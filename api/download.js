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

function fetchCobalt(url) {
  var body = JSON.stringify({ url: url });

  return fetch(COBALT_INSTANCE + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body,
  })
    .then(function(r) { if (!r.ok) throw new Error('Cobalt HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.status === 'error') {
        throw new Error(data.error && data.error.code ? data.error.code : 'cobalt error');
      }
      return data;
    });
}

function extractTwitterStatusId(url) {
  var m = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return m ? m[1] : null;
}

function fetchVxtwitter(screenName, statusId) {
  return fetch('https://api.vxtwitter.com/' + screenName + '/status/' + statusId, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
  })
    .then(function(r) { if (!r.ok) throw new Error('vxtwitter HTTP ' + r.status); return r.json(); });
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
          return res.status(200).json({ url: muxedMatch.url, filename: filename, hasAudio: true });
        }

        var videoMatch = findFormat(
          adaptiveFormats.filter(function(f) { return f.mimeType && f.mimeType.indexOf('video/') === 0; }),
          qualityHeight, true
        );

        var audioFormats = adaptiveFormats.filter(function(f) {
          return f.mimeType && f.mimeType.indexOf('audio/') === 0 && isValidStreamUrl(f.url);
        }).sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        var bestAudio = audioFormats[0] || null;

        if (videoMatch && videoMatch.url) {
          return res.status(200).json({
            url: videoMatch.url, filename: filename, hasAudio: false,
            audioUrl: bestAudio ? bestAudio.url : null,
            qualityLabel: videoMatch.qualityLabel,
          });
        }

        var anyMuxed = findFormat(formats, 99999, true);
        if (anyMuxed && anyMuxed.url) {
          return res.status(200).json({ url: anyMuxed.url, filename: filename, hasAudio: true, fallback: true });
        }

        res.status(200).json({ url: 'https://cobalt.tools/', filename: filename, hasAudio: true, redirect: true, message: 'Could not get direct download URL. Use cobalt.tools to download.' });
      }).catch(function(err) {
        console.error('[NEON] YouTube download error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to get download URL: ' + err.message });
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
          if (cobaltData.url) {
            var fn = cobaltData.filename || 'twitter_video.mp4';
            return res.status(200).json({ url: cobaltData.url, filename: fn, hasAudio: true });
          }
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        }).catch(function() {
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        });
      }).catch(function() {
        fetchCobalt(url).then(function(cobaltData) {
          if (cobaltData.url) {
            return res.status(200).json({ url: cobaltData.url, filename: cobaltData.filename || 'video.mp4', hasAudio: true });
          }
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        }).catch(function() {
          res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
        });
      });
      return;
    }

    fetchCobalt(url).then(function(cobaltData) {
      var fn = cobaltData.filename || 'video.mp4';
      if (cobaltData.status === 'redirect' && cobaltData.url) {
        res.status(200).json({ url: cobaltData.url, filename: fn, hasAudio: true });
        return;
      }
      if (cobaltData.status === 'tunnel' && cobaltData.url) {
        res.status(200).json({ url: cobaltData.url, filename: fn, hasAudio: true });
        return;
      }
      if (cobaltData.status === 'picker' && cobaltData.picker && cobaltData.picker.length > 0) {
        var pick = cobaltData.picker.find(function(p) { return p.type === 'video'; }) || cobaltData.picker[0];
        if (pick && pick.url) {
          res.status(200).json({ url: pick.url, filename: fn, hasAudio: true });
          return;
        }
      }
      if (cobaltData.url) {
        res.status(200).json({ url: cobaltData.url, filename: fn, hasAudio: true });
        return;
      }
      res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not extract video. Try cobalt.tools directly.' });
    }).catch(function() {
      res.status(200).json({ url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: platform + ' download failed. Try cobalt.tools directly.' });
    });
  } catch (err) {
    console.error('[NEON] Sync error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
};
