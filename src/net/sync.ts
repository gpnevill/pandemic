import { useSyncExternalStore } from 'react';
import type { GameState } from '../game/types';

/**
 * Client side of the shared game (see server/gameServer.ts).
 *
 * The server holds the copy of record. This store mirrors it over an
 * EventSource and only ever shows state the server has accepted: `commit`
 * computes the next state locally, sends it tagged with the version it was
 * built on, and applies it once the server says yes. If someone else got
 * there first the server answers 409 with its current state, which we adopt.
 */

export interface Shared {
  game: GameState | null;
  history: GameState[]; // within-turn undo stack
}

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface SyncView {
  shared: Shared;
  version: number; // -1 until the first state arrives
  status: ConnStatus;
  peers: number; // open tabs following the game, this one included
}

/** ok: accepted · noop: nothing changed · busy: a commit is already in flight · conflict: another player's change won */
export type CommitResult = 'ok' | 'noop' | 'busy' | 'conflict' | 'error';

type ServerMsg =
  | { type: 'state'; initial?: boolean; version: number; game: GameState | null; history: GameState[] }
  | { type: 'peers'; count: number };

let view: SyncView = { shared: { game: null, history: [] }, version: -1, status: 'connecting', peers: 0 };
const listeners = new Set<() => void>();
let source: EventSource | null = null;
let inFlight = false;

function set(patch: Partial<SyncView>) {
  view = { ...view, ...patch };
  listeners.forEach((l) => l());
}

function adopt(version: number, shared: Shared, force = false) {
  if (force || version > view.version) set({ version, shared });
}

function connect() {
  const es = new EventSource('/api/events');
  source = es;
  es.onopen = () => set({ status: 'online' });
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerMsg;
    if (msg.type === 'peers') set({ peers: msg.count });
    // the first message on every (re)connect is authoritative, even if older (server reset)
    else adopt(msg.version, { game: msg.game, history: msg.history }, msg.initial);
  };
  es.onerror = () => {
    set({ status: 'offline' });
    // the browser retries dropped streams itself, but gives up on an error response
    if (es.readyState === EventSource.CLOSED) setTimeout(() => source === es && connect(), 3000);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!source) connect();
  return () => listeners.delete(listener);
}

export function useSync(): SyncView {
  return useSyncExternalStore(subscribe, () => view);
}

/**
 * Change the shared game. `fn` runs synchronously against the latest accepted
 * state, so a RuleError it throws reaches the caller directly. Returning the
 * same object means "no change". Only one commit is in flight at a time;
 * extra clicks meanwhile are dropped.
 */
export function commit(fn: (s: Shared) => Shared): Promise<CommitResult> {
  if (inFlight) return Promise.resolve('busy');
  const base = view;
  const next = fn(base.shared);
  if (next === base.shared) return Promise.resolve('noop');
  inFlight = true;
  return fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseVersion: base.version, game: next.game, history: next.history }),
  })
    .then(async (res): Promise<CommitResult> => {
      if (res.ok) {
        const { version } = (await res.json()) as { version: number };
        adopt(version, next); // no-op if the broadcast already brought it (or something newer)
        return 'ok';
      }
      if (res.status === 409) {
        const cur = (await res.json()) as { version: number } & Shared;
        adopt(cur.version, { game: cur.game, history: cur.history });
        return 'conflict';
      }
      return 'error';
    })
    .catch((): CommitResult => 'error')
    .finally(() => {
      inFlight = false;
    });
}

// dev hot-reload: don't leave the old module's stream open
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    source?.close();
    source = null;
  });
}
