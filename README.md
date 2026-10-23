# 🌍 Pandemic

A fan-made digital implementation of the cooperative board game **Pandemic**, built as a local web app. Two to four players share one screen or play from their own machines over [Tailscale](https://tailscale.com/), racing to cure four diseases before the world is overwhelmed.

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

## Multiplayer over Tailscale

Host the game on one machine and play from any other machine on your tailnet:

```bash
npm run host
```

This builds the game, starts the server on port 24848 (`PORT=24849 npm run host` to change it), and prints the links:

```
  On this machine:      http://localhost:24848
  On the other machine: http://your-mac.your-tailnet.ts.net:24848
                        http://100.x.y.z:24848
```

Open the first link yourself and send one of the others to your teammate. When a game starts, each browser picks which player(s) it controls. Pick every player to pass one screen around, or **Just watch** to spectate; change it later with the 👤 button in the top bar. Everyone sees the board update live, and only the browser holding the player whose move it is can act. Events are played from their holder's browser at any time, as in the board game.

- **Only this machine and your tailnet can connect.** The server turns away other addresses, such as people on the same Wi-Fi. Set `PANDEMIC_ALLOW_LAN=1` to allow them.
- **The game is saved** to `.pandemic-save.json` after every move, so you can stop the server and pick up later. Delete the file to start fresh.
- On first run, macOS may ask whether to allow `node` to accept incoming connections. Allow it, or the other machine can't connect.
- Browsers only play sound after you've clicked the page once, so the other player's moves are silent until then.
- `npm run dev -- --host` gives the same multiplayer setup with hot reload, for working on the code.

## Features

- **Full base-game rules** — all 48 cities, 4 diseases, 7 roles, 5 event cards, epidemics, chained outbreaks, eradication, hand limits, and every win/loss condition.
- **Co-op for 2–4 players** — hotseat on one screen with turn-handoff screens, or across machines on your Tailscale tailnet with live updates.
- **Three difficulties** — Introductory (4 epidemics), Standard (5), Heroic (6).
- **Cinematic turn flow** — card draws, epidemic steps (rate rise → strike → intensify), and infections resolve one at a time with click-anywhere-to-advance announcements, so you never need to read the log to know what happened.
- **Click-driven movement** — click a connected city to drive, a research-station city to shuttle, or a card in your hand to fly (your own city's card charters anywhere).
- **Within-turn undo**, rules reference panel, and role power summaries.
- **Auto-save** — the local server saves the game after every move, so it survives reloads and restarts.
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
  net/         # shared-game sync and per-browser seat choice
  ui/          # React components (board, sounds)
  App.tsx      # app shell, dialogs, turn flow
server/
  gameServer.ts # Vite plugin: holds the shared game, live updates, tailnet-only access
scripts/
  genWorld.mjs # regenerates src/game/world.ts from Natural Earth data
  host.mjs     # `npm run host`: build and serve the game to your tailnet
```

To regenerate the world map path (e.g. after changing the projection):

```bash
node scripts/genWorld.mjs
```

## Disclaimer

This is an unofficial, non-commercial fan project for personal local play, implementing the game mechanics of Pandemic (designed by Matt Leacock, published by Z-Man Games). It is not affiliated with or endorsed by the publisher, and uses no artwork or assets from the published game. If you enjoy it, buy the real board game — it's excellent.
