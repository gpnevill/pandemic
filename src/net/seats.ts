import { useState } from 'react';

/**
 * Which players this browser tab controls, remembered per game.
 *
 * Saved to sessionStorage (so two tabs on one machine can play different
 * seats) and to localStorage (so a new tab or a browser restart remembers
 * the last choice). Choosing every player is classic hotseat.
 */

const KEY = 'pandemic-seats';

interface Saved {
  gameId: string;
  seats: number[];
}

function read(gameId: string): number[] | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const v = JSON.parse(store.getItem(KEY) ?? 'null') as Saved | null;
      if (v?.gameId === gameId && Array.isArray(v.seats)) return v.seats;
    } catch {
      // unavailable or corrupt — fall through
    }
  }
  return null;
}

function write(saved: Saved) {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.setItem(KEY, JSON.stringify(saved));
    } catch {
      // storage unavailable — the choice just won't survive a reload
    }
  }
}

/** Seats for `gameId`: `null` until this tab has chosen, `[]` for spectating. */
export function useSeats(gameId: string | null): [number[] | null, (seats: number[]) => void] {
  const [picked, setPicked] = useState<Saved | null>(null);
  const seats = gameId === null ? null : picked?.gameId === gameId ? picked.seats : read(gameId);
  const choose = (s: number[]) => {
    if (gameId === null) return;
    const saved = { gameId, seats: [...s].sort((a, b) => a - b) };
    write(saved);
    setPicked(saved);
  };
  return [seats, choose];
}
