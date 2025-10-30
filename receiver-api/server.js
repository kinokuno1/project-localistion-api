// receiver-api/server.js — Zero-deps API (HTTP natif + SSE) avec CORS robuste
import http from 'node:http';

const PORT = process.env.PORT || 3000;

// Liste blanche des origines autorisées (ajoute/retire selon tes sites)
const ALLOWED_ORIGINS = new Set([
  'https://project-localisation-input.onrender.com',
  'https://project-localisation-output.onrender.com',
  // ajoute d'autres domaines si besoin (ex. ton Netlify)
]);

let lastPosition = null;
const history = [];
const MAX_HISTORY = 100;
const clients = new Set();

/* ---------- CORS helpers ---------- */
function getOrigin(req) {
  const o = req.headers.origin;
  return (o && ALLOWED_ORIGINS.has(o)) ? o : null;
}

function writeCORS(res, origin) {
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  // méthodes & en-têtes attendus par le préflight/fetch
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // pas de credentials ici → pas d’Allow-Credentials (inutile)
}

function sendJson(req, res, status, data) {
  const origin = getOrigin(req);
  res.statusCode = status;
  writeCORS(res, origin);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

/* ---------- SSE ---------- */
function handleSSE(req, res) {
  const origin = getOrigin(req);
  writeCORS(res, origin);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('retry: 5000\n\n');
  clients.add(res);
  if (lastPosition) {
    res.write('event: position\n');
    res.write(`data: ${JSON.stringify(lastPosition)}\n\n`);
  }
  req.on('close', () => clients.delete(res));
}

function broadcastPosition(pos) {
  for (const res of clients) {
    res.write('event: position\n');
    res.write(`data: ${JSON.stringify(pos)}\n\n`);
  }
}

/* ---------- Server ---------- */
const server = http.createServer((req, res) => {
  // Normalise le chemin (pas de slash final)
  const url = new URL(req.url, `http://${req.headers.host}`);
  let path = url.pathname.replace(/\/+$/, '');
  if (path === '') path = '/';

  // Préflight CORS (OPTIONS) – répondre AVANT tout
  if (req.method === 'OPTIONS') {
    const origin = getOrigin(req);
    writeCORS(res, origin);
    // annonce ce que tu acceptes ; 204 = No Content
    res.statusCode = 204;
    res.end();
    return;
  }

  // Santé / racine
  if (path === '/' || path === '/health') {
    const origin = getOrigin(req);
    writeCORS(res, origin);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
  }

  if (path === '/stream' && req.method === 'GET') {
    return handleSSE(req, res);
  }

  if (path === '/latest' && req.method === 'GET') {
    if (!lastPosition) return sendJson(req, res, 404, { error: 'No data yet' });
    return sendJson(req, res, 200, lastPosition);
  }

  if (path === '/history' && req.method === 'GET') {
    return sendJson(req, res, 200, history);
  }

  if (path === '/collect' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try {
        const data = raw ? JSON.parse(raw) : {};
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
          return sendJson(req, res, 400, { error: 'Missing/invalid lat/lng' });
        }
        const enriched = {
          ...data,
          received_at_ms: Date.now(),
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null
        };
        lastPosition = enriched;
        history.push(enriched);
        if (history.length > MAX_HISTORY) history.shift();
        broadcastPosition(enriched);
        return sendJson(req, res, 200, { ok: true });
      } catch {
        return sendJson(req, res, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  // 404 JSON (avec CORS)
  return sendJson(req, res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Zero-deps Receiver API with strict CORS on http://localhost:${PORT}`);
});
