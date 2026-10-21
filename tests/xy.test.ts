import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { XYGame, XY_RULE, crossing } from "../src/xy-game";
import {
  XYTracker,
  calibrateUpper,
  inspectUpper,
  mapHand,
} from "../src/xy-motion";
import type { Action, Chart, Note, Point } from "../src/types";
const note: Note = {
  id: "n",
  time: 2,
  kind: "slash",
  hand: "left",
  x: 0.32,
  y: 0.48,
};
const chart = (notes: Note[]): Chart => ({
  id: "xy-test",
  version: "1",
  ruleVersion: XY_RULE,
  duration: 64,
  bpm: 120,
  mode: "XY",
  notes,
});
function swipe(
  time = 2,
  hand: "left" | "right" = "left",
  id = "swipe",
  x = hand === "left" ? 0.32 : 0.68,
  y = 0.48,
): Action {
  return {
    id,
    time,
    prevTime: time,
    kind: "hand",
    hand,
    prevX: x - 0.12,
    prevY: y,
    x: x + 0.12,
    y,
    dx: 0.24,
    dy: 0,
    speed: 2,
    confidence: 1,
  };
}
function pose(): Point[] {
  const p: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 1.2,
    visibility: 0.1,
  }));
  for (const [i, x, y] of [
    [11, 0.4, 0.3],
    [12, 0.6, 0.3],
    [13, 0.3, 0.42],
    [14, 0.7, 0.42],
    [15, 0.25, 0.5],
    [16, 0.75, 0.5],
  ])
    p[i] = { x, y, visibility: 1, presence: 1 };
  return p;
}
const samples = () =>
  Array.from({ length: 23 }, (_, i) => ({ points: pose(), time: i * 100 }));
test("XY calibration accepts six upper joints with invisible hips, rejects missing wrist", () => {
  assert.ok(calibrateUpper(samples()));
  const s = samples();
  for (const f of s) f.points[15].visibility = 0.1;
  assert.equal(calibrateUpper(s), null);
  assert.equal(inspectUpper(pose()).ready, true);
});
test("one good snapshot or a short burst cannot produce a verified calibration", () => {
  assert.equal(calibrateUpper(samples().slice(0, 5)), null);
  assert.equal(
    calibrateUpper(samples().map((s, i) => ({ ...s, time: i * 20 }))),
    null,
  );
});
test("XY tracker never emits depth/sway and static hands cannot generate events", () => {
  const tr = new XYTracker();
  tr.reset(calibrateUpper(samples()));
  for (let i = 0; i < 80; i++) {
    const f = tr.process(pose(), i * 40 + 1);
    assert.equal(f.actions.length, 0);
    assert.ok(f.hands.left);
    assert.equal(f.depthQuality, 0);
  }
});
test("wrist outside frame and low presence are invalid even with high visibility", () => {
  const tr = new XYTracker();
  tr.reset(calibrateUpper(samples()));
  const p = pose();
  p[15].x = -0.02;
  p[16].presence = 0.2;
  const f = tr.process(p, 10);
  assert.equal(f.hands.left, null);
  assert.equal(f.hands.right, null);
  assert.equal(f.quality, 1);
});
test("capture gaps cannot interpolate fictitious swipes; current hand stays visible", () => {
  const tr = new XYTracker();
  tr.reset(calibrateUpper(samples()));
  tr.process(pose(), 1);
  const p = pose();
  p[15].x = 0.1;
  const f = tr.process(p, 250);
  assert.ok(f.hands.left);
  assert.equal(f.actions.length, 0);
});
test("map keeps model hand identity across screen crossing, without clamping outside", () => {
  const c = calibrateUpper(samples())!;
  assert.ok(mapHand({ x: -1, y: 0.5 }, c).x > 1);
  const tr = new XYTracker();
  tr.reset(c);
  const p = pose();
  p[15].x = 0.65;
  p[16].x = 0.35;
  const f = tr.process(p, 1);
  assert.ok(f.hands.left!.x < f.hands.right!.x);
});
test("XY free-direction swipe crosses fixed plane, no arrow condition", () => {
  for (const direction of [-1, 1]) {
    const g = new XYGame(chart([note]));
    g.consume({
      ...swipe(),
      prevX: 0.32 - direction * 0.12,
      x: 0.32 + direction * 0.12,
      dx: direction * 0.24,
    });
    assert.equal(g.score, 1e6);
  }
});
test("crossing timestamp uses segment capture times instead of callback endpoint", () => {
  const a = { ...swipe(), prevTime: 1.9, time: 2.1, prevX: 0.1, x: 0.5 };
  const at = crossing(a, 0.32, 0.48)!;
  assert.ok(Math.abs(at - 1.975) < 1e-8);
  const g = new XYGame(chart([note]));
  g.consume(a);
  assert.equal(g.counts.Perfect, 1);
});
test("no scoring for stationary, wrong-hand, low confidence or wrong region", () => {
  for (const a of [
    { ...swipe(), dx: 0, dy: 0, speed: 0 },
    swipe(2, "right"),
    { ...swipe(), confidence: 0.5 },
    swipe(2, "left", "far", 0.8),
  ]) {
    const g = new XYGame(chart([note]));
    g.consume(a);
    assert.equal(g.results.size, 0);
  }
});
test("one continuous physical stroke scores at most one unit", () => {
  const g = new XYGame(chart([note, { ...note, id: "n2", time: 2.1 }]));
  g.consume(swipe());
  g.consume(swipe(2.1));
  assert.equal(g.results.size, 1);
});
test("new 100/180/260ms windows and close buffer are not expanded for slow inference", () => {
  for (const [error, grade] of [
    [0.1, "Perfect"],
    [0.18, "Great"],
    [0.26, "Good"],
  ] as const) {
    const g = new XYGame(chart([note]));
    g.consume(swipe(2 + error));
    assert.equal(g.results.get("n")?.grade, grade);
  }
  const g = new XYGame(chart([note]));
  g.consume(swipe(2.261));
  assert.equal(g.results.size, 0);
  g.tick(2.5);
  assert.equal(g.results.size, 0);
  g.tick(2.511);
  assert.equal(g.counts.Miss, 1);
});
test("Pair needs distinct hands and preserves partial grade factors", () => {
  const n = { ...note, kind: "double" as const, hand: undefined, x: 0.5 };
  const g = new XYGame(chart([n]));
  g.consume(swipe(2.15));
  g.consume(swipe(2.15, "left", "left-again"));
  assert.equal(g.results.size, 0);
  g.tick(3);
  assert.equal(g.score, 400000);
  assert.equal(g.counts.Miss, 1);
  const pair = new XYGame(chart([n]));
  pair.consume(swipe());
  pair.consume(swipe(2.13, "right", "r"));
  assert.equal(pair.counts.Great, 1);
  assert.equal(pair.combo, 1);
});
test("technical protection keeps denominator and cannot fake a full combo", () => {
  const g = new XYGame(
    chart([note, { ...note, id: "r", hand: "right", x: 0.68 }]),
  );
  g.protectHand(1.9, 2.1, "left");
  g.consume(swipe(2, "right", "r"));
  assert.equal(g.score, 500000);
  assert.equal(g.counts.Protected, 1);
  assert.equal(g.assisted, true);
  assert.equal(g.maxCombo, 1);
});
test("rewind removes replay results and reconstructs combo before resuming", () => {
  const g = new XYGame(
    chart([note, { ...note, id: "b", time: 4 }, { ...note, id: "c", time: 6 }]),
  );
  for (const [i, time] of [2, 4, 6].entries())
    g.consume(swipe(time, "left", String(i)));
  assert.equal(g.maxCombo, 3);
  g.rewind(4);
  assert.equal(g.results.size, 1);
  assert.equal(g.combo, 1);
  assert.equal(g.maxCombo, 1);
  assert.equal(g.assisted, true);
});
test("one 64-second XY chart completes with exactly 80 judgements and normalized perfect score", () => {
  const c: Chart = JSON.parse(readFileSync("public/charts/xy-64.json", "utf8"));
  assert.equal(c.duration, 64);
  assert.equal(c.notes.length, 80);
  assert.equal(c.notes.filter((n) => n.kind === "double").length, 12);
  assert.ok(c.notes.every((n) => ["slash", "double"].includes(n.kind)));
  assert.equal(c.ruleVersion, XY_RULE);
  const g = new XYGame(c);
  for (const n of c.notes) {
    g.tick(n.time - 0.001);
    if (n.kind === "double") {
      g.consume(swipe(n.time, "left", n.id + "l", 0.32, n.y));
      g.consume(swipe(n.time, "right", n.id + "r", 0.68, n.y));
    } else g.consume(swipe(n.time, n.hand!, n.id, n.x, n.y));
  }
  g.tick(64);
  assert.equal(g.results.size, 80);
  assert.equal(g.counts.Perfect, 80);
  assert.equal(g.score, 1e6);
  assert.equal(g.maxCombo, 80);
});

test("straight movement keeps one physical stroke ID and reversal starts a new one", () => {
  const tr = new XYTracker();
  tr.reset(calibrateUpper(samples()));
  const forward: string[] = [];
  const reverse: string[] = [];
  for (let i = 0; i < 8; i++) {
    const p = pose();
    p[15].x = 0.2 + i * 0.015;
    forward.push(
      ...tr
        .process(p, i * 40 + 1)
        .actions.filter((a) => a.hand === "left")
        .map((a) => a.id),
    );
  }
  for (let i = 1; i <= 8; i++) {
    const p = pose();
    p[15].x = 0.305 - i * 0.015;
    reverse.push(
      ...tr
        .process(p, (7 + i) * 40 + 1)
        .actions.filter((a) => a.hand === "left")
        .map((a) => a.id),
    );
  }
  assert.ok(forward.length > 1);
  assert.equal(new Set(forward).size, 1);
  assert.ok(reverse.length > 0);
  assert.notEqual(reverse.at(-1), forward.at(-1));
});

test("desynchronized Pair cannot receive a full score even when both subhits are Perfect", () => {
  const g = new XYGame(
    chart([{ ...note, kind: "double", hand: undefined, x: 0.5 }]),
  );
  g.consume(swipe(1.9));
  g.consume(swipe(2.1, "right", "r"));
  assert.equal(g.counts.Miss, 1);
  assert.equal(g.score, 500000);
  assert.equal(g.combo, 0);
});
