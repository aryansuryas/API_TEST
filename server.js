const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const CHECKS_FILE = path.join(__dirname, 'checks.json');
const MAX_CHECKS = 10;

// ── Middleware ──────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ────────────────────────────────────────────────
function readChecks() {
  try {
    const data = fs.readFileSync(CHECKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeChecks(checks) {
  fs.writeFileSync(CHECKS_FILE, JSON.stringify(checks, null, 2), 'utf-8');
}

// ── Routes ─────────────────────────────────────────────────

// Dashboard
app.get('/', (req, res) => {
  const checks = readChecks();
  res.render('index', { checks });
});

// Perform API check
app.post('/check', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const startTime = Date.now();
  let result;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(parsedUrl.href, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'API-Sentinel/1.0',
      },
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - startTime;

    result = {
      id: uuidv4(),
      url: parsedUrl.href,
      status: response.status >= 200 && response.status < 400 ? 'UP' : 'DOWN',
      httpCode: response.status,
      latencyMs,
      timestamp: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    result = {
      id: uuidv4(),
      url: parsedUrl.href,
      status: 'DOWN',
      httpCode: null,
      latencyMs,
      timestamp: new Date().toISOString(),
      error: err.cause?.code || err.message || 'Unknown error',
    };
  }

  // Save to file (cap at MAX_CHECKS)
  const checks = readChecks();
  checks.unshift(result);
  if (checks.length > MAX_CHECKS) {
    checks.length = MAX_CHECKS;
  }
  writeChecks(checks);

  res.json(result);
});

// Validate via browser subagent
app.post('/validate', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      exec(`node validate.js "${url}"`, { cwd: __dirname, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ service: url, officialStatus: 'unknown', details: stdout.trim() });
        }
      });
    });

    res.json(result);
  } catch (err) {
    res.json({
      service: url,
      officialStatus: 'unknown',
      error: err.message,
    });
  }
});

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║   🛰️  API SENTINEL — MISSION CONTROL     ║`);
  console.log(`  ║   Server online at http://localhost:${PORT}  ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
