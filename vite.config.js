import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Lokalna obsługa funkcji z api/ podczas `vite dev` (na produkcji robi to Vercel).
// Dzięki temu w trybie deweloperskim / testowym działają ceny akcji, FX, import ze zrzutu itd.
// Adapter odwzorowuje to, czego używają nasze handlery: req.query, req.body, res.status().json/send.
function localApi(env) {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      // Klucze serwerowe (ANTHROPIC_API_KEY, GROQ_API_KEY…) z .env.local → process.env handlerów
      for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const m = url.pathname.match(/^\/api\/([\w-]+)$/)
        if (!m) return next()
        // Jak na Vercelu: konkretny plik api/<nazwa>.js, a w przeciwnym razie router api/[route].js
        const own = path.resolve(server.config.root, 'api', `${m[1]}.js`)
        const file = fs.existsSync(own) ? own : path.resolve(server.config.root, 'api', '[route].js')
        if (!fs.existsSync(file)) return next()

        try {
          let raw = ''
          for await (const chunk of req) raw += chunk
          req.query = Object.fromEntries(url.searchParams)
          if (file !== own) req.query.route = m[1]
          req.body = raw && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : raw || undefined
          req.devLocal = true

          res.status = code => { res.statusCode = code; return res }
          res.json = obj => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return res }
          res.send = body => { res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); return res }

          const mod = await server.ssrLoadModule(file)
          await mod.default(req, res)
        } catch (e) {
          console.error(`[local-api] ${m[1]}`, e)
          if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), localApi(loadEnv(mode, process.cwd(), ''))],
}))
