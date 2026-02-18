#!/usr/bin/env node
// ============================================================================
// IBKR CORS Proxy Server
// ============================================================================
// Proxies requests to IBKR Client Portal Gateway with CORS + API key auth.
// Uses only built-in Node.js modules (no npm dependencies needed).
//
// Environment variables:
//   IBKR_GATEWAY_URL  - IBKR Gateway URL (default: https://localhost:5000)
//   PROXY_PORT        - Port for this proxy (default: 5001)
//   PROXY_API_KEY     - Required API key for authentication
//   ALLOWED_ORIGINS   - Comma-separated allowed origins (default: *)
// ============================================================================

const http = require('http');
const https = require('https');
const { URL } = require('url');

const IBKR_GATEWAY_URL = process.env.IBKR_GATEWAY_URL || 'https://localhost:5000';
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '5001', 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

if (!PROXY_API_KEY) {
  console.error('WARNING: No PROXY_API_KEY set! Anyone can access your IBKR account.');
}

// Pick http or https based on gateway URL scheme
const useHttps = IBKR_GATEWAY_URL.startsWith('https');
const gatewayLib = useHttps ? https : http;
const gatewayAgent = useHttps
  ? new https.Agent({ rejectUnauthorized: false })
  : new http.Agent();

// ============================================================================
// Helper: Proxy a request to the IBKR Gateway
// ============================================================================
function proxyToGateway(path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, IBKR_GATEWAY_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 5000,
      path: url.pathname + url.search,
      method: method,
      agent: gatewayAgent,
      headers: { ...headers },
      timeout: 15000,
    };

    // Remove headers that shouldn't be forwarded
    delete options.headers['host'];
    delete options.headers['x-api-key'];
    delete options.headers['origin'];
    delete options.headers['referer'];

    const req = gatewayLib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gateway request timed out'));
    });

    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

// ============================================================================
// Add CORS headers
// ============================================================================
function addCorsHeaders(res, origin) {
  if (ALLOWED_ORIGINS === '*') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  } else {
    const allowed = ALLOWED_ORIGINS.split(',').map(s => s.trim());
    if (allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ============================================================================
// HTTP Server
// ============================================================================
const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'] || '';
  addCorsHeaders(res, origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      gateway: IBKR_GATEWAY_URL,
      keepAlive: keepAliveActive,
      uptime: Math.floor(process.uptime()),
    }));
    return;
  }

  // API Key check
  if (PROXY_API_KEY) {
    const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);
    const providedKey = req.headers['x-api-key'] || url.searchParams.get('apiKey');
    if (providedKey !== PROXY_API_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid API key' }));
      return;
    }
  }

  // Only proxy /v1/* paths
  if (!req.url.startsWith('/v1')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Proxy only handles /v1/* paths.' }));
    return;
  }

  // Read request body
  const bodyChunks = [];
  req.on('data', (chunk) => bodyChunks.push(chunk));
  req.on('end', async () => {
    const body = Buffer.concat(bodyChunks);

    try {
      const result = await proxyToGateway(req.url, req.method, req.headers, body);

      // Forward response headers (skip hop-by-hop)
      const skipHeaders = new Set(['transfer-encoding', 'connection', 'keep-alive']);
      for (const [key, value] of Object.entries(result.headers)) {
        if (!skipHeaders.has(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }

      // Re-apply CORS headers (gateway response may overwrite them)
      addCorsHeaders(res, origin);

      res.writeHead(result.statusCode);
      res.end(result.body);
    } catch (err) {
      console.error('[Proxy] Error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Gateway connection failed',
        message: err.message,
        hint: 'Make sure IBKR Client Portal Gateway is running and you are logged in.',
      }));
    }
  });
});

// ============================================================================
// Keep-Alive: Tickle IBKR Gateway every 50 seconds
// ============================================================================
let keepAliveActive = false;

function tickleGateway() {
  const url = new URL('/v1/api/tickle', IBKR_GATEWAY_URL);
  const req = gatewayLib.request({
    hostname: url.hostname,
    port: url.port || 5000,
    path: url.pathname,
    method: 'POST',
    agent: gatewayAgent,
    timeout: 5000,
  }, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      keepAliveActive = res.statusCode === 200;
    });
  });
  req.on('error', () => { keepAliveActive = false; });
  req.on('timeout', () => { req.destroy(); keepAliveActive = false; });
  req.end();
}

setInterval(tickleGateway, 50_000);

// ============================================================================
// Start Server
// ============================================================================
server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log('============================================================');
  console.log('  IBKR CORS Proxy Server');
  console.log('============================================================');
  console.log(`  Proxy listening on:    http://0.0.0.0:${PROXY_PORT}`);
  console.log(`  IBKR Gateway target:   ${IBKR_GATEWAY_URL}`);
  console.log(`  API Key protection:    ${PROXY_API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  Allowed origins:       ${ALLOWED_ORIGINS}`);
  console.log(`  Keep-alive:            Every 50 seconds`);
  console.log('============================================================');

  tickleGateway();
});
