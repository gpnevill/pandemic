import { useEffect, useMemo, useRef, useState } from 'react';
import Board from './ui/Board';
import { CITIES, DISEASE_UI, EVENTS, ROLES } from './game/data';
import type { Card, Color, EventId, GameState, Player, RoleId } from './game/types';
import { COLORS, HAND_LIMIT, INFECTION_RATES, MAX_STATIONS } from './game/types';
import * as E from './game/engine';
import type { MoveKind } from './game/engine';
import { S, isMuted, setMuted, startVictoryMusic, stopVictoryMusic } from './ui/sounds';

/* ---------------------------------------------------------------- helpers */

function cardLabel(c: Card): string {
  if (c.kind === 'city') return CITIES[c.city].name;
  if (c.kind === 'event') return EVENTS[c.event].name;
  return 'Epidemic';
}

function CardChip({ card, onClick, selected }: { card: Card; onClick?: () => void; selected?: boolean }) {
  const cls = ['card-chip'];
  if (card.kind === 'event') cls.push('event');
  if (onClick) cls.push('clickable');
  if (selected) cls.push('selected');
  const bg = card.kind === 'city' ? DISEASE_UI[CITIES[card.city].color].hex : undefined;
  return (
    <span className={cls.join(' ')} style={bg ? { background: bg } : undefined} onClick={onClick}>
      {cardLabel(card)}
    </span>
  );
}

type Pending =
  | { kind: 'move'; move: MoveKind }
  | { kind: 'opsFlight'; discardCity: string }
  | { kind: 'dispatch'; targetId: number; move: MoveKind | 'toPawn' }
  | { kind: 'airlift'; playerId: number; targetPlayerId: number; fromStored: boolean }
  | { kind: 'grant'; playerId: number; fromStored: boolean };

type Modal =
  | { kind: 'share' }
  | { kind: 'cure' }
  | { kind: 'treat' }
  | { kind: 'buildRemove' }
  | { kind: 'opsPick' }
  | { kind: 'dispatchPick' }
  | { kind: 'airliftPick'; playerId: number; fromStored: boolean }
  | { kind: 'resilient'; playerId: number; fromStored: boolean }
  | { kind: 'grantRemove'; city: string; playerId: number; fromStored: boolean }
  | { kind: 'storeEvent' }
  | { kind: 'roles' }
  | { kind: 'rules' };

const SAVE_KEY = 'pandemic-save-v3';

function loadSave(): { game: GameState; history: GameState[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.game?.players?.length || !data.game.phase) return null;
    return { game: data.game, history: Array.isArray(data.history) ? data.history : [] };
  } catch {
    return null;
  }
}

const PENDING_HINTS: Record<Pending['kind'], string> = {
  move: 'Click a destination city on the map.',
  opsFlight: 'Click any city to fly there.',
  dispatch: 'Click the destination city.',
  airlift: 'Click any city as the airlift destination.',
  grant: 'Click a city to build the research station in.',
};

/* ------------------------------------------------------------------ setup */

function SetupScreen({ onStart }: { onStart: (cfg: E.SetupConfig) => void }) {
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(['', '', '', '']);
  const [roles, setRoles] = useState<(RoleId | 'random')[]>(['random', 'random', 'random', 'random']);
  const [epidemics, setEpidemics] = useState<4 | 5 | 6>(4);

  const takenRoles = roles.slice(0, count).filter((r) => r !== 'random');

  return (
    <div className="setup">
      <h1>🌍 PANDEMIC</h1>
      <p style={{ color: 'var(--muted)' }}>
        A cooperative board game — cure four diseases before the world succumbs. Hotseat: pass the
        mouse between players.
      </p>
      <div className="row">
        <label>Players:</label>
        {[2, 3, 4].map((n) => (
          <button key={n} className={count === n ? 'primary' : ''} onClick={() => setCount(n)}>
            {n}
          </button>
        ))}
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div className="row" key={i}>
          <input
            placeholder={`Player ${i + 1} name`}
            value={names[i]}
            onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
          />
          <select
            value={roles[i]}
            onChange={(e) => setRoles(roles.map((r, j) => (j === i ? (e.target.value as RoleId | 'random') : r)))}
          >
            <option value="random">🎲 Random role</option>
            {(Object.keys(ROLES) as RoleId[]).map((r) => (
              <option key={r} value={r} disabled={takenRoles.includes(r) && roles[i] !== r}>
                {ROLES[r].name}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="row">
        <label>Difficulty:</label>
        {([4, 5, 6] as const).map((n) => (
          <button key={n} className={epidemics === n ? 'primary' : ''} onClick={() => setEpidemics(n)}>
            {n === 4 ? 'Introductory' : n === 5 ? 'Standard' : 'Heroic'} ({n} epidemics)
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 20 }}>
        <button
          className="primary"
          style={{ fontSize: 16, padding: '10px 24px' }}
          onClick={() =>
            onStart({
              players: Array.from({ length: count }, (_, i) => ({ name: names[i], role: roles[i] })),
              epidemics,
            })
          }
        >
          Start Game
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- app */

export default function App() {
  const [boot] = useState(loadSave);
  const [game, setGame] = useState<GameState | null>(boot?.game ?? null);
  const [history, setHistory] = useState<GameState[]>(boot?.history ?? []);
  const [pending, setPending] = useState<Pending | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [game?.log.length]);

  // persist the game (and undo history) so a reload resumes mid-game
  useEffect(() => {
    try {
      if (game && !game.gameOver) {
        localStorage.setItem(SAVE_KEY, JSON.stringify({ game, history }));
      } else {
        localStorage.removeItem(SAVE_KEY);
      }
    } catch {
      // storage full or unavailable — the game just won't survive a reload
    }
  }, [game, history]);

  // sound effects: diff the game state and play (at most) one small sound per change,
  // most dramatic first — works the same regardless of which control caused it
  const prevGameRef = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = prevGameRef.current;
    prevGameRef.current = game;
    if (!prev || !game || prev === game) return;
    if (game.phase === 'gameOver' && prev.phase !== 'gameOver') {
      if (!game.gameOver?.won) S.defeat();
      return; // victory music is handled by its own looping effect
    }
    if (game.gameOver && !prev.gameOver) {
      // the fatal step itself — fall through so its own sound (outbreak, cube) plays
    }
    if (game.celebration && !prev.celebration) return void S.cure();
    if (game.epidemicStep === 'reveal' && prev.epidemicStep !== 'reveal') return void S.epidemic();
    if (game.infectionRateIndex > prev.infectionRateIndex) return void S.rate();
    if (game.fxSeq > prev.fxSeq) {
      const fresh = game.fx.filter((f) => f.id > prev.fxSeq);
      return void (fresh.some((f) => f.type === 'outbreak') ? S.outbreak() : S.cube());
    }
    const cubesNow = COLORS.reduce((n, c) => n + game.cubesLeft[c], 0);
    const cubesBefore = COLORS.reduce((n, c) => n + prev.cubesLeft[c], 0);
    if (cubesNow > cubesBefore) return void S.treat();
    if (game.players.some((p, i) => p.location !== prev.players[i]?.location)) return void S.move();
    if (game.players.some((p, i) => p.hand.length !== prev.players[i]?.hand.length)) return void S.deal();
    if (game.phase !== prev.phase) return void S.click();
  }, [game]);

  // looping victory fanfare: plays while the victory screen is up, stops on New Game
  const won = game?.gameOver?.won ?? false;
  const epidemicsTotal = game?.epidemicsTotal ?? 4;
  useEffect(() => {
    if (!won) return;
    startVictoryMusic(epidemicsTotal);
    return () => stopVictoryMusic();
  }, [won, epidemicsTotal]);

  // staged phases: the first card reveals immediately; each further step is click-driven
  useEffect(() => {
    if (!game || game.gameOver) return;
    if (game.phase === 'infecting' && !game.currentInfection) {
      setGame((g) => (g && g.phase === 'infecting' && !g.gameOver ? E.infectNext(g) : g));
    } else if (game.phase === 'drawing' && !game.currentDraw) {
      setGame((g) => (g && g.phase === 'drawing' && !g.gameOver ? E.drawNext(g) : g));
    }
  }, [game]);

  /** Click-to-advance for the staged draw/epidemic/infect phases. */
  function advance() {
    if (game?.gameOver && game.phase !== 'gameOver') {
      // the fatal step has been seen — now show the defeat screen
      setGame((g) => (g && g.gameOver && g.phase !== 'gameOver' ? E.acknowledgeDefeat(g) : g));
      return;
    }
    if (game?.phase === 'preDraw') {
      apply(E.drawPlayerCards, { clearsHistory: true });
      return;
    }
    if (game?.phase === 'preInfect') {
      apply(E.infectCities);
      return;
    }
    setGame((g) => {
      if (!g) return g;
      if (g.phase === 'infecting') return E.infectNext(g);
      if (g.phase === 'drawing') return E.drawNext(g);
      if (g.phase === 'epidemic') return E.epidemicNext(g);
      return g;
    });
  }

  if (!game) {
    return (
      <SetupScreen
        onStart={(cfg) => {
          setGame(E.newGame(cfg));
          setHistory([]);
        }}
      />
    );
  }

  const me = game.players[game.current];

  /** Apply an engine function; push undo history if we're still in the action part of a turn. */
  function apply(fn: (s: GameState) => GameState, opts: { clearsHistory?: boolean } = {}) {
    if (!game) return;
    try {
      const next = fn(game);
      if (opts.clearsHistory) {
        setHistory([]);
      } else if (game.phase === 'actions' || game.phase === 'preDraw') {
        setHistory((h) => [...h, game]);
      }
      setGame(next);
      setPending(null);
      setModal(null);
    } catch (err) {
      if (err instanceof E.RuleError) setToast(err.message);
      else throw err;
    }
  }

  function undo() {
    if (history.length === 0) return;
    setGame(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setPending(null);
    setModal(null);
  }

  function handleCityClick(id: string) {
    if (!game) return;
    if (!pending) {
      // Convenience: bare click = drive to a neighbor, or shuttle between stations
      if (game.phase !== 'actions' || id === me.location) return;
      if (CITIES[me.location].neighbors.includes(id)) {
        apply((s) => E.doMove(s, 'drive', id));
      } else if (game.stations.includes(me.location) && game.stations.includes(id)) {
        apply((s) => E.doMove(s, 'shuttle', id));
      }
      return;
    }
    switch (pending.kind) {
      case 'move':
        apply((s) => E.doMove(s, pending.move, id));
        break;
      case 'opsFlight':
        apply((s) => E.doOpsFlight(s, pending.discardCity, id));
        break;
      case 'dispatch':
        apply((s) => E.doDispatcherMove(s, pending.targetId, pending.move, id));
        break;
      case 'airlift':
        apply((s) =>
          E.playEvent(s, pending.playerId, 'airlift', { targetPlayerId: pending.targetPlayerId, city: id }, pending.fromStored)
        );
        break;
      case 'grant':
        if (game.stations.length >= MAX_STATIONS) {
          setModal({ kind: 'grantRemove', city: id, playerId: pending.playerId, fromStored: pending.fromStored });
          setPending(null);
        } else {
          apply((s) => E.playEvent(s, pending.playerId, 'government_grant', { city: id }, pending.fromStored));
        }
        break;
    }
  }

  function startEvent(playerId: number, event: EventId, fromStored: boolean) {
    switch (event) {
      case 'airlift':
        setModal({ kind: 'airliftPick', playerId, fromStored });
        break;
      case 'government_grant':
        setPending({ kind: 'grant', playerId, fromStored });
        setModal(null);
        break;
      case 'one_quiet_night':
        apply((s) => E.playEvent(s, playerId, 'one_quiet_night', {}, fromStored));
        break;
      case 'forecast':
        apply((s) => E.playEvent(s, playerId, 'forecast', {}, fromStored));
        break;
      case 'resilient_population':
        setModal({ kind: 'resilient', playerId, fromStored });
        break;
    }
  }

  const inActions = game.phase === 'actions';
  const cubesHere = COLORS.filter((c) => (game.cubes[me.location]?.[c] ?? 0) > 0);

  /** Click a card in your own hand: fly with it (city cards) or play it (events). */
  function handleHandCardClick(card: Card) {
    if (!game || game.phase !== 'actions' || pending) return;
    if (card.kind === 'event') {
      startEvent(game.current, card.event, false);
      return;
    }
    if (card.kind !== 'city') return;
    if (card.city === me.location) {
      // your own city's card: charter flight — pick any destination
      setPending({ kind: 'move', move: 'charter' });
      return;
    }
    // any other city card: direct flight there, discarding the clicked card
    apply((s) => E.doMove(s, 'direct', card.city));
  }

  return (
    <div className="app">
      <div className="board-wrap">
        <TopBar
          game={game}
          onNewGame={() => {
            if (!game.gameOver && !window.confirm('Abandon the current game and start over?')) return;
            setGame(null);
            setHistory([]);
          }}
          onRules={() => setModal({ kind: 'rules' })}
        />
        <Board state={game} onCityClick={handleCityClick} />
      </div>

      <div className="sidebar">
        {/* phase banners */}
        {pending && (
          <div className="banner info">
            {PENDING_HINTS[pending.kind]}
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        )}
        {game.phase === 'preDraw' && (
          <div className="banner info">
            Actions done — draw your cards.
            {history.length > 0 && <button onClick={undo}>↩ Undo</button>}
          </div>
        )}
        {game.phase === 'drawing' && (
          <div className="banner info">
            🃏 Drawing player cards… {game.drawsRemaining} left to reveal — click anywhere to continue.
          </div>
        )}
        {game.phase === 'epidemic' && (
          <div className="banner warn">
            {game.epidemicStep === 'reveal' && <>⚠️ Epidemic card drawn!</>}
            {game.epidemicStep === 'increase' && (
              <>📈 The infection rate rises to {INFECTION_RATES[game.infectionRateIndex]} per turn.</>
            )}
            {game.epidemicStep === 'infect' && (
              <>
                🦠 A city is struck from the bottom of the infection deck. You may play events (e.g.
                Resilient Population) now, before the reshuffle.
              </>
            )}
            {game.epidemicStep === 'intensify' && (
              <>🔀 The infection discard was shuffled back on top of the deck.</>
            )}
            <button className="primary" onClick={advance}>
              Continue ▶
            </button>
          </div>
        )}
        {game.phase === 'preInfect' && (
          <div className="banner warn">
            {game.oneQuietNight ? (
              <>🌙 One Quiet Night is active — infection will be skipped.</>
            ) : (
              <>Infect {INFECTION_RATES[game.infectionRateIndex]} cities to end the turn.</>
            )}
          </div>
        )}
        {game.phase === 'infecting' && (
          <div className="banner warn">
            🦠 Infecting cities… {game.infectionsRemaining} card
            {game.infectionsRemaining === 1 ? '' : 's'} left to draw — click anywhere to continue.
          </div>
        )}

        {/* current turn */}
        <div className="section" style={{ borderLeft: `3px solid ${ROLES[me.role].color}` }}>
          <h3>
            Turn — {me.name} ({ROLES[me.role].name})
          </h3>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            📍 {CITIES[me.location].name} · Actions left: <b>{game.actionsLeft}</b>
            {history.length > 0 && inActions && (
              <button style={{ marginLeft: 10 }} onClick={undo}>
                ↩ Undo
              </button>
            )}
          </div>
          <div className="action-grid">
            <button
              disabled={!inActions}
              onClick={() => {
                if (game.stations.length >= MAX_STATIONS) setModal({ kind: 'buildRemove' });
                else apply(E.doBuildStation);
              }}
            >
              🏥 Build Station
            </button>
            <button
              disabled={!inActions}
              onClick={() => {
                if (cubesHere.length === 1) apply((s) => E.doTreat(s, cubesHere[0]));
                else setModal({ kind: 'treat' });
              }}
            >
              💉 Treat
            </button>
            <button disabled={!inActions} onClick={() => setModal({ kind: 'share' })}>
              🤝 Share
            </button>
            <button disabled={!inActions} onClick={() => setModal({ kind: 'cure' })}>
              🧪 Cure
            </button>
            {me.role === 'operations' && (
              <button disabled={!inActions || game.opsFlightUsed} onClick={() => setModal({ kind: 'opsPick' })}>
                🛫 Ops Flight
              </button>
            )}
            {me.role === 'dispatcher' && (
              <button disabled={!inActions} onClick={() => setModal({ kind: 'dispatchPick' })}>
                📡 Dispatch
              </button>
            )}
            {me.role === 'contingency' && (
              <button disabled={!inActions} onClick={() => setModal({ kind: 'storeEvent' })}>
                📥 Retrieve Event
              </button>
            )}
            <button disabled={!inActions} onClick={() => apply(E.doPass)}>
              ⏭ Pass
            </button>
            <button disabled={!inActions} onClick={() => apply(E.endActions)}>
              End Actions
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Move: click a connected city to drive, a station city to shuttle, a card in your hand to fly
            (your own city's card charters anywhere).
          </div>
        </div>

        {/* team + hands */}
        <div className="section">
          <h3>
            Team{' '}
            <button style={{ float: 'right', fontSize: 11, padding: '2px 8px' }} onClick={() => setModal({ kind: 'roles' })}>
              Role powers
            </button>
          </h3>
          {game.players.map((p) => (
            <div
              key={p.id}
              className={`player-block ${p.id === game.current ? 'current' : ''}`}
              style={{ borderLeftColor: ROLES[p.role].color }}
            >
              <div className="player-row">
                <span className="pawn-dot" style={{ background: ROLES[p.role].color }} />
                <b>{p.name}</b>
                <span style={{ color: 'var(--muted)' }}>{ROLES[p.role].name}</span>
                <span style={{ marginLeft: 'auto' }}>📍 {CITIES[p.location].name}</span>
              </div>
              <div className="mini-hand" style={{ marginLeft: 26, marginTop: 2 }}>
                {p.hand.map((c, i) => (
                  <CardChip
                    key={i}
                    card={c}
                    onClick={p.id === game.current && inActions && !pending ? () => handleHandCardClick(c) : undefined}
                  />
                ))}
                {p.storedEvent && <span className="card-chip event">📥 {EVENTS[p.storedEvent].name}</span>}
                <span className="hand-count">
                  {p.hand.length}/{HAND_LIMIT}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* events */}
        <EventsPanel game={game} onPlay={startEvent} />

        {/* log */}
        <div className="section" style={{ flex: 1 }}>
          <h3>Log</h3>
          <div className="log" ref={logRef}>
            {game.log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </div>

      {game.phase === 'epidemic' && game.epidemicStep === 'reveal' && (
        <div className="epidemic-flash" key={game.log.length} />
      )}

      {((game.phase === 'drawing' && game.currentDraw) ||
        (game.phase === 'infecting' && game.currentInfection) ||
        (game.phase === 'epidemic' && game.epidemicStep) ||
        (game.gameOver && game.phase !== 'gameOver') ||
        ((game.phase === 'preDraw' || game.phase === 'preInfect') && !pending && !modal)) && (
        <div className="advance-overlay" onClick={advance} />
      )}

      {game.phase === 'preDraw' && !pending && !modal && (
        <div
          className="infect-announce clickable"
          style={{ borderColor: 'var(--accent)' }}
          onClick={() => apply(E.drawPlayerCards, { clearsHistory: true })}
        >
          <div className="infect-city" style={{ color: 'var(--accent)' }}>
            🃏 Draw 2 Player Cards
          </div>
          <div className="infect-sub">Actions complete — undo is no longer possible after drawing</div>
          <div className="infect-hint">▶ click anywhere to draw</div>
        </div>
      )}

      {game.phase === 'preInfect' && !pending && !modal && (
        <div
          className="infect-announce clickable"
          style={{ borderColor: game.oneQuietNight ? '#c9b6ff' : 'var(--danger)' }}
          onClick={() => apply(E.infectCities)}
        >
          <div className="infect-city" style={{ color: game.oneQuietNight ? '#c9b6ff' : 'var(--danger)' }}>
            {game.oneQuietNight ? '🌙 End Turn' : `🦠 Infect ${INFECTION_RATES[game.infectionRateIndex]} Cities`}
          </div>
          <div className="infect-sub">
            {game.oneQuietNight
              ? 'One Quiet Night — the infection step is skipped'
              : 'The infection deck strikes back'}
          </div>
          <div className="infect-hint">
            {game.oneQuietNight ? '▶ click anywhere to end the turn' : '▶ click anywhere to infect'}
          </div>
        </div>
      )}

      {game.phase === 'drawing' && game.currentDraw && (
        <DrawAnnounce card={game.currentDraw} n={game.drawnCards.length} onAdvance={advance} />
      )}

      {game.phase === 'epidemic' && game.epidemicStep && (
        <EpidemicAnnounce game={game} onAdvance={advance} />
      )}

      {game.phase === 'infecting' && game.currentInfection && (
        <div
          className={`infect-announce clickable ${game.currentInfection.outbreak ? 'outbreak' : ''}`}
          key={`${game.currentInfection.city}-${game.infectionsRemaining}`}
          style={{ borderColor: DISEASE_UI[game.currentInfection.color].hex }}
          onClick={advance}
        >
          <div className="infect-city" style={{ color: DISEASE_UI[game.currentInfection.color].hex }}>
            🦠 {CITIES[game.currentInfection.city].name}
          </div>
          <div className="infect-sub">
            {game.currentInfection.outbreak
              ? '💥 OUTBREAK! Disease spreads to connected cities'
              : game.currentInfection.noEffect
                ? 'No effect — placement prevented or disease eradicated'
                : `+1 ${DISEASE_UI[game.currentInfection.color].name.toLowerCase()} cube`}
          </div>
          <div className="infect-hint">
            {game.infectionsRemaining > 0 ? '▶ click anywhere to continue' : '▶ click anywhere to end the turn'}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <Modals
        game={game}
        modal={modal}
        setModal={setModal}
        setPending={setPending}
        apply={apply}
        startEvent={startEvent}
      />

      {game.forecast && (
        <ForecastModal
          cards={game.forecast}
          onConfirm={(order) => apply((s) => E.confirmForecast(s, order))}
        />
      )}

      {game.phase === 'discard' && !pending && !modal && (
        <DiscardModal game={game} apply={apply} startEvent={startEvent} />
      )}

      {game.celebration && (
        <Celebration
          color={game.celebration}
          onClose={() => setGame((g) => (g ? E.dismissCelebration(g) : g))}
        />
      )}

      {game.phase === 'handoff' && (
        <div className="handoff-overlay">
          <div className="handoff-card" style={{ borderColor: ROLES[me.role].color }}>
            <div style={{ fontSize: 15, color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Pass the controls to
            </div>
            <h1 style={{ margin: '10px 0 2px', fontSize: 40 }}>{me.name}</h1>
            <div style={{ fontSize: 18, fontWeight: 700, color: ROLES[me.role].color, marginBottom: 14 }}>
              {ROLES[me.role].name}
            </div>
            <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20 }}>
              📍 {CITIES[me.location].name} · 🃏 {me.hand.length} card{me.hand.length === 1 ? '' : 's'} in hand
              · 4 actions ahead
            </div>
            <button className="primary" style={{ fontSize: 17, padding: '10px 28px' }} onClick={() => apply(E.startTurn)}>
              Begin Turn
            </button>
          </div>
        </div>
      )}

      {game.gameOver && game.phase === 'gameOver' && (
        <div className="gameover-overlay">
          {game.gameOver.won && <MegaConfetti />}
          <h1 className={game.gameOver.won ? 'victory-title' : ''}>
            {game.gameOver.won ? '🏆 VICTORY 🏆' : '💀 DEFEAT'}
          </h1>
          <p style={{ fontSize: 18 }}>{game.gameOver.reason}</p>
          <button
            className="primary"
            style={{ fontSize: 16 }}
            onClick={() => {
              setGame(null);
              setHistory([]);
            }}
          >
            New Game
          </button>
        </div>
      )}
    </div>
  );
}

function DrawAnnounce({ card, n, onAdvance }: { card: Card; n: number; onAdvance: () => void }) {
  const isEpidemic = card.kind === 'epidemic';
  const color = card.kind === 'city' ? DISEASE_UI[CITIES[card.city].color].hex : isEpidemic ? '#e94f4f' : '#c9b6ff';
  return (
    <div
      className={`infect-announce clickable ${isEpidemic ? 'outbreak' : ''}`}
      key={n}
      style={{ borderColor: color }}
      onClick={onAdvance}
    >
      <div className="infect-city" style={{ color }}>
        {isEpidemic ? '⚠️ EPIDEMIC!' : card.kind === 'city' ? `🃏 ${CITIES[card.city].name}` : `🃏 ${EVENTS[card.event].name}`}
      </div>
      <div className="infect-sub">
        {isEpidemic
          ? 'The disease surges — resolve it step by step'
          : card.kind === 'city'
            ? `City card — ${DISEASE_UI[CITIES[card.city].color].name}`
            : `Event card — ${EVENTS[card.event].desc}`}
      </div>
      <div className="infect-hint">▶ click anywhere to continue</div>
    </div>
  );
}

const CONFETTI_COLORS = ['#3d9be9', '#e9c53d', '#e94f4f', '#7bd151', '#c9b6ff', '#ff8c42', '#f4f1de', '#2ec4b6'];
const CONFETTI_EMOJI = ['🎉', '🎊', '✨', '⭐', '🧪', '🏆', '💚', '🌍'];

function MegaConfetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 320 }, (_, i) => ({
        emoji: i % 7 === 0 ? CONFETTI_EMOJI[(i / 7) % CONFETTI_EMOJI.length | 0] : null,
        left: Math.random() * 100,
        delay: Math.random() * 3.5,
        dur: 2 + Math.random() * 4,
        bg: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 5 + Math.random() * 9,
        h: 8 + Math.random() * 12,
        size: 16 + Math.random() * 22,
        rot: Math.random() * 360,
        sway: 25 + Math.random() * 90,
        round: Math.random() < 0.3,
      })),
    []
  );
  return (
    <div className="mega-confetti">
      {pieces.map((p, i) =>
        p.emoji ? (
          <span
            key={i}
            className="confetti-piece confetti-emoji"
            style={{
              left: `${p.left}%`,
              fontSize: p.size,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              ['--rot' as string]: `${p.rot}deg`,
              ['--sway' as string]: `${p.sway}px`,
            }}
          >
            {p.emoji}
          </span>
        ) : (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${p.left}%`,
              width: p.w,
              height: p.h,
              background: p.bg,
              borderRadius: p.round ? '50%' : 2,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              ['--rot' as string]: `${p.rot}deg`,
              ['--sway' as string]: `${p.sway}px`,
            }}
          />
        )
      )}
    </div>
  );
}

function Celebration({ color, onClose }: { color: Color; onClose: () => void }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 110 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 2.2,
        dur: 2.6 + Math.random() * 2.4,
        bg: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        w: 6 + Math.random() * 7,
        h: 10 + Math.random() * 8,
        rot: Math.random() * 360,
        sway: 20 + Math.random() * 60,
      })),
    []
  );
  return (
    <div className="celebration-overlay" onClick={onClose}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.h,
            background: p.bg,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
            ['--rot' as string]: `${p.rot}deg`,
            ['--sway' as string]: `${p.sway}px`,
          }}
        />
      ))}
      <div className="celebration-card" style={{ borderColor: DISEASE_UI[color].hex }}>
        <div style={{ fontSize: 56 }}>🎉</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 40, letterSpacing: '0.03em' }}>CONGRATULATIONS!</h1>
        <div style={{ fontSize: 22, fontWeight: 800, color: DISEASE_UI[color].hex }}>
          The {DISEASE_UI[color].name} disease has been CURED!
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 12 }}>
          Treating {DISEASE_UI[color].name.toLowerCase()} now removes every cube in a city — clear them
          all from the board to eradicate it entirely.
        </p>
        <button className="primary" style={{ fontSize: 16, padding: '10px 26px', marginTop: 8 }} onClick={onClose}>
          Back to saving the world
        </button>
      </div>
    </div>
  );
}

function EpidemicAnnounce({ game, onAdvance }: { game: GameState; onAdvance: () => void }) {
  const step = game.epidemicStep!;
  const inf = game.currentInfection;
  let title: React.ReactNode;
  let sub: React.ReactNode;
  let color = '#e94f4f';
  let shake = false;

  if (step === 'reveal') {
    title = '⚠️ EPIDEMIC!';
    sub = 'The disease surges — resolve it step by step';
    shake = true;
  } else if (step === 'increase') {
    title = `📈 Infection Rate: ${INFECTION_RATES[game.infectionRateIndex]}`;
    sub = `${INFECTION_RATES[game.infectionRateIndex]} cities will now be infected each turn`;
  } else if (step === 'infect' && inf) {
    title = `🦠 ${CITIES[inf.city].name}`;
    color = DISEASE_UI[inf.color].hex;
    shake = inf.outbreak;
    sub = inf.outbreak
      ? '💥 3 cubes from the bottom of the deck — OUTBREAK!'
      : inf.noEffect
        ? 'Struck from the bottom of the deck — but placement was prevented'
        : `+3 ${DISEASE_UI[inf.color].name.toLowerCase()} cubes from the bottom of the deck`;
  } else {
    title = '🔀 Intensify';
    sub = 'The infection discard returns to the top of the deck — those cities will be hit again soon';
  }

  return (
    <div
      className={`infect-announce clickable ${shake ? 'outbreak' : ''}`}
      key={step}
      style={{ borderColor: color }}
      onClick={onAdvance}
    >
      <div className="infect-city" style={{ color }}>
        {title}
      </div>
      <div className="infect-sub">{sub}</div>
      <div className="infect-hint">▶ click anywhere to continue</div>
    </div>
  );
}

/* ----------------------------------------------------------------- topbar */

function TopBar({ game, onNewGame, onRules }: { game: GameState; onNewGame: () => void; onRules: () => void }) {
  const [muted, setMutedState] = useState(isMuted);
  return (
    <div className="topbar">
      <b style={{ letterSpacing: '0.1em' }}>PANDEMIC</b>
      <div className="tracker">
        <span className="label">Infection rate</span>
        {INFECTION_RATES.map((r, i) => (
          <span
            key={i === game.infectionRateIndex ? `active-${game.infectionRateIndex}` : i}
            className={`rate-dot ${i === game.infectionRateIndex ? 'active' : ''}`}
          >
            {r}
          </span>
        ))}
      </div>
      <div className="tracker">
        <span className="label">Outbreaks</span>
        <span className={`outbreak-count ${game.outbreaks >= 5 ? 'hot' : ''}`}>{game.outbreaks}/8</span>
      </div>
      <div className="tracker">
        <span className="label">Cures</span>
        {COLORS.map((c) => (
          <span
            key={c}
            className={`cure-vial ${game.cured[c] ? 'cured' : ''}`}
            style={{ borderColor: DISEASE_UI[c].hex, color: DISEASE_UI[c].hex }}
            title={game.eradicated[c] ? 'Eradicated' : game.cured[c] ? 'Cured' : 'Not cured'}
          >
            {game.eradicated[c] ? '✕' : game.cured[c] ? '✓' : ''}
          </span>
        ))}
      </div>
      <div className="tracker">
        <span className="label">Player deck</span>
        <span>{game.playerDeck.length}</span>
      </div>
      <div className="tracker">
        <span className="label">Cubes left</span>
        {COLORS.map((c) => (
          <span key={c} style={{ color: DISEASE_UI[c].hex, fontWeight: 700 }}>
            {game.cubesLeft[c]}
          </span>
        ))}
      </div>
      <button
        style={{ marginLeft: 'auto' }}
        title={muted ? 'Unmute sounds' : 'Mute sounds'}
        onClick={() => {
          const next = !muted;
          setMuted(next);
          setMutedState(next);
          if (!next) S.click();
        }}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <button onClick={onRules}>📖 Rules</button>
      <button onClick={onNewGame}>New Game</button>
    </div>
  );
}

/* ----------------------------------------------------------- events panel */

function EventsPanel({
  game,
  onPlay,
}: {
  game: GameState;
  onPlay: (playerId: number, event: EventId, fromStored: boolean) => void;
}) {
  const rows: Array<{ playerId: number; name: string; event: EventId; fromStored: boolean }> = [];
  for (const p of game.players) {
    for (const c of p.hand) {
      if (c.kind === 'event') rows.push({ playerId: p.id, name: p.name, event: c.event, fromStored: false });
    }
    if (p.storedEvent) rows.push({ playerId: p.id, name: p.name, event: p.storedEvent, fromStored: true });
  }
  if (rows.length === 0) return null;
  return (
    <div className="section">
      <h3>Playable Events</h3>
      <div className="modal-list">
        {rows.map((r, i) => (
          <button key={i} onClick={() => onPlay(r.playerId, r.event, r.fromStored)}>
            <b>{EVENTS[r.event].name}</b> ({r.name}
            {r.fromStored ? ', stored' : ''}) — <span style={{ color: 'var(--muted)' }}>{EVENTS[r.event].desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- modals */

interface ModalsProps {
  game: GameState;
  modal: Modal | null;
  setModal: (m: Modal | null) => void;
  setPending: (p: Pending | null) => void;
  apply: (fn: (s: GameState) => GameState) => void;
  startEvent: (playerId: number, event: EventId, fromStored: boolean) => void;
}

function Modals({ game, modal, setModal, setPending, apply }: ModalsProps) {
  if (!modal) return null;
  const me = game.players[game.current];

  const close = () => setModal(null);

  let content: React.ReactNode = null;

  if (modal.kind === 'treat') {
    const colors = COLORS.filter((c) => (game.cubes[me.location]?.[c] ?? 0) > 0);
    content = (
      <>
        <h2>Treat Disease</h2>
        <div className="modal-list">
          {colors.length === 0 && <p>No cubes here.</p>}
          {colors.map((c) => (
            <button key={c} onClick={() => apply((s) => E.doTreat(s, c))}>
              Remove {DISEASE_UI[c].name} ({game.cubes[me.location]![c]} present)
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.kind === 'buildRemove') {
    content = (
      <>
        <h2>Relocate a Research Station</h2>
        <p className="sub">All 6 stations are on the board. Choose one to move here.</p>
        <div className="modal-list">
          {game.stations.map((c) => (
            <button key={c} onClick={() => apply((s) => E.doBuildStation(s, c))}>
              Remove station in {CITIES[c].name}
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.kind === 'grantRemove') {
    content = (
      <>
        <h2>Relocate a Research Station</h2>
        <div className="modal-list">
          {game.stations.map((c) => (
            <button
              key={c}
              onClick={() =>
                apply((s) =>
                  E.playEvent(s, modal.playerId, 'government_grant', { city: modal.city, removeStation: c }, modal.fromStored)
                )
              }
            >
              Remove station in {CITIES[c].name}
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.kind === 'share') {
    const eligible = (p: Player) =>
      p.hand.filter(
        (c): c is Extract<Card, { kind: 'city' }> =>
          c.kind === 'city' && (p.role === 'researcher' || c.city === p.location)
      );
    const partners = game.players.filter((o) => o.id !== me.id && o.location === me.location);
    content = (
      <>
        <h2>Share Knowledge</h2>
        <p className="sub">
          You are in {CITIES[me.location].name}. Click a card to hand it over — or to take it.
        </p>
        {partners.length === 0 && <p>No other players in your city.</p>}
        {partners.map((o) => {
          const give = eligible(me);
          const take = eligible(o);
          return (
            <div key={o.id} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                <span className="pawn-dot" style={{ background: ROLES[o.role].color, display: 'inline-block', verticalAlign: -2, marginRight: 6 }} />
                {o.name} ({ROLES[o.role].name})
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>Give to {o.name}:</div>
              <div className="hand">
                {give.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>no eligible card</span>}
                {give.map((c, i) => (
                  <CardChip key={i} card={c} onClick={() => apply((s) => E.doShare(s, me.id, o.id, c.city))} />
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 4px' }}>Take from {o.name}:</div>
              <div className="hand">
                {take.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>no eligible card</span>}
                {take.map((c, i) => (
                  <CardChip key={i} card={c} onClick={() => apply((s) => E.doShare(s, o.id, me.id, c.city))} />
                ))}
              </div>
            </div>
          );
        })}
      </>
    );
  } else if (modal.kind === 'cure') {
    content = <CureModal game={game} apply={apply} />;
  } else if (modal.kind === 'opsPick') {
    const cityCards = me.hand.filter((c): c is Extract<Card, { kind: 'city' }> => c.kind === 'city');
    content = (
      <>
        <h2>Operations Expert Flight</h2>
        <p className="sub">Discard any city card to fly from this research station to any city.</p>
        <div className="modal-list">
          {cityCards.map((c, i) => (
            <button
              key={i}
              onClick={() => {
                setModal(null);
                setPending({ kind: 'opsFlight', discardCity: c.city });
              }}
            >
              Discard {CITIES[c.city].name}
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.kind === 'dispatchPick') {
    content = <DispatchModal game={game} setModal={setModal} setPending={setPending} />;
  } else if (modal.kind === 'airliftPick') {
    content = (
      <>
        <h2>Airlift</h2>
        <p className="sub">Choose a pawn to move, then click the destination city.</p>
        <PawnPicker
          game={game}
          onPick={(playerId) => {
            setModal(null);
            setPending({
              kind: 'airlift',
              playerId: modal.playerId,
              targetPlayerId: playerId,
              fromStored: modal.fromStored,
            });
          }}
        />
      </>
    );
  } else if (modal.kind === 'resilient') {
    content = (
      <>
        <h2>Resilient Population</h2>
        <p className="sub">Remove one card from the infection discard pile from the game.</p>
        <div className="modal-list">
          {game.infectionDiscard.length === 0 && <p>The infection discard pile is empty.</p>}
          {[...game.infectionDiscard].reverse().map((c, i) => (
            <button
              key={i}
              onClick={() =>
                apply((s) => E.playEvent(s, modal.playerId, 'resilient_population', { city: c }, modal.fromStored))
              }
            >
              {CITIES[c].name}
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.kind === 'storeEvent') {
    const events = game.playerDiscard.filter((c): c is Extract<Card, { kind: 'event' }> => c.kind === 'event');
    content = (
      <>
        <h2>Retrieve an Event Card</h2>
        <p className="sub">Take an event from the player discard pile and store it on your role card.</p>
        <div className="modal-list">
          {events.length === 0 && <p>No event cards in the discard pile.</p>}
          {events.map((c, i) => (
            <button key={i} onClick={() => apply((s) => E.doStoreEvent(s, c.event))}>
              {EVENTS[c.event].name} — {EVENTS[c.event].desc}
            </button>
          ))}
        </div>
      </>
    );
  } else if (modal.kind === 'rules') {
    const h = (t: string) => (
      <h3 style={{ margin: '14px 0 4px', fontSize: 13, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {t}
      </h3>
    );
    const li = { margin: '3px 0' } as const;
    content = (
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>
        <h2>Rules Reference</h2>
        {h('Goal')}
        <p style={{ margin: 0 }}>
          Work together to discover cures for all four diseases before the world is overwhelmed. Everyone
          wins or loses as a team.
        </p>
        {h('Your turn')}
        <ol style={{ margin: '4px 0', paddingLeft: 20 }}>
          <li style={li}><b>Take 4 actions</b> (any mix, repeats allowed).</li>
          <li style={li}><b>Draw 2 player cards</b> — epidemics resolve immediately.</li>
          <li style={li}><b>Infect cities</b> — flip infection cards equal to the infection rate; each adds 1 cube.</li>
        </ol>
        {h('The 8 actions')}
        <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
          <li style={li}><b>Drive/Ferry</b> — move along a line to a connected city.</li>
          <li style={li}><b>Direct Flight</b> — discard a city card to move to that city.</li>
          <li style={li}><b>Charter Flight</b> — discard the card of the city you're in to move anywhere.</li>
          <li style={li}><b>Shuttle Flight</b> — move between two research stations.</li>
          <li style={li}><b>Build Research Station</b> — discard the card of your current city (max 6 on the board).</li>
          <li style={li}><b>Treat Disease</b> — remove 1 cube here (all cubes of that color if cured).</li>
          <li style={li}><b>Share Knowledge</b> — give or take the card matching the city you're both in.</li>
          <li style={li}><b>Discover Cure</b> — at a research station, discard 5 same-color city cards.</li>
        </ul>
        {h('Epidemics')}
        <p style={{ margin: 0 }}>
          The infection rate rises, the <i>bottom</i> card of the infection deck gets 3 cubes, then the
          infection discard is shuffled and stacked <i>on top</i> of the deck — recently hit cities will be
          hit again.
        </p>
        {h('Outbreaks')}
        <p style={{ margin: 0 }}>
          A city that would get a 4th cube of a color instead spreads 1 cube to each connected city — which
          can chain. Each outbreak moves the tracker; the 8th loses the game.
        </p>
        {h('Hand limit & events')}
        <p style={{ margin: 0 }}>
          Max 7 cards; discard or play an event when over. Event cards may be played at any time and cost no
          action.
        </p>
        {h('You lose if')}
        <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
          <li style={li}>the 8th outbreak occurs,</li>
          <li style={li}>a disease's cube supply runs out, or</li>
          <li style={li}>the player deck is empty when someone must draw.</li>
        </ul>
        <p style={{ marginTop: 10, color: 'var(--muted)' }}>
          Cured (not yet eradicated) diseases still spread — but treating them clears whole cities.
          Eradicated diseases never place cubes again. See <b>Role powers</b> in the Team panel for your
          special abilities.
        </p>
      </div>
    );
  } else if (modal.kind === 'roles') {
    content = (
      <>
        <h2>Role Powers</h2>
        <div className="modal-list">
          {game.players.map((p) => (
            <div key={p.id} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <b style={{ color: ROLES[p.role].color }}>{ROLES[p.role].name}</b> ({p.name})
              <div style={{ color: 'var(--muted)' }}>{ROLES[p.role].desc}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {content}
        <div className="modal-actions">
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

function PawnIcon({ color }: { color: string }) {
  return (
    <svg width="30" height="36" viewBox="0 0 30 36">
      <circle cx="15" cy="9" r="6.5" fill={color} stroke="#fff" strokeWidth="1.8" />
      <path
        d="M6.5 34 Q6.5 19 15 19 Q23.5 19 23.5 34 Z"
        fill={color}
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Pawn selection as clickable cards — used by Dispatcher and Airlift. */
function PawnPicker({
  game,
  selected,
  onPick,
}: {
  game: GameState;
  selected?: number | null;
  onPick: (playerId: number) => void;
}) {
  return (
    <div className="pawn-row">
      {game.players.map((p) => (
        <button key={p.id} className={`pawn-btn ${selected === p.id ? 'selected' : ''}`} onClick={() => onPick(p.id)}>
          <PawnIcon color={ROLES[p.role].color} />
          <b>{p.name}</b>
          <span className="pawn-btn-role" style={{ color: ROLES[p.role].color }}>
            {ROLES[p.role].name}
          </span>
          <span className="pawn-btn-loc">📍 {CITIES[p.location].name}</span>
        </button>
      ))}
    </div>
  );
}

function VialSVG({ hex, cured }: { hex: string; cured: boolean }) {
  return (
    <svg width="44" height="60" viewBox="0 0 46 64">
      <rect x="16" y="1" width="14" height="7" rx="2" fill="#8b5a2b" />
      <rect x="19" y="8" width="8" height="9" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
      <path
        d="M19 17 C10 22 5 30 5 40 C5 52 13 61 23 61 C33 61 41 52 41 40 C41 30 36 22 27 17 Z"
        fill={hex}
        opacity={cured ? 1 : 0.9}
        stroke="rgba(255,255,255,0.65)"
        strokeWidth="1.5"
      />
      <ellipse cx="15" cy="32" rx="4" ry="8" fill="rgba(255,255,255,0.28)" />
      {cured && (
        <text x="23" y="48" textAnchor="middle" fontSize="22" fill="#0b111d" fontWeight="bold">
          ✓
        </text>
      )}
    </svg>
  );
}

function CureModal({ game, apply }: { game: GameState; apply: ModalsProps['apply'] }) {
  const me = game.players[game.current];
  const needed = me.role === 'scientist' ? 4 : 5;
  const [color, setColor] = useState<Color | null>(null);
  const [selected, setSelected] = useState<number[]>([]);

  const cityCards = me.hand
    .map((c, i) => ({ c, i }))
    .filter((x): x is { c: Extract<Card, { kind: 'city' }>; i: number } => x.c.kind === 'city');

  const ofColor = color ? cityCards.filter((x) => CITIES[x.c.city].color === color) : [];

  return (
    <>
      <h2>Discover a Cure</h2>
      <p className="sub">
        Discard {needed} city cards of one color at a research station.
        {!game.stations.includes(me.location) && ' ⚠️ You are not at a research station.'}
      </p>
      <div className="vial-row">
        {COLORS.map((c) => {
          const count = cityCards.filter((x) => CITIES[x.c.city].color === c).length;
          const cured = game.cured[c];
          return (
            <button
              key={c}
              className={`vial-btn ${color === c ? 'selected' : ''}`}
              disabled={cured}
              onClick={() => {
                setColor(c);
                setSelected(
                  cityCards
                    .filter((x) => CITIES[x.c.city].color === c)
                    .slice(0, needed)
                    .map((x) => x.i)
                );
              }}
            >
              <VialSVG hex={DISEASE_UI[c].hex} cured={cured} />
              <span className="vial-label">{cured ? 'Cured ✓' : `${count}/${needed}`}</span>
            </button>
          );
        })}
      </div>
      {color && (
        <div className="hand" style={{ marginBottom: 10 }}>
          {ofColor.map((x) => (
            <CardChip
              key={x.i}
              card={x.c}
              selected={selected.includes(x.i)}
              onClick={() =>
                setSelected((sel) => (sel.includes(x.i) ? sel.filter((s) => s !== x.i) : [...sel, x.i]))
              }
            />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button
          className="primary"
          style={{ fontSize: 17, padding: '12px 30px' }}
          disabled={!color || selected.length !== needed}
          onClick={() =>
            apply((s) =>
              E.doCure(
                s,
                color!,
                selected.map((i) => (me.hand[i] as Extract<Card, { kind: 'city' }>).city)
              )
            )
          }
        >
          🧪 Discover Cure ({selected.length}/{needed})
        </button>
      </div>
    </>
  );
}

function DispatchModal({
  game,
  setModal,
  setPending,
}: {
  game: GameState;
  setModal: (m: Modal | null) => void;
  setPending: (p: Pending | null) => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const moves: Array<{ kind: MoveKind | 'toPawn'; label: string; desc: string }> = [
    { kind: 'drive', label: '🚗 Drive', desc: 'Move to an adjacent city' },
    { kind: 'direct', label: '✈️ Direct Flight', desc: 'You discard the destination city card' },
    { kind: 'charter', label: '🛩 Charter Flight', desc: "You discard the pawn's current city card" },
    { kind: 'shuttle', label: '🚁 Shuttle', desc: 'Between research stations' },
    { kind: 'toPawn', label: '🎯 To Another Pawn', desc: 'Move to any city containing a pawn' },
  ];
  return (
    <>
      <h2>Dispatcher</h2>
      <p className="sub">Click the pawn to move…</p>
      <PawnPicker game={game} selected={target} onPick={setTarget} />
      {target !== null && (
        <>
          <p className="sub" style={{ margin: '14px 0 6px' }}>
            …then how they travel. After that, click the destination city on the map.
          </p>
          <div className="action-grid">
            {moves.map((m) => (
              <button
                key={m.kind}
                title={m.desc}
                onClick={() => {
                  setModal(null);
                  setPending({ kind: 'dispatch', targetId: target, move: m.kind });
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ForecastModal({ cards, onConfirm }: { cards: string[]; onConfirm: (order: string[]) => void }) {
  const [order, setOrder] = useState(cards);
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>Forecast</h2>
        <p className="sub">Rearrange the top 6 infection cards. The top card is drawn first.</p>
        <div className="modal-list">
          {order.map((c, i) => (
            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 60, color: 'var(--muted)', fontSize: 12 }}>
                {i === 0 ? 'TOP ↑' : `#${i + 1}`}
              </span>
              <span
                className="card-chip"
                style={{ background: DISEASE_UI[CITIES[c].color].hex, flex: 1 }}
              >
                {CITIES[c].name}
              </span>
              <button onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === order.length - 1}>
                ↓
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={() => onConfirm(order)}>
            Confirm Order
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscardModal({
  game,
  apply,
  startEvent,
}: {
  game: GameState;
  apply: ModalsProps['apply'];
  startEvent: (playerId: number, event: EventId, fromStored: boolean) => void;
}) {
  const playerId = game.discardQueue[0];
  const p = game.players[playerId];
  if (!p) return null;
  return (
    <div className="discard-panel">
      <button className="peek" title="Hold to see the board underneath">
        👁 Hold to peek
      </button>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>Hand Limit Exceeded</h2>
      <p className="sub" style={{ margin: '0 0 10px' }}>
        {p.name} has {p.hand.length} cards (limit {HAND_LIMIT}). Click a card to discard it — or play an
        event card instead. The board stays visible to help you choose.
      </p>
      <div className="hand">
        {p.hand.map((c, i) => (
          <CardChip key={i} card={c} onClick={() => apply((s) => E.discardCard(s, playerId, i))} />
        ))}
      </div>
      {p.hand.some((c) => c.kind === 'event') && (
        <div className="modal-list" style={{ marginTop: 10 }}>
          {p.hand
            .filter((c): c is Extract<Card, { kind: 'event' }> => c.kind === 'event')
            .map((c, i) => (
              <button key={i} onClick={() => startEvent(playerId, c.event, false)}>
                ▶ Play {EVENTS[c.event].name} instead
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
