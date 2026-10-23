import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

/**
 * The multiplayer game server, built into Vite's dev and preview servers.
 *
 * It holds one shared game. Browsers follow it live over Server-Sent Events
 * (GET /api/events) and change it with POST /api/state. Each change names the
 * version it was built on; a change built on an old version is refused with
 * 409 plus the current state, so two players can never overwrite each other.
 *
 * The rules engine still runs in the browser — the server only stores and
 * relays the resulting state, and saves it to disk so a restart resumes.
 */

interface Snapshot {
  version: number;
  game: unknown; // GameState | null — the server never looks inside
  history: unknown[]; // within-turn undo stack
}

const SAVE_FILE = '.pandemic-save.json';
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export function gameServer(): Plugin {
  let saveFile = SAVE_FILE;
  let state: Snapshot | null = null;
  const streams = new Set<ServerResponse>();

  const current = (): Snapshot => (state ??= load(saveFile));

  function broadcast(msg: object) {
    const frame = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of streams) res.write(frame);
  }

  function openStream(req: IncomingMessage, res: ServerResponse) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'state', initial: true, ...current() })}\n\n`);
    streams.add(res);
    broadcast({ type: 'peers', count: streams.size });
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
      clearInterval(ping);
      streams.delete(res);
      broadcast({ type: 'peers', count: streams.size });
    });
  }

  async function update(req: IncomingMessage, res: ServerResponse) {
    let body: { baseVersion?: unknown; game?: unknown; history?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, err instanceof TooLarge ? 413 : 400, { error: 'Bad request' });
    }
    const { baseVersion, game, history } = body ?? {};
    if (typeof baseVersion !== 'number' || typeof game !== 'object' || !Array.isArray(history)) {
      return sendJson(res, 400, { error: 'Bad request' });
    }
    const cur = current();
    if (baseVersion !== cur.version) return sendJson(res, 409, cur);
    state = { version: cur.version + 1, game, history };
    save(saveFile, state);
    sendJson(res, 200, { version: state.version });
    broadcast({ type: 'state', ...state });
  }

  const api: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/api/events' && req.method === 'GET') return openStream(req, res);
    if (url === '/api/state' && req.method === 'GET') return sendJson(res, 200, current());
    if (url === '/api/state' && req.method === 'POST') return void update(req, res);
    if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    next();
  };

  // Vite runs its Host-header check before these, and its compression after,
  // so the event stream is never buffered.
  const install = (middlewares: Connect.Server) => {
    middlewares.use(tailnetOnly);
    middlewares.use(api);
  };

  return {
    name: 'pandemic-game-server',
    config: () => ({ server: { watch: { ignored: [`**/${SAVE_FILE}*`] } } }),
    configResolved(config) {
      saveFile = path.resolve(config.root, SAVE_FILE);
    },
    configureServer: (server) => install(server.middlewares),
    configurePreviewServer: (server) => install(server.middlewares),
  };
}

/* --------------------------------------------------------------- access */

/** Only this machine and Tailscale peers may connect (set PANDEMIC_ALLOW_LAN=1 to allow anyone). */
const tailnetOnly: Connect.NextHandleFunction = (req, res, next) => {
  if (process.env.PANDEMIC_ALLOW_LAN === '1' || isLocalOrTailnet(req.socket.remoteAddress)) return next();
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(
    'This Pandemic server only accepts connections from its own machine and your Tailscale tailnet.\n' +
      'Connect via the host\'s Tailscale address, or restart it with PANDEMIC_ALLOW_LAN=1.\n'
  );
};

/** Loopback, or a Tailscale address: 100.64.0.0/10 or fd7a:115c:a1e0::/48. */
function isLocalOrTailnet(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase().replace(/^::ffff:/, '');
  if (a === '::1' || a.startsWith('127.')) return true;
  if (a.startsWith('fd7a:115c:a1e0:')) return true;
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(a);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/* -------------------------------------------------------------- helpers */

function load(file: string): Snapshot {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof s?.version === 'number' && Array.isArray(s.history)) return s;
  } catch {
    // no save yet (or unreadable) — start fresh
  }
  return { version: 0, game: null, history: [] };
}

function save(file: string, s: Snapshot) {
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(s));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.warn('[pandemic] could not save the game:', err);
  }
}

class TooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk); // past the limit: keep draining, then refuse
    });
    req.on('end', () =>
      size > MAX_BODY_BYTES ? reject(new TooLarge()) : resolve(Buffer.concat(chunks).toString('utf8'))
    );
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
