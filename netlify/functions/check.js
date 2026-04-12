// netlify/functions/check.js
// Serverless health check — replaces Express POST /check

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let url;
  try {
    ({ url } = JSON.parse(event.body));
    if (!url) throw new Error('Missing url');
    // Ensure protocol
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const start = Date.now();
  let status = 'DOWN';
  let httpCode = null;
  let error = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'API-Sentinel/1.0' }
    });
    clearTimeout(timeout);
    httpCode = res.status;
    status = res.ok ? 'UP' : 'DOWN';
  } catch (err) {
    error = err.name === 'AbortError' ? 'Request timed out (8s)' : err.message;
    status = 'DOWN';
  }

  const latencyMs = Date.now() - start;

  const result = {
    id: crypto.randomUUID(),
    url,
    status,
    httpCode,
    latencyMs,
    error,
    timestamp: new Date().toISOString()
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(result)
  };
};
