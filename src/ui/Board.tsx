import { CITIES, CITY_IDS, DISEASE_UI, ROLES, edgeKey, WRAP_EDGES } from '../game/data';
import { WORLD_PATH } from '../game/world';
import { MAP_H, MAP_W } from '../game/geo';
import type { GameState } from '../game/types';
import { COLORS } from '../game/types';

interface Props {
  state: GameState;
  onCityClick: (cityId: string) => void;
}

export default function Board({ state, onCityClick }: Props) {
  // Collect each edge once
  const edges: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const id of CITY_IDS) {
    for (const nb of CITIES[id].neighbors) {
      const key = edgeKey(id, nb);
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([id, nb]);
      }
    }
  }

  // Pawn positions: spread co-located pawns around their city
  const byCity: Record<string, number[]> = {};
  for (const p of state.players) (byCity[p.location] ??= []).push(p.id);

  return (
    <svg className="board-svg" viewBox={`0 30 ${MAP_W} ${MAP_H - 60}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="ocean" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor="#0e1830" />
          <stop offset="100%" stopColor="#090e1a" />
        </radialGradient>
        <linearGradient id="land" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d2a45" />
          <stop offset="100%" stopColor="#16203a" />
        </linearGradient>
        {COLORS.map((c) => (
          <filter key={c} id={`glow-${c}`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        ))}
      </defs>

      {/* ocean + graticule + land */}
      <rect width={MAP_W} height={MAP_H} fill="url(#ocean)" />
      <g stroke="rgba(140,170,230,0.05)" strokeWidth="1">
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} x1={(i + 1) * (MAP_W / 12)} y1={0} x2={(i + 1) * (MAP_W / 12)} y2={MAP_H} />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(i + 1) * (MAP_H / 6)} x2={MAP_W} y2={(i + 1) * (MAP_H / 6)} />
        ))}
      </g>
      <path d={WORLD_PATH} fill="url(#land)" stroke="rgba(120,155,220,0.28)" strokeWidth="1.2" />

      {/* connection lines */}
      {edges.map(([a, b]) => {
        const A = CITIES[a];
        const B = CITIES[b];
        if (WRAP_EDGES.has(edgeKey(a, b))) {
          // draw each half aimed at where the partner sits beyond the map edge,
          // so the line leaves at the true angle (the svg clips it at the edge)
          const west = A.x < B.x ? A : B;
          const east = A.x < B.x ? B : A;
          return (
            <g key={`${a}-${b}`}>
              <line className="map-edge" x1={west.x} y1={west.y} x2={east.x - MAP_W} y2={east.y} strokeDasharray="5 5" />
              <line className="map-edge" x1={east.x} y1={east.y} x2={west.x + MAP_W} y2={west.y} strokeDasharray="5 5" />
            </g>
          );
        }
        return <line key={`${a}-${b}`} className="map-edge" x1={A.x} y1={A.y} x2={B.x} y2={B.y} />;
      })}

      {/* targeting rings on the city currently being infected (infect phase or epidemic strike) */}
      {(state.phase === 'infecting' || state.phase === 'epidemic') && state.currentInfection && (
        <g key={`${state.currentInfection.city}-${state.infectionsRemaining}`} pointerEvents="none">
          <circle
            className="focus-ring"
            cx={CITIES[state.currentInfection.city].x}
            cy={CITIES[state.currentInfection.city].y}
            r={22}
            fill="none"
            stroke={DISEASE_UI[state.currentInfection.color].hex}
            strokeWidth={3}
          />
          <circle
            className="focus-ring delayed"
            cx={CITIES[state.currentInfection.city].x}
            cy={CITIES[state.currentInfection.city].y}
            r={22}
            fill="none"
            stroke={DISEASE_UI[state.currentInfection.color].hex}
            strokeWidth={2}
          />
        </g>
      )}

      {/* fx pulse rings (outbreaks / infections) */}
      {state.fx.slice(-12).map((f) => (
        <circle
          key={f.id}
          className={f.type === 'outbreak' ? 'pulse-outbreak' : 'pulse-infect'}
          cx={CITIES[f.city].x}
          cy={CITIES[f.city].y}
          r={14}
          fill="none"
          stroke={DISEASE_UI[f.color].hex}
        />
      ))}

      {/* cities */}
      {CITY_IDS.map((id) => {
        const c = CITIES[id];
        const hasStation = state.stations.includes(id);
        const cubesHere = COLORS.filter((col) => (state.cubes[id]?.[col] ?? 0) > 0);
        return (
          <g key={id} className="city-node" data-city={id} onClick={() => onCityClick(id)}>
            <title>
              {c.name}
              {cubesHere.length > 0
                ? ` — ${cubesHere.map((col) => `${state.cubes[id]![col]} ${col}`).join(', ')}`
                : ''}
            </title>
            {/* generous invisible hit area */}
            <circle cx={c.x} cy={c.y} r={26} fill="transparent" />
            <circle
              className="city-circle"
              cx={c.x}
              cy={c.y}
              r={12}
              fill={DISEASE_UI[c.color].hex}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={1.5}
              filter={cubesHere.length > 0 ? `url(#glow-${c.color})` : undefined}
            />
            {hasStation && (
              <g transform={`translate(${c.x - 7.5}, ${c.y - 7})`} className="station">
                <path d="M0 14 L0 6 L7.5 0 L15 6 L15 14 Z" fill="#fff" stroke="#0b111d" strokeWidth="1.2" />
                <rect x={5.6} y={8} width={3.8} height={6} fill="#0b111d" />
              </g>
            )}
            {/* cubes: stacked rows per color, right of node */}
            {cubesHere.map((col, ci) => {
              const n = state.cubes[id]![col]!;
              return (
                <g key={col}>
                  {Array.from({ length: n }, (_, i) => (
                    <rect
                      key={`${col}-${i}`}
                      className="cube"
                      x={c.x + 16 + i * 11}
                      y={c.y - 15 + ci * 11}
                      width={9}
                      height={9}
                      rx={2}
                      fill={DISEASE_UI[col].hex}
                      stroke="#0b111d"
                      strokeWidth={1}
                    />
                  ))}
                </g>
              );
            })}
            <text
              className="city-label"
              x={c.x + (c.label === 'left' ? -19 : c.label === 'right' ? 19 : 0)}
              y={c.label === 'top' ? c.y - 20 : c.label === 'bottom' ? c.y + 28 : c.y + 9}
              textAnchor={c.label === 'left' ? 'end' : c.label === 'right' ? 'start' : 'middle'}
            >
              {c.name}
            </text>
          </g>
        );
      })}

      {/* pawns: own layer so they animate between cities */}
      {state.players.map((p) => {
        const c = CITIES[p.location];
        const idx = byCity[p.location].indexOf(p.id);
        const x = c.x - 10 + idx * 17;
        const y = c.y - 15; // figure stands on top of the city node
        return (
          <g key={p.id} className="pawn" style={{ transform: `translate(${x}px, ${y}px)` }}>
            <title>{`${p.name} (${ROLES[p.role].name})`}</title>
            {/* person silhouette: head + rounded body, like the physical pawn */}
            <circle cy={-15.5} r={5} fill={ROLES[p.role].color} stroke="#fff" strokeWidth={1.6} />
            <path
              d="M-6.5 0 Q-6.5 -11 0 -11 Q6.5 -11 6.5 0 Z"
              fill={ROLES[p.role].color}
              stroke="#fff"
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
}
