// netlify/functions/validate.js
// Lightweight status validation — no Puppeteer (not supported on Netlify)
// Tries known status page patterns for a given URL

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let url;
  try {
    ({ url } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid body' }) };
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid URL' }) };
  }

  // Common status page patterns
  const candidates = [
    `https://status.${hostname}`,
    `https://${hostname}/status`,
    `https://${hostname}/health`,
    `https://www.${hostname}/status`,
  ];

  const results = [];
  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(candidate, { signal: controller.signal, headers: { 'User-Agent': 'API-Sentinel/1.0' } });
      clearTimeout(t);
      if (res.ok) {
        const text = (await res.text()).toLowerCase();
        const isOp = text.includes('operational') || text.includes('all systems') || text.includes('no incidents');
        const isDeg = text.includes('degraded') || text.includes('partial') || text.includes('incident') || text.includes('outage');
        results.push({
          statusPageUrl: candidate,
          officialStatus: isOp ? 'operational' : isDeg ? 'degraded' : 'unknown',
          details: isOp ? 'Service reports operational.' : isDeg ? 'Degraded or incident detected on status page.' : 'Status page found but status unclear.',
          service: hostname
        });
        break;
      }
    } catch { /* try next */ }
  }

  if (results.length > 0) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(results[0])
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      service: hostname,
      officialStatus: 'unknown',
      details: 'No public status page found. Check the provider\'s website manually.',
      error: 'Could not locate a status page.'
    })
  };
};
