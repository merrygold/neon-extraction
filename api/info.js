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

  const directPromise = tryFetch(directUrl, 5000).catch(e => { console.error('[NEON] Direct:', e.message); return null; });
  const proxyPromise = tryFetch(proxyUrl, 8000).catch(e => { console.error('[NEON] Proxy:', e.message); return null; });

  const [direct, proxy] = await Promise.all([directPromise, proxyPromise]);
  const result = direct?.title ? direct : proxy?.title ? proxy : null;
  if (result) return result;

  throw new Error('Could not fetch video info. The service may be temporarily overloaded. Please try again in a moment.');
}

function parseFormats(data) {
  const seen = new Set();
  const qualities = [];
  const muxed = data.formatStreams || [];
  const adaptive = (data.adaptiveFormats || []).filter(f => f.type?.startsWith('video/') && f.qualityLabel);
  const all = [...muxed, ...adaptive].sort((a, b) => (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0));

  for (const f of all) {
    const label = f.qualityLabel || '360p';
    if (!seen.has(label)) {
      seen.add(label);
      const isMuxed = muxed.some(m => m.qualityLabel === label && m.itag === f.itag);
      qualities.push({
        label, height: parseInt(label) || 0,
        format_id: f.itag?.toString() || '', ext: f.container || 'mp4',
        filesize: f.clen ? parseInt(f.clen) : null,
        vcodec: f.encoding || '', acodec: '',
        vbr: f.bitrate ? Math.round(parseInt(f.bitrate) / 1000) : null,
        abr: null, tbr: null,
        hasAudio: isMuxed, isMuxed,
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
  if (!videoId) throw new Error('Could not extract YouTube video ID');

  const data = await fetchVideoInfo(videoId);
  const thumb = data.videoThumbnails?.find(t => t.quality === 'maxres') || data.videoThumbnails?.[0];
  const thumbUrl = thumb?.url?.startsWith('http') ? thumb.url : `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

  return {
    title: data.title || 'Untitled', thumbnail: thumbUrl,
    duration: data.lengthSeconds || 0,
    description: (data.description || '').slice(0, 300),
    platform: 'youtube', qualities: parseFormats(data),
    uploader: data.author || '',
    view_count: data.viewCount || 0, like_count: data.likeCount || 0,
  };
}

function getGenericInfo(platform) {
  return {
    title: 'Video from ' + platform, thumbnail: null,
    duration: 0, description: '', platform,
    qualities: [{ label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true }],
    uploader: '', view_count: 0, like_count: 0,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform = detectPlatform(url);
    const info = platform === 'youtube' ? await getYouTubeInfo(url) : getGenericInfo(platform);
    res.status(200).json(info);
  } catch (err) {
    console.error('[NEON] Info error:', err);
    res.status(500).json({ error: err.message || 'Failed to extract video info' });
  }
}
