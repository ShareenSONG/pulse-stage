import { jointStatus } from "./motion";
import type { Point } from "./types";
export const BODY_RULE = "body-1.4.0";
export const BODY_MAP = "shoulders-1.4.0";
export const clamp = (v: number, a = -1, b = 1) => Math.max(a, Math.min(b, v));
export interface BodyCalibration {
  version: typeof BODY_MAP;
  center: number;
  y: number;
  width: number;
  left: number;
  right: number;
}
export interface ShoulderObservation {
  center: number;
  y: number;
  width: number;
}
export interface PilotState {
  effective: number;
  captured: number;
  x: number;
  reliable: boolean;
  reason: string;
}
export function shoulders(points: Point[]): ShoulderObservation | null {
  const a = points[11],
    b = points[12];
  if (jointStatus(a) !== "ready" || jointStatus(b) !== "ready") return null;
  const width = Math.hypot(a.x - b.x, a.y - b.y);
  if (width < 0.045 || Math.abs(a.y - b.y) / width > 0.35) return null;
  return { center: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width };
}
export const median = (a: number[]) =>
  [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
export function baseline(
  samples: { at: number; value: ShoulderObservation }[],
): BodyCalibration | null {
  if (samples.length < 20 || samples.at(-1)!.at - samples[0].at < 2000)
    return null;
  const width = median(samples.map((s) => s.value.width)),
    center = median(samples.map((s) => s.value.center)),
    y = median(samples.map((s) => s.value.y));
  if (
    samples.some(
      (s) =>
        Math.abs(s.value.width / width - 1) > 0.12 ||
        Math.abs(s.value.center - center) / width > 0.09,
    )
  )
    return null;
  return { version: BODY_MAP, center, y, width, left: 0.45, right: 0.45 };
}
export function mapBody(r: number, c: BodyCalibration) {
  const dead = 0.06;
  if (Math.abs(r) <= dead) return 0;
  return clamp(
    (Math.sign(r) * (Math.abs(r) - dead)) / ((r > 0 ? c.right : c.left) - dead),
  );
}
export class BodyController {
  x = 0;
  last: { at: number; r: number } | null = null;
  reset() {
    this.last = null;
    this.x = 0;
  }
  process(
    points: Point[],
    captured: number,
    effective: number,
    c: BodyCalibration | null,
  ): PilotState {
    const obs = shoulders(points);
    let reason = "双肩清晰，身体左右驾驶";
    let reliable = !!obs && !!c;
    let r = 0;
    if (!obs) reason = "双肩不完整或侧转明显，请正面回到镜头中";
    else if (!c) reason = "请先完成身体定位";
    else {
      r = (c.center - obs.center) / c.width;
      if (
        Math.abs(obs.width / c.width - 1) > 0.25 ||
        Math.abs(obs.y - c.y) / c.width > 0.55
      ) {
        reliable = false;
        reason = "肩部尺度或高度变化过大，请回到原站位";
      } else if (r > c.right * 1.3 || r < -c.left * 1.3) {
        reliable = false;
        reason = "超出已校准范围，请向中间收回";
      } else if (
        this.last &&
        captured > this.last.at &&
        Math.abs(r - this.last.r) / ((captured - this.last.at) / 1000) > 5
      ) {
        reliable = false;
        reason = "肩部位置突变，等待稳定输入";
      } else if (this.last && captured <= this.last.at) {
        reliable = false;
        reason = "丢弃过期姿态";
      }
    }
    if (reliable && c) {
      const target = mapBody(r, c),
        dt = this.last ? captured - this.last.at : 100;
      // Causal smoothing; no future landmarks and no note snapping.
      const alpha = 1 - Math.exp(-Math.min(dt, 150) / 32);
      this.x += alpha * (target - this.x);
      if (target === 0 && Math.abs(this.x) < 0.015) this.x = 0;
      this.last = { at: captured, r };
    }
    return { effective, captured, x: this.x, reliable, reason };
  }
}
