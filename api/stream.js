export const config = {
  runtime: 'edge',
};

var INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.thepixora.com',
  'https://iv.ggtyler.dev',
  'https://inv.nadeko.net',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
  'https://invidious.f5.si',
];

function isAllowedUrl(urlStr) {
  try {
    var u = new URL(urlStr);
    var host = u.hostname;
    if (host.endsWith('.googlevideo.com')) return true;
    if (host.endsWith('.google.com')) return true;
    for (var i = 0; i < INSTANCES.length; i++) {
      var instHost = new URL(INSTANCES[i]).hostname;
      if (host === instHost || host.endsWith('.' + instHost)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function tryFetchWithRetry(urls, filename) {
  for (var i = 0; i < urls.length; i++) {
    try {
      var res = await fetch(urls[i], {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
        },
      });
      if (res.ok) {
        var ct = res.headers.get('Content-Type') || '';
        if (ct.indexOf('video/') === 0 || ct.indexOf('application/octet-stream') === 0 || ct.indexOf('application/x-mpeg') === 0 || ct.indexOf('audio/') === 0) {
          return { ok: true, response: res };
        }
        if (ct.indexOf('text/html') === 0 || ct.indexOf('application/json') === 0) {
          continue;
        }
        return { ok: true, response: res };
      }
    } catch (e) {
      continue;
    }
  }
  return { ok: false };
}

async function getVideoFormats(videoId) {
  for (var i = 0; i < INSTANCES.length; i++) {
    try {
      var res = await fetch(INSTANCES[i] + '/api/v1/videos/' + videoId, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      var data = await res.json();
      if (data && data.title) {
        return { data: data, instance: INSTANCES[i] };
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    var params = new URL(request.url).searchParams;
    var urlStr = params.get('url');
    var videoId = params.get('id');
    var itag = params.get('itag') || '18';
    var qualityHeight = parseInt(params.get('quality') || '720');
    var filename = params.get('filename') || 'video.mp4';
    var safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');

    var urlsToTry = [];

    if (urlStr && isAllowedUrl(urlStr)) {
      urlsToTry.push(urlStr);
    }

    if (videoId) {
      var videoInfo = await getVideoFormats(videoId);
      if (videoInfo) {
        var data = videoInfo.data;
        var muxed = data.formatStreams || [];
        var adaptive = (data.adaptiveFormats || []).filter(function(f) { return f.type && f.type.indexOf('video/') === 0 && f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight; });
        adaptive.sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); });

        var muxedMatch = muxed
          .filter(function(f) { return f.qualityLabel && (parseInt(f.qualityLabel) || 0) <= qualityHeight; })
          .sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];

        if (muxedMatch && muxedMatch.url && isAllowedUrl(muxedMatch.url)) {
          urlsToTry.push(muxedMatch.url);
        }

        var bestVideo = adaptive[0];
        if (bestVideo && bestVideo.url && isAllowedUrl(bestVideo.url)) {
          urlsToTry.push(bestVideo.url);
        }

        var fallbackMuxed = muxed.sort(function(a, b) { return (parseInt(b.qualityLabel) || 0) - (parseInt(a.qualityLabel) || 0); })[0];
        if (fallbackMuxed && fallbackMuxed.url && isAllowedUrl(fallbackMuxed.url) && (!muxedMatch || muxedMatch.itag !== fallbackMuxed.itag)) {
          urlsToTry.push(fallbackMuxed.url);
        }
      }

      for (var j = 0; j < INSTANCES.length; j++) {
        var companionUrl = INSTANCES[j] + '/latest_version?id=' + videoId + '&itag=' + itag + '&local=true';
        if (urlsToTry.indexOf(companionUrl) === -1) {
          urlsToTry.push(companionUrl);
        }
      }
    }

    if (urlsToTry.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid download URLs available' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    var result = await tryFetchWithRetry(urlsToTry, safeFilename);

    if (!result.ok) {
      return new Response(JSON.stringify({ error: 'All download sources failed. Try again later or use cobalt.tools', fallback: 'https://cobalt.tools/' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    var contentType = result.response.headers.get('Content-Type') || 'video/mp4';
    var contentLength = result.response.headers.get('Content-Length') || '';

    return new Response(result.response.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment; filename="' + safeFilename + '"',
        'Content-Length': contentLength,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Stream error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
