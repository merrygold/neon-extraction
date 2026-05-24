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

const STATIC_INSTANCES = [
  'https://inv.thepixora.com',
];

let cachedInstances = null;
let lastInstanceRefresh = 0;

async function getInstances() {
  const now = Date.now();
  if (cachedInstances && now - lastInstanceRefresh < 300000) return cachedInstances;

  try {
    const r = await fetch('https://api.invidious.io/instances.json', {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const data = await r.json();
      const apiInstances = data
        .filter(i => i[1]?.api && !i[1]?.flagged && i[1]?.monitor?.enabled !== false)
        .map(i => 'https://' + i[0]);
      if (apiInstances.length > 0) {
        cachedInstances = [...new Set([...apiInstances, ...STATIC_INSTANCES])];
        lastInstanceRefresh = now;
        return cachedInstances;
      }
    }
  } catch {}
  cachedInstances = STATIC_INSTANCES;
  lastInstanceRefresh = now;
  return cachedInstances;
}

async function fetchFromInstance(base, videoId) {
  const r = await fetch(`${base}/api/v1/videos/${videoId}`, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
}

async function fetchVideoInfo(videoId) {
  const instances = await getInstances();

  // Try each instance sequentially with a reasonable timeout
  for (const base of instances) {
    try {
      const data = await fetchFromInstance(base, videoId);
      if (data.title) return data;
    } catch {}
  }

  // Last resort: try with longer timeout on static instances
  for (const base of STATIC_INSTANCES) {
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 25000);
      const r = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.title) return data;
      }
    } catch {}
  }

  throw new Error('Could not fetch video info. The Invidious network may be temporarily overloaded. Please try again in a moment.');
}

function parseInvidiousFormats(data) {
  const seen = new Set();
  const qualities = [];
  const muxed = data.formatStreams || [];
  const adaptive = data.adaptiveFormats || [];
  const videoAdaptive = adaptive.filter(f => f.type?.startsWith('video/') && f.qualityLabel);

  const all = [...muxed, ...videoAdaptive].sort((a, b) => {
    return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0);
  });

  for (const f of all) {
    const label = f.qualityLabel || '360p';
    if (!seen.has(label)) {
      seen.add(label);
      const isMuxed = muxed.some(m => m.qualityLabel === label && m.itag === f.itag);
      qualities.push({
        label,
        height: parseInt(label) || 0,
        format_id: f.itag?.toString() || f.index?.toString() || '',
        ext: f.container || 'mp4',
        filesize: f.clen ? parseInt(f.clen) : null,
        vcodec: f.encoding || '',
        acodec: '',
        vbr: f.bitrate ? Math.round(parseInt(f.bitrate) / 1000) : null,
        abr: null,
        tbr: null,
        hasAudio: isMuxed,
        isMuxed,
      });
    }
  }

  if (qualities.length === 0) {
    qualities.push({ label: '360p', height: 360, format_id: '18', ext: 'mp4', filesize: null, vcodec: 'h264', acodec: 'aac', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true });
  }

  return qualities;
}

async function getYouTubeInfo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID. Make sure the URL is a valid YouTube link.');

  const data = await fetchVideoInfo(videoId);
  const thumb = data.videoThumbnails?.find(t => t.quality === 'maxres') || data.videoThumbnails?.[0];
  const thumbUrl = thumb?.url
    ? (thumb.url.startsWith('http') ? thumb.url : `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)
    : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return {
    title: data.title || 'Untitled',
    thumbnail: thumbUrl,
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
  api: {
    bodyParser: { sizeLimit: '1mb' },
    maxDuration: 30,
  },
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
    const info = platform === 'youtube'
      ? await getYouTubeInfo(url)
      : await getGenericInfo(url, platform);

    res.status(200).json(info);
  } catch (err) {
    console.error('[NEON API] Info error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract video info' });
  }
}
