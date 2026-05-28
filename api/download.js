var COBALT_INSTANCE = 'https://co.eepy.today';

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

function extractVideoId(url) {
  var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

var YT_CLIENTS = [
  { clientName: 'ANDROID_VR', clientVersion: '1.30.1', ua: 'com.google.android.apps.youtube.vr/1.30.1 (Linux; U; Android 12; Pixel 6)', sdk: '32', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { clientName: 'ANDROID_VR', clientVersion: '1.35.1', ua: 'com.google.android.apps.youtube.vr/1.35.1 (Linux; U; Android 14; Quest 3)', sdk: '34', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { clientName: 'ANDROID', clientVersion: '19.02.39', ua: 'com.google.android.youtube/19.02.39 (Linux; U; Android 14; Pixel 8 Pro)', sdk: '30', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
];

function tryYouTubeClient(videoId, c) {
  var ctx = { client: { clientName: c.clientName, clientVersion: c.clientVersion, hl: 'en', gl: 'US' } };
  if (c.sdk) ctx.client.androidSdkVersion = c.sdk;
  var body = JSON.stringify({ videoId: videoId, context: ctx, contentCheckOk: true, racyCheckOk: true });
  var url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + c.key;
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua }, body: body })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.playabilityStatus && data.playabilityStatus.status === 'OK' && data.streamingData) return data;
      throw new Error(data.playabilityStatus?.status || 'failed');
    });
}

function fetchYouTubePlayer(videoId) {
  var chain = Promise.reject(new Error('no clients'));
  YT_CLIENTS.forEach(function(c) {
    chain = chain.catch(function() { return tryYouTubeClient(videoId, c); });
  });
  return chain;
}

function getStreamUrl(format) {
  if (format.url && format.url.indexOf('http') === 0 && (format.url.indexOf('.googlevideo.com/') !== -1 || format.url.indexOf('.youtube.com/') !== -1)) return format.url;
  if (format.signatureCipher) {
    var parts = format.signatureCipher.split('&');
    var url = null;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('url=') === 0) url = decodeURIComponent(parts[i].substring(4));
    }
    if (url && url.indexOf('.googlevideo.com/') !== -1) return url;
  }
  return null;
}

function findFormat(formats, qualityHeight, preferMp4) {
  var valid = formats.filter(function(f) {
    var streamUrl = getStreamUrl(f);
    if (!streamUrl) return false;
    var h = f.height || parseInt(f.qualityLabel) || 0;
    return h <= qualityHeight;
  }).map(function(f) { return Object.assign({}, f, { _streamUrl: getStreamUrl(f) }); });
  valid.sort(function(a, b) {
    var ha = a.height || parseInt(a.qualityLabel) || 0;
    var hb = b.height || parseInt(b.qualityLabel) || 0;
    if (hb !== ha) return hb - ha;
    if (preferMp4) { return (b.mimeType?.indexOf('mp4') !== -1 ? 1 : 0) - (a.mimeType?.indexOf('mp4') !== -1 ? 1 : 0); }
    return 0;
  });
  return valid[0] || null;
}

function fetchCobalt(url) {
  var body = JSON.stringify({ url: url, downloadMode: 'auto', youtubeVideoCodec: 'h264' });
  return fetch(COBALT_INSTANCE + '/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: body })
    .then(function(r) { if (!r.ok) throw new Error('Cobalt HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.status === 'error') throw new Error(data.error?.code || 'cobalt error');
      return data;
    });
}

function getCobaltUrl(data) {
  if (data.url) return data.url;
  if (data.tunnel && data.tunnel.length > 0) return data.tunnel[0];
  if (data.picker && data.picker.length > 0) {
    var vid = data.picker.find(function(p) { return p.type === 'video'; });
    if (vid && vid.url) return vid.url;
    if (data.picker[0].url) return data.picker[0].url;
  }
  return null;
}

function extractTwitterStatusId(url) {
  var m = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return m ? m[1] : null;
}

function fetchVxtwitter(screenName, statusId) {
  return fetch('https://api.vxtwitter.com/' + screenName + '/status/' + statusId, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
  }).then(function(r) { if (!r.ok) throw new Error('vxtwitter HTTP ' + r.status); return r.json(); });
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    var body = req.body || {};
    var url = body.url;
    var quality = body.quality;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    var platform = detectPlatform(url);
    var qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;

    if (platform === 'youtube') {
      var videoId = extractVideoId(url);
      if (!videoId) return res.status(400).json({ error: 'Could not extract YouTube video ID' });

      fetchYouTubePlayer(videoId).then(function(playerData) {
        var title = (playerData.videoDetails && playerData.videoDetails.title) || 'video';
        var safeName = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);
        var filename = safeName + '.mp4';
        var formats = (playerData.streamingData && playerData.streamingData.formats) || [];
        var adaptiveFormats = (playerData.streamingData && playerData.streamingData.adaptiveFormats) || [];

        var muxedMatch = findFormat(formats, qualityHeight, true);
        if (muxedMatch && muxedMatch._streamUrl) return res.status(200).json({ url: muxedMatch._streamUrl, filename: filename, hasAudio: true });

        var videoMatch = findFormat(adaptiveFormats.filter(function(f) { return f.mimeType && f.mimeType.indexOf('video/') === 0; }), qualityHeight, true);
        var audioFormats = adaptiveFormats.filter(function(f) { return f.mimeType && f.mimeType.indexOf('audio/') === 0 && getStreamUrl(f); }).sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        var bestAudioUrl = audioFormats.length > 0 ? getStreamUrl(audioFormats[0]) : null;

        if (videoMatch && videoMatch._streamUrl) return res.status(200).json({ url: videoMatch._streamUrl, filename: filename, hasAudio: false, audioUrl: bestAudioUrl, qualityLabel: videoMatch.qualityLabel });

        var anyMuxed = findFormat(formats, 99999, true);
        if (anyMuxed && anyMuxed._streamUrl) return res.status(200).json({ url: anyMuxed._streamUrl, filename: filename, hasAudio: true, fallback: true });

        res.status(200).json({ url: 'https://cobalt.tools/', filename: filename, hasAudio: true, redirect: true, message: 'Could not get direct download URL. Use cobalt.tools to download.' });
      }).catch(function() {
        fetchCobalt(url).then(function(cobaltData) {
          var cobaltUrl = getCobaltUrl(cobaltData);
          if (cobaltUrl) return res.status(200).json({ url: cobaltUrl, filename: cobaltData.output?.filename || cobaltData.filename || 'video.mp4', hasAudio: true });
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not get direct download URL. Use cobalt.tools to download.' });
        }).catch(function() {
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not get direct download URL. Use cobalt.tools to download.' });
        });
      });
      return;
    }

    if (platform === 'twitter') {
      var statusId = extractTwitterStatusId(url);
      var screenName = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status/);
      screenName = screenName ? screenName[1] : 'i';
      fetchVxtwitter(screenName, statusId || '').then(function(data) {
        if (data.media_extended && data.media_extended.length > 0) {
          var videos = data.media_extended.filter(function(m) { return m.type === 'video' || m.type === 'gif'; });
          if (videos.length > 0 && videos[0].url) {
            var safeName = (data.user_name || 'twitter').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 40);
            return res.status(200).json({ url: videos[0].url, filename: safeName + '.mp4', hasAudio: true });
          }
        }
        fetchCobalt(url).then(function(cobaltData) {
          var cobaltUrl = getCobaltUrl(cobaltData);
          if (cobaltUrl) return res.status(200).json({ url: cobaltUrl, filename: cobaltData.output?.filename || cobaltData.filename || 'video.mp4', hasAudio: true });
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        }).catch(function() {
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        });
      }).catch(function() {
        fetchCobalt(url).then(function(cobaltData) {
          var cobaltUrl = getCobaltUrl(cobaltData);
          if (cobaltUrl) return res.status(200).json({ url: cobaltUrl, filename: cobaltData.output?.filename || cobaltData.filename || 'video.mp4', hasAudio: true });
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        }).catch(function() {
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        });
      });
      return;
    }

    fetchCobalt(url).then(function(cobaltData) {
      var cobaltUrl = getCobaltUrl(cobaltData);
      if (cobaltUrl) return res.status(200).json({ url: cobaltUrl, filename: cobaltData.output?.filename || cobaltData.filename || 'video.mp4', hasAudio: true });
      res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
    }).catch(function() {
      res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: platform + ' download failed. Try cobalt.tools directly.' });
    });
  } catch (err) {
    console.error('[NEON] Sync error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
};
