import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();

// ----- CONFIG -----
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
// Si non défini, on autorise tout en DEV :
const corsOptions = ALLOWED_ORIGINS.length
  ? { origin: ALLOWED_ORIGINS, methods: ['GET','POST'], credentials: false }
  : { origin: true, methods: ['GET','POST'] };

app.use(cors(corsOptions));
app.use(express.json());

// ----- STOCKAGE EN MEMOIRE -----
let lastPosition = null;         // dernière position reçue
const history = [];              // historique (limité)
const MAX_HISTORY = 100;

// ----- SSE (Server-Sent Events) -----
const clients = new Set();

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(`retry: 5000\n\n`);
  clients.add(res);

  // envoyer la dernière position immédiatement si dispo
  if (lastPosition) {
    res.write(`event: position\n`);
    res.write(`data: ${JSON.stringify(lastPosition)}\n\n`);
  }

  req.on('close', () => {
    clients.delete(res);
  });
});

function broadcastPosition(pos) {
  for (const res of clients) {
    res.write(`event: position\n`);
    res.write(`data: ${JSON.stringify(pos)}\n\n`);
  }
}

// ----- ROUTES -----

// POST /collect : reçoit la position
app.post('/collect', (req, res) => {
  const data = req.body || {};
  const required = ['lat','lng'];
  for (const k of required) {
    if (typeof data[k] !== 'number') {
      return res.status(400).json({ error: `Missing/invalid field: ${k}` });
    }
  }

  const enriched = {
    ...data,
    received_at_ms: Date.now(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null
  };

  lastPosition = enriched;
  history.push(enriched);
  if (history.length > MAX_HISTORY) history.shift();

  // diffusion temps réel
  broadcastPosition(enriched);

  res.sendStatus(200);
});

// GET /latest : renvoie la dernière position
app.get('/latest', (req, res) => {
  if (!lastPosition) return res.status(404).json({ error: 'No data yet' });
  res.json(lastPosition);
});

// GET /history : renvoie l’historique (limité)
app.get('/history', (req, res) => {
  res.json(history);
});

// Santé
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log(`Receiver API running on http://localhost:${PORT}`);
  if (!ALLOWED_ORIGINS.length) {
    console.log('CORS: DEV mode (origin:*). Configure ALLOWED_ORIGINS in .env for production.');
  }
});
