const crypto = require('crypto');
const fetch = global.fetch || require('node-fetch');
const GATEWAY_SECRET = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';
const JWT_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOjc1NTk4OTY1MjM5Mzc4Mjk4OTYsImV4cCI6MTc4OTMxMDMxNiwiaWF0IjoxNzgxNTM0MDE2fQ.OCVrv-cYzyczcuFysDVENSZ8rXk60M09rmMPb-xWECg';

function normalizeQuery(qs) {
  if (!qs) return '';
  const pairs = [];
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const key = idx === -1 ? pair : pair.slice(0, idx);
    const val = idx === -1 ? '' : pair.slice(idx + 1);
    try {
      pairs.push([decodeURIComponent(key), decodeURIComponent(val)]);
    } catch {
      pairs.push([key, val]);
    }
  }
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function bodyMd5(body) {
  if (!body) return '';
  const chunk = Buffer.from(body, 'utf8');
  const c = chunk.length > 102400 ? chunk.subarray(0, 102400) : chunk;
  return crypto.createHash('md5').update(c).digest('hex');
}

function buildCanonical(method, headers, body, fullUrl, ts) {
  const u = new URL(fullUrl);
  const accept = headers['accept'] || '';
  const contentType = headers['content-type'] || '';
  let contentLength = headers['content-length'] || '';
  if (!contentLength && body) contentLength = String(Buffer.byteLength(body, 'utf8'));
  if (method.toUpperCase() === 'GET' && !body) contentLength = '';
  const md5 = bodyMd5(body || '');
  const normalizedQuery = normalizeQuery(u.search.replace(/^\?/, ''));
  const pathUrl = u.pathname + (normalizedQuery ? `?${normalizedQuery}` : '');
  return [method.toUpperCase(), accept, contentType, contentLength, String(ts), md5, pathUrl].join('\n');
}

function sign(secretB64, canonical) {
  const key = Buffer.from(secretB64, 'base64');
  const h = crypto.createHmac('md5', key);
  h.update(canonical, 'utf8');
  return h.digest('base64');
}

function makeXTr(method, url, headers, body) {
  const ts = Date.now();
  const canonical = buildCanonical(method, headers, body, url, ts);
  const signature = sign(GATEWAY_SECRET, canonical);
  return `${ts}|2|${signature}`;
}

function commonHeaders() {
  return {
    accept: '*/*',
    authorization: JWT_TOKEN,
    'accept-encoding': 'gzip, deflate, br',
    connection: 'keep-alive',
    'user-agent':
      'com.vskit.lite/40020000 (Linux; U; Android 7.1.2; en_US; SM-G988N; Build/N2G48H; Cronet/148.0.7778.120)',
    'x-client-info': JSON.stringify({
      package_name: 'com.vskit.lite',
      version_name: '4.0.20.0205',
      version_code: 40020000,
      os: 'android',
      os_version: '7.1.2',
      install_ch: 'google-play',
      device_id: '42b83559578df558a1ddb1f771a1c1d7',
      install_store: 'gp',
      gaid: '11c59e8b-f84f-4252-b69d-b4cd1544dc07',
      brand: 'samsung',
      model: 'SM-G988N',
      system_language: 'en',
      net: 'NETWORK_WIFI',
      region: 'US',
      timezone: 'Africa/Brazzaville',
      sp_code: '405840',
      'X-Play-Mode': '2',
      'X-Family-Mode': '0',
    }),
    'x-client-status': '1',
    'x-family-mode': '0',
    'x-play-mode': '2',
  };
}

async function req(method, url, body = '') {
  const headers = { ...commonHeaders() };
  if (body && !headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';
  headers['x-tr-signature'] = makeXTr(method, url, headers, body);
  headers['x-tr-signature-method'] = 'HmacMD5';
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, text };
  }
}

(async () => {
  const search = await req(
    'POST',
    'https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/search/v2',
    JSON.stringify({ page: 1, perPage: 10, keyword: 'Love Short Drama' }),
  );
  console.log('SEARCH', JSON.stringify(search, null, 2));
  if (search?.code !== 0) return;
  const subjects = [];
  for (const r of search.data.results || []) if (Array.isArray(r.subjects)) subjects.push(...r.subjects);
  console.log(
    'FOUND',
    subjects.length,
    subjects.map((s) => ({
      id: s.subjectId,
      title: s.title,
      subjectType: s.subjectType,
      corner: s.corner,
      lang: s.lang,
      releaseDate: s.releaseDate,
    })).slice(0, 20),
  );
  const s = subjects.find((x) => x.subjectType === 7);
  if (!s) return;
  const sid = String(s.subjectId);
  console.log('USE', sid, s.title);
  const season = await req('GET', `https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/season-info?subjectId=${encodeURIComponent(sid)}`);
  console.log('SEASON', JSON.stringify(season, null, 2));
  const resource1 = await req(
    'GET',
    `https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/resource?subjectId=${encodeURIComponent(sid)}&all=0&page=1&perPage=5&se=1&ep=1&epFrom=1&epTo=1&startPosition=1&endPosition=1&pagerMode=2`,
  );
  console.log('RESOURCE1', JSON.stringify(resource1, null, 2));
  const resource2 = await req(
    'GET',
    `https://api3.aoneroom.com/wefeed-mobile-bff/subject-api/resource?subjectId=${encodeURIComponent(sid)}&all=0&page=1&perPage=5&se=1&ep=2&epFrom=2&epTo=2&startPosition=2&endPosition=2&pagerMode=2`,
  );
  console.log('RESOURCE2', JSON.stringify(resource2, null, 2));
})();
