var INSTANCES = [
  'https://inv.thepixora.com',
  'https://invidious.fdn.fr',
  'https://vid.puffyan.us',
  'https://invidious.nerdvpn.de',
  'https://iv.ggtyler.dev',
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
          .then(function(d) { if (d && d.title) { resolve(d); } else { resolve(null); } })
          .catch(function() { clearTimeout(timer); resolve(null); });
      } catch (e) { resolve(null); }
    });
  });
  return Promise.all(promises).then(function(results) {
    return results.find(function(r) { return r !== null; }) || null;
  });
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
    if (platform !== 'youtube') return res.status(400).json({ error: platform + ' not supported on Vercel' });

    var videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'Could not extract YouTube video ID' });

    tryFetchVideo(videoId, 6000).then(function(data) {
      if (!data) {
        if (!res.headersSent) res.status(500).json({ error: 'Could not fetch video info from any instance' });
        return;
      }

      var safeName = (data.title || 'video').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);
      var qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;

      var muxed = data.formatStreams || [];
      var adaptive = data.adaptiveFormats || [];

      var muxedMatch = muxed
        .filter(function(f) { return f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight; })
        .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];

      if (muxedMatch && muxedMatch.url) {
        return res.status(200).json({
          url: muxedMatch.url,
          filename: safeName + '.mp4',
          hasAudio: true,
        });
      }

      var videoFormats = adaptive
        .filter(function(f) { return f.type && f.type.indexOf('video/') === 0 && f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight; })
        .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); });

      var bestVideo = videoFormats[0];

      var audioFormats = adaptive
        .filter(function(f) { return f.type && f.type.indexOf('audio/') === 0; })
        .sort(function(a, b) { return (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0); });
      var bestAudio = audioFormats[0];

      if (bestVideo && bestVideo.url) {
        return res.status(200).json({
          url: bestVideo.url,
          filename: safeName + '.mp4',
          hasAudio: false,
          audioUrl: bestAudio ? bestAudio.url : null,
          qualityLabel: bestVideo.qualityLabel,
        });
      }

      var fallback = muxed.sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];
      if (fallback && fallback.url) {
        return res.status(200).json({
          url: fallback.url,
          filename: safeName + '.mp4',
          hasAudio: true,
          fallback: true,
        });
      }

      if (!res.headersSent) res.status(500).json({ error: 'No downloadable format found' });
    }).catch(function(err) {
      console.error('[NEON] Download error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message || 'Download failed' });
    });
  } catch (err) {
    console.error('[NEON] Sync error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  }
};
