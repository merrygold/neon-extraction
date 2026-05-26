if (typeof fetch === 'undefined') {
  module.exports = function handler(req, res) {
    res.status(500).json({ error: 'Node.js 18+ required (fetch unavailable)' });
  };
  return;
}

var INSTANCES = [
  'https://inv.thepixora.com',
  'https://invidious.fdn.fr',
  'https://vid.puffyan.us',
  'https://invidious.nerdvpn.de',
  'https://iv.ggtyler.dev',
];

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

function parseFormats(data) {
  var seen = {};
  var qualities = [];
  var muxed = data.formatStreams || [];
  var adaptive = (data.adaptiveFormats || []).filter(function(f) { return f.type && f.type.indexOf('video/') === 0 && f.qualityLabel; });
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

function tryFetchVideo(videoId, timeout) {
  var promises = INSTANCES.map(function(instance) {
    return new Promise(function(resolve) {
      try {
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, timeout);
        fetch(instance + '/api/v1/videos/' + videoId, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        })
          .then(function(r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(d) { if (d && d.title) { resolve(d); } else { resolve(null); } })
          .catch(function() { clearTimeout(timer); resolve(null); });
      } catch (e) { resolve(null); }
    });
  });
  return Promise.all(promises).then(function(results) {
    return results.find(function(r) { return r !== null; }) || null;
  });
}

module.exports = function handler(req, res) {
  function json(data, status) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(status || 200).json(data);
  }

  try {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    var body = req.body || {};
    var url = body.url;
    if (!url) return json({ error: 'URL is required' }, 400);

    var platform = detectPlatform(url);
    if (platform !== 'youtube') {
      return json({
        title: 'Video from ' + platform, thumbnail: null,
        duration: 0, description: '', platform: platform,
        qualities: [{ label: 'best', height: 720, format_id: 'best', ext: 'mp4', filesize: null, vcodec: '', acodec: '', vbr: null, abr: null, tbr: null, hasAudio: true, isMuxed: true }],
        uploader: '', view_count: 0, like_count: 0,
      });
    }

    var videoId = extractVideoId(url);
    if (!videoId) return json({ error: 'Could not extract YouTube video ID' }, 400);

    tryFetchVideo(videoId, 6000).then(function(data) {
      if (!data) return json({ error: 'Could not fetch video info. All instances failed.' }, 500);

      var thumb = (data.videoThumbnails || []).find(function(t) { return t.quality === 'maxres'; }) || (data.videoThumbnails || [])[0];
      var thumbUrl = (thumb && thumb.url && thumb.url.indexOf('http') === 0) ? thumb.url : ('https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg');

      json({
        title: data.title || 'Untitled', thumbnail: thumbUrl,
        duration: data.lengthSeconds || 0,
        description: (data.description || '').slice(0, 300),
        platform: 'youtube', qualities: parseFormats(data),
        uploader: data.author || '',
        view_count: data.viewCount || 0, like_count: data.likeCount || 0,
      });
    }).catch(function(err) {
      console.error('[NEON] Info error:', err);
      json({ error: err.message || 'Failed to extract video info' }, 500);
    });
  } catch (err) {
    console.error('[NEON] Sync error:', err);
    json({ error: 'Internal error' }, 500);
  }
};
