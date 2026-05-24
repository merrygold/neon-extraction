import ytdl from '@distube/ytdl-core';

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

function parseYouTubeFormats(formats) {
  const seen = new Set();
  const qualities = [];
  const sorted = formats
    .filter(f => f.hasVideo && f.height)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const f of sorted) {
    const label = `${f.height}p`;
    if (!seen.has(label)) {
      seen.add(label);
      qualities.push({
        label,
        height: f.height,
        format_id: f.itag?.toString() || '',
        ext: f.container || 'mp4',
        filesize: f.contentLength ? parseInt(f.contentLength) : null,
        vcodec: f.videoCodec || '',
        acodec: f.audioCodec || '',
        vbr: f.bitrate ? Math.round(f.bitrate / 1000) : null,
        abr: null,
        tbr: null,
        hasAudio: f.hasAudio,
      });
    }
  }
  return qualities;
}

async function getYouTubeInfo(url) {
  const info = await ytdl.getInfo(url);
  const d = info.videoDetails;

  return {
    title: d.title || 'Untitled',
    thumbnail: d.thumbnails?.[d.thumbnails.length - 1]?.url || null,
    duration: parseInt(d.lengthSeconds) || 0,
    description: d.description?.slice(0, 300) || '',
    platform: 'youtube',
    qualities: parseYouTubeFormats(info.formats),
    uploader: d.author?.name || '',
    view_count: parseInt(d.viewCount) || 0,
    like_count: parseInt(d.likes) || 0,
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
      { label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true },
    ],
    uploader: '',
    view_count: 0,
    like_count: 0,
  };
}

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
