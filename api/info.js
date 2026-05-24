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

const INVIDIOUS_BASES = [
  'https://inv.thepixora.com',
];

async function fetchInvidious(videoId, retries = INVIDIOUS_BASES.length) {
  for (let i = 0; i < retries; i++) {
    const base = INVIDIOUS_BASES[i % INVIDIOUS_BASES.length];
    try {
      const r = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'NeonExtraction/1.0' },
      });
      if (r.ok) {
        const data = await r.json();
        data._instance = base;
        return data;
      }
    } catch {}
  }
  throw new Error('All Invidious instances failed. Please try again later.');
}

async function refreshInstances() {
  try {
    const r = await fetch('https://api.invidious.io/instances.json', {
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    const apiInstances = data
      .filter(i => i[1]?.api && !i[1]?.flagged)
      .map(i => 'https://' + i[0]);
    if (apiInstances.length > 0) {
      INVIDIOUS_BASES.length = 0;
      INVIDIOUS_BASES.push(...apiInstances);
    }
  } catch {}
}

let lastRefresh = 0;

async function getInvidiousWithRefresh(videoId) {
  const now = Date.now();
  if (now - lastRefresh > 3600000) {
    lastRefresh = now;
    await refreshInstances();
  }
  return fetchInvidious(videoId);
}

function parseInvidiousFormats(data) {
  const seen = new Set();
  const qualities = [];

  const muxed = data.formatStreams || [];
  const adaptive = data.adaptiveFormats || [];

  const videoAdaptive = adaptive.filter(f => f.type?.startsWith('video/') && f.qualityLabel);

  for (const f of [...muxed, ...videoAdaptive].sort((a, b) => {
    const hA = parseInt(a.qualityLabel) || 0;
    const hB = parseInt(b.qualityLabel) || 0;
    return hB - hA;
  })) {
    const label = f.qualityLabel || '360p';
    if (!seen.has(label)) {
      seen.add(label);
      qualities.push({
        label,
        height: parseInt(label) || 0,
        format_id: f.itag?.toString() || f.index?.toString() || '',
        ext: f.container || 'mp4',
        filesize: f.clen ? parseInt(f.clen) : (f.size ? null : null),
        vcodec: f.encoding || '',
        acodec: '',
        vbr: f.bitrate ? Math.round(parseInt(f.bitrate) / 1000) : null,
        abr: null,
        tbr: null,
        hasAudio: f.type?.includes('audio') || !!muxed.find(m => m.qualityLabel === label),
        isMuxed: !!muxed.find(m => m.qualityLabel === label && m.itag === f.itag),
      });
    }
  }

  if (qualities.length === 0) {
    qualities.push({ label: '360p', height: 360, format_id: '', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true });
  }

  return qualities;
}

async function getYouTubeInfo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID');

  const data = await getInvidiousWithRefresh(videoId);
  const base = data._instance;

  return {
    title: data.title || 'Untitled',
    thumbnail: data.videoThumbnails?.[0]?.url
      ? (data.videoThumbnails[0].url.startsWith('http') ? data.videoThumbnails[0].url : base + data.videoThumbnails[0].url)
      : null,
    duration: data.lengthSeconds || 0,
    description: (data.description || '').slice(0, 300),
    platform: 'youtube',
    qualities: parseInvidiousFormats(data),
    uploader: data.author || '',
    view_count: data.viewCount || 0,
    like_count: data.likeCount || 0,
  };
}

async function getGenericInfo(url, platform) {
  return {
    title: 'Video from ' + platform,
    thumbnail: null,
    duration: 0,
    description: '',
    platform,
    qualities: [
      { label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true },
    ],
    uploader: '',
    view_count: 0,
    like_count: 0,
  };
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform = detectPlatform(url);
    let info;

    if (platform === 'youtube') {
      info = await getYouTubeInfo(url);
    } else {
      info = await getGenericInfo(url, platform);
    }

    res.status(200).json(info);
  } catch (err) {
    console.error('[NEON API] Info error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract video info' });
  }
}
