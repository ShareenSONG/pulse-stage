import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inspectArms,
  palmProgress,
  type Hand,
  type PalmFrame,
} from "../src/palm";
import { PalmGame, PALM_RULE } from "../src/palm-game";
import { validateBodyChart, type BodyChart } from "../src/body-game";
import type { Point } from "../src/types";
const chart = () =>
  JSON.parse(
    readFileSync("public/charts/body-palm-64.json", "utf8"),
  ) as BodyChart;
const pose = (): Point[] => {
  const p: Point[] = [];
  const put = (id: number, x: number, y: number) =>
    (p[id] = { x, y, visibility: 0.99, presence: 0.99 });
  put(11, 0.6, 0.4);
  put(12, 0.4, 0.4);
  put(13, 0.65, 0.53);
  put(14, 0.35, 0.53);
  put(15, 0.68, 0.38);
  put(16, 0.32, 0.38);
  return p;
};
const frame = (at: number, hand: Hand = "left", raised = true): PalmFrame => ({
  effective: at,
  captured: at,
  left: {
    reliable: true,
    raised: hand === "left" && raised,
    x: -0.4,
    y: 0.3,
    reason: "",
  },
  right: {
    reliable: true,
    raised: hand === "right" && raised,
    x: 0.4,
    y: 0.3,
    reason: "",
  },
});
const run = (a: number, b: number, hand: Hand = "left") =>
  Array.from({ length: Math.round((b - a) / 0.05) + 1 }, (_, i) =>
    frame(a + i * 0.05, hand),
  );
const palm = (g: PalmGame, i = 0) =>
  g.chart.events.filter((b) => b.kind === "palm")[i];
test("both arm chains identify a raised palm pose without fingers or hips", () => {
  const a = inspectArms(pose());
  assert.equal(a.left.raised, true);
  assert.equal(a.right.raised, true);
  assert.equal(a.left.reliable, true);
});
test("a lowered wrist is known negative, not technical protection", () => {
  const p = pose();
  p[15].y = 0.6;
  const a = inspectArms(p).left;
  assert.equal(a.reliable, true);
  assert.equal(a.raised, false);
});
test("each arm requires its own elbow and wrist; other arm remains usable", () => {
  const p = pose();
  delete p[13];
  const a = inspectArms(p);
  assert.equal(a.left.reliable, false);
  assert.equal(a.right.reliable, true);
  assert.equal(a.right.raised, true);
});
test("low presence or offscreen wrist is rejected", () => {
  const p = pose();
  p[15].presence = 0.2;
  assert.equal(inspectArms(p).left.reliable, false);
  p[15].presence = 1;
  p[15].x = 1.1;
  assert.equal(inspectArms(p).left.reliable, false);
});
test("body translation and scale preserve shoulder-relative arm pose", () => {
  const p = pose(),
    a = inspectArms(p);
  const q = p.map((v) => ({
    ...v,
    x: 0.5 + (v.x - 0.5) * 0.7 + 0.04,
    y: 0.5 + (v.y - 0.5) * 0.7,
  }));
  const b = inspectArms(q);
  assert.equal(b.left.raised, a.left.raised);
  assert.ok(Math.abs(b.left.x - a.left.x) < 1e-6);
  assert.ok(Math.abs(b.right.y - a.right.y) < 1e-6);
});
test("holding steadily for half a second becomes ready", () => {
  const p = palmProgress(run(1, 1.5), "left", 1, 1.5);
  assert.equal(p.ready, true);
  assert.equal(p.progress, 1);
});
test("brief gesture does not complete a hold", () => {
  const p = palmProgress(run(1.35, 1.5), "left", 1, 1.5);
  assert.equal(p.ready, false);
  assert.equal(p.technical, false);
});
test("wrong hand cannot operate the other slider", () => {
  const p = palmProgress(run(1, 1.5, "right"), "left", 1, 1.5);
  assert.equal(p.ready, false);
  assert.equal(p.technical, false);
});
test("data age limit prevents a frozen hand filling or scoring", () => {
  const p = palmProgress(run(1, 1.5), "left", 1, 1.8);
  assert.equal(p.ready, false);
  assert.equal(p.technical, true);
});
test("a dropped reliable arm resets hold without converting the player miss into protection", () => {
  const states = run(1, 1.5);
  states[7].left.raised = false;
  const p = palmProgress(states, "left", 1, 1.5);
  assert.equal(p.ready, false);
  assert.equal(p.technical, false);
});
test("tracking gaps cannot be bridged into a fake continuous hold", () => {
  const states = [...run(1, 1.2), ...run(1.45, 1.6)];
  const p = palmProgress(states, "left", 1, 1.6);
  assert.equal(p.ready, false);
  assert.equal(p.technical, true);
});
test("moving wrist substantially resets stability, while small tracking noise is tolerated", () => {
  const stable = run(1, 1.5);
  stable.forEach((f, i) => (f.left.x += Math.sin(i) * 0.02));
  assert.equal(palmProgress(stable, "left", 1, 1.5).ready, true);
  const waving = run(1, 1.5);
  waving[5].left.x += 0.5;
  assert.equal(palmProgress(waving, "left", 1, 1.5).ready, false);
});
test("holding before cue window does not grant immediate completion at window opening", () => {
  assert.equal(palmProgress(run(0, 1), "left", 1, 1).ready, false);
});
test("eight palm events are gradually introduced left then right, and centered with room to hold", () => {
  const c = validateBodyChart(chart()),
    p = c.events.filter((b) => b.kind === "palm");
  assert.equal(c.ruleVersion, PALM_RULE);
  assert.equal(c.events.length, 68);
  assert.deepEqual(
    p.map((b) => b.time),
    [14, 22, 30, 38, 46, 54, 60, 62],
  );
  assert.deepEqual(
    p.slice(0, 2).map((b) => b.hand),
    ["left", "right"],
  );
});
test("invalid hold fields, duplicate IDs, simultaneous opposite palms and busy lateral sequences reject", () => {
  for (const change of [
    (c: BodyChart) => (c.events.find((b) => b.kind === "palm")!.hold = 0.05),
    (c: BodyChart) =>
      (c.events.find((b) => b.kind === "palm")!.id = c.events[0].id),
    (c: BodyChart) => {
      const p = c.events.filter((b) => b.kind === "palm");
      p[1].time = p[0].time;
      p[1].beat = p[0].beat;
    },
    (c: BodyChart) =>
      (c.events.find((b) => b.kind === "body" && b.time === 14)!.x = 0.65),
  ]) {
    const c = chart();
    change(c);
    assert.throws(() => validateBodyChart(c));
  }
});
test("ready palm waits for music beat and scores exactly once", () => {
  const g = new PalmGame(chart()),
    n = palm(g);
  run(12.5, 14).forEach((f) => g.pushPalms(f));
  g.tick(13.99);
  assert.equal(g.results.has(n.id), false);
  g.tick(14);
  assert.equal(g.results.get(n.id)!.grade, "Perfect");
  const score = g.score;
  g.tick(14.2);
  assert.equal(g.score, score);
});
test("late arriving raised palm does not overwrite a lowered pose at beat", () => {
  const g = new PalmGame(chart()),
    n = palm(g);
  g.pushPalms(frame(13.95, "left", false));
  run(14.01, 14.51).forEach((f) => g.pushPalms(f));
  g.tick(14.6);
  assert.equal(g.results.get(n.id)!.grade, "Miss");
});
test("missing arm protects only its target while shoulder driving continues", () => {
  const g = new PalmGame(chart());
  g.push({
    effective: 13.99,
    captured: 13.99,
    x: 0,
    reliable: true,
    reason: "",
  });
  const f = frame(13.99);
  f.left.reliable = false;
  g.pushPalms(f);
  g.tick(14);
  assert.equal(g.results.get(palm(g).id)!.grade, "Protected");
  assert.equal(
    g.results.get(
      g.chart.events.find((b) => b.kind === "body" && b.time === 14)!.id,
    )!.grade,
    "Perfect",
  );
});
test("completed hold latches and can be lowered before the music beat", () => {
  const g = new PalmGame(chart());
  run(12.5, 13.8).forEach((f) => {
    g.pushPalms(f);
    g.tick(f.effective);
  });
  g.pushPalms(frame(13.95, "left", false));
  g.tick(14);
  assert.equal(g.results.get(palm(g).id)!.grade, "Perfect");
});
test("full 64s mixed synthetic run has exactly 68 results and 1M normalized score", () => {
  const c = chart(),
    g = new PalmGame(c);
  for (let i = 0; i <= 6400; i++) {
    const t = i / 100,
      n =
        c.events.find((b) => b.kind !== "palm" && b.time >= t) ??
        c.events.filter((b) => b.kind !== "palm").at(-1)!;
    g.push({ effective: t, captured: t, x: n.x, reliable: true, reason: "" });
    const f = frame(t);
    f.right.raised = true;
    g.pushPalms(f);
    g.tick(t);
  }
  assert.equal(g.results.size, 68);
  assert.equal(g.palmsCompleted, 8);
  assert.equal(g.score, 1e6);
  assert.equal(g.maxCombo, 68);
});
test("rewind removes old palm hold evidence and scores before replay; no ready carryover", () => {
  const g = new PalmGame(chart());
  run(12.5, 14).forEach((f) => g.pushPalms(f));
  g.tick(14);
  assert.equal(g.palmsCompleted, 1);
  g.rewind(12);
  assert.equal(g.palms.length, 0);
  assert.equal(g.palmsCompleted, 0);
  assert.equal(g.assisted, true);
  g.tick(14);
  assert.equal(g.results.get(palm(g).id)!.grade, "Protected");
});
test("successful charge remains valid if arm tracking disappears after completed input", () => {
  const g = new PalmGame(chart());
  for (const f of run(11.2, 12)) {
    g.pushPalms(f);
    g.tick(f.effective);
  }
  const lost = frame(13.95);
  lost.left.reliable = false;
  g.pushPalms(lost);
  g.tick(14);
  const j = g.results.get(palm(g).id)!;
  assert.equal(j.grade, "Perfect");
  assert.ok(j.chargedAt! < 13);
});
test("new target cannot inherit a completed charge before it becomes visible", () => {
  const g = new PalmGame(chart());
  for (const f of run(8, 10)) {
    g.pushPalms(f);
    g.tick(f.effective);
  }
  assert.equal(g.charges.size, 0);
});
