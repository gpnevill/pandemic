export type Color = 'blue' | 'yellow' | 'black' | 'red';

export const COLORS: Color[] = ['blue', 'yellow', 'black', 'red'];

export type LabelPos = 'top' | 'bottom' | 'left' | 'right';

export interface City {
  id: string;
  name: string;
  color: Color;
  pop: number; // in thousands
  x: number;
  y: number;
  label: LabelPos;
  neighbors: string[];
}

export type RoleId =
  | 'contingency'
  | 'dispatcher'
  | 'medic'
  | 'operations'
  | 'quarantine'
  | 'researcher'
  | 'scientist';

export type EventId =
  | 'airlift'
  | 'government_grant'
  | 'one_quiet_night'
  | 'forecast'
  | 'resilient_population';

export type Card =
  | { kind: 'city'; city: string }
  | { kind: 'event'; event: EventId }
  | { kind: 'epidemic' };

export interface Player {
  id: number;
  name: string;
  role: RoleId;
  location: string;
  hand: Card[];
  storedEvent: EventId | null; // Contingency Planner
}

export type Phase =
  | 'handoff' // pass the controls to the next player
  | 'actions' // current player spending actions
  | 'preDraw' // actions done, waiting for "draw cards" click (undo still allowed)
  | 'drawing' // player cards revealing one by one
  | 'epidemic' // epidemic drawn: infect done, waiting for Intensify click
  | 'discard' // someone over hand limit must discard
  | 'preInfect' // player cards drawn, waiting for "infect" click
  | 'infecting' // infection cards resolving one by one
  | 'gameOver';

export interface GameState {
  id: string; // identifies this game, e.g. for remembering which seats a browser plays
  players: Player[];
  current: number; // index into players
  actionsLeft: number;
  phase: Phase;

  cubes: Record<string, Partial<Record<Color, number>>>;
  cubesLeft: Record<Color, number>;
  stations: string[];
  cured: Record<Color, boolean>;
  eradicated: Record<Color, boolean>;

  playerDeck: Card[];
  playerDiscard: Card[];
  infectionDeck: string[];
  infectionDiscard: string[];
  removedCards: Card[]; // removed from game (played stored events, resilient population)

  infectionRateIndex: number;
  outbreaks: number;
  epidemicsTotal: number;

  oneQuietNight: boolean;
  opsFlightUsed: boolean; // Operations Expert special flight, once per turn

  // staged infect-cities phase
  infectionsRemaining: number;
  currentInfection: { city: string; color: Color; outbreak: boolean; noEffect: boolean } | null;

  // staged epidemic resolution: reveal → increase → infect → intensify
  epidemicStep: 'reveal' | 'increase' | 'infect' | 'intensify' | null;

  celebration: Color | null; // a cure was just discovered — party time

  prevPhase?: Phase; // phase to return to after forced discards
  forecast: string[] | null; // top 6 infection cards being rearranged
  forecastBy?: number | null; // player id who played Forecast and is rearranging
  drawnCards: Card[]; // cards revealed so far this draw step, for display
  drawsRemaining: number; // player cards still to reveal this turn
  currentDraw: Card | null; // the card being announced right now
  discardQueue: number[]; // player ids over hand limit

  log: string[];
  gameOver: { won: boolean; reason: string } | null;

  // Transient visual effects for the UI (append-only, capped)
  fx: FxEvent[];
  fxSeq: number;
}

export interface FxEvent {
  id: number;
  type: 'infect' | 'outbreak';
  city: string;
  color: Color;
}

export const INFECTION_RATES = [2, 2, 2, 3, 3, 4, 4];
export const MAX_OUTBREAKS = 8;
export const CUBES_PER_COLOR = 24;
export const HAND_LIMIT = 7;
export const MAX_STATIONS = 6;
