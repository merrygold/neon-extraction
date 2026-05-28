var INSTANCES = [
  'https://inv.thepixora.com',
  'https://invidious.nerdvpn.de',
  'https://iv.ggtyler.dev',
  'https://inv.nadeko.net',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://invidious.f5.si',
];

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
  { name: 'ANDROID_VR', clientName: 'ANDROID_VR', clientVersion: '1.30.1', ua: 'com.google.android.apps.youtube.vr/1.30.1 (Linux; U; Android 12; Pixel 6)', sdk: '32', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { name: 'ANDROID_VR_V2', clientName: 'ANDROID_VR', clientVersion: '1.35.1', ua: 'com.google.android.apps.youtube.vr/1.35.1 (Linux; U; Android 14; Quest 3)', sdk: '34', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { name: 'ANDROID', clientName: 'ANDROID', clientVersion: '19.02.39', ua: 'com.google.android.youtube/19.02.39 (Linux; U; Android 14; Pixel 8 Pro)', sdk: '30', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { name: 'ANDROID_MUSIC', clientName: 'ANDROID_MUSIC', clientVersion: '7.11.50', ua: 'com.google.android.apps.youtube.music/7.11.50 (Linux; U; Android 14)', sdk: '34', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
];

function fetchYouTubePlayer(videoId) {
  var clients = YT_CLIENTS.slice();

  function tryNext() {
    if (clients.length === 0) return Promise.reject(new Error('All YouTube clients failed'));

    var c = clients.shift();
    var ctx = {
      client: {
        clientName: c.clientName,
        clientVersion: c.clientVersion,
        hl: 'en',
        gl: 'US',
      },
    };
    if (c.sdk) ctx.client.androidSdkVersion = c.sdk;

    var body = JSON.stringify({
      videoId: videoId,
      context: ctx,
      contentCheckOk: true,
      racyCheckOk: true,
    });

    var url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
    if (c.key) url += '&key=' + c.key;

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.ua,
      },
      body: body,
    })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        if (data.playabilityStatus && data.playabilityStatus.status === 'OK' && data.videoDetails) {
          return data;
        }
        return tryNext();
      })
      .catch(function() { return tryNext(); });
  }

  return tryNext();
}

function parseYouTubeFormats(playerData) {
  var formats = (playerData.streamingData && playerData.streamingData.formats) || [];
  var adaptiveFormats = (playerData.streamingData && playerData.streamingData.adaptiveFormats) || [];
  var seen = {};
  var qualities = [];

  var allFormats = formats.concat(adaptiveFormats).filter(function(f) {
    return f.mimeType && f.mimeType.indexOf('video/') === 0 && f.qualityLabel;
  });

  allFormats.sort(function(a, b) {
    return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0);
  });

  for (var i = 0; i < allFormats.length; i++) {
    var f = allFormats[i];
    var label = f.qualityLabel || '360p';
    if (!seen[label]) {
      seen[label] = true;
      var isMuxed = formats.some(function(m) { return m.itag === f.itag; });
      var codec = '';
      if (f.mimeType) {
        var cm = f.mimeType.match(/codecs="([^"]+)"/);
        codec = cm ? cm[1].split(',')[0].trim() : '';
      }
      qualities.push({
        label: label,
        height: parseInt(label) || 0,
        format_id: f.itag ? String(f.itag) : '',
        ext: f.mimeType && f.mimeType.indexOf('mp4') !== -1 ? 'mp4' : 'webm',
        filesize: f.contentLength ? parseInt(f.contentLength) : null,
        vcodec: codec,
        acodec: isMuxed ? 'aac' : '',
        vbr: f.bitrate ? Math.round(f.bitrate / 1000) : null,
        abr: null,
        tbr: null,
        hasAudio: isMuxed,
        isMuxed: isMuxed,
      });
    }
  }

  if (qualities.length === 0) {
    qualities.push({ label: '360p', height: 360, format_id: '18', ext: 'mp4', filesize: null, vcodec: 'h264', acodec: 'aac', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true });
  }
  return qualities;
}

function tryFetchVideo(videoId, timeout) {
  var promises = INSTANCES.map(function(instance) {
    return new Promise(function(resolve) {
      try {
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, timeout);
        fetch(instance + '/api/v1/videos/' + videoId, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
          .then(function(r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(d) { if (d && d.title) { resolve({ data: d, instance: instance }); } else { resolve(null); } })
          .catch(function() { clearTimeout(timer); resolve(null); });
      } catch (e) { resolve(null); }
    });
  });
  return Promise.all(promises).then(function(results) {
    return results.find(function(r) { return r !== null; }) || null;
  });
}

function parseInvidiousFormats(data) {
  var seen = {};
  var qualities = [];
  var muxed = data.formatStreams || [];
  var adaptive = (data.adaptiveFormats || []).filter(function(f) { return f.type && f.type.indexOf('video/') === 0 && f.qualityLabel; });
  var all = muxed.concat(adaptive).sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); });

  for (var i = 0; i < all.length; i++) {
    var f = all[i];
    var label = f.qualityLabel || '360p';
    if (!seen[label]) {
      seen[label] = true;
      var isMuxed = muxed.some(function(m) { return m.qualityLabel === label && m.itag === f.itag; });
      qualities.push({
        label: label, height: parseInt(label) || 0,
        format_id: f.itag ? f.itag.toString() : '', ext: f.container || 'mp4',
        filesize: f.clen ? parseInt(f.clen) : null,
        vcodec: f.encoding || '', acodec: '',
        vbr: f.bitrate ? Math.round(parseInt(f.bitrate) / 1000) : null,
        abr: null, tbr: null,
        hasAudio: isMuxed, isMuxed: isMuxed,
      });
    }
  }

  if (qualities.length === 0) {
    qualities.push({ label: '360p', height: 360, format_id: '18', ext: 'mp4', filesize: null, vcodec: 'h264', acodec: 'aac', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true });
  }
  return qualities;
}

function fetchOEmbed(url) {
  return fetch('https://www.youtube.com/oembed?url=' + encodeURIComponent(url) + '&format=json', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
    .then(function(r) { if (!r.ok) throw new Error('oEmbed HTTP ' + r.status); return r.json(); })
    .catch(function() { return null; });
}

function fetchNoembed(url) {
  return fetch('https://noembed.com/embed?url=' + encodeURIComponent(url), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
    .then(function(r) { if (!r.ok) throw new Error('noembed HTTP ' + r.status); return r.json(); })
    .catch(function() { return null; });
}

function makeGenericResponse(platform) {
  return {
    title: 'Video from ' + platform, thumbnail: null,
    duration: 0, description: '', platform: platform,
    qualities: [{ label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true }],
    uploader: '', view_count: 0, like_count: 0,
  };
}

module.exports = function handler(req, res) {
  function json(data, status) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status || 200).json(data);
  }

  try {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    var body = req.body || {};
    var url = body.url;
    if (!url) return json({ error: 'URL is required' }, 400);

    var platform = detectPlatform(url);

    if (platform === 'youtube') {
      var videoId = extractVideoId(url);
      if (!videoId) return json({ error: 'Could not extract YouTube video ID' }, 400);

      fetchYouTubePlayer(videoId).then(function(playerData) {
        var details = playerData.videoDetails || {};
        var microformat = playerData.microformat && playerData.microformat.playerMicroformatRenderer || {};
        var thumb = 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg';
        if (details.thumbnail && details.thumbnail.thumbnails && details.thumbnail.thumbnails.length > 0) {
          var best = details.thumbnail.thumbnails[details.thumbnail.thumbnails.length - 1];
          if (best.url) thumb = best.url;
        }

        json({
          title: details.title || 'Untitled',
          thumbnail: thumb,
          duration: parseInt(details.lengthSeconds) || 0,
          description: (details.shortDescription || '').slice(0, 300),
          platform: 'youtube',
          qualities: parseYouTubeFormats(playerData),
          uploader: details.author || '',
          view_count: parseInt(details.viewCount) || 0,
          like_count: 0,
        });
      }).catch(function(ytErr) {
        console.error('[NEON] YouTube player error:', ytErr.message);

        tryFetchVideo(videoId, 5000).then(function(result) {
          if (result && result.data) {
            var data = result.data;
            var thumb2 = (data.videoThumbnails || []).find(function(t) { return t.quality === 'maxres'; }) || (data.videoThumbnails || [])[0];
            var thumbUrl = (thumb2 && thumb2.url && thumb2.url.indexOf('http') === 0) ? thumb2.url : ('https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg');

            json({
              title: data.title || 'Untitled', thumbnail: thumbUrl,
              duration: data.lengthSeconds || 0,
              description: (data.description || '').slice(0, 300),
              platform: 'youtube', qualities: parseInvidiousFormats(data),
              uploader: data.author || '',
              view_count: data.viewCount || 0, like_count: data.likeCount || 0,
            });
            return;
          }

          fetchOEmbed(url).then(function(oembed) {
            if (!oembed) return json({ error: 'Could not fetch video info. Try again later.' }, 500);
            json({
              title: oembed.title || 'Untitled',
              thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg',
              duration: 0, description: '', platform: 'youtube',
              qualities: [{
                label: '360p', height: 360, format_id: '18', ext: 'mp4', filesize: null,
                vcodec: 'h264', acodec: 'aac', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true,
              }],
              uploader: oembed.author_name || '', view_count: 0, like_count: 0,
            });
          });
        });
      });
      return;
    }

    fetchNoembed(url).then(function(noembed) {
      if (noembed && !noembed.error) {
        json({
          title: noembed.title || 'Video from ' + platform,
          thumbnail: noembed.thumbnail_url || null,
          duration: 0, description: '', platform: platform,
          qualities: [{ label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true }],
          uploader: noembed.author_name || '', view_count: 0, like_count: 0,
        });
        return;
      }

      if (platform === 'twitter') {
        fetch('https://publish.twitter.com/oembed?url=' + encodeURIComponent(url) + '&omit_script=true', {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
          .then(function(r) { if (!r.ok) throw new Error('Twitter oEmbed HTTP ' + r.status); return r.json(); })
          .then(function(tw) {
            json({
              title: tw.author_name ? tw.author_name + ' on X' : 'Post on X',
              thumbnail: null, duration: 0, description: '', platform: 'twitter',
              qualities: [{ label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true }],
              uploader: tw.author_name || '', view_count: 0, like_count: 0,
            });
          })
          .catch(function() { json(makeGenericResponse(platform)); });
        return;
      }

      json(makeGenericResponse(platform));
    }).catch(function() { json(makeGenericResponse(platform)); });
  } catch (err) {
    console.error('[NEON] Sync error:', err);
    json({ error: 'Internal error' }, 500);
  }
};
