module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'online',
    engine: 'invidious-api + oembed + noembed',
    platforms: ['youtube', 'instagram', 'facebook', 'tiktok', 'twitter'],
    version: '2.1.0',
  });
};
