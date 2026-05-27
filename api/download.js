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

function makeStreamUrl(params, req) {
  var protocol = req.headers && req.headers['x-forwarded-proto'] ? req.headers['x-forwarded-proto'] : 'https';
  var host = req.headers && req.headers['host'] ? req.headers['host'] : 'localhost:3000';
  var qs = Object.keys(params).map(function(k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return protocol + '://' + host + '/api/stream?' + qs;
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

      var itag = '18';
      if (qualityHeight <= 360) itag = '18';
      else if (qualityHeight <= 480) itag = '18';
      else if (qualityHeight <= 720) itag = '22';
      else itag = '22';

      var safeName = 'video';
      if (body.format_id && body.format_id !== 'best') itag = body.format_id;

      res.status(200).json({
        url: makeStreamUrl({
          id: videoId,
          itag: itag,
          quality: String(qualityHeight),
          filename: safeName + '.mp4',
        }, req),
        filename: safeName + '.mp4',
        hasAudio: true,
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
