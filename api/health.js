export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'online',
    engine: 'invidious-api',
    platforms: ['youtube'],
    version: '2.0.0',
  });
}
