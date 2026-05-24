function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

const INVIDIOUS_BASES = ['https://inv.thepixora.com'];

let lastRefresh = 0;

async function refreshInstances() {
  try {
    const r = await fetch('https://api.invidious.io/instances.json', { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    const apiInstances = data.filter(i => i[1]?.api && !i[1]?.flagged).map(i => 'https://' + i[0]);
    if (apiInstances.length > 0) { INVIDIOUS_BASES.length = 0; INVIDIOUS_BASES.push(...apiInstances); }
  } catch {}
}

async function fetchInvidious(videoId) {
  const now = Date.now();
  if (now - lastRefresh > 3600000) { lastRefresh = now; await refreshInstances(); }

  for (const base of INVIDIOUS_BASES) {
    try {
      const r = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'NeonExtraction/1.0' },
      });
      if (r.ok) return await r.json();
    } catch {}
  }
  throw new Error('Could not fetch video info. Please try again later.');
}

async function handleYouTubeDownload(url, quality, res) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID');

  const data = await fetchInvidious(videoId);
  const safeName = (data.title || 'video').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);

  const qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;

  const muxed = data.formatStreams || [];
  const adaptive = data.adaptiveFormats || [];

  // Try muxed (video+audio) first
  const muxedMatch = muxed
    .filter(f => f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight)
    .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0))[0];

  if (muxedMatch?.url) {
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    return res.redirect(302, muxedMatch.url);
  }

  // Fall back to video-only adaptive + audio
  const videoFormats = adaptive
    .filter(f => f.type?.startsWith('video/') && f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight)
    .sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));

  const bestVideo = videoFormats[0];
  const bestAudio = adaptive
    .filter(f => f.type?.startsWith('audio/'))
    .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0))[0];

  if (bestVideo?.url) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
    res.setHeader('X-Filename', `${safeName}.mp4`);
    return res.redirect(302, bestVideo.url);
  }

  throw new Error('No downloadable format found for this quality');
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' }, responseLimit: false },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url, quality } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform = detectPlatform(url);

    if (platform === 'youtube') {
      await handleYouTubeDownload(url, quality, res);
    } else {
      res.status(400).json({
        error: `${platform} downloads are not supported on Vercel (serverless). Use the local server for full platform support.`,
      });
    }
  } catch (err) {
    console.error('[NEON API] Download error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Download failed' });
    }
  }
}
