import { CITIES, CITY_IDS, EVENT_IDS, EVENTS, ROLE_IDS } from './data';
import type { Card, Color, EventId, GameState, Player, RoleId } from './types';
import {
  COLORS,
  CUBES_PER_COLOR,
  HAND_LIMIT,
  INFECTION_RATES,
  MAX_OUTBREAKS,
  MAX_STATIONS,
} from './types';

export class RuleError extends Error {}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clone = (s: GameState): GameState => structuredClone(s);

function log(s: GameState, msg: string) {
  s.log.push(msg);
}

function fx(s: GameState, type: 'infect' | 'outbreak', city: string, color: Color) {
  s.fx.push({ id: ++s.fxSeq, type, city, color });
  if (s.fx.length > 30) s.fx.splice(0, s.fx.length - 30);
}

function cityName(id: string): string {
  return CITIES[id].name;
}

function cubeCount(s: GameState, city: string, color: Color): number {
  return s.cubes[city]?.[color] ?? 0;
}

function totalCubesOfColor(s: GameState, color: Color): number {
  return CITY_IDS.reduce((n, c) => n + cubeCount(s, c, color), 0);
}

function playerByRole(s: GameState, role: RoleId): Player | undefined {
  return s.players.find((p) => p.role === role);
}

/** Is cube placement of `color` prevented in `city`? (Quarantine Specialist / Medic passive) */
function placementPrevented(s: GameState, city: string, color: Color): boolean {
  const q = playerByRole(s, 'quarantine');
  if (q && (q.location === city || CITIES[q.location].neighbors.includes(city))) return true;
  const m = playerByRole(s, 'medic');
  if (m && s.cured[color] && m.location === city) return true;
  return false;
}

function checkEradication(s: GameState, color: Color) {
  if (s.cured[color] && !s.eradicated[color] && totalCubesOfColor(s, color) === 0) {
    s.eradicated[color] = true;
    log(s, `🎉 ${color.toUpperCase()} has been ERADICATED.`);
  }
}

function lose(s: GameState, reason: string) {
  if (s.gameOver) return;
  // the phase is left as-is so the fatal step stays on screen;
  // acknowledgeDefeat() moves to the game-over screen on the next click
  s.gameOver = { won: false, reason };
  log(s, `💀 GAME OVER — ${reason}`);
}

/** The player has seen the step that lost the game — show the defeat screen. */
export function acknowledgeDefeat(state: GameState): GameState {
  const s = clone(state);
  s.phase = 'gameOver';
  return s;
}

function win(s: GameState) {
  s.gameOver = { won: true, reason: 'All four diseases have been cured!' };
  s.phase = 'gameOver';
  log(s, '🏆 VICTORY — all four diseases cured!');
}

/**
 * Place cubes with outbreak chaining. `visited` holds cities that have already
 * outbroken during this single infection-card resolution.
 */
function placeCubes(s: GameState, city: string, color: Color, n: number, visited: Set<string>) {
  if (s.gameOver) return;
  if (s.eradicated[color]) return;
  if (placementPrevented(s, city, color)) {
    log(s, `🛡 Cube placement prevented in ${cityName(city)}.`);
    return;
  }
  for (let i = 0; i < n; i++) {
    const cur = cubeCount(s, city, color);
    if (cur >= 3) {
      outbreak(s, city, color, visited);
      if (s.gameOver) return;
    } else {
      if (s.cubesLeft[color] <= 0) {
        lose(s, `The supply of ${color} disease cubes ran out.`);
        return;
      }
      s.cubes[city] = s.cubes[city] ?? {};
      s.cubes[city][color] = cur + 1;
      s.cubesLeft[color]--;
      fx(s, 'infect', city, color);
    }
  }
}

function outbreak(s: GameState, city: string, color: Color, visited: Set<string>) {
  if (visited.has(city)) return;
  visited.add(city);
  s.outbreaks++;
  fx(s, 'outbreak', city, color);
  log(s, `💥 OUTBREAK in ${cityName(city)} (${color})! Outbreak count: ${s.outbreaks}`);
  if (s.outbreaks >= MAX_OUTBREAKS) {
    lose(s, 'The 8th outbreak occurred — worldwide panic.');
    return;
  }
  for (const nb of CITIES[city].neighbors) {
    if (visited.has(nb)) continue;
    placeCubes(s, nb, color, 1, visited);
    if (s.gameOver) return;
  }
}

/* ------------------------------------------------------------------ setup */

export interface SetupConfig {
  players: Array<{ name: string; role: RoleId | 'random' }>;
  epidemics: 4 | 5 | 6;
}

export function newGame(cfg: SetupConfig): GameState {
  const usedRoles = new Set<RoleId>(
    cfg.players.map((p) => p.role).filter((r): r is RoleId => r !== 'random')
  );
  const pool = shuffle(ROLE_IDS.filter((r) => !usedRoles.has(r)));
  const players: Player[] = cfg.players.map((p, i) => ({
    id: i,
    name: p.name || `Player ${i + 1}`,
    role: p.role === 'random' ? pool.pop()! : p.role,
    location: 'atlanta',
    hand: [],
    storedEvent: null,
  }));

  const s: GameState = {
    // Math.random, not crypto.randomUUID: remote players load the game over plain http, where crypto is unavailable
    id: Math.random().toString(36).slice(2, 10),
    players,
    current: 0,
    actionsLeft: 4,
    phase: 'handoff', // first player confirms before seeing the turn controls

    cubes: {},
    cubesLeft: { blue: CUBES_PER_COLOR, yellow: CUBES_PER_COLOR, black: CUBES_PER_COLOR, red: CUBES_PER_COLOR },
    stations: ['atlanta'],
    cured: { blue: false, yellow: false, black: false, red: false },
    eradicated: { blue: false, yellow: false, black: false, red: false },
    playerDeck: [],
    playerDiscard: [],
    infectionDeck: shuffle(CITY_IDS),
    infectionDiscard: [],
    removedCards: [],
    infectionRateIndex: 0,
    outbreaks: 0,
    epidemicsTotal: cfg.epidemics,
    oneQuietNight: false,
    opsFlightUsed: false,
    infectionsRemaining: 0,
    currentInfection: null,
    epidemicStep: null,
    celebration: null,
    forecast: null,
    drawnCards: [],
    drawsRemaining: 0,
    currentDraw: null,
    discardQueue: [],
    log: [],
    gameOver: null,
    fx: [],
    fxSeq: 0,
  };

  log(s, `— New game: ${players.length} players, ${cfg.epidemics} epidemics —`);

  // Initial infections: 3 cities ×3 cubes, 3 ×2, 3 ×1 (no outbreaks possible, no prevention in setup)
  for (const n of [3, 2, 1]) {
    for (let i = 0; i < 3; i++) {
      const card = s.infectionDeck.pop()!;
      s.infectionDiscard.push(card);
      const color = CITIES[card].color;
      s.cubes[card] = { [color]: n };
      s.cubesLeft[color] -= n;
      log(s, `Setup: ${cityName(card)} gets ${n} ${color} cube${n > 1 ? 's' : ''}.`);
    }
  }

  // Player deck: city + event cards, deal hands, then insert epidemics
  let deck: Card[] = shuffle([
    ...CITY_IDS.map((c): Card => ({ kind: 'city', city: c })),
    ...EVENT_IDS.map((e): Card => ({ kind: 'event', event: e })),
  ]);
  const handSize = players.length === 2 ? 4 : players.length === 3 ? 3 : 2;
  for (const p of players) {
    p.hand = deck.splice(0, handSize);
  }

  // Starting player: highest-population city card in hand
  let best = { pop: -1, player: 0 };
  for (const p of players) {
    for (const c of p.hand) {
      if (c.kind === 'city' && CITIES[c.city].pop > best.pop) {
        best = { pop: CITIES[c.city].pop, player: p.id };
      }
    }
  }
  s.current = best.player;
  log(s, `${players[best.player].name} goes first (highest city population in hand).`);

  // Split into piles, one epidemic shuffled into each
  const piles: Card[][] = Array.from({ length: cfg.epidemics }, () => []);
  deck.forEach((card, i) => piles[i % cfg.epidemics].push(card));
  s.playerDeck = piles
    .map((pile) => shuffle([...pile, { kind: 'epidemic' } as Card]))
    .reverse()
    .flat();
  // playerDeck: index 0 is bottom, pop() draws from top
  s.playerDeck.reverse();

  return s;
}

/* ---------------------------------------------------------------- helpers */

function requirePhase(s: GameState, ...phases: GameState['phase'][]) {
  if (s.gameOver) throw new RuleError('The game is over.');
  if (!phases.includes(s.phase)) throw new RuleError(`Not allowed right now (phase: ${s.phase}).`);
}

function currentPlayer(s: GameState): Player {
  return s.players[s.current];
}

function spendAction(s: GameState) {
  s.actionsLeft--;
  if (s.actionsLeft <= 0) {
    s.phase = 'preDraw';
  }
}

function discardFromHand(s: GameState, player: Player, pred: (c: Card) => boolean, desc: string): Card {
  const idx = player.hand.findIndex(pred);
  if (idx === -1) throw new RuleError(`${player.name} does not have ${desc}.`);
  const [card] = player.hand.splice(idx, 1);
  s.playerDiscard.push(card);
  return card;
}

/** Post-move bookkeeping: Medic auto-clears cured diseases at his location. */
function afterMove(s: GameState, p: Player) {
  if (p.role !== 'medic') return;
  medicSweep(s, p.location);
}

function medicSweep(s: GameState, city: string) {
  for (const color of COLORS) {
    if (s.cured[color] && cubeCount(s, city, color) > 0) {
      const n = s.cubes[city]![color]!;
      s.cubes[city]![color] = 0;
      s.cubesLeft[color] += n;
      log(s, `⚕️ Medic automatically clears ${n} ${color} cube${n > 1 ? 's' : ''} in ${cityName(city)}.`);
      checkEradication(s, color);
    }
  }
}

function checkHandLimits(s: GameState) {
  s.discardQueue = s.players.filter((p) => p.hand.length > HAND_LIMIT).map((p) => p.id);
  if (s.discardQueue.length > 0) {
    if (s.phase !== 'discard' && s.phase !== 'gameOver') {
      s.prevPhase = s.phase;
      s.phase = 'discard';
    }
  } else if (s.phase === 'discard') {
    // queue emptied (by discarding OR by playing an event) — resume the turn
    s.phase = s.prevPhase ?? 'preInfect';
    s.prevPhase = undefined;
  }
}

/* ---------------------------------------------------------------- actions */

export type MoveKind = 'drive' | 'direct' | 'charter' | 'shuttle';

/** Move `pawn` using standard movement; card costs come from `cardSource`'s hand (Dispatcher pays from own hand). */
function movePawn(s: GameState, pawn: Player, cardSource: Player, kind: MoveKind, dest: string) {
  if (dest === pawn.location) throw new RuleError('Already there.');
  switch (kind) {
    case 'drive':
      if (!CITIES[pawn.location].neighbors.includes(dest))
        throw new RuleError(`${cityName(dest)} is not connected to ${cityName(pawn.location)}.`);
      break;
    case 'direct':
      discardFromHand(s, cardSource, (c) => c.kind === 'city' && c.city === dest, `the ${cityName(dest)} card`);
      break;
    case 'charter':
      discardFromHand(
        s,
        cardSource,
        (c) => c.kind === 'city' && c.city === pawn.location,
        `the ${cityName(pawn.location)} card`
      );
      break;
    case 'shuttle':
      if (!s.stations.includes(pawn.location) || !s.stations.includes(dest))
        throw new RuleError('Shuttle flights require research stations in both cities.');
      break;
  }
  pawn.location = dest;
  log(s, `${pawn.name} ${kindVerb(kind)} to ${cityName(dest)}.`);
  afterMove(s, pawn);
}

function kindVerb(kind: MoveKind): string {
  return { drive: 'drives/ferries', direct: 'takes a direct flight', charter: 'takes a charter flight', shuttle: 'takes a shuttle flight' }[kind];
}

export function doMove(state: GameState, kind: MoveKind, dest: string): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const p = currentPlayer(s);
  movePawn(s, p, p, kind, dest);
  spendAction(s);
  return s;
}

export function doDispatcherMove(
  state: GameState,
  targetId: number,
  kind: MoveKind | 'toPawn',
  dest: string
): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const me = currentPlayer(s);
  if (me.role !== 'dispatcher') throw new RuleError('Only the Dispatcher can move other pawns.');
  const target = s.players[targetId];
  if (kind === 'toPawn') {
    if (!s.players.some((p) => p.id !== target.id && p.location === dest))
      throw new RuleError('Destination must contain another pawn.');
    target.location = dest;
    log(s, `Dispatcher moves ${target.name} to ${cityName(dest)} (to another pawn).`);
    afterMove(s, target);
  } else {
    movePawn(s, target, me, kind, dest);
  }
  spendAction(s);
  return s;
}

export function doOpsFlight(state: GameState, discardCity: string, dest: string): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const p = currentPlayer(s);
  if (p.role !== 'operations') throw new RuleError('Only the Operations Expert can do this.');
  if (s.opsFlightUsed) throw new RuleError('Special flight already used this turn.');
  if (!s.stations.includes(p.location)) throw new RuleError('You must be at a research station.');
  discardFromHand(s, p, (c) => c.kind === 'city' && c.city === discardCity, `the ${cityName(discardCity)} card`);
  p.location = dest;
  s.opsFlightUsed = true;
  log(s, `Operations Expert flies from a research station to ${cityName(dest)}.`);
  afterMove(s, p);
  spendAction(s);
  return s;
}

export function doBuildStation(state: GameState, removeStation?: string): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const p = currentPlayer(s);
  const city = p.location;
  if (s.stations.includes(city)) throw new RuleError('There is already a research station here.');
  if (s.stations.length >= MAX_STATIONS) {
    if (!removeStation || !s.stations.includes(removeStation))
      throw new RuleError('All 6 stations are built — choose one to relocate.');
    s.stations = s.stations.filter((c) => c !== removeStation);
    log(s, `Research station removed from ${cityName(removeStation)}.`);
  }
  if (p.role !== 'operations') {
    discardFromHand(s, p, (c) => c.kind === 'city' && c.city === city, `the ${cityName(city)} card`);
  }
  s.stations.push(city);
  log(s, `${p.name} builds a research station in ${cityName(city)}.`);
  spendAction(s);
  return s;
}

export function doTreat(state: GameState, color: Color): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const p = currentPlayer(s);
  const city = p.location;
  const n = cubeCount(s, city, color);
  if (n === 0) throw new RuleError(`No ${color} cubes in ${cityName(city)}.`);
  const removed = s.cured[color] || p.role === 'medic' ? n : 1;
  s.cubes[city]![color] = n - removed;
  s.cubesLeft[color] += removed;
  log(s, `${p.name} treats ${color} in ${cityName(city)} (−${removed} cube${removed > 1 ? 's' : ''}).`);
  checkEradication(s, color);
  spendAction(s);
  return s;
}

export function doShare(state: GameState, giverId: number, takerId: number, city: string): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const me = currentPlayer(s);
  const giver = s.players[giverId];
  const taker = s.players[takerId];
  if (me.id !== giverId && me.id !== takerId)
    throw new RuleError('The current player must be part of the exchange.');
  if (giver.location !== taker.location) throw new RuleError('Both players must be in the same city.');
  if (giver.role !== 'researcher' && city !== giver.location)
    throw new RuleError('The card must match the city you are both in (unless the giver is the Researcher).');
  const idx = giver.hand.findIndex((c) => c.kind === 'city' && c.city === city);
  if (idx === -1) throw new RuleError(`${giver.name} does not have the ${cityName(city)} card.`);
  const [card] = giver.hand.splice(idx, 1);
  taker.hand.push(card);
  log(s, `${giver.name} gives the ${cityName(city)} card to ${taker.name}.`);
  spendAction(s);
  checkHandLimits(s);
  return s;
}

export function doCure(state: GameState, color: Color, cardCities: string[]): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const p = currentPlayer(s);
  if (s.cured[color]) throw new RuleError(`${color} is already cured.`);
  if (!s.stations.includes(p.location)) throw new RuleError('You must be at a research station.');
  const needed = p.role === 'scientist' ? 4 : 5;
  if (cardCities.length !== needed) throw new RuleError(`Select exactly ${needed} ${color} city cards.`);
  if (cardCities.some((c) => CITIES[c].color !== color)) throw new RuleError(`All cards must be ${color}.`);
  for (const c of cardCities) {
    discardFromHand(s, p, (card) => card.kind === 'city' && card.city === c, `the ${cityName(c)} card`);
  }
  s.cured[color] = true;
  log(s, `🧪 ${p.name} discovers a cure for ${color.toUpperCase()}!`);
  const medic = playerByRole(s, 'medic');
  if (medic) medicSweep(s, medic.location);
  checkEradication(s, color);
  if (COLORS.every((c) => s.cured[c])) {
    win(s); // the victory screen is celebration enough
    return s;
  }
  s.celebration = color;
  spendAction(s);
  return s;
}

export function dismissCelebration(state: GameState): GameState {
  const s = clone(state);
  s.celebration = null;
  return s;
}

export function doPass(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  log(s, `${currentPlayer(s).name} passes.`);
  spendAction(s);
  return s;
}

export function doStoreEvent(state: GameState, event: EventId): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  const p = currentPlayer(s);
  if (p.role !== 'contingency') throw new RuleError('Only the Contingency Planner can do this.');
  if (p.storedEvent) throw new RuleError('You already have a stored event.');
  const idx = s.playerDiscard.findIndex((c) => c.kind === 'event' && c.event === event);
  if (idx === -1) throw new RuleError('That event is not in the player discard pile.');
  s.playerDiscard.splice(idx, 1);
  p.storedEvent = event;
  log(s, `Contingency Planner retrieves ${EVENTS[event].name} from the discard pile.`);
  spendAction(s);
  return s;
}

export function endActions(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'actions');
  s.phase = 'preDraw';
  s.actionsLeft = 0;
  return s;
}

/* ----------------------------------------------------------------- events */

export interface EventParams {
  targetPlayerId?: number; // airlift
  city?: string; // airlift dest / government grant / resilient population target
  removeStation?: string; // government grant when 6 built
}

export function playEvent(state: GameState, playerId: number, event: EventId, params: EventParams, fromStored = false): GameState {
  const s = clone(state);
  requirePhase(s, 'actions', 'preDraw', 'epidemic', 'preInfect', 'discard');
  const p = s.players[playerId];

  if (fromStored) {
    if (p.storedEvent !== event) throw new RuleError('That event is not stored on your role card.');
    p.storedEvent = null;
    s.removedCards.push({ kind: 'event', event });
  } else {
    const idx = p.hand.findIndex((c) => c.kind === 'event' && c.event === event);
    if (idx === -1) throw new RuleError(`${p.name} does not have ${EVENTS[event].name}.`);
    const [card] = p.hand.splice(idx, 1);
    s.playerDiscard.push(card);
  }
  log(s, `🃏 ${p.name} plays ${EVENTS[event].name}.`);

  switch (event) {
    case 'airlift': {
      const target = s.players[params.targetPlayerId ?? -1];
      if (!target || !params.city) throw new RuleError('Airlift needs a pawn and a destination.');
      target.location = params.city;
      log(s, `${target.name} is airlifted to ${cityName(params.city)}.`);
      afterMove(s, target);
      break;
    }
    case 'government_grant': {
      if (!params.city) throw new RuleError('Choose a city for the station.');
      if (s.stations.includes(params.city)) throw new RuleError('That city already has a station.');
      if (s.stations.length >= MAX_STATIONS) {
        if (!params.removeStation || !s.stations.includes(params.removeStation))
          throw new RuleError('All 6 stations built — choose one to relocate.');
        s.stations = s.stations.filter((c) => c !== params.removeStation);
      }
      s.stations.push(params.city);
      log(s, `Research station built in ${cityName(params.city)}.`);
      break;
    }
    case 'one_quiet_night':
      s.oneQuietNight = true;
      log(s, 'The next Infect Cities step will be skipped.');
      break;
    case 'forecast':
      s.forecast = s.infectionDeck.slice(-6).reverse(); // [0] = top of deck
      s.forecastBy = playerId;
      break;
    case 'resilient_population': {
      if (!params.city) throw new RuleError('Choose an infection card to remove.');
      const idx = s.infectionDiscard.indexOf(params.city);
      if (idx === -1) throw new RuleError('That card is not in the infection discard pile.');
      s.infectionDiscard.splice(idx, 1);
      log(s, `${cityName(params.city)} is removed from the infection deck permanently.`);
      break;
    }
  }
  checkHandLimits(s);
  return s;
}

export function confirmForecast(state: GameState, order: string[]): GameState {
  const s = clone(state);
  if (!s.forecast) throw new RuleError('No forecast in progress.');
  const expected = [...s.forecast].sort().join();
  if ([...order].sort().join() !== expected) throw new RuleError('Forecast cards mismatch.');
  s.infectionDeck.splice(-s.forecast.length);
  // order[0] should be drawn first → must end up on top (end of array)
  s.infectionDeck.push(...[...order].reverse());
  s.forecast = null;
  s.forecastBy = null;
  log(s, 'Top of the infection deck rearranged.');
  return s;
}

/* ------------------------------------------------------------ turn phases */

export function drawPlayerCards(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'preDraw');
  if (s.playerDeck.length < 2) {
    // no board step to observe here — go straight to the defeat screen
    lose(s, 'The player deck ran out — time has run out.');
    s.phase = 'gameOver';
    return s;
  }
  s.phase = 'drawing';
  s.drawsRemaining = 2;
  s.drawnCards = [];
  s.currentDraw = null;
  return s;
}

/** Reveal one player card; epidemics resolve immediately through their steps. */
export function drawNext(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'drawing');
  if (s.drawsRemaining <= 0) {
    finishDrawPhase(s);
    return s;
  }
  const p = currentPlayer(s);
  const card = s.playerDeck.pop()!;
  s.drawnCards.push(card);
  s.currentDraw = card;
  s.drawsRemaining--;
  if (card.kind === 'city') {
    log(s, `${p.name} draws ${cityName(card.city)}.`);
    p.hand.push(card);
  } else if (card.kind === 'event') {
    log(s, `${p.name} draws ${EVENTS[card.event].name}.`);
    p.hand.push(card);
  } else {
    log(s, `⚠️ ${p.name} draws an EPIDEMIC card!`);
    s.phase = 'epidemic';
    s.epidemicStep = 'reveal';
  }
  return s;
}

/** Advance the epidemic one rulebook step: reveal → increase → infect → intensify. */
export function epidemicNext(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'epidemic');
  switch (s.epidemicStep) {
    case 'reveal': {
      s.infectionRateIndex = Math.min(s.infectionRateIndex + 1, INFECTION_RATES.length - 1);
      log(s, `📈 Epidemic! Infection rate is now ${INFECTION_RATES[s.infectionRateIndex]}.`);
      s.epidemicStep = 'increase';
      break;
    }
    case 'increase': {
      const card = s.infectionDeck.shift();
      if (card) {
        s.infectionDiscard.push(card);
        const color = CITIES[card].color;
        log(s, `🦠 Epidemic strikes ${cityName(card)} (+3 ${color}).`);
        const outbreaksBefore = s.outbreaks;
        const cubesBefore = cubeCount(s, card, color);
        placeCubes(s, card, color, 3, new Set());
        s.currentInfection = {
          city: card,
          color,
          outbreak: s.outbreaks > outbreaksBefore,
          noEffect: s.outbreaks === outbreaksBefore && cubeCount(s, card, color) === cubesBefore,
        };
      }
      s.epidemicStep = 'infect';
      break;
    }
    case 'infect': {
      s.infectionDeck.push(...shuffle(s.infectionDiscard));
      s.infectionDiscard = [];
      log(s, '🔀 Infection discard shuffled back on top of the deck.');
      s.currentInfection = null;
      s.epidemicStep = 'intensify';
      break;
    }
    case 'intensify': {
      s.epidemicStep = null;
      if (s.drawsRemaining > 0) {
        s.phase = 'drawing'; // reveal the remaining player card
        s.currentDraw = null;
      } else {
        finishDrawPhase(s);
      }
      break;
    }
    default:
      throw new RuleError('No epidemic step in progress.');
  }
  return s;
}

function finishDrawPhase(s: GameState) {
  s.phase = 'preInfect';
  checkHandLimits(s);
}

export function discardCard(state: GameState, playerId: number, handIndex: number): GameState {
  const s = clone(state);
  requirePhase(s, 'discard');
  const p = s.players[playerId];
  if (!s.discardQueue.includes(playerId)) throw new RuleError(`${p.name} is not over the hand limit.`);
  const [card] = p.hand.splice(handIndex, 1);
  s.playerDiscard.push(card);
  const label = card.kind === 'city' ? cityName(card.city) : card.kind === 'event' ? EVENTS[card.event].name : 'Epidemic';
  log(s, `${p.name} discards ${label}.`);
  checkHandLimits(s);
  return s;
}

export function infectCities(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'preInfect');
  if (s.oneQuietNight) {
    s.oneQuietNight = false;
    log(s, '🌙 One Quiet Night — the Infect Cities step is skipped.');
    nextTurn(s);
    return s;
  }
  s.phase = 'infecting';
  s.infectionsRemaining = INFECTION_RATES[s.infectionRateIndex];
  s.currentInfection = null;
  return s;
}

/** Resolve one infection card; when none remain, advance to the next player. */
export function infectNext(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'infecting');
  if (s.infectionsRemaining <= 0) {
    nextTurn(s);
    return s;
  }
  const card = s.infectionDeck.pop();
  if (!card) {
    nextTurn(s);
    return s;
  }
  s.infectionDiscard.push(card);
  const color = CITIES[card].color;
  log(s, `🦠 Infection: ${cityName(card)} (+1 ${color})`);
  const outbreaksBefore = s.outbreaks;
  const cubesBefore = cubeCount(s, card, color);
  placeCubes(s, card, color, 1, new Set());
  s.currentInfection = {
    city: card,
    color,
    outbreak: s.outbreaks > outbreaksBefore,
    noEffect: s.outbreaks === outbreaksBefore && cubeCount(s, card, color) === cubesBefore,
  };
  s.infectionsRemaining--;
  return s;
}

function nextTurn(s: GameState) {
  s.current = (s.current + 1) % s.players.length;
  s.actionsLeft = 4;
  s.opsFlightUsed = false;
  s.drawnCards = [];
  s.drawsRemaining = 0;
  s.currentDraw = null;
  s.infectionsRemaining = 0;
  s.currentInfection = null;
  s.epidemicStep = null;
  s.celebration = null; // each browser dismisses it on its own; stop showing it once the turn passes
  s.phase = 'handoff';
  log(s, `— ${currentPlayer(s).name}'s turn —`);
}

/** The incoming player has the controls — begin their action phase. */
export function startTurn(state: GameState): GameState {
  const s = clone(state);
  requirePhase(s, 'handoff');
  s.phase = 'actions';
  return s;
}
