const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('bundle-temp/index.html', 'utf8');
const cssMatch = html.match(/href=([^\s>]+\.css)/);
const jsMatch = html.match(/src=([^\s>]+\.js)/);

console.log('CSS file:', cssMatch ? cssMatch[1] : 'NOT FOUND');
console.log('JS file:', jsMatch ? jsMatch[1] : 'NOT FOUND');

const cssPath = path.join('bundle-temp', cssMatch[1]);
const jsPath = path.join('bundle-temp', jsMatch[1]);

const css = fs.readFileSync(cssPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

let result = html;
result = result.replace(
  /<link[^>]*href=[^\s>]+\.css[^>]*>/,
  '<style>' + css + '</style>'
);
result = result.replace(
  /<script[^>]*src=[^\s>]+\.js[^>]*><\/script>/,
  '<script>' + js + '<\/script>'
);

fs.writeFileSync('bundle.html', result);
console.log('Done! bundle.html created (' + (result.length / 1024).toFixed(1) + ' KB)');
