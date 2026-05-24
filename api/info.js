function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/twitter\.com|x\.com/i.test(url)) return 'twitter';
  return 'unknown';
}

function extractVideoId(url) {
  var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

var PRIMARY = 'https://inv.thepixora.com';
var PROXY_URL = 'https://api.codetabs.com/v1/proxy?quest=';

function makeAbort(ms) {
  var c = new AbortController();
  setTimeout(function() { c.abort(); }, ms);
  return c.signal;
}

function tryFetch(url, timeout) {
  return fetch(url, { signal: makeAbort(timeout), headers: { 'User-Agent': 'Mozilla/5.0' } })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

function fetchVideoInfo(videoId) {
  var directUrl = PRIMARY + '/api/v1/videos/' + videoId;
  var proxyUrl = PROXY_URL + encodeURIComponent(directUrl);

  var directPromise = tryFetch(directUrl, 5000).catch(function() { return null; });
  var proxyPromise = tryFetch(proxyUrl, 8000).catch(function() { return null; });

  return Promise.all([directPromise, proxyPromise]).then(function(results) {
    var direct = results[0];
    var proxy = results[1];
    var result = (direct && direct.title) ? direct : (proxy && proxy.title) ? proxy : null;
    if (result) return result;
    throw new Error('Could not fetch video info. The service may be temporarily overloaded. Please try again in a moment.');
  });
}

function parseFormats(data) {
  var seen = {};
  var qualities = [];
  var muxed = data.formatStreams || [];
  var adaptive = (data.adaptiveFormats || []).filter(function(f) { return f.type && f.type.startsWith('video/') && f.qualityLabel; });
  var all = muxed.concat(adaptive).sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); });

  for (var i = 0; i < all.length; i++) {
    var f = all[i];
    var label = f.qualityLabel || '360p';
    if (!seen[label]) {
      seen[label] = true;
      var isMuxed = muxed.some(function(m) { return m.qualityLabel === label && m.itag === f.itag; });
      qualities.push({
        label: label, height: parseInt(label) || 0,
        format_id: f.itag ? f.itag.toString() : '', ext: f.container || 'mp4',
        filesize: f.clen ? parseInt(f.clen) : null,
        vcodec: f.encoding || '', acodec: '',
        vbr: f.bitrate ? Math.round(parseInt(f.bitrate) / 1000) : null,
        abr: null, tbr: null,
        hasAudio: isMuxed, isMuxed: isMuxed,
      });
    }
  }

  if (qualities.length === 0) {
    qualities.push({ label: '360p', height: 360, format_id: '18', ext: 'mp4', filesize: null, vcodec: 'h264', acodec: 'aac', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true });
  }
  return qualities;
}

function getYouTubeInfo(url) {
  var videoId = extractVideoId(url);
  if (!videoId) throw new Error('Could not extract YouTube video ID');

  return fetchVideoInfo(videoId).then(function(data) {
    var thumb = (data.videoThumbnails || []).find(function(t) { return t.quality === 'maxres'; }) || (data.videoThumbnails || [])[0];
    var thumbUrl = (thumb && thumb.url && thumb.url.startsWith('http')) ? thumb.url : ('https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg');

    return {
      title: data.title || 'Untitled', thumbnail: thumbUrl,
      duration: data.lengthSeconds || 0,
      description: (data.description || '').slice(0, 300),
      platform: 'youtube', qualities: parseFormats(data),
      uploader: data.author || '',
      view_count: data.viewCount || 0, like_count: data.likeCount || 0,
    };
  });
}

function getGenericInfo(platform) {
  return {
    title: 'Video from ' + platform, thumbnail: null,
    duration: 0, description: '', platform: platform,
    qualities: [{ label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true }],
    uploader: '', view_count: 0, like_count: 0,
  };
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var url = (req.body || {}).url;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  var platform = detectPlatform(url);
  var infoPromise = (platform === 'youtube') ? getYouTubeInfo(url) : Promise.resolve(getGenericInfo(platform));

  infoPromise.then(function(info) {
    res.status(200).json(info);
  }).catch(function(err) {
    console.error('[NEON] Info error:', err);
    res.status(500).json({ error: err.message || 'Failed to extract video info' });
  });
};
