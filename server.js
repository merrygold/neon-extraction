const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const YtDlpWrap = require('yt-dlp-wrap').default;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

const ytDlpPath = path.join(__dirname, 'bin', 'yt-dlp.exe');
const ffmpegPath = path.join(__dirname, 'bin', 'ffmpeg.exe');
const downloadDir = path.join(__dirname, 'downloads');

if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

const recentDownloads = [];
const ytDlpWrap = new YtDlpWrap(ytDlpPath);

async function ensureBinary() {
  const binDir = path.join(__dirname, 'bin');
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  if (!fs.existsSync(ytDlpPath)) {
    console.log('[NEON] Downloading yt-dlp binary...');
    await YtDlpWrap.downloadFromGithub(ytDlpPath);
    console.log('[NEON] yt-dlp binary ready.');
  }

  if (!fs.existsSync(ffmpegPath)) {
    console.log('[NEON] Downloading ffmpeg...');
    const https = require('https');
    const { execSync } = require('child_process');
    const zipUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    const zipPath = path.join(binDir, 'ffmpeg.zip');

    await new Promise((resolve, reject) => {
      const follow = (url) => {
        https.get(url, { timeout: 300000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
          const file = fs.createWriteStream(zipPath);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
        }).on('error', reject);
      };
      follow(zipUrl);
    });

    console.log('[NEON] Extracting ffmpeg...');
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`, { timeout: 120000 });

    const dirs = fs.readdirSync(binDir).filter(d => d.startsWith('ffmpeg') && fs.statSync(path.join(binDir, d)).isDirectory());
    for (const dir of dirs) {
      const candidate = path.join(binDir, dir, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(candidate)) {
        fs.copyFileSync(candidate, ffmpegPath);
        const probe = path.join(binDir, dir, 'bin', 'ffprobe.exe');
        if (fs.existsSync(probe)) fs.copyFileSync(probe, path.join(binDir, 'ffprobe.exe'));
        break;
      }
    }
    for (const dir of dirs) {
      try { fs.rmSync(path.join(binDir, dir), { recursive: true }); } catch {}
    }
    try { fs.unlinkSync(zipPath); } catch {}
    console.log('[NEON] ffmpeg ready.');
  }
}

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

function parseFormats(formats) {
  const seen = new Set();
  const qualities = [];
  const sorted = (formats || [])
    .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const f of sorted) {
    const label = `${f.height}p`;
    if (!seen.has(label)) {
      seen.add(label);
      qualities.push({
        label,
        height: f.height,
        format_id: f.format_id,
        ext: f.ext || 'mp4',
        filesize: f.filesize || f.filesize_approx || null,
        vcodec: f.vcodec,
        acodec: f.acodec,
        vbr: f.vbr,
        abr: f.abr,
        tbr: f.tbr
      });
    }
  }

  if (qualities.length === 0) {
    qualities.push({ label: 'best', height: 1080, format_id: 'best', ext: 'mp4', filesize: null });
  }

  return qualities;
}

app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const platform = detectPlatform(url);

    const result = await ytDlpWrap.execPromise([
      url,
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--quiet',
      '--no-check-certificates',
      '--ffmpeg-location', ffmpegPath
    ]);

    let data;
    try {
      data = typeof result === 'string' ? JSON.parse(result) : result;
    } catch {
      const lines = result.trim().split('\n').filter(Boolean);
      data = JSON.parse(lines[lines.length - 1]);
    }

    const qualities = parseFormats(data.formats);

    res.json({
      title: data.title || 'Untitled',
      thumbnail: data.thumbnail || data.thumbnails?.[data.thumbnails.length - 1]?.url || null,
      duration: data.duration || 0,
      description: data.description?.slice(0, 300) || '',
      platform,
      qualities,
      uploader: data.uploader || data.channel || '',
      view_count: data.view_count || 0,
      like_count: data.like_count || 0
    });
  } catch (err) {
    console.error('[NEON] Info error:', err.message);
    res.status(500).json({ error: 'Failed to extract video info. Check the URL and try again.', detail: err.message });
  }
});

app.post('/api/download', async (req, res) => {
  try {
    const { url, quality, format_id } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const id = uuidv4().slice(0, 8);
    const platform = detectPlatform(url);
    const outPath = path.join(downloadDir, `${id}.mp4`);

    const args = [
      url,
      '-o', outPath,
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificates',
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegPath
    ];

    const qualityHeight = parseInt((quality || '1080p').replace('p', '')) || 1080;
    if (qualityHeight <= 360) {
      args.push('-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]');
    } else if (qualityHeight <= 480) {
      args.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]');
    } else if (qualityHeight <= 720) {
      args.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]');
    } else if (qualityHeight <= 1080) {
      args.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]');
    } else {
      args.push('-f', 'bestvideo+bestaudio/best');
    }

    await ytDlpWrap.execPromise(args);

    if (!fs.existsSync(outPath)) {
      return res.status(500).json({ error: 'Download failed — file not created.' });
    }

    const stat = fs.statSync(outPath);
    const fileName = `${id}.mp4`;

    recentDownloads.unshift({
      id,
      fileName,
      platform,
      quality: quality || '1080p',
      size: stat.size,
      time: new Date().toISOString()
    });
    if (recentDownloads.length > 20) recentDownloads.pop();

    res.download(outPath, fileName, (err) => {
      if (err) console.error('[NEON] Send error:', err.message);
      setTimeout(() => {
        try { fs.unlinkSync(outPath); } catch {}
      }, 60000);
    });
  } catch (err) {
    console.error('[NEON] Download error:', err.message);
    res.status(500).json({ error: 'Download failed. Check the URL and try again.', detail: err.message });
  }
});

app.get('/api/recent', (req, res) => {
  res.json(recentDownloads);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    binaryReady: fs.existsSync(ytDlpPath),
    downloads: recentDownloads.length
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureBinary().then(() => {
  app.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════╗
  ║                                           ║
  ║   ◈  NEON EXTRACTION — Video Downloader  ║
  ║                                           ║
  ║   Server:  http://localhost:${PORT}           ║
  ║   Status:  ONLINE                         ║
  ║                                           ║
  ╚═══════════════════════════════════════════╝
    `);
  });
}).catch(err => {
  console.error('[NEON] Failed to download yt-dlp binary:', err.message);
  console.error('[NEON] You may need to manually place yt-dlp.exe in the /bin folder.');
  process.exit(1);
});
