import { shoulders, clamp } from "./body";
import type { BodyCalibration } from "./body";
import type { Point } from "./types";
import type { Hand, PalmPose } from "./palm";

export const HAND_MAP = "palm-center-1.0.0";
export interface HandDetection {
  points: Point[];
  label: string;
  // Handedness is a classification score, NOT landmark confidence.
  handednessScore: number;
}
export interface HandInput {
  available: boolean;
  delegate?: "CPU" | "GPU";
  detections: HandDetection[];
  processing: number;
  error?: string;
}
export interface TrackedPalm extends PalmPose {
  points: Point[];
  fingers: number;
  rawLaneX?: number;
  label?: string;
}
export const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
const empty = (reason: string): TrackedPalm => ({
  reliable: false,
  raised: false,
  x: 0,
  y: 0,
  reason,
  points: [],
  fingers: 0,
});
export function emptyPalms(reason = "举起手掌，让手指完整入镜") {
  return { left: empty(reason), right: empty(reason) };
}
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, (a.y - b.y) * 0.75);
export function extendedFingers(p: Point[]) {
  if (p.length !== 21) return 0;
  let count = 0;
  for (const m of [5, 9, 13, 17]) {
    const a = p[m],
      b = p[m + 1],
      tip = p[m + 3];
    const ux = a.x - b.x,
      uy = (a.y - b.y) * 0.75,
      vx = tip.x - b.x,
      vy = (tip.y - b.y) * 0.75;
    const cosine =
      (ux * vx + uy * vy) /
      Math.max(1e-8, Math.hypot(ux, uy) * Math.hypot(vx, vy));
    if (cosine < -0.65 && dist(tip, p[0]) > dist(b, p[0]) * 1.12) count++;
  }
  return count;
}
/** Associate hand wrists with Pose wrists before display mirroring. */
export class HandController {
  previous: Partial<
    Record<Hand, { at: number; value: number; lane?: number }>
  > = {};
  reset() {
    this.previous = {};
  }
  process(
    bodyPoints: Point[],
    input: HandInput | undefined,
    at: number,
    calibration: BodyCalibration | null,
  ) {
    const body = shoulders(bodyPoints);
    const out = emptyPalms(
      !input?.available
        ? input?.error || "手部模型未就绪"
        : !body
          ? "等待清晰双肩"
          : "未找到手掌，请让手指完整入镜",
    );
    if (!body || !input?.available) {
      this.reset();
      return out;
    }
    const anchor = (hand: Hand) => {
      const p = bodyPoints[hand === "left" ? 15 : 16];
      return p &&
        [p.x, p.y].every(Number.isFinite) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1 &&
        (p.visibility ?? 1) >= 0.35 &&
        (p.presence ?? 1) >= 0.35
        ? p
        : null;
    };
    const hands = input.detections.filter(
      (d) =>
        d.points.length === 21 &&
        d.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    );
    const left = anchor("left"),
      right = anchor("right");
    const cost = (a: Point | null, i: number) =>
      a && i >= 0 ? dist(a, hands[i].points[0]) / body.width : Infinity;
    let best = { l: -1, r: -1, score: Infinity };
    for (let l = -1; l < hands.length; l++)
      for (let r = -1; r < hands.length; r++) {
        if (l >= 0 && l === r) continue;
        const lc = cost(left, l),
          rc = cost(right, r);
        if ((l >= 0 && lc > 0.65) || (r >= 0 && rc > 0.65)) continue;
        const score = (l < 0 ? 2 : lc) + (r < 0 ? 2 : rc);
        if (score < best.score) best = { l, r, score };
      }
    for (const hand of ["left", "right"] as const) {
      const i = hand === "left" ? best.l : best.r;
      if (i < 0) {
        delete this.previous[hand];
        continue;
      }
      const d = hands[i],
        p = d.points;
      if (left && right && dist(left, right) < body.width * 0.16) {
        out[hand] = empty("双手重叠，请稍微分开");
        delete this.previous[hand];
        continue;
      }
      const palmIds = [0, 5, 9, 13, 17];
      const x = palmIds.reduce((sum, i) => sum + p[i].x, 0) / 5,
        y = palmIds.reduce((sum, i) => sum + p[i].y, 0) / 5;
      const span = Math.max(dist(p[0], p[9]), dist(p[5], p[17]));
      const inFrame = p.every(
        (q) => q.x > 0.005 && q.x < 0.995 && q.y > 0.005 && q.y < 0.995,
      );
      if (!inFrame || span < Math.max(0.018, body.width * 0.1)) {
        out[hand] = {
          ...empty(
            !inFrame ? "手指超出画面，向内收一点" : "手掌太小，请靠近一些",
          ),
          points: p,
        };
        delete this.previous[hand];
        continue;
      }
      const fingers = extendedFingers(p);
      // Fixed baseline prevents torso movement changing a stationary hand origin.
      const center = calibration?.center ?? body.center,
        width = calibration?.width ?? body.width,
        raw = clamp((center - x) / width / 1.15, -1, 1),
        old = this.previous[hand],
        filtered =
          old && at > old.at && at - old.at <= 180
            ? old.value +
              (raw - old.value) * (1 - Math.exp(-(at - old.at) / 24))
            : raw;
      let lane = old?.lane;
      if (lane !== undefined && Math.abs(filtered - lane) > 0.17)
        lane = undefined;
      if (lane === undefined)
        lane = [-0.65, 0, 0.65].find((v) => Math.abs(filtered - v) <= 0.1);
      this.previous[hand] = { at, value: filtered, lane };
      const lifted =
        (body.y - y) / body.width >= -0.3 && (body.y - y) / body.width <= 1.8;
      const open = fingers >= 3;
      out[hand] = {
        reliable: true,
        raised: lifted && open,
        x,
        y,
        laneX: lane ?? filtered,
        rawLaneX: raw,
        points: p,
        fingers,
        label: d.label,
        reason: !open
          ? "张开手掌，伸直至少三根手指"
          : !lifted
            ? "举起手掌到肩部附近"
            : "手掌已就绪，对准亮起的轨道",
      };
    }
    return out;
  }
}
