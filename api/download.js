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

function tryInvidious(videoId, timeout) {
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

function fetchYouTubePlayer(videoId) {
  var body = JSON.stringify({
    videoId: videoId,
    context: {
      client: {
        clientName: 'ANDROID_VR',
        clientVersion: '1.30.1',
        hl: 'en',
        gl: 'US',
        androidSdkVersion: '32',
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  });

  return fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'com.google.android.apps.youtube.vr/1.30.1 (Linux; U; Android 12; Pixel 6 Build/SD1A.210817.015.A4)',
    },
    body: body,
  })
    .then(function(r) { if (!r.ok) throw new Error('YouTube API HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.playabilityStatus && data.playabilityStatus.status !== 'OK') {
        throw new Error(data.playabilityStatus.reason || data.playabilityStatus.status);
      }
      return data;
    });
}

function isValidStreamUrl(url) {
  if (!url) return false;
  return url.indexOf('http') === 0 && url.indexOf('.googlevideo.com/') !== -1;
}

function findFormat(formats, qualityHeight, preferMp4) {
  var valid = formats.filter(function(f) {
    if (!isValidStreamUrl(f.url)) return false;
    var h = f.height || parseInt(f.qualityLabel) || 0;
    return h <= qualityHeight;
  });

  valid.sort(function(a, b) {
    var ha = a.height || parseInt(a.qualityLabel) || 0;
    var hb = b.height || parseInt(b.qualityLabel) || 0;
    if (hb !== ha) return hb - ha;
    if (preferMp4) {
      var aMp4 = a.mimeType && a.mimeType.indexOf('mp4') !== -1 ? 1 : 0;
      var bMp4 = b.mimeType && b.mimeType.indexOf('mp4') !== -1 ? 1 : 0;
      return bMp4 - aMp4;
    }
    return 0;
  });

  return valid[0] || null;
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
        if (muxedMatch && muxedMatch.url) {
          return res.status(200).json({
            url: muxedMatch.url,
            filename: filename,
            hasAudio: true,
          });
        }

        var videoMatch = findFormat(
          adaptiveFormats.filter(function(f) { return f.mimeType && f.mimeType.indexOf('video/') === 0; }),
          qualityHeight,
          true
        );

        var audioFormats = adaptiveFormats.filter(function(f) {
          return f.mimeType && f.mimeType.indexOf('audio/') === 0 && isValidStreamUrl(f.url);
        }).sort(function(a, b) {
          return (b.bitrate || 0) - (a.bitrate || 0);
        });
        var bestAudio = audioFormats[0] || null;

        if (videoMatch && videoMatch.url) {
          return res.status(200).json({
            url: videoMatch.url,
            filename: filename,
            hasAudio: false,
            audioUrl: bestAudio ? bestAudio.url : null,
            qualityLabel: videoMatch.qualityLabel,
          });
        }

        var anyMuxed = findFormat(formats, 99999, true);
        if (anyMuxed && anyMuxed.url) {
          return res.status(200).json({
            url: anyMuxed.url,
            filename: filename,
            hasAudio: true,
            fallback: true,
          });
        }

        res.status(200).json({
          url: 'https://cobalt.tools/',
          filename: filename,
          hasAudio: true,
          redirect: true,
          message: 'Could not get direct download URL. Use cobalt.tools to download this video.',
        });
      }).catch(function(ytErr) {
        console.error('[NEON] YouTube player error:', ytErr.message);

        tryInvidious(videoId, 6000).then(function(result) {
          if (result && result.data) {
            var data = result.data;
            var safeName2 = (data.title || 'video').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);
            var filename2 = safeName2 + '.mp4';
            var muxed = data.formatStreams || [];
            var adaptive = (data.adaptiveFormats || []).filter(function(f) { return f.type && f.type.indexOf('video/') === 0; });

            var muxedMatch2 = muxed
              .filter(function(f) { return f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight && isValidStreamUrl(f.url); })
              .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];

            if (muxedMatch2 && muxedMatch2.url) {
              return res.status(200).json({ url: muxedMatch2.url, filename: filename2, hasAudio: true });
            }

            var bestVideo2 = adaptive
              .filter(function(f) { return f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight && isValidStreamUrl(f.url); })
              .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];

            if (bestVideo2 && bestVideo2.url) {
              var audioFormats2 = (data.adaptiveFormats || [])
                .filter(function(f) { return f.type && f.type.indexOf('audio/') === 0 && isValidStreamUrl(f.url); })
                .sort(function(a, b) { return (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0); });
              return res.status(200).json({
                url: bestVideo2.url,
                filename: filename2,
                hasAudio: false,
                audioUrl: audioFormats2[0] ? audioFormats2[0].url : null,
                qualityLabel: bestVideo2.qualityLabel,
              });
            }
          }

          res.status(200).json({
            url: 'https://cobalt.tools/',
            filename: 'video.mp4',
            hasAudio: true,
            redirect: true,
            message: 'Could not get direct download URL. Use cobalt.tools to download this video.',
          });
        });
      });
      return;
    }

    res.status(200).json({
      url: 'https://cobalt.tools/',
      filename: 'video.mp4',
      hasAudio: true,
      redirect: true,
      message: platform + ' downloads require cobalt.tools. Paste your URL there to download.',
    });
  } catch (err) {
    console.error('[NEON] Sync error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
};
