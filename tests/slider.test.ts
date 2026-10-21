import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SliderGame } from "../src/slider-game";
import { PalmGame } from "../src/palm-game";
import { sliderProgress } from "../src/slider";
import { inspectArms, type PalmFrame } from "../src/palm";
import {
  validateBodyChart,
  type BodyChart,
  type Block,
} from "../src/body-game";
import type { Point } from "../src/types";
const chart = () =>
  JSON.parse(
    readFileSync("public/charts/body-slider-64.json", "utf8"),
  ) as BodyChart;
const oldChart = () =>
  JSON.parse(
    readFileSync("public/charts/body-palm-64.json", "utf8"),
  ) as BodyChart;
const block = (index = 0) =>
  chart().events.filter((b) => b.kind === "palm")[index];
const frame = (at: number, x = -0.65, raised = true): PalmFrame => ({
  effective: at,
  captured: at,
  left: { reliable: true, raised, x: 0, y: 0.3, laneX: x, reason: "" },
  right: { reliable: true, raised, x: 0, y: 0.3, laneX: x, reason: "" },
});
const sample = (n: Block, x = n.x, raised = true) =>
  Array.from({ length: Math.round(n.hold! * 100) + 1 }, (_, i) =>
    frame(n.sliderStart! + i / 100, x, raised),
  );
test("lower body chart is preserved byte-for-byte as data, all three upper lanes receive sliders", () => {
  const c = validateBodyChart(chart());
  assert.deepEqual(
    c.events.filter((b) => b.kind !== "palm"),
    oldChart().events.filter((b) => b.kind !== "palm"),
  );
  assert.deepEqual(
    [
      ...new Set(c.events.filter((b) => b.kind === "palm").map((b) => b.x)),
    ].sort(),
    [-0.65, 0, 0.65],
  );
  assert.equal(c.events.length, 68);
});
test("ribbon head time and tail time bound the authored hold duration", () => {
  for (const b of chart().events.filter((b) => b.kind === "palm"))
    assert.equal(b.time - b.sliderStart!, b.hold);
  const c = chart();
  c.events.find((b) => b.kind === "palm")!.sliderStart += 0.1;
  assert.throws(() => validateBodyChart(c));
});
test("full raised hand hold in correct lane completes only at the tail beat", () => {
  const n = block(),
    s = sample(n);
  const halfway = sliderProgress(s, n, n.sliderStart! + 0.5);
  assert.equal(halfway.ready, false);
  assert.ok(halfway.held < 0.6);
  const p = sliderProgress(s, n, n.time);
  assert.ok(p.coverage > 0.99);
  assert.equal(p.ready, true);
});
test("wrong lane cannot operate a slider even with the correct hand raised", () => {
  const n = block(),
    p = sliderProgress(sample(n, 0.65), n, n.time);
  assert.equal(p.held, 0);
  assert.equal(p.technical, false);
});
test("center lane accepts either hand without merging half a hold from each", () => {
  const n = block(2),
    s = sample(n);
  s.forEach((f) => (f.left.raised = false));
  assert.equal(sliderProgress(s, n, n.time).ready, true);
  const split = sample(n);
  split.forEach((f) => {
    f.left.raised = f.effective < n.sliderStart! + 0.5;
    f.right.raised = !f.left.raised;
  });
  assert.ok(sliderProgress(split, n, n.time).coverage < 0.6);
});
test("short tap or early release cannot latch an entire long slider", () => {
  const n = block(),
    s = sample(n);
  s.forEach((f) => {
    if (f.effective > n.sliderStart! + 0.45) f.left.raised = false;
  });
  const p = sliderProgress(s, n, n.time);
  assert.ok(p.coverage < 0.5);
  assert.equal(p.ready, false);
  assert.equal(p.technical, false);
});
test("posing before the head and lowering before it arrives does not score", () => {
  const n = block(),
    s = [frame(n.sliderStart! - 0.4), ...sample(n, n.x, false)];
  assert.equal(sliderProgress(s, n, n.time).held, 0);
});
test("camera freeze protects the slider instead of extrapolating a full hold", () => {
  const n = block(),
    p = sliderProgress([frame(n.sliderStart!)], n, n.time);
  assert.ok(p.held <= 0.181);
  assert.equal(p.technical, true);
});
test("later received position cannot fix an already missed tail", () => {
  const n = block(),
    s = [...sample(n, 0.65), frame(n.time + 0.001, n.x)];
  assert.equal(sliderProgress(s, n, n.time).held, 0);
});
test("future capture timestamps are not accepted as proof of a hold", () => {
  const n = block(),
    s = sample(n);
  s.forEach((f) => (f.captured = f.effective + 1));
  assert.equal(sliderProgress(s, n, n.time).held, 0);
});
test("minor hand jitter within upper-lane width is tolerated", () => {
  const n = block(),
    s = sample(n);
  s.forEach((f, i) => (f.left.laneX = n.x + Math.sin(i) * 0.06));
  assert.equal(sliderProgress(s, n, n.time).ready, true);
});
test("hand geometry reaches center from either shoulder without moving the lower ship", () => {
  const p: Point[] = [];
  for (const [id, x, y] of [
    [11, 0.6, 0.4],
    [12, 0.4, 0.4],
    [13, 0.65, 0.53],
    [14, 0.35, 0.53],
    [15, 0.5, 0.38],
    [16, 0.5, 0.38],
  ])
    p[id] = { x, y, visibility: 1, presence: 1 };
  const a = inspectArms(p, true);
  assert.equal(a.left.raised, true);
  assert.equal(a.right.raised, true);
  assert.ok(Math.abs(a.left.laneX!) < 1e-6);
  assert.ok(Math.abs(a.right.laneX!) < 1e-6);
});
test("lower body judgements are identical with and without hand control", () => {
  const g = new SliderGame(chart()),
    old = new PalmGame(oldChart());
  for (let i = 0; i <= 6400; i++) {
    const t = i / 100,
      state = {
        effective: t,
        captured: t,
        x: Math.sin(t) * 0.65,
        reliable: true,
        reason: "",
      };
    g.push(state);
    old.push(state);
    g.pushPalms(frame(t, 0.65, false));
    g.tick(t);
    old.tick(t);
  }
  for (const b of g.chart.events.filter((b) => b.kind !== "palm")) {
    assert.equal(g.results.get(b.id)!.grade, old.results.get(b.id)!.grade);
    assert.equal(g.results.get(b.id)!.factor, old.results.get(b.id)!.factor);
  }
});
test("one complete mixed minute still has 68 unique results and 1M maximum", () => {
  const c = chart(),
    g = new SliderGame(c);
  for (let i = 0; i <= 6400; i++) {
    const t = i / 100,
      next =
        c.events.find((b) => b.kind !== "palm" && b.time >= t) ??
        c.events.filter((b) => b.kind !== "palm").at(-1)!,
      hand = c.events.find((b) => b.kind === "palm" && b.time >= t) ?? block(7);
    g.push({
      effective: t,
      captured: t,
      x: next.x,
      reliable: true,
      reason: "",
    });
    g.pushPalms(frame(t, hand.x));
    g.tick(t);
  }
  assert.equal(g.results.size, 68);
  assert.equal(g.palmsCompleted, 8);
  assert.equal(g.score, 1e6);
});
test("rewind clears upper tracking and replay results, not the lower rule", () => {
  const n = block(),
    g = new SliderGame(chart());
  sample(n).forEach((f) => g.pushPalms(f));
  g.tick(n.time);
  assert.equal(g.palmsCompleted, 1);
  g.rewind(12);
  assert.equal(g.palms.length, 0);
  assert.equal(g.palmsCompleted, 0);
  assert.equal(g.assisted, true);
});
test("a center slider remains playable with one reliable raised hand and the other out of frame", () => {
  const n = block(2),
    s = sample(n);
  s.forEach((f) => (f.left.reliable = false));
  assert.equal(sliderProgress(s, n, n.time).ready, true);
  assert.equal(sliderProgress(s, n, n.time).technical, false);
});
test("unknown potential control hand on center is protected rather than mislabeled as a player miss", () => {
  const n = block(2),
    s = sample(n);
  s.forEach((f) => {
    f.left.reliable = false;
    f.right.raised = false;
  });
  assert.equal(sliderProgress(s, n, n.time).technical, true);
});
