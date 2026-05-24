function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

const PRIMARY = 'https://inv.thepixora.com';
const PROXY_URL = 'https://api.codetabs.com/v1/proxy?quest=';

function makeAbort(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function tryFetch(url, timeout) {
  const r = await fetch(url, { signal: makeAbort(timeout), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function fetchVideoInfo(videoId) {
  const directUrl = `${PRIMARY}/api/v1/videos/${videoId}`;
  const proxyUrl = PROXY_URL + encodeURIComponent(directUrl);

  const directPromise = tryFetch(directUrl, 5000).catch(() => null);
  const proxyPromise = tryFetch(proxyUrl, 8000).catch(() => null);

  const [direct, proxy] = await Promise.all([directPromise, proxyPromise]);
  const result = direct?.title ? direct : proxy?.title ? proxy : null;
  if (result) return result;

  throw new Error('Could not fetch video info. Please try again.');
}

async function handleYouTubeDownload(url, quality, res) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID');

  const data = await fetchVideoInfo(videoId);
  const safeName = (data.title || 'video').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);
  const qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;

  const muxed = data.formatStreams || [];
  const adaptive = data.adaptiveFormats || [];

  const muxedMatch = muxed
    .filter(f => f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight)
    .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0))[0];

  if (muxedMatch?.url) {
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.redirect(302, muxedMatch.url);
  }

  const videoFormats = adaptive
    .filter(f => f.type?.startsWith('video/') && f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight)
    .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));

  const bestVideo = videoFormats[0];
  if (bestVideo?.url) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
    res.setHeader('X-Filename', `${safeName}.mp4`);
    return res.redirect(302, bestVideo.url);
  }

  throw new Error('No downloadable format found');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url, quality } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform = detectPlatform(url);
    if (platform === 'youtube') {
      await handleYouTubeDownload(url, quality, res);
    } else {
      res.status(400).json({ error: `${platform} not supported on Vercel. Use local server.` });
    }
  } catch (err) {
    console.error('[NEON] Download error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Download failed' });
  }
}
