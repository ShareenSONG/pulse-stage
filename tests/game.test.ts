import { validateBodyChart } from "../src/body-game";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Game, validateChart } from "../src/game";
import { MotionTracker, makeCalibration } from "../src/motion";
import type { Action, Chart, Note, Point } from "../src/types";
const note: Note = {
  id: "a",
  time: 2,
  kind: "catch",
  hand: "left",
  x: 0.32,
  y: 0.48,
};
const chart = (notes: Note[]): Chart => ({
  id: "test",
  version: "test",
  mode: "XY",
  bpm: 120,
  duration: 32,
  notes,
});
const action = (patch: Partial<Action> = {}): Action => ({
  id: "e",
  time: 2,
  kind: "hand",
  hand: "left",
  x: 0.32,
  y: 0.48,
  prevX: 0.32,
  prevY: 0.6,
  dx: 0,
  dy: -0.12,
  speed: 1,
  confidence: 1,
  ...patch,
});
test("one event cannot score twice, perfect score is normalized", () => {
  const g = new Game(chart([note, { ...note, id: "b", time: 2.1 }]));
  g.consume(action());
  g.consume(action({ time: 2.1 }));
  assert.equal(g.results.size, 1);
  assert.equal(g.score, 500000);
});
test("fast slash segment crosses target between samples", () => {
  const g = new Game(chart([{ ...note, kind: "slash", dx: 1, dy: 0 }]));
  g.consume(
    action({
      x: 0.5,
      prevX: 0.1,
      y: 0.48,
      prevY: 0.48,
      dx: 0.4,
      dy: 0,
      speed: 2,
    }),
  );
  assert.equal(g.score, 1000000);
});
test("wrong direction slash does not hit", () => {
  const g = new Game(chart([{ ...note, kind: "slash", dx: 1, dy: 0 }]));
  g.consume(action({ x: 0.5, prevX: 0.1, dx: -0.4, dy: 0, speed: 2 }));
  assert.equal(g.results.size, 0);
});
test("double requires two different hands within 120ms", () => {
  const g = new Game(chart([{ ...note, kind: "double", hand: undefined }]));
  g.consume(action());
  g.consume(action({ id: "e2" }));
  assert.equal(g.results.size, 0);
  g.consume(
    action({ id: "e3", hand: "right", x: 0.68, prevX: 0.68, time: 2.05 }),
  );
  assert.equal(g.score, 1000000);
});
test("partial double gets half score and miss, not full combo", () => {
  const g = new Game(chart([{ ...note, kind: "double", hand: undefined }]));
  g.consume(action());
  g.tick(3);
  assert.equal(g.score, 500000);
  assert.equal(g.counts.Miss, 1);
  assert.equal(g.combo, 0);
});
test("direction is independent of chart expected answer", () => {
  const g = new Game(
    chart([{ ...note, kind: "step", direction: "toward_camera" }]),
  );
  g.consume(
    action({
      kind: "depth",
      direction: "away_from_camera",
      directionConfidence: 1,
    }),
  );
  assert.equal(g.counts["Wrong Direction"], 1);
  assert.equal(g.score, 0);
});
test("unknown direction cannot become a successful Z1 action", () => {
  const g = new Game(
    chart([{ ...note, kind: "step", direction: "toward_camera" }]),
  );
  g.consume(action({ kind: "depth", direction: undefined }));
  assert.equal(g.results.size, 0);
});
test("both directions can score Z0", () => {
  for (const direction of ["toward_camera", "away_from_camera"] as const) {
    const g = new Game(chart([{ ...note, kind: "pulse" }]));
    g.consume(action({ kind: "depth", direction }));
    assert.equal(g.score, 1000000);
  }
});
test("protected notes retain denominator and disqualify best", () => {
  const g = new Game(chart([note, { ...note, id: "b", time: 3 }]));
  g.consume(action());
  g.protect(2.9, 3.1);
  assert.equal(g.score, 500000);
  assert.equal(g.assisted, true);
  assert.equal(g.counts.Protected, 1);
});
test("all delivered chart variants obey recovery constraints", () => {
  for (const f of readdirSync("public/charts")) {
    const c = JSON.parse(readFileSync("public/charts/" + f, "utf8"));
    if (c.playStyle === "body-pilot")
      assert.doesNotThrow(() => validateBodyChart(c), f);
    else assert.deepEqual(validateChart(c), [], f);
  }
});
function pose(scale = 1, shiftX = 0) {
  const p: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
  }));
  const put = (i: number, x: number, y: number) => {
    p[i] = {
      x: 0.5 + (x - 0.5) * scale + shiftX,
      y: 0.5 + (y - 0.5) * scale,
      visibility: 1,
    };
  };
  put(11, 0.4, 0.3);
  put(12, 0.6, 0.3);
  put(23, 0.43, 0.6);
  put(24, 0.57, 0.6);
  put(15, 0.25, 0.5);
  put(16, 0.75, 0.5);
  put(25, 0.43, 0.75);
  put(26, 0.57, 0.75);
  put(27, 0.43, 0.9);
  put(28, 0.57, 0.9);
  return p;
}
function tracker() {
  const c = makeCalibration(Array.from({ length: 30 }, () => pose()))!;
  assert.ok(c);
  const t = new MotionTracker();
  t.reset(c);
  return t;
}
test("static pose and lateral translation produce no depth pulses", () => {
  const t = tracker();
  let total = 0;
  for (let i = 0; i < 150; i++)
    total += t
      .process(pose(1, i > 40 ? 0.06 : 0), i * 33 + 1)
      .actions.filter((a) => a.kind === "depth").length;
  assert.equal(total, 0);
});
test("scale growth and shrink estimate opposite directions", () => {
  for (const sign of [1, -1]) {
    const t = tracker();
    const actions: Action[] = [];
    for (let i = 0; i < 90; i++) {
      const s = i < 20 ? 1 : 1 + sign * Math.min(0.12, (i - 20) * 0.009);
      actions.push(
        ...t
          .process(pose(s), i * 33 + 1)
          .actions.filter((a) => a.kind === "depth"),
      );
    }
    assert.equal(actions.length, 1);
    assert.equal(
      actions[0].direction,
      sign === 1 ? "toward_camera" : "away_from_camera",
    );
  }
});
test("turning shoulder width alone is rejected", () => {
  const t = tracker();
  let count = 0;
  for (let i = 0; i < 90; i++) {
    const p = pose();
    if (i > 20) {
      p[11].x = 0.45;
      p[12].x = 0.55;
    }
    count += t
      .process(p, i * 33 + 1)
      .actions.filter((a) => a.kind === "depth").length;
  }
  assert.equal(count, 0);
});
test("tracking loss never interpolates a hit or creates a jump event", () => {
  const t = tracker();
  for (let i = 0; i < 20; i++) t.process(pose(), i * 33);
  const empty = t.process([], 700);
  assert.equal(empty.quality, 0);
  const next = t.process(pose(1.2), 1000);
  assert.equal(next.actions.length, 0);
});

test("visible shoulders do not make low-confidence hips pass full calibration", async () => {
  const { inspectPose } = await import("../src/motion");
  const p = pose();
  p[23].visibility = 0.6;
  p[24].visibility = 0.57;
  const d = inspectPose(p);
  assert.equal(d.shoulderReady, true);
  assert.equal(d.fullReady, false);
  assert.match(d.reason, /左髋/);
  assert.match(d.reason, /60%/);
  assert.equal(makeCalibration(Array(30).fill(p)), null);
  const upper = makeCalibration(Array(30).fill(p), "upper-body")!;
  assert.ok(upper);
  assert.equal(upper.profile, "upper-body");
  assert.equal(upper.z0, false);
  assert.equal(upper.z1, false);
  assert.equal(upper.hip, 0);
});
test("out-of-frame hips are not accepted even with high confidence", async () => {
  const { inspectPose } = await import("../src/motion");
  const p = pose();
  p[23].y = 1.04;
  assert.match(inspectPose(p).reason, /左髋在画面外/);
  assert.equal(makeCalibration(Array(30).fill(p)), null);
});
test("upper-body mode keeps hands working without any fake depth evidence", () => {
  const p = pose();
  p[23].visibility = 0.1;
  p[24].visibility = 0.1;
  const c = makeCalibration(Array(30).fill(p), "upper-body")!;
  const t = new MotionTracker();
  t.reset(c);
  let hands = 0,
    depth = 0;
  for (let i = 0; i < 80; i++) {
    const q = pose(1 + i * 0.002);
    q[23].visibility = 0.1;
    q[24].visibility = 0.1;
    q[15].x += Math.sin(i * 0.3) * 0.15;
    const f = t.process(q, i * 33 + 1);
    assert.equal(f.quality, 1);
    assert.equal(f.depthQuality, 0);
    assert.ok(f.hands.left);
    hands += f.actions.filter((a) => a.kind === "hand").length;
    depth += f.actions.filter((a) => a.kind === "depth").length;
  }
  assert.ok(hands > 0);
  assert.equal(depth, 0);
});
test("full calibration losing hips preserves XY hands but disables Z", () => {
  const t = tracker();
  for (let i = 0; i < 20; i++) t.process(pose(), i * 33 + 1);
  const p = pose();
  p[24].visibility = 0.5;
  const f = t.process(p, 661);
  assert.equal(f.quality, 1);
  assert.equal(f.depthQuality, 0);
  assert.ok(f.hands.left);
  assert.equal(
    f.actions.some((a) => a.kind === "depth"),
    false,
  );
});
test("calibration does not require knee/ankle data for shoulder-hip baseline", () => {
  assert.ok(makeCalibration(Array(30).fill(pose().slice(0, 25))));
});
test("upper-body calibration cannot bypass missing shoulders", () => {
  const p = pose();
  p[11].visibility = 0.4;
  assert.equal(makeCalibration(Array(30).fill(p), "upper-body"), null);
});
test("slow valid capture succeeds without the old 40-frame-in-3s gate", async () => {
  const { CalibrationCapture } = await import("../src/motion");
  const c = new CalibrationCapture();
  for (let i = 0; i <= 22; i++) c.add(pose(), i * 100);
  assert.ok(c.candidate("full-body", 2200));
  assert.equal(c.progress("full-body", 2200), 1);
  assert.equal(
    c.candidate("full-body", 2600),
    null,
    "stale frames cannot pass",
  );
});
test("capture refuses stale, absent or abruptly moving shoulder evidence", async () => {
  const { CalibrationCapture } = await import("../src/motion");
  const c = new CalibrationCapture();
  for (let i = 0; i < 18; i++) c.add(pose(), i * 100);
  c.add([], 1800);
  assert.equal(c.candidate("upper-body", 1800), null);
  assert.equal(c.progress("upper-body", 1800), 0);
  for (let i = 0; i < 18; i++) c.add(pose(), 2000 + i * 100);
  c.add(pose(1, 0.3), 3800);
  assert.equal(c.candidate("full-body", 3800), null);
});

test("slow frames still update a visible hand cursor without interpolating a scoring slash", () => {
  const t = tracker();
  t.process(pose(), 1);
  const p = pose();
  p[15].x = 0.1;
  const f = t.process(p, 240);
  assert.equal(f.quality, 1);
  assert.ok(f.hands.left);
  assert.equal(
    f.actions.some((a) => a.kind === "hand"),
    false,
    "never turn a long gap into a fictitious swipe",
  );
});
