import ytdl from '@distube/ytdl-core';

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

async function handleYouTubeDownload(url, quality, res) {
  const info = await ytdl.getInfo(url);
  const d = info.videoDetails;
  const safeName = (d.title || 'video').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);

  const qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;

  let format;

  try {
    if (qualityHeight <= 720) {
      format = ytdl.chooseFormat(info.formats, {
        quality: qualityHeight + 'p',
        filter: 'audioandvideo',
      });
    } else {
      format = ytdl.chooseFormat(info.formats, {
        quality: qualityHeight + 'p',
        filter: 'videoonly',
      });
    }
  } catch {
    format = ytdl.chooseFormat(info.formats, { filter: 'audioandvideo' });
  }

  if (!format || !format.url) {
    throw new Error('Could not get download URL for this quality');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Filename');
  res.setHeader('X-Filename', `${safeName}.mp4`);

  if (format.hasAudio) {
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
    res.redirect(302, format.url);
  } else {
    const audioFormat = ytdl.chooseFormat(info.formats, { filter: 'audioonly' });
    if (audioFormat?.url) {
      res.json({
        type: 'multi',
        videoUrl: format.url,
        audioUrl: audioFormat.url,
        filename: `${safeName}.mp4`,
      });
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
      res.redirect(302, format.url);
    }
  }
}

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
        error: `${platform} downloads are not supported on Vercel (serverless). Use the local Node.js server for full platform support.`,
      });
    }
  } catch (err) {
    console.error('[NEON API] Download error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Download failed' });
    }
  }
}
