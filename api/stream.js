export const config = {
  runtime: 'edge',
};

var ALLOWED_HOSTS = [
  'inv.thepixora.com',
  'invidious.nerdvpn.de',
  'iv.ggtyler.dev',
  'inv.nadeko.net',
  'yt.chocolatemoo53.com',
  'invidious.tiekoetter.com',
  'invidious.f5.si',
  'rr1.sn-h5q7kne6.googlevideo.com',
  'rr2.sn-h5q7kne6.googlevideo.com',
  'rr3.sn-h5q7kne6.googlevideo.com',
  'rr4.sn-h5q7kne6.googlevideo.com',
];

function isAllowedUrl(urlStr) {
  try {
    var u = new URL(urlStr);
    var host = u.hostname;
    for (var i = 0; i < ALLOWED_HOSTS.length; i++) {
      if (host === ALLOWED_HOSTS[i] || host.endsWith('.' + ALLOWED_HOSTS[i])) return true;
    }
    if (host.endsWith('.googlevideo.com')) return true;
    if (host.endsWith('.google.com')) return true;
    return false;
  } catch (e) {
    return false;
  }
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
    var urlStr = new URL(request.url).searchParams.get('url');
    var filename = new URL(request.url).searchParams.get('filename') || 'video.mp4';

    if (!urlStr) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!isAllowedUrl(urlStr)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    var res = await fetch(urlStr, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Upstream returned HTTP ' + res.status }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    var contentType = res.headers.get('Content-Type') || 'video/mp4';
    var contentLength = res.headers.get('Content-Length') || '';

    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment; filename="' + filename.replace(/[^a-zA-Z0-9_.-]/g, '_') + '"',
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
