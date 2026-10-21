import { writeFile } from "node:fs/promises";
const sections = [
  { start: 0, end: 8, count: 4 },
  { start: 8, end: 24, count: 20 },
  { start: 24, end: 40, count: 20 },
  { start: 40, end: 56, count: 28 },
  { start: 56, end: 64, count: 8 },
];
const notes = [];
let index = 0;
const pairIndices = new Set([10, 17, 22, 28, 35, 41, 48, 54, 61, 66, 72, 78]);
for (const section of sections) {
  const times = [];
  for (let t = section.start; t < section.end; t += 0.5) {
    if (t >= 2 && t <= 62.5) times.push(t);
  }
  const chosen = [];
  for (let i = 0; i < section.count; i++)
    chosen.push(
      times[Math.floor((i * (times.length - 1)) / (section.count - 1))],
    );
  for (const time of chosen) {
    const pair = pairIndices.has(index),
      hand = index % 2 ? "right" : "left";
    const y =
      index < 4
        ? 0.48
        : [0.48, 0.48, 0.32, 0.48, 0.62, 0.48, 0.32, 0.48][
            Math.floor(index / 2) % 8
          ];
    notes.push({
      id: `xy-${index}`,
      time,
      kind: pair ? "double" : "slash",
      ...(!pair ? { hand } : {}),
      x: pair ? 0.5 : hand === "left" ? 0.32 : 0.68,
      y,
    });
    index++;
  }
}
const chart = {
  id: "neon-bloom-xy-64",
  title: "Neon Bloom · 光绽",
  version: "xy-chart-1.3.0",
  ruleVersion: "xy-1.3.0",
  mode: "XY",
  duration: 64,
  bpm: 120,
  notes,
};
for (let i = 0; i < notes.length; i++)
  for (let j = i + 1; j < notes.length; j++) {
    const a = notes[i],
      b = notes[j];
    if (b.time - a.time >= 0.5) break;
    if (a.kind === "double" || b.kind === "double" || a.hand === b.hand)
      throw Error("同手冲突");
  }
await writeFile("public/charts/xy-64.json", JSON.stringify(chart, null, 2));
console.log(
  `${notes.length} XY units / ${notes.filter((n) => n.kind === "double").length} pairs / 64s`,
);
