import test from "node:test";
import assert from "node:assert/strict";
import { HandController, extendedFingers, type HandInput } from "../src/hands";
import type { Point } from "../src/types";
import { BODY_MAP, type BodyCalibration } from "../src/body";
const calibration: BodyCalibration = {
  version: BODY_MAP,
  center: 0.5,
  y: 0.5,
  width: 0.2,
  left: 0.4,
  right: 0.4,
};
function pose() {
  const p: Point[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 1,
    presence: 1,
  }));
  p[11].x = 0.6;
  p[12].x = 0.4;
  p[15] = { x: 0.65, y: 0.4, visibility: 1 };
  p[16] = { x: 0.35, y: 0.4, visibility: 1 };
  return p;
}
function hand(x: number, open = true) {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.4 }));
  for (const [j, m] of [5, 9, 13, 17].entries()) {
    const fx = x + (j - 1.5) * 0.018;
    p[m] = { x: fx, y: 0.355 };
    p[m + 1] = { x: fx, y: 0.32 };
    p[m + 2] = { x: fx, y: open ? 0.295 : 0.35 };
    p[m + 3] = { x: fx, y: open ? 0.27 : 0.38 };
  }
  return { points: p, label: "WrongOnPurpose", handednessScore: 0.99 };
}
const input = (...detections: ReturnType<typeof hand>[]): HandInput => ({
  available: true,
  detections,
  processing: 15,
});
test("open fingers activate, a fist does not", () => {
  assert.equal(extendedFingers(hand(0.65).points), 4);
  assert.equal(extendedFingers(hand(0.65, false).points), 0);
  const c = new HandController();
  assert.equal(
    c.process(pose(), input(hand(0.65)), 100, calibration).left.raised,
    true,
  );
  const fist = c.process(
    pose(),
    input(hand(0.65, false)),
    133,
    calibration,
  ).left;
  assert.equal(fist.reliable, true);
  assert.equal(fist.raised, false);
});
test("anatomical wrists associate hands regardless of detector order or labels", () => {
  const c = new HandController();
  const a = c.process(pose(), input(hand(0.35), hand(0.65)), 100, calibration);
  const b = c.process(pose(), input(hand(0.65), hand(0.35)), 133, calibration);
  assert.ok(a.left.x > 0.6 && a.right.x < 0.4);
  assert.equal(a.left.laneX, b.left.laneX);
  assert.equal(a.right.laneX, b.right.laneX);
  assert.equal(a.left.laneX, -0.65);
  assert.equal(a.right.laneX, 0.65);
});
test("one detected hand cannot activate both controls", () => {
  const r = new HandController().process(
    pose(),
    input(hand(0.65)),
    100,
    calibration,
  );
  assert.equal(r.left.reliable, true);
  assert.equal(r.right.reliable, false);
});
test("occluded elbow no longer disables recognized palm", () => {
  const p = pose();
  p[13].visibility = 0;
  assert.equal(
    new HandController().process(p, input(hand(0.65)), 100, calibration).left
      .raised,
    true,
  );
});
test("hand loss immediately invalidates rather than holding an old paddle", () => {
  const c = new HandController();
  c.process(pose(), input(hand(0.65)), 100, calibration);
  const r = c.process(pose(), input(), 133, calibration);
  assert.equal(r.left.reliable, false);
  assert.equal(r.left.laneX, undefined);
});
test("missing hand model protects inputs, never silently falls back to pose wrist", () => {
  const r = new HandController().process(
    pose(),
    { available: false, detections: [], processing: 0, error: "加载失败" },
    100,
    calibration,
  );
  assert.equal(r.left.reliable, false);
  assert.equal(r.left.reason, "加载失败");
});
test("fixed camera-space palm mapping is independent of torso-origin movement", () => {
  const c = new HandController(),
    p = pose();
  const a = c.process(p, input(hand(0.65)), 100, calibration);
  p[11].x += 0.02;
  p[12].x += 0.02;
  const b = c.process(p, input(hand(0.65)), 133, calibration);
  assert.equal(a.left.rawLaneX, b.left.rawLaneX);
});
test("fresh coordinate smoothing and lane hysteresis absorb small jitter", () => {
  const c = new HandController(),
    p = pose();
  c.process(p, input(hand(0.65)), 100, calibration);
  p[15].x = 0.66;
  const b = c.process(p, input(hand(0.66)), 133, calibration);
  assert.equal(b.left.laneX, -0.65);
});
test("reacquisition after a gap resets smoothing", () => {
  const c = new HandController(),
    p = pose();
  c.process(p, input(hand(0.65)), 100, calibration);
  p[15].x = 0.5;
  const b = c.process(p, input(hand(0.5)), 400, calibration);
  assert.equal(b.left.laneX, 0);
});
test("overlapping wrists and hands far from a wrist are not guessed", () => {
  const p = pose();
  p[16] = { ...p[15] };
  assert.equal(
    new HandController().process(p, input(hand(0.65)), 100, calibration).left
      .reliable,
    false,
  );
  assert.equal(
    new HandController().process(pose(), input(hand(0.9)), 100, calibration)
      .left.reliable,
    false,
  );
});
test("cropped fingers, NaN, and small palms fail safely", () => {
  const c = new HandController();
  const cropped = hand(0.65);
  cropped.points[8].y = -0.1;
  assert.equal(
    c.process(pose(), input(cropped), 100, calibration).left.reliable,
    false,
  );
  const broken = hand(0.65);
  broken.points[8].x = NaN;
  assert.equal(
    c.process(pose(), input(broken), 133, calibration).left.reliable,
    false,
  );
  const tiny = hand(0.65);
  tiny.points = tiny.points.map((p) => ({
    x: 0.65 + (p.x - 0.65) * 0.05,
    y: 0.4 + (p.y - 0.4) * 0.05,
  }));
  assert.equal(
    c.process(pose(), input(tiny), 166, calibration).left.reliable,
    false,
  );
});

import { sliderProgress } from "../src/slider";
import type { PalmFrame } from "../src/palm";
test("21-point palm detections drive actual slider coverage, wrist alone cannot score", () => {
  const controller = new HandController(),
    frames: PalmFrame[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = 12.95 + i / 30;
    frames.push({
      effective: t,
      captured: t - 0.025,
      ...controller.process(pose(), input(hand(0.65)), t * 1000, calibration),
    });
  }
  const note = {
    id: "hand-integration",
    kind: "palm" as const,
    time: 14,
    sliderStart: 13,
    hold: 1,
    x: -0.65,
    beat: 28,
    halfWidth: 0.12,
    accent: false,
    group: "test",
  };
  const p = sliderProgress(frames, note, 14);
  assert.ok(p.coverage > 0.99);
  assert.equal(p.ready, true);
  assert.equal(p.technical, false);
  const lost = frames.map((f) => ({
    ...f,
    ...controller.process(pose(), input(), f.captured * 1000, calibration),
  }));
  const q = sliderProgress(lost, note, 14);
  assert.equal(q.coverage, 0);
  assert.equal(q.technical, true);
});
