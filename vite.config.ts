import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const WATCHLIST_FILE = path.resolve(__dirname, 'src/config/watchlist.ts')

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'watchlist-api',
      configureServer(server) {
        // API to update watchlist file
        server.middlewares.use('/api/watchlist', (req, res) => {
          if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', () => {
              try {
                const { stocks } = JSON.parse(body)
                const content = `/**
 * Permanent Watchlist Configuration
 * This file is auto-updated when you add/remove stocks in the app.
 */

export const PERMANENT_STOCKS = [
${stocks.map((s: string) => `  '${s}',`).join('\n')}
];

export const PERMANENT_WATCHLIST = [...PERMANENT_STOCKS];
`
                fs.writeFileSync(WATCHLIST_FILE, content)
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: String(err) }))
              }
            })
          } else {
            res.writeHead(405)
            res.end()
          }
        })
      }
    }
  ],
  server: {
    proxy: {
      '/api/ibkr': {
        target: 'https://localhost:5000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/ibkr/, ''),
      },
      '/api/twelvedata': {
        target: 'https://api.twelvedata.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/twelvedata/, ''),
      },
    },
  },
})
