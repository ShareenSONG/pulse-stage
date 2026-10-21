import { jointStatus } from "./motion";
import { shoulders } from "./body";
import type { Point } from "./types";
export type Hand = "left" | "right";
export interface PalmPose {
  reliable: boolean;
  raised: boolean;
  x: number;
  y: number;
  reason: string;
  laneX?: number;
}
export interface PalmFrame {
  effective: number;
  captured: number;
  left: PalmPose;
  right: PalmPose;
}
export const PALM_HOLD = 0.45;
export const PALM_WINDOW = 2.8;
export function inspectArms(
  points: Point[],
  across = false,
): Record<Hand, PalmPose> {
  const body = shoulders(points);
  const inspect = (hand: Hand): PalmPose => {
    const ids = hand === "left" ? [11, 13, 15] : [12, 14, 16];
    if (!body || ids.some((id) => jointStatus(points[id]) !== "ready"))
      return {
        reliable: false,
        raised: false,
        x: 0,
        y: 0,
        reason: `${hand === "left" ? "左" : "右"}臂不完整，请让肩、肘、腕入镜`,
      };
    const [s, e, w] = ids.map((id) => points[id]),
      x = (s.x - w.x) / body.width,
      y = (s.y - w.y) / body.width;
    const side = hand === "left" ? -1 : 1;
    // Shoulder-relative pose, not monocular palm orientation or forward depth.
    const raised =
      y >= -0.12 &&
      y <= 1.5 &&
      (e.y - w.y) / body.width >= 0.18 &&
      x * side >= (across ? -0.75 : -0.18) &&
      x * side <= 1.3;
    return {
      reliable: true,
      raised,
      x,
      y,
      laneX: Math.max(-1, Math.min(1, (body.center - w.x) / body.width / 1.4)),
      reason: raised ? "保持手掌位置" : "抬手到肩部附近，掌心朝向屏幕",
    };
  };
  return { left: inspect("left"), right: inspect("right") };
}
export interface PalmProgress {
  held: number;
  progress: number;
  ready: boolean;
  technical: boolean;
  reason: string;
}
export function palmProgress(
  states: PalmFrame[],
  hand: Hand,
  start: number,
  at: number,
  hold = PALM_HOLD,
): PalmProgress {
  const none = (reason: string, technical: boolean): PalmProgress => ({
    held: 0,
    progress: 0,
    ready: false,
    technical,
    reason,
  });
  let i = states.length - 1;
  while (i >= 0 && states[i].effective > at) i--;
  if (i < 0) return none("等待手臂输入", true);
  const last = states[i],
    age = at - last.captured;
  if (age < -0.001 || age > 0.1800001 || !last[hand].reliable)
    return none(age > 0.18 ? "手臂数据已过期" : last[hand].reason, true);
  if (!last[hand].raised) return none("举起对应手掌并停留", false);
  let first = last,
    count = 1,
    technical = false,
    reason = "保持";
  for (let j = i - 1; j >= 0; j--) {
    const older = states[j];
    if (first.effective <= start) break;
    if (
      !older[hand].reliable ||
      first.effective - older.effective > 0.1800001 ||
      first.captured - older.captured > 0.1800001 ||
      older.effective - older.captured > 0.1800001
    ) {
      technical = true;
      reason = "手臂采样中断，重新保持";
      break;
    }
    if (!older[hand].raised) {
      reason = "保持还不够";
      break;
    }
    if (
      Math.hypot(older[hand].x - last[hand].x, older[hand].y - last[hand].y) >
      0.25
    ) {
      reason = "手掌移动较大，请稳住";
      break;
    }
    first = older;
    count++;
  }
  const held = Math.max(0, at - Math.max(start, first.effective));
  const ready =
    held >= hold - 1e-7 &&
    count >= 3 &&
    last.effective - first.effective >= Math.min(0.25, hold);
  return {
    held,
    progress: Math.min(1, held / hold),
    ready,
    technical: !ready && technical,
    reason: ready ? "充能完成" : reason,
  };
}
