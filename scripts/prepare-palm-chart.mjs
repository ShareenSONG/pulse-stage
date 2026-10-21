import { writeFileSync } from "node:fs";
const groups = [
  [2, 0, 1],
  [4, 0, 1],
  [6, -0.65, 2],
  ...[0, 0.65, 0, 0, -0.65, 0, 0, 0].map((x, i) => [8 + i * 2, x, 2]),
  ...[0.65, 0, 0, 0, -0.65, 0, 0, 0].map((x, i) => [24 + i * 2, x, 2]),
  ...[0.65, 0, 0, 0, -0.65, 0, 0, 0].map((x, i) => [40 + i * 2, x, 2]),
  ...[0.65, 0, 0, 0].map((x, i) => [56 + i * 2, x, 2]),
];
let id = 0;
const body = groups.flatMap(([time, x, count], g) =>
  Array.from({ length: count }, (_, i) => ({
    id: `body-${++id}`,
    kind: "body",
    beat: (time + i * 0.5) * 2,
    time: time + i * 0.5,
    x,
    halfWidth: 0.12,
    accent: i === 0 && time % 4 === 0,
    group: `g-${g}`,
  })),
);
const palms = [14, 22, 30, 38, 46, 54, 60, 62].map((time, i) => ({
  id: `palm-${i + 1}`,
  kind: "palm",
  hand: i % 2 ? "right" : "left",
  hold: 0.45,
  beat: time * 2,
  time,
  x: i % 2 ? 0.65 : -0.65,
  halfWidth: 0.12,
  accent: false,
  group: `palm-${i + 1}`,
}));
const chart = {
  id: "neon-bloom-palm",
  version: "1.5.0",
  audioVersion: "neon-bloom-64-v1",
  playStyle: "body-pilot",
  ruleVersion: "body-palm-1.5.0",
  mapVersion: "shoulders-1.4.0",
  duration: 64,
  bpm: 120,
  offset: 0,
  leadTime: 2.8,
  events: [...body, ...palms].sort((a, b) => a.time - b.time),
};
writeFileSync(
  "public/charts/body-palm-64.json",
  JSON.stringify(chart, null, 2) + "\n",
);
console.log(`64s: ${body.length} body blocks + ${palms.length} palm holds`);
