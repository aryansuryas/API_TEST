/**
 * validate.js — Agentic Browser Validation Script
 *
 * When an API check returns DOWN, this script uses Puppeteer to search
 * for the service's official status page and scrape whether it's operational.
 *
 * Usage: node validate.js "https://api.github.com"
 * Output: JSON { service, statusPageUrl, officialStatus, details }
 */

const puppeteer = require('puppeteer');

const OPERATIONAL_KEYWORDS = [
  'all systems operational',
  'all services are online',
  'no incidents',
  'no issues',
  'operational',
  'all systems go',
  'services are up',
  'everything is working',
];

const DEGRADED_KEYWORDS = [
  'degraded',
  'partial outage',
  'minor outage',
  'major outage',
  'service disruption',
  'incident',
  'maintenance',
  'investigating',
  'identified',
  'monitoring',
];

/**
 * Extracts a human-readable service name from a URL.
 * e.g., "https://api.github.com/v1/health" → "github"
 */
function extractServiceName(url) {
  try {
    const hostname = new URL(url).hostname;
    // Remove common prefixes/suffixes
    const parts = hostname.replace(/^(api|www|status)\./, '').split('.');
    return parts[0] || hostname;
  } catch {
    return url;
  }
}

/**
 * Launch a headless browser, search Google for the service status page,
 * navigate to it, and scrape for operational keywords.
 */
async function validateService(apiUrl) {
  const serviceName = extractServiceName(apiUrl);
  const searchQuery = `${serviceName} status page operational`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Step 1: Search Google for the status page
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Step 2: Extract the first relevant link from search results
    const statusPageUrl = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      const statusLink = links.find((link) => {
        const href = link.href || '';
        const text = (link.textContent || '').toLowerCase();
        return (
          (href.includes('status.') || href.includes('/status') || text.includes('status')) &&
          !href.includes('google.com') &&
          !href.includes('webcache') &&
          href.startsWith('http')
        );
      });
      return statusLink ? statusLink.href : null;
    });

    if (!statusPageUrl) {
      return {
        service: serviceName,
        statusPageUrl: null,
        officialStatus: 'unknown',
        details: `Could not find a status page for "${serviceName}" via search.`,
      };
    }

    // Step 3: Navigate to the status page
    await page.goto(statusPageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());

    // Step 4: Check for operational or degraded keywords
    const isOperational = OPERATIONAL_KEYWORDS.some((kw) => pageText.includes(kw));
    const isDegraded = DEGRADED_KEYWORDS.some((kw) => pageText.includes(kw));

    let officialStatus = 'unknown';
    if (isOperational && !isDegraded) {
      officialStatus = 'operational';
    } else if (isDegraded) {
      officialStatus = 'degraded';
    }

    // Extract a snippet of the relevant text
    const snippet = extractSnippet(pageText);

    return {
      service: serviceName,
      statusPageUrl,
      officialStatus,
      details: snippet,
    };
  } catch (err) {
    return {
      service: serviceName,
      statusPageUrl: null,
      officialStatus: 'unknown',
      error: err.message,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Extracts a short relevant snippet from the page text.
 */
function extractSnippet(text) {
  const allKeywords = [...OPERATIONAL_KEYWORDS, ...DEGRADED_KEYWORDS];
  for (const kw of allKeywords) {
    const idx = text.indexOf(kw);
    if (idx !== -1) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + kw.length + 50);
      return '...' + text.slice(start, end).replace(/\n/g, ' ').trim() + '...';
    }
  }
  return 'No recognizable status keywords found on the page.';
}

// ── CLI entry point ──
(async () => {
  const apiUrl = process.argv[2];
  if (!apiUrl) {
    console.error(JSON.stringify({ error: 'Usage: node validate.js <api-url>' }));
    process.exit(1);
  }

  const result = await validateService(apiUrl);
  console.log(JSON.stringify(result));
})();
