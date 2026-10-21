import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BodyController,
  baseline,
  BODY_MAP,
  mapBody,
  type BodyCalibration,
} from "../src/body";
import { BodyGame, validateBodyChart, type BodyChart } from "../src/body-game";
import { impactPreset } from "../src/body-stage";
import type { Point } from "../src/types";
const chart = () =>
  JSON.parse(readFileSync("public/charts/body-64.json", "utf8")) as BodyChart;
const cal: BodyCalibration = {
  version: BODY_MAP,
  center: 0.5,
  y: 0.35,
  width: 0.2,
  left: 0.4,
  right: 0.5,
};
const pose = (r = 0): Point[] => {
  const p: Point[] = [];
  p[11] = { x: 0.4 - r * 0.2, y: 0.35, visibility: 0.99, presence: 0.99 };
  p[12] = { x: 0.6 - r * 0.2, y: 0.35, visibility: 0.99, presence: 0.99 };
  return p;
};
test("shoulders alone drive without any elbows wrists hips or facial landmarks", () => {
  const c = new BodyController();
  const s = c.process(pose(0.35), 1000, 1100, cal);
  assert.equal(s.reliable, true);
  assert.ok(s.x > 0.6);
  assert.equal(s.captured, 1000);
  assert.equal(s.effective, 1100);
});
test("mirrored continuous mapping, independent left/right ranges, deadzone and center", () => {
  assert.equal(mapBody(0.05, cal), 0);
  assert.equal(mapBody(-0.05, cal), 0);
  assert.equal(mapBody(-0.4, cal), -1);
  assert.equal(mapBody(0.5, cal), 1);
  assert.ok(Math.abs(mapBody(0.25, cal)) < Math.abs(mapBody(-0.25, cal)));
});
test("small shoulder breathing noise does not cause steering", () => {
  const c = new BodyController();
  for (let i = 0; i < 40; i++)
    assert.equal(
      c.process(pose(Math.sin(i) * 0.04), 1000 + i * 40, 1100 + i * 40, cal).x,
      0,
    );
});
test("a missing shoulder freezes display but marks it unreliable", () => {
  const c = new BodyController();
  const a = c.process(pose(0.2), 1000, 1100, cal);
  const p = pose(0.2);
  delete p[12];
  const b = c.process(p, 1100, 1200, cal);
  assert.equal(b.reliable, false);
  assert.equal(a.x, b.x);
});
test("low presence shoulder is rejected independently of visibility", () => {
  const p = pose();
  p[11].presence = 0.3;
  assert.equal(
    new BodyController().process(p, 1000, 1100, cal).reliable,
    false,
  );
});
test("reject scale drift, impossible jump, out of calibrated bounds and stale capture", () => {
  const c = new BodyController();
  c.process(pose(), 1000, 1100, cal);
  assert.equal(c.process(pose(0.4), 1010, 1110, cal).reliable, false);
  const p = pose();
  p[12].x = 0.8;
  assert.equal(c.process(p, 1200, 1300, cal).reliable, false);
  assert.equal(c.process(pose(1), 1300, 1400, cal).reliable, false);
  assert.equal(c.process(pose(), 999, 1450, cal).reliable, false);
});
test("stable 2 second baseline requires enough samples, independent of hip confidence", () => {
  const samples = Array.from({ length: 25 }, (_, i) => ({
    at: i * 100,
    value: { center: 0.5, y: 0.35, width: 0.2 },
  }));
  assert.ok(baseline(samples));
  assert.equal(baseline(samples.slice(0, 12)), null);
  samples[7].value.center = 0.57;
  assert.equal(baseline(samples), null);
});
test("all 60 authored blocks are on musical beats with 22 reachable changes and section counts", () => {
  const c = validateBodyChart(chart());
  assert.equal(
    c.events.filter((b, i) => i && b.x !== c.events[i - 1].x).length,
    22,
  );
  assert.deepEqual(
    [
      [0, 8],
      [8, 24],
      [24, 40],
      [40, 56],
      [56, 64],
    ].map(([a, b]) => c.events.filter((n) => n.time >= a && n.time < b).length),
    [4, 16, 16, 16, 8],
  );
});
test("invalid beat, duplicate timestamp, direct extreme jump and wrong chart versions reject", () => {
  for (const change of [
    (c: BodyChart) => (c.events[1].time = 2),
    (c: BodyChart) => (c.events[0].beat = 4.2),
    (c: BodyChart) => (c.events[3].x = 0.65),
    (c: BodyChart) => (c.ruleVersion = "xy"),
  ]) {
    const c = chart();
    change(c);
    assert.throws(() => validateBodyChart(c));
  }
});
test("early positioning waits until the target music beat", () => {
  const g = new BodyGame(chart());
  g.push({ effective: 1.9, captured: 1.9, x: 0, reliable: true, reason: "" });
  g.tick(1.999);
  assert.equal(g.results.size, 0);
  g.tick(2);
  assert.equal(g.counts.Perfect, 1);
});
test("later arriving new position cannot rewrite the already effective state at beat", () => {
  const g = new BodyGame(chart());
  g.push({
    effective: 1.95,
    captured: 1.9,
    x: -0.65,
    reliable: true,
    reason: "",
  });
  g.push({
    effective: 2.001,
    captured: 1.96,
    x: 0,
    reliable: true,
    reason: "",
  });
  g.tick(2.01);
  assert.equal(g.results.get("bp-1")!.grade, "Miss");
});
test("state age uses capture timestamp, not late processing completion timestamp", () => {
  const g = new BodyGame(chart());
  g.push({ effective: 1.99, captured: 1.7, x: 0, reliable: true, reason: "" });
  g.tick(2);
  assert.equal(g.counts.Protected, 1);
  assert.equal(g.assisted, true);
  assert.equal(g.score, 0);
});
test("180ms freshness boundary accepted; older data protects with no points", () => {
  for (const [captured, grade] of [
    [1.820001, "Perfect"],
    [1.819, "Protected"],
  ] as const) {
    const g = new BodyGame(chart());
    g.push({ effective: 1.99, captured, x: 0, reliable: true, reason: "" });
    g.tick(2);
    assert.equal(g.results.get("bp-1")!.grade, grade);
  }
});
test("position-based grade boundaries correspond to logical collision geometry", () => {
  for (const [x, grade] of [
    [0.06, "Perfect"],
    [0.12, "Great"],
    [0.2, "Good"],
    [0.201, "Miss"],
  ] as const) {
    const g = new BodyGame(chart());
    g.push({ effective: 1.99, captured: 1.95, x, reliable: true, reason: "" });
    g.tick(2);
    assert.equal(g.results.get("bp-1")!.grade, grade);
  }
});
test("same lane holding scores every block separately; repeated tick produces no extra score or feedback", () => {
  const g = new BodyGame(chart());
  let events = 0;
  g.onJudge = () => events++;
  for (let t = 0; t <= 4.51; t += 0.025) {
    g.push({ effective: t, captured: t, x: 0, reliable: true, reason: "" });
    g.tick(t);
  }
  assert.equal(g.counts.Perfect, 2);
  const score = g.score;
  g.tick(4.51);
  assert.equal(g.score, score);
  assert.equal(events, 2);
});
test("unreliable shoulders protected, reliable but wrong position is a normal miss", () => {
  for (const reliable of [false, true]) {
    const g = new BodyGame(chart());
    g.push({
      effective: 1.99,
      captured: 1.95,
      x: 0.65,
      reliable,
      reason: "single shoulder",
    });
    g.tick(2);
    assert.equal(g.results.get("bp-1")!.grade, reliable ? "Miss" : "Protected");
  }
});
test("full synthetic 64s controller history can earn 1 million with independent 60 events", () => {
  const c = chart(),
    g = new BodyGame(c);
  for (let i = 0; i <= 6400; i++) {
    const t = i / 100,
      n = c.events.find((n) => n.time >= t) ?? c.events.at(-1)!;
    g.push({ effective: t, captured: t, x: n.x, reliable: true, reason: "" });
    g.tick(t);
  }
  assert.equal(g.results.size, 60);
  assert.equal(g.score, 1000000);
  assert.equal(g.maxCombo, 60);
  assert.equal(g.assisted, false);
  assert.deepEqual(g.bands, [100, 100, 100]);
});
test("pause rewind purges replayed scores and state history, preserves assisted eligibility", () => {
  const c = chart(),
    g = new BodyGame(c);
  for (let i = 0; i <= 1000; i++) {
    const t = i / 100,
      n = c.events.find((n) => n.time >= t)!;
    g.push({ effective: t, captured: t, x: n.x, reliable: true, reason: "" });
    g.tick(t);
  }
  const before = g.results.size;
  g.rewind(8);
  assert.ok(g.results.size < before);
  assert.ok([...g.results.values()].every((j) => j.block.time < 8));
  assert.equal(g.states.length, 0);
  assert.equal(g.assisted, true);
  const oldRound = g.round;
  g.push({ effective: 7.99, captured: 7.99, x: 0, reliable: true, reason: "" });
  g.tick(8);
  assert.equal(g.results.get("bp-5")!.round, oldRound);
});
test("Good interrupts combo and receives half points; protected stays in denominator", () => {
  const g = new BodyGame(chart());
  g.push({
    effective: 1.99,
    captured: 1.95,
    x: 0.15,
    reliable: true,
    reason: "",
  });
  g.tick(2);
  assert.equal(g.combo, 0);
  assert.equal(g.score, Math.round((1e6 * 0.5) / 60));
  g.tick(4);
  assert.equal(g.counts.Protected, 1);
  assert.equal(g.score, Math.round((1e6 * 0.5) / 60));
});
test("feedback preset off, light and standard are bounded and reduced-effects compatible", () => {
  assert.equal(impactPreset(true, "off", false).amplitude, 0);
  assert.ok(
    impactPreset(true, "light", false).amplitude <
      impactPreset(true, "standard", false).amplitude,
  );
  assert.ok(
    impactPreset(false, "standard", false).amplitude <
      impactPreset(true, "standard", false).amplitude,
  );
  for (const setting of ["off", "light", "standard"] as const) {
    assert.ok(impactPreset(true, setting, false).amplitude <= 6);
    assert.ok(impactPreset(true, setting, false).duration <= 140);
  }
});
