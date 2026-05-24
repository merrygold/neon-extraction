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

const INSTANCES = ['https://inv.thepixora.com'];
const PROXY_URL = 'https://api.codetabs.com/v1/proxy?quest=';
let cachedInstances = INSTANCES;
let lastRefresh = 0;

async function getInstances() {
  const now = Date.now();
  if (now - lastRefresh < 600000) return cachedInstances;
  lastRefresh = now;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 4000);
    const r = await fetch('https://api.invidious.io/instances.json', { signal: controller.signal });
    if (r.ok) {
      const data = await r.json();
      const list = data.filter(i => i[1]?.api && !i[1]?.flagged).map(i => 'https://' + i[0]);
      if (list.length > 0) { cachedInstances = [...new Set([...list, ...INSTANCES])]; return cachedInstances; }
    }
  } catch {}
  return cachedInstances;
}

async function fetchFromInstance(base, videoId) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);
  const r = await fetch(`${base}/api/v1/videos/${videoId}`, {
    signal: controller.signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (r.ok) { const data = await r.json(); if (data.title) return data; }
  throw new Error('Failed from ' + base);
}

async function fetchViaProxy(videoId) {
  const targetUrl = encodeURIComponent(`${INSTANCES[0]}/api/v1/videos/${videoId}`);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15000);
  const r = await fetch(PROXY_URL + targetUrl, { signal: controller.signal });
  if (!r.ok) throw new Error('Proxy HTTP ' + r.status);
  const data = await r.json();
  if (data.title) return data;
  throw new Error('No title in proxy response');
}

async function fetchVideoInfo(videoId) {
  const instances = await getInstances();
  for (const base of instances) {
    try { return await fetchFromInstance(base, videoId); } catch {}
  }
  try { return await fetchViaProxy(videoId); } catch {}
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
