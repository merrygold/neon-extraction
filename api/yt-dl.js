export const config = {
  runtime: 'edge',
  maxDuration: 30,
};

var YT_CLIENTS = [
  { clientName: 'ANDROID_VR', clientVersion: '1.30.1', ua: 'com.google.android.apps.youtube.vr/1.30.1 (Linux; U; Android 12; Pixel 6)', sdk: '32', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { clientName: 'ANDROID_VR', clientVersion: '1.35.1', ua: 'com.google.android.apps.youtube.vr/1.35.1 (Linux; U; Android 14; Quest 3)', sdk: '34', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { clientName: 'ANDROID', clientVersion: '19.02.39', ua: 'com.google.android.youtube/19.02.39 (Linux; U; Android 14; Pixel 8 Pro)', sdk: '30', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
  { clientName: 'ANDROID_MUSIC', clientVersion: '7.11.50', ua: 'com.google.android.apps.youtube.music/7.11.50 (Linux; U; Android 14)', sdk: '34', key: 'AIzaSyA8eiZmM1FaDVzR5qEZ_Bfq2sTg2tGHhXk' },
];

function tryClient(videoId, c) {
  var ctx = { client: { clientName: c.clientName, clientVersion: c.clientVersion, hl: 'en', gl: 'US' } };
  if (c.sdk) ctx.client.androidSdkVersion = c.sdk;
  var body = JSON.stringify({ videoId: videoId, context: ctx, contentCheckOk: true, racyCheckOk: true });
  var url = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=' + c.key;

  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua }, body: body })
    .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(data) {
      if (data.playabilityStatus && data.playabilityStatus.status === 'OK' && data.streamingData) return data;
      throw new Error(data.playabilityStatus?.status || 'failed');
    });
}

function fetchYouTubePlayer(videoId) {
  var chain = Promise.reject(new Error('no clients'));
  YT_CLIENTS.forEach(function(c) {
    chain = chain.catch(function() { return tryClient(videoId, c); });
  });
  return chain;
}

function getStreamUrl(format) {
  if (format.url && format.url.indexOf('http') === 0 && (format.url.indexOf('.googlevideo.com/') !== -1 || format.url.indexOf('.youtube.com/') !== -1)) return format.url;
  if (format.signatureCipher) {
    var parts = format.signatureCipher.split('&');
    var url = null;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf('url=') === 0) url = decodeURIComponent(parts[i].substring(4));
    }
    if (url && url.indexOf('.googlevideo.com/') !== -1) return url;
  }
  return null;
}

function findFormat(formats, qualityHeight, preferMp4) {
  var valid = formats.filter(function(f) {
    var s = getStreamUrl(f);
    if (!s) return false;
    var h = f.height || parseInt(f.qualityLabel) || 0;
    return h <= qualityHeight;
  }).map(function(f) { return Object.assign({}, f, { _streamUrl: getStreamUrl(f) }); });

  valid.sort(function(a, b) {
    var ha = a.height || parseInt(a.qualityLabel) || 0;
    var hb = b.height || parseInt(b.qualityLabel) || 0;
    if (hb !== ha) return hb - ha;
    if (preferMp4) return (b.mimeType?.indexOf('mp4') !== -1 ? 1 : 0) - (a.mimeType?.indexOf('mp4') !== -1 ? 1 : 0);
    return 0;
  });
  return valid[0] || null;
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  try {
    var params = new URL(request.url).searchParams;
    var videoId = params.get('id');
    var quality = parseInt(params.get('quality') || '1080');

    if (!videoId) {
      return new Response(JSON.stringify({ error: 'Missing id parameter' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    var playerData = await fetchYouTubePlayer(videoId);

    var title = (playerData.videoDetails && playerData.videoDetails.title) || 'video';
    var safeName = title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 60);
    var filename = safeName + '.mp4';

    var formats = (playerData.streamingData && playerData.streamingData.formats) || [];
    var adaptiveFormats = (playerData.streamingData && playerData.streamingData.adaptiveFormats) || [];

    var muxedMatch = findFormat(formats, quality, true);
    if (muxedMatch && muxedMatch._streamUrl) {
      return new Response(JSON.stringify({ url: muxedMatch._streamUrl, filename: filename, hasAudio: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    var videoMatch = findFormat(adaptiveFormats.filter(function(f) { return f.mimeType && f.mimeType.indexOf('video/') === 0; }), quality, true);
    var audioFormats = adaptiveFormats.filter(function(f) { return f.mimeType && f.mimeType.indexOf('audio/') === 0 && getStreamUrl(f); }).sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
    var bestAudioUrl = audioFormats.length > 0 ? getStreamUrl(audioFormats[0]) : null;

    if (videoMatch && videoMatch._streamUrl) {
      return new Response(JSON.stringify({ url: videoMatch._streamUrl, filename: filename, hasAudio: false, audioUrl: bestAudioUrl, qualityLabel: videoMatch.qualityLabel }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    var anyMuxed = findFormat(formats, 99999, true);
    if (anyMuxed && anyMuxed._streamUrl) {
      return new Response(JSON.stringify({ url: anyMuxed._streamUrl, filename: filename, hasAudio: true, fallback: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ url: 'https://cobalt.tools/', filename: filename, hasAudio: true, redirect: true, message: 'Could not get direct download URL. Use cobalt.tools to download.' }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Edge function error', url: 'https://cobalt.tools/', filename: 'video.mp4', hasAudio: true, redirect: true, message: 'Could not get direct download URL. Use cobalt.tools to download.' }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
