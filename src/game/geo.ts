// Miller projection into the 1600x900 board viewBox — must match scripts/genWorld.mjs.
export const MAP_W = 1600;
export const MAP_H = 900;

const LAT_TOP = 74;
const LAT_BOT = -56;

const rad = (d: number) => (d * Math.PI) / 180;
const millerY = (lat: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * rad(lat)));
const Y_TOP = millerY(LAT_TOP);
const Y_BOT = millerY(LAT_BOT);

export function project(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * MAP_W;
  const clamped = Math.max(LAT_BOT, Math.min(LAT_TOP, lat));
  const y = ((Y_TOP - millerY(clamped)) / (Y_TOP - Y_BOT)) * MAP_H;
  return [x, y];
}
