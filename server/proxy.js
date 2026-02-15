#!/usr/bin/env node
// ============================================================================
// IBKR CORS Proxy Server
// ============================================================================
// This proxy runs alongside the IBKR Client Portal Gateway and:
//
//  1. Adds CORS headers so the web app can connect from any domain
//  2. Proxies all requests to the local IBKR Gateway (https://localhost:5000)
//  3. Keeps the IBKR session alive automatically (tickle every 50s)
//  4. Protects access with a simple API key
//
// Usage:
//   PROXY_API_KEY=your-secret-key node proxy.js
//
// The web app connects to this proxy instead of the IBKR Gateway directly.
// Example: https://your-server.com:5001 (or whatever port you choose)
//
// Environment variables:
//   IBKR_GATEWAY_URL  - IBKR Gateway URL (default: https://localhost:5000)
//   PROXY_PORT        - Port for this proxy (default: 5001)
//   PROXY_API_KEY     - Required API key for authentication
//   ALLOWED_ORIGINS   - Comma-separated allowed origins (default: *)
// ============================================================================

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('https-proxy-middleware');

const IBKR_GATEWAY_URL = process.env.IBKR_GATEWAY_URL || 'https://localhost:5000';
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '5001', 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY || '';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

if (!PROXY_API_KEY) {
  console.error('========================================================');
  console.error('  WARNING: No PROXY_API_KEY set!');
  console.error('  Anyone can access your IBKR account through this proxy.');
  console.error('  Set PROXY_API_KEY environment variable for security.');
  console.error('========================================================');
}

const app = express();

// ============================================================================
// CORS - Allow the web app to connect
// ============================================================================
const corsOptions = {
  origin: ALLOWED_ORIGINS === '*' ? true : ALLOWED_ORIGINS.split(',').map(s => s.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
};

app.use(cors(corsOptions));

// ============================================================================
// API Key Authentication Middleware
// ============================================================================
app.use((req, res, next) => {
  // Skip auth check for OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  // Health check endpoint doesn't need auth
  if (req.path === '/health') {
    return next();
  }

  if (PROXY_API_KEY) {
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    if (providedKey !== PROXY_API_KEY) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
  }

  next();
});

// ============================================================================
// Health Check
// ============================================================================
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    gateway: IBKR_GATEWAY_URL,
    keepAlive: keepAliveActive,
    uptime: Math.floor(process.uptime()),
  });
});

// ============================================================================
// IBKR Gateway Proxy
// ============================================================================
app.use(
  '/v1',
  createProxyMiddleware({
    target: IBKR_GATEWAY_URL,
    changeOrigin: true,
    secure: false, // IBKR Gateway uses self-signed SSL cert
    cookieDomainRewrite: '', // Forward cookies
    on: {
      proxyReq: (proxyReq) => {
        // Remove the x-api-key header before forwarding to IBKR
        proxyReq.removeHeader('x-api-key');
      },
      error: (err, _req, res) => {
        console.error('[Proxy] Error:', err.message);
        if (res.writeHead) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Gateway connection failed',
            message: err.message,
            hint: 'Make sure IBKR Client Portal Gateway is running',
          }));
        }
      },
    },
  })
);

// ============================================================================
// Keep-Alive: Tickle IBKR Gateway every 50 seconds
// ============================================================================
let keepAliveActive = false;

async function tickleGateway() {
  try {
    // Use dynamic import for node-fetch (ESM)
    const fetch = (await import('node-fetch')).default;

    const response = await fetch(`${IBKR_GATEWAY_URL}/v1/api/tickle`, {
      method: 'POST',
      rejectUnauthorized: false, // Self-signed cert
      agent: new (await import('https')).Agent({ rejectUnauthorized: false }),
    });

    if (response.ok) {
      keepAliveActive = true;
    } else {
      console.warn('[KeepAlive] Tickle response:', response.status);
      keepAliveActive = false;
    }
  } catch (err) {
    // Gateway not running or not authenticated - that's okay
    keepAliveActive = false;
  }
}

// Tickle every 50 seconds
setInterval(tickleGateway, 50_000);

// Also check auth status every 5 minutes
async function checkAuthStatus() {
  try {
    const fetch = (await import('node-fetch')).default;
    const https = await import('https');
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await fetch(`${IBKR_GATEWAY_URL}/v1/api/iserver/auth/status`, {
      method: 'POST',
      agent,
    });

    if (response.ok) {
      const status = await response.json();
      if (!status.authenticated) {
        console.warn('[KeepAlive] IBKR session not authenticated - please log in via the Gateway web UI');
      }
    }
  } catch {
    // Silently ignore - gateway might not be running
  }
}

setInterval(checkAuthStatus, 300_000);

// ============================================================================
// Start Server
// ============================================================================
app.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log('============================================================');
  console.log('  IBKR CORS Proxy Server');
  console.log('============================================================');
  console.log(`  Proxy listening on:    http://0.0.0.0:${PROXY_PORT}`);
  console.log(`  IBKR Gateway target:   ${IBKR_GATEWAY_URL}`);
  console.log(`  API Key protection:    ${PROXY_API_KEY ? 'ENABLED' : 'DISABLED (not recommended!)'}`);
  console.log(`  Allowed origins:       ${ALLOWED_ORIGINS}`);
  console.log(`  Keep-alive:            Every 50 seconds`);
  console.log('============================================================');
  console.log('');
  console.log('  In your web app, set the Gateway URL to:');
  console.log(`    http://your-server-ip:${PROXY_PORT}`);
  console.log('');

  // Initial tickle
  tickleGateway();
  checkAuthStatus();
});
