import type { Action, Calibration, MotionFrame, Point } from "./types";
import { jointStatus, makeCalibration } from "./motion";
export const XY_JOINTS = [
  { id: 11, label: "左肩" },
  { id: 12, label: "右肩" },
  { id: 13, label: "左肘" },
  { id: 14, label: "右肘" },
  { id: 15, label: "左腕" },
  { id: 16, label: "右腕" },
];
export function inspectUpper(points: Point[]) {
  const joints = XY_JOINTS.map((j) => ({
    ...j,
    status: jointStatus(points[j.id]),
    confidence: Math.min(
      points[j.id]?.visibility ?? 0,
      points[j.id]?.presence ?? 1,
    ),
  }));
  const shoulders = joints.slice(0, 2).every((j) => j.status === "ready");
  const left = shoulders && [2, 4].every((i) => joints[i].status === "ready");
  const right = shoulders && [3, 5].every((i) => joints[i].status === "ready");
  const missing = joints.filter((j) => j.status !== "ready");
  return {
    joints,
    shoulders,
    left,
    right,
    ready: left && right,
    reason: missing.length
      ? missing
          .map(
            (j) =>
              j.label +
              (j.status === "outside"
                ? "在画面外"
                : j.status === "missing"
                  ? "无数据"
                  : "不可靠"),
          )
          .join("、")
      : "双肩、双肘、双腕可用",
  };
}
export function calibrateUpper(samples: { points: Point[]; time: number }[]) {
  if (samples.length < 20 || samples.at(-1)!.time - samples[0].time < 2000)
    return null;
  const usable = samples.filter((s) => inspectUpper(s.points).ready);
  if (usable.length / samples.length < 0.85 || usable.length < 20) return null;
  const c = makeCalibration(
    usable.map((s) => s.points),
    "upper-body",
  );
  if (c) {
    c.version = "xy-map-1.3";
    c.z0 = false;
    c.z1 = false;
  }
  return c;
}
export function mapHand(p: Point, c: Calibration): Point {
  return {
    x: 0.5 + (c.centerX - p.x) / c.reachX,
    y: 0.5 + (p.y - c.centerY) / c.reachY,
  };
}
type Sample = Point & { time: number };
type Track = {
  samples: Sample[];
  id: string;
  direction: Point | null;
  lastMoving: number;
};
export class XYTracker {
  calibration: Calibration | null = null;
  serial = 0;
  tracks: Record<"left" | "right", Track> = {
    left: this.fresh(),
    right: this.fresh(),
  };
  private fresh(): Track {
    return {
      samples: [],
      id: `xy-${++this.serial}`,
      direction: null,
      lastMoving: 0,
    };
  }
  reset(c = this.calibration) {
    this.calibration = c;
    this.tracks = { left: this.fresh(), right: this.fresh() };
  }
  process(points: Point[], time: number, processing = 0): MotionFrame {
    const d = inspectUpper(points),
      c = this.calibration;
    const hands: MotionFrame["hands"] = { left: null, right: null };
    const actions: Action[] = [];
    for (const hand of ["left", "right"] as const) {
      if (!c || !d[hand]) {
        this.tracks[hand] = this.fresh();
        continue;
      }
      const raw = mapHand(points[hand === "left" ? 15 : 16], c);
      const tr = this.tracks[hand];
      const prev = tr.samples.at(-1);
      if (prev && (time <= prev.time || time - prev.time > 150)) {
        this.tracks[hand] = this.fresh();
      }
      const track = this.tracks[hand],
        last = track.samples.at(-1);
      // The same causal position drives the visible cursor and judgement.
      const alpha = last ? 1 - Math.exp(-(time - last.time) / 22) : 1;
      const p: Sample = {
        x: last ? last.x + (raw.x - last.x) * alpha : raw.x,
        y: last ? last.y + (raw.y - last.y) * alpha : raw.y,
        time,
      };
      hands[hand] = p;
      if (last) {
        const dt = (time - last.time) / 1000,
          dx = p.x - last.x,
          dy = p.y - last.y,
          mag = Math.hypot(dx, dy),
          speed = mag / dt;
        // Reject impossible label jumps; never sort hands by screen position.
        if (speed > 8) {
          hands[hand] = null;
          this.tracks[hand] = this.fresh();
          continue;
        }
        const dir = mag > 0.002 ? { x: dx / mag, y: dy / mag } : null;
        const turned =
          dir &&
          track.direction &&
          dir.x * track.direction.x + dir.y * track.direction.y < -0.25;
        if (turned || (speed < 0.12 && time - track.lastMoving > 120)) {
          track.id = `xy-${++this.serial}`;
          track.samples = [last];
          track.direction = null;
        }
        if (speed > 0.2) {
          track.lastMoving = time;
          if (dir && !track.direction) track.direction = dir;
        }
        const anchor = track.samples.find((s) => time - s.time <= 140) ?? last;
        const move = Math.hypot(p.x - anchor.x, p.y - anchor.y);
        const threshold = Math.max(
          0.035,
          (c.shoulder * 0.14) / Math.max(c.reachX, c.reachY),
        );
        if (move >= threshold && speed >= 0.3) {
          actions.push({
            id: track.id,
            kind: "hand",
            hand,
            time,
            prevTime: anchor.time,
            x: p.x,
            y: p.y,
            prevX: anchor.x,
            prevY: anchor.y,
            dx: p.x - anchor.x,
            dy: p.y - anchor.y,
            speed,
            confidence: Math.min(
              points[hand === "left" ? 15 : 16].visibility ?? 0,
              points[hand === "left" ? 13 : 14].visibility ?? 0,
            ),
          });
        }
      }
      track.samples.push(p);
      track.samples = track.samples.filter((s) => time - s.time <= 180);
    }
    return {
      points,
      time,
      processing,
      hands,
      actions,
      quality: c && d.shoulders ? 1 : 0,
      depthQuality: 0,
      scale: 1,
      delta: 0,
      status: c ? "上半身 XY" : "等待定位",
      reason: d.reason,
      direction: "stable",
      confidence: d.ready ? 1 : 0,
    };
  }
}
