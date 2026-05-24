export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'online',
    engine: '@distube/ytdl-core',
    platforms: ['youtube'],
    version: '1.0.0',
  });
}
