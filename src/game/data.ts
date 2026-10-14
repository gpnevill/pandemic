import type { City, Color, EventId, LabelPos, RoleId } from './types';
import { project } from './geo';

// Cities carry real lat/lon and are projected onto the world map with the same
// Miller projection used to generate the landmass path (scripts/genWorld.mjs).
// Three routes wrap around the Pacific edge: sf-tokyo, sf-manila, la-sydney.
const raw: Array<[string, string, Color, number, number, number, string[]]> = [
  // id, name, color, population (thousands), lat, lon, neighbors
  ['sf', 'San Francisco', 'blue', 5864, 37.77, -122.42, ['tokyo', 'manila', 'la', 'chicago']],
  ['chicago', 'Chicago', 'blue', 9121, 41.88, -87.63, ['sf', 'la', 'mexico', 'atlanta', 'montreal']],
  ['atlanta', 'Atlanta', 'blue', 4715, 33.75, -84.39, ['chicago', 'washington', 'miami']],
  ['montreal', 'Montréal', 'blue', 3429, 45.5, -73.57, ['chicago', 'washington', 'ny']],
  ['washington', 'Washington', 'blue', 4679, 38.9, -77.04, ['atlanta', 'montreal', 'ny', 'miami']],
  ['ny', 'New York', 'blue', 20464, 40.71, -74.01, ['montreal', 'washington', 'london', 'madrid']],
  ['london', 'London', 'blue', 8586, 51.51, -0.13, ['ny', 'madrid', 'paris', 'essen']],
  ['madrid', 'Madrid', 'blue', 5427, 40.42, -3.7, ['ny', 'london', 'paris', 'algiers', 'saopaulo']],
  ['paris', 'Paris', 'blue', 10755, 48.86, 2.35, ['london', 'madrid', 'essen', 'milan', 'algiers']],
  ['essen', 'Essen', 'blue', 575, 51.46, 7.01, ['london', 'paris', 'milan', 'stpetersburg']],
  ['milan', 'Milan', 'blue', 5232, 45.46, 9.19, ['essen', 'paris', 'istanbul']],
  ['stpetersburg', 'St. Petersburg', 'blue', 4879, 59.93, 30.34, ['essen', 'istanbul', 'moscow']],

  ['la', 'Los Angeles', 'yellow', 14900, 34.05, -118.24, ['sf', 'chicago', 'mexico', 'sydney']],
  ['mexico', 'Mexico City', 'yellow', 19463, 19.43, -99.13, ['la', 'chicago', 'miami', 'bogota', 'lima']],
  ['miami', 'Miami', 'yellow', 5582, 25.76, -80.19, ['atlanta', 'washington', 'mexico', 'bogota']],
  ['bogota', 'Bogotá', 'yellow', 8702, 4.71, -74.07, ['miami', 'mexico', 'lima', 'buenosaires', 'saopaulo']],
  ['lima', 'Lima', 'yellow', 9121, -12.05, -77.04, ['mexico', 'bogota', 'santiago']],
  ['santiago', 'Santiago', 'yellow', 6015, -33.45, -70.67, ['lima']],
  ['buenosaires', 'Buenos Aires', 'yellow', 13639, -34.6, -58.38, ['bogota', 'saopaulo']],
  ['saopaulo', 'São Paulo', 'yellow', 20186, -23.55, -46.63, ['bogota', 'buenosaires', 'madrid', 'lagos']],
  ['lagos', 'Lagos', 'yellow', 11547, 6.52, 3.38, ['saopaulo', 'kinshasa', 'khartoum']],
  ['kinshasa', 'Kinshasa', 'yellow', 9046, -4.44, 15.27, ['lagos', 'khartoum', 'johannesburg']],
  ['johannesburg', 'Johannesburg', 'yellow', 3888, -26.2, 28.05, ['kinshasa', 'khartoum']],
  ['khartoum', 'Khartoum', 'yellow', 4887, 15.5, 32.56, ['lagos', 'kinshasa', 'johannesburg', 'cairo']],

  ['algiers', 'Algiers', 'black', 2946, 36.75, 3.06, ['madrid', 'paris', 'istanbul', 'cairo']],
  ['istanbul', 'Istanbul', 'black', 13576, 41.01, 28.98, ['milan', 'stpetersburg', 'algiers', 'cairo', 'baghdad', 'moscow']],
  ['cairo', 'Cairo', 'black', 14718, 30.04, 31.24, ['algiers', 'istanbul', 'baghdad', 'khartoum', 'riyadh']],
  ['moscow', 'Moscow', 'black', 15512, 55.76, 37.62, ['stpetersburg', 'istanbul', 'tehran']],
  ['baghdad', 'Baghdad', 'black', 6204, 33.31, 44.36, ['istanbul', 'cairo', 'riyadh', 'karachi', 'tehran']],
  ['riyadh', 'Riyadh', 'black', 5037, 24.71, 46.68, ['cairo', 'baghdad', 'karachi']],
  ['tehran', 'Tehran', 'black', 7419, 35.69, 51.39, ['moscow', 'baghdad', 'karachi', 'delhi']],
  ['karachi', 'Karachi', 'black', 20711, 24.86, 67.0, ['baghdad', 'riyadh', 'tehran', 'delhi', 'mumbai']],
  ['mumbai', 'Mumbai', 'black', 16910, 19.08, 72.88, ['karachi', 'delhi', 'chennai']],
  ['delhi', 'Delhi', 'black', 22242, 28.7, 77.1, ['tehran', 'karachi', 'mumbai', 'chennai', 'kolkata']],
  ['chennai', 'Chennai', 'black', 8865, 13.08, 80.27, ['mumbai', 'delhi', 'kolkata', 'bangkok', 'jakarta']],
  ['kolkata', 'Kolkata', 'black', 14374, 22.57, 88.36, ['delhi', 'chennai', 'bangkok', 'hongkong']],

  ['beijing', 'Beijing', 'red', 17311, 39.9, 116.41, ['shanghai', 'seoul']],
  ['seoul', 'Seoul', 'red', 22547, 37.57, 126.98, ['beijing', 'shanghai', 'tokyo']],
  ['shanghai', 'Shanghai', 'red', 13482, 31.23, 121.47, ['beijing', 'seoul', 'tokyo', 'hongkong', 'taipei']],
  ['tokyo', 'Tokyo', 'red', 13189, 35.68, 139.69, ['seoul', 'shanghai', 'osaka', 'sf']],
  ['osaka', 'Osaka', 'red', 2871, 34.69, 135.5, ['tokyo', 'taipei']],
  ['taipei', 'Taipei', 'red', 8338, 25.03, 121.57, ['shanghai', 'osaka', 'hongkong', 'manila']],
  ['hongkong', 'Hong Kong', 'red', 7106, 22.32, 114.17, ['kolkata', 'bangkok', 'hochiminh', 'manila', 'taipei', 'shanghai']],
  ['bangkok', 'Bangkok', 'red', 7151, 13.76, 100.5, ['kolkata', 'chennai', 'jakarta', 'hochiminh', 'hongkong']],
  ['jakarta', 'Jakarta', 'red', 26063, -6.21, 106.85, ['chennai', 'bangkok', 'hochiminh', 'sydney']],
  ['hochiminh', 'Ho Chi Minh City', 'red', 8314, 10.82, 106.63, ['jakarta', 'bangkok', 'hongkong', 'manila']],
  ['manila', 'Manila', 'red', 20767, 14.6, 120.98, ['hochiminh', 'hongkong', 'taipei', 'sydney', 'sf']],
  ['sydney', 'Sydney', 'red', 3785, -33.87, 151.21, ['jakarta', 'manila', 'la']],
];

// Hand nudges (viewBox px) to spread crowded clusters apart for playability —
// the printed board distorts geography for the same reason.
const NUDGE: Record<string, [number, number]> = {
  london: [-25, -10],
  essen: [15, -20],
  paris: [-5, 15],
  milan: [25, -2],
  madrid: [-20, 10],
  algiers: [-8, 12],
  istanbul: [-2, -12],
  cairo: [-5, 14],
  baghdad: [8, -6],
  riyadh: [5, 18],
  tehran: [12, -14],
  karachi: [-6, 8],
  delhi: [8, -14],
  mumbai: [-14, 12],
  chennai: [4, 18],
  kolkata: [16, -4],
  hongkong: [-12, 0],
  taipei: [14, -6],
  shanghai: [-10, -6],
  seoul: [6, -12],
  tokyo: [16, 0],
  osaka: [6, 20],
  washington: [10, 6],
  atlanta: [-8, 6],
  montreal: [0, -8],
  ny: [14, -6],
  miami: [6, 10],
  lagos: [-12, 6],
  khartoum: [10, -4],
  hochiminh: [-4, 12],
  manila: [10, 8],
  bangkok: [-10, -4],
  jakarta: [-8, 8],
};

// Label placement relative to the node (default: below). Chosen so labels in
// dense clusters don't overlap each other, connection lines, or cube stacks.
const LABEL_POS: Record<string, LabelPos> = {
  sf: 'top',
  montreal: 'top',
  ny: 'right',
  washington: 'right',
  atlanta: 'left',
  miami: 'right',
  mexico: 'left',
  lima: 'left',
  santiago: 'left',
  buenosaires: 'right',
  saopaulo: 'right',
  london: 'left',
  essen: 'top',
  madrid: 'left',
  stpetersburg: 'top',
  moscow: 'right',
  istanbul: 'top',
  baghdad: 'left',
  tehran: 'top',
  delhi: 'right',
  kolkata: 'right',
  lagos: 'left',
  beijing: 'top',
  seoul: 'top',
  shanghai: 'left',
  tokyo: 'right',
  osaka: 'right',
  taipei: 'right',
  manila: 'right',
  sydney: 'right',
};

export const CITIES: Record<string, City> = Object.fromEntries(
  raw.map(([id, name, color, pop, lat, lon, neighbors]) => {
    const [px, py] = project(lon, lat);
    const [dx, dy] = NUDGE[id] ?? [0, 0];
    return [id, { id, name, color, pop, x: px + dx, y: py + dy, label: LABEL_POS[id] ?? 'bottom', neighbors }];
  })
);

export const CITY_IDS = Object.keys(CITIES);

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Routes that wrap around the map edge instead of crossing it
export const WRAP_EDGES = new Set([edgeKey('sf', 'tokyo'), edgeKey('sf', 'manila'), edgeKey('la', 'sydney')]);

export const ROLES: Record<RoleId, { name: string; color: string; desc: string }> = {
  contingency: {
    name: 'Contingency Planner',
    color: '#2ec4b6',
    desc: 'As an action, take a discarded Event card and store it on this card (max 1). Playing the stored card removes it from the game.',
  },
  dispatcher: {
    name: 'Dispatcher',
    color: '#b56cff',
    desc: 'As an action, move any pawn to a city containing another pawn, or move another player’s pawn as if it were yours (their consent assumed; card discards come from your hand).',
  },
  medic: {
    name: 'Medic',
    color: '#ff8c42',
    desc: 'Treat Disease removes all cubes of one color. Cured diseases are automatically cleared from your city, and you prevent placement of cured cubes where you are.',
  },
  operations: {
    name: 'Operations Expert',
    color: '#7bd151',
    desc: 'Build a research station in your city without discarding. Once per turn as an action, move from a research station to any city by discarding any city card.',
  },
  quarantine: {
    name: 'Quarantine Specialist',
    color: '#5aa9e6',
    desc: 'Prevents disease cube placement (and outbreaks) in your city and all connected cities.',
  },
  researcher: {
    name: 'Researcher',
    color: '#d4a373',
    desc: 'When sharing knowledge, you may give any city card from your hand (you must both be in the same city).',
  },
  scientist: {
    name: 'Scientist',
    color: '#f4f1de',
    desc: 'You need only 4 (not 5) matching city cards to Discover a Cure.',
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export const EVENTS: Record<EventId, { name: string; desc: string }> = {
  airlift: { name: 'Airlift', desc: 'Move any pawn to any city.' },
  government_grant: { name: 'Government Grant', desc: 'Build a research station in any city (no card needed).' },
  one_quiet_night: { name: 'One Quiet Night', desc: 'Skip the next Infect Cities step.' },
  forecast: { name: 'Forecast', desc: 'Look at the top 6 infection cards and rearrange them.' },
  resilient_population: { name: 'Resilient Population', desc: 'Remove a card in the infection discard pile from the game.' },
};

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export const DISEASE_UI: Record<Color, { name: string; hex: string }> = {
  blue: { name: 'Blue', hex: '#3d9be9' },
  yellow: { name: 'Yellow', hex: '#e9c53d' },
  black: { name: 'Black', hex: '#9a92b2' },
  red: { name: 'Red', hex: '#e94f4f' },
};
