// receiver-api/server.js — API sans dépendances (HTTP natif + SSE)
import http from 'node:http';
import { parse } from 'node:url';

const PORT = process.env.PORT || 3000;

let lastPosition = null;
const history = [];
const MAX_HISTORY = 100;
const clients = new Set();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}

function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
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

const server = http.createServer((req, res) => {
  const { pathname } = parse(req.url, true);

  // Préflight CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    return res.end('OK');
  }

  if (pathname === '/stream' && req.method === 'GET') {
    return handleSSE(req, res);
  }

  if (pathname === '/latest' && req.method === 'GET') {
    if (!lastPosition) return sendJson(res, 404, { error: 'No data yet' });
    return sendJson(res, 200, lastPosition);
  }

  if (pathname === '/history' && req.method === 'GET') {
    return sendJson(res, 200, history);
  }

  if (pathname === '/collect' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      try {
        const data = raw ? JSON.parse(raw) : {};
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
          return sendJson(res, 400, { error: 'Missing/invalid lat/lng' });
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
        sendJson(res, 200, { ok: true });
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Zero-deps Receiver API on http://localhost:${PORT}`);
});
