const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(distDir, 'assets', 'index-6tM5QR2k.css'), 'utf8');
const jsContent = fs.readFileSync(path.join(distDir, 'assets', 'index-Cip0AEkD.js'), 'utf8');

let result = html;
result = result.replace(
  '<link rel="stylesheet" crossorigin href="/assets/index-6tM5QR2k.css">',
  '<style>' + cssContent + '</style>'
);
result = result.replace(
  '<script type="module" crossorigin src="/assets/index-Cip0AEkD.js"></script>',
  '<script type="module">' + jsContent + '</script>'
);

fs.writeFileSync(path.join(__dirname, 'bundle.html'), result);
fs.writeFileSync(path.join(__dirname, '..', 'public', 'index.html'), result);
console.log('Done! bundle.html + public/index.html created (' + (result.length / 1024).toFixed(1) + ' KB)');
