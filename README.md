# 🌍 Pandemic

A fan-made digital implementation of the cooperative board game **Pandemic**, built as a local hotseat web app. Two to four players share one screen, racing to cure four diseases before the world is overwhelmed.

Built with React, TypeScript, and Vite. The world map is generated from real [Natural Earth](https://www.naturalearthdata.com/) coastline data, with all 48 cities placed at their true coordinates via a Miller projection.

## Running locally

**Requirements:** [Node.js](https://nodejs.org/) 18 or newer.

```bash
# install dependencies (first time only)
npm install

# start the dev server
npm run dev
```

Then open **http://localhost:5173** in your browser.

For an optimized production build:

```bash
npm run build
npm run preview
```

## Features

- **Full base-game rules** — all 48 cities, 4 diseases, 7 roles, 5 event cards, epidemics, chained outbreaks, eradication, hand limits, and every win/loss condition.
- **Hotseat co-op** for 2–4 players with turn-handoff screens between players.
- **Three difficulties** — Introductory (4 epidemics), Standard (5), Heroic (6).
- **Cinematic turn flow** — card draws, epidemic steps (rate rise → strike → intensify), and infections resolve one at a time with click-anywhere-to-advance announcements, so you never need to read the log to know what happened.
- **Click-driven movement** — click a connected city to drive, a research-station city to shuttle, or a card in your hand to fly (your own city's card charters anywhere).
- **Within-turn undo**, rules reference panel, and role power summaries.
- **Auto-save** — games persist to the browser's localStorage and survive reloads.
- **Synthesized sound effects and victory music** (grander with higher difficulty), with a mute toggle. No audio assets — everything is generated with the Web Audio API.
- **Confetti.** You'll know it when you've earned it.

## How to play

Each turn: take **4 actions** (move, treat disease, build research stations, share knowledge, discover cures), then **draw 2 player cards** (beware epidemics), then **infect cities**. Cure all four diseases to win. Lose if the 8th outbreak occurs, a disease's cube supply runs out, or the player deck is exhausted. The in-app **📖 Rules** button has the full reference.

## Project structure

```
src/
  game/        # pure TypeScript rules engine (no UI)
    engine.ts  # actions, turn phases, epidemics, outbreaks, win/loss
    data.ts    # the 48 cities, connections, roles, events
    world.ts   # generated world-map SVG path (do not edit)
    geo.ts     # Miller projection shared by map + cities
  ui/          # React components (board, sounds)
  App.tsx      # app shell, dialogs, turn flow
scripts/
  genWorld.mjs # regenerates src/game/world.ts from Natural Earth data
```

To regenerate the world map path (e.g. after changing the projection):

```bash
node scripts/genWorld.mjs
```

## Disclaimer

This is an unofficial, non-commercial fan project for personal local play, implementing the game mechanics of Pandemic (designed by Matt Leacock, published by Z-Man Games). It is not affiliated with or endorsed by the publisher, and uses no artwork or assets from the published game. If you enjoy it, buy the real board game — it's excellent.
