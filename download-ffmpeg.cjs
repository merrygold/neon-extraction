const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const binDir = path.join(__dirname, 'bin');
if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

const ffmpegPath = path.join(binDir, 'ffmpeg.exe');

if (fs.existsSync(ffmpegPath)) {
  console.log('ffmpeg already exists');
  process.exit(0);
}

console.log('Downloading ffmpeg...');

const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const zipPath = path.join(binDir, 'ffmpeg.zip');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url) => {
      https.get(url, { timeout: 120000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    follow(url);
  });
}

(async () => {
  try {
    await download(url, zipPath);
    console.log('Downloaded zip, extracting...');

    // Use PowerShell to extract
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${binDir}' -Force"`, { timeout: 60000 });

    // Find ffmpeg.exe in extracted folder
    const dirs = fs.readdirSync(binDir).filter(d => d.startsWith('ffmpeg') && fs.statSync(path.join(binDir, d)).isDirectory());
    for (const dir of dirs) {
      const candidate = path.join(binDir, dir, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(candidate)) {
        fs.copyFileSync(candidate, ffmpegPath);
        console.log('Copied ffmpeg.exe to bin/');
        break;
      }
    }

    // Cleanup
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    for (const dir of dirs) {
      const dirPath = path.join(binDir, dir);
      if (dirPath !== binDir) {
        try { fs.rmSync(dirPath, { recursive: true }); } catch {}
      }
    }

    if (fs.existsSync(ffmpegPath)) {
      console.log('ffmpeg ready! Size:', (fs.statSync(ffmpegPath).size / 1024 / 1024).toFixed(1), 'MB');
    } else {
      console.error('Failed to find ffmpeg.exe in archive');
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error('Please install ffmpeg manually and add it to PATH');
  }
})();
