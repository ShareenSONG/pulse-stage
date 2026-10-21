import { writeFileSync } from "node:fs";
// Each pair is a musical group. Return through center before crossing extremes.
const groups = [
  [2, 0, 1],
  [4, 0, 1],
  [6, -0.65, 2],
  ...[0, 0.65, 0, 0, -0.65, -0.65, 0, 0].map((x, i) => [8 + i * 2, x, 2]),
  ...[-0.65, 0, 0.65, 0, 0, -0.65, 0, 0.65].map((x, i) => [24 + i * 2, x, 2]),
  ...[0, -0.65, 0, 0.65, 0.65, 0, -0.65, 0].map((x, i) => [40 + i * 2, x, 2]),
  ...[0, -0.65, 0, 0].map((x, i) => [56 + i * 2, x, 2]),
];
let id = 0;
const events = groups.flatMap(([time, x, count], g) =>
  Array.from({ length: count }, (_, i) => ({
    id: `bp-${++id}`,
    beat: (time + i * 0.5) * 2,
    time: time + i * 0.5,
    x,
    halfWidth: 0.12,
    accent: i === 0 && time % 4 === 0,
    group: `g-${g}`,
  })),
);
const chart = {
  id: "neon-bloom-body",
  version: "1.4.0",
  audioVersion: "neon-bloom-64-v1",
  playStyle: "body-pilot",
  ruleVersion: "body-1.4.0",
  mapVersion: "shoulders-1.4.0",
  duration: 64,
  bpm: 120,
  offset: 0,
  leadTime: 2.8,
  events,
};
writeFileSync(
  "public/charts/body-64.json",
  JSON.stringify(chart, null, 2) + "\n",
);
console.log(
  `Body pilot: ${events.length} beat blocks, ${events.filter((b, i) => i && b.x !== events[i - 1].x).length} lane changes`,
);
