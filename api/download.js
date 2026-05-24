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

var PRIMARY = 'https://inv.thepixora.com';
var PROXY_URL = 'https://api.codetabs.com/v1/proxy?quest=';

function makeAbort(ms) {
  var c = new AbortController();
  setTimeout(function() { c.abort(); }, ms);
  return c.signal;
}

function tryFetch(url, timeout) {
  return fetch(url, { signal: makeAbort(timeout), headers: { 'User-Agent': 'Mozilla/5.0' } })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

function fetchVideoInfo(videoId) {
  var directUrl = PRIMARY + '/api/v1/videos/' + videoId;
  var proxyUrl = PROXY_URL + encodeURIComponent(directUrl);

  var directPromise = tryFetch(directUrl, 5000).catch(function() { return null; });
  var proxyPromise = tryFetch(proxyUrl, 8000).catch(function() { return null; });

  return Promise.all([directPromise, proxyPromise]).then(function(results) {
    var direct = results[0];
    var proxy = results[1];
    var result = (direct && direct.title) ? direct : (proxy && proxy.title) ? proxy : null;
    if (result) return result;
    throw new Error('Could not fetch video info. Please try again.');
  });
}

function handleYouTubeDownload(url, quality, res) {
  var videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID');

  return fetchVideoInfo(videoId).then(function(data) {
    var safeName = (data.title || 'video').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);
    var qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;

    var muxed = data.formatStreams || [];
    var adaptive = data.adaptiveFormats || [];

    var muxedMatch = muxed
      .filter(function(f) { return f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight; })
      .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];

    if (muxedMatch && muxedMatch.url) {
      res.setHeader('Content-Disposition', 'attachment; filename="' + safeName + '.mp4"');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      return res.redirect(302, muxedMatch.url);
    }

    var videoFormats = adaptive
      .filter(function(f) { return f.type && f.type.startsWith('video/') && f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight; })
      .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); });

    var bestVideo = videoFormats[0];
    if (bestVideo && bestVideo.url) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
      res.setHeader('X-Filename', safeName + '.mp4');
      return res.redirect(302, bestVideo.url);
    }

    throw new Error('No downloadable format found');
  });
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  var url = body.url;
  var quality = body.quality;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  var platform = detectPlatform(url);
  if (platform === 'youtube') {
    handleYouTubeDownload(url, quality, res).catch(function(err) {
      console.error('[NEON] Download error:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message || 'Download failed' });
    });
  } else {
    res.status(400).json({ error: platform + ' not supported on Vercel. Use local server.' });
  }
};
