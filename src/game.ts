import type { Action, Chart, Grade, Judgement, Note } from "./types";
export const RULE_VERSION = "0.1.0";
const coefficients: Record<Grade, number> = {
  Perfect: 1,
  Great: 0.8,
  Good: 0.5,
  Miss: 0,
  "Wrong Direction": 0,
  Protected: 0,
};
function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
) {
  const vx = bx - ax,
    vy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)),
  );
  return Math.hypot(x - ax - t * vx, y - ay - t * vy);
}
export class Game {
  results = new Map<string, Judgement>();
  consumed = new Set<string>();
  combo = 0;
  maxCombo = 0;
  assisted = false;
  partials = new Map<string, Map<string, { time: number; action: string }>>();
  onJudge: (j: Judgement) => void = () => {};
  constructor(public chart: Chart) {}
  get score() {
    return Math.round(
      (1e6 * [...this.results.values()].reduce((s, j) => s + j.factor, 0)) /
        this.chart.notes.length,
    );
  }
  get accuracy() {
    return this.score / 10000;
  }
  get counts() {
    const c: Record<Grade, number> = {
      Perfect: 0,
      Great: 0,
      Good: 0,
      Miss: 0,
      "Wrong Direction": 0,
      Protected: 0,
    };
    for (const r of this.results.values()) c[r.grade]++;
    return c;
  }
  window(n: Note): number {
    return n.kind === "pulse" || n.kind === "step" || n.kind === "sway"
      ? 0.38
      : 0.23;
  }
  private resolve(
    n: Note,
    g: Grade,
    error = 0,
    action?: string,
    factor = coefficients[g],
  ) {
    if (this.results.has(n.id)) return;
    const j = { note: n, grade: g, error, action, factor };
    this.results.set(n.id, j);
    if (g === "Perfect" || g === "Great") {
      this.combo++;
      this.maxCombo = Math.max(this.combo, this.maxCombo);
    } else this.combo = 0;
    if (g === "Protected") this.assisted = true;
    this.onJudge(j);
  }
  protect(from: number, to: number) {
    for (const n of this.chart.notes)
      if (n.time >= from && n.time <= to) this.resolve(n, "Protected");
    this.assisted = true;
  }
  tick(time: number) {
    for (const n of this.chart.notes)
      if (!this.results.has(n.id) && time > n.time + this.window(n) + 0.35) {
        const p = this.partials.get(n.id);
        this.resolve(n, "Miss", 0, undefined, p?.size === 1 ? 0.5 : 0);
      }
  }
  consume(a: Action) {
    if (this.consumed.has(a.id)) return;
    const candidates = this.chart.notes
      .filter(
        (n) =>
          !this.results.has(n.id) &&
          Math.abs(n.time - a.time) <= this.window(n) &&
          this.matches(n, a),
      )
      .sort(
        (a1, b) =>
          Math.abs(a1.time - a.time) - Math.abs(b.time - a.time) ||
          a1.time - b.time,
      );
    const n = candidates[0];
    if (!n) return;
    this.consumed.add(a.id);
    if (n.kind === "double") {
      const hits = this.partials.get(n.id) ?? new Map();
      this.partials.set(n.id, hits);
      const hand = a.hand!;
      if (hits.has(hand)) return;
      hits.set(hand, { time: a.time, action: a.id });
      if (hits.size < 2) return;
      const values = [...hits.values()];
      if (Math.abs(values[0].time - values[1].time) > 0.12) {
        this.resolve(n, "Miss", 0, a.id, 0.5);
        return;
      }
      const error = Math.max(...values.map((v) => Math.abs(v.time - n.time)));
      this.resolve(n, this.grade(error, false), error, a.id);
      return;
    }
    const err = a.time - n.time;
    if (n.kind === "step" && a.direction !== n.direction) {
      this.resolve(n, "Wrong Direction", err, a.id);
      return;
    }
    this.resolve(
      n,
      this.grade(Math.abs(err), ["pulse", "step", "sway"].includes(n.kind)),
      err,
      a.id,
    );
  }
  private grade(error: number, body: boolean): Grade {
    return error <= (body ? 0.16 : 0.09)
      ? "Perfect"
      : error <= (body ? 0.26 : 0.15)
        ? "Great"
        : "Good";
  }
  private matches(n: Note, a: Action) {
    if (n.kind === "pulse") return a.kind === "depth" && a.confidence >= 0.65;
    if (n.kind === "step")
      return (
        a.kind === "depth" &&
        a.direction !== undefined &&
        (a.directionConfidence ?? 0) >= 0.75
      );
    if (n.kind === "sway") return a.kind === "sway";
    if (
      a.kind !== "hand" ||
      a.confidence < 0.6 ||
      (n.hand && n.hand !== a.hand)
    )
      return false;
    const x = n.kind === "double" ? (a.hand === "left" ? 0.32 : 0.68) : n.x;
    const d = segmentDistance(
      a.prevX ?? a.x!,
      a.prevY ?? a.y!,
      a.x!,
      a.y!,
      x,
      n.y,
    );
    if (d > 0.13) return false;
    if (n.kind === "slash") {
      const mag = Math.hypot(a.dx ?? 0, a.dy ?? 0);
      if ((a.speed ?? 0) < 0.45 || mag < 0.001) return false;
      const dot = ((a.dx ?? 0) * (n.dx ?? 0) + (a.dy ?? 0) * (n.dy ?? 0)) / mag;
      if (dot < Math.SQRT1_2) return false;
    }
    return true;
  }
}
export function validateChart(chart: Chart) {
  const errors: string[] = [];
  const ids = new Set();
  const zs = chart.notes.filter((n) => n.kind === "pulse" || n.kind === "step");
  for (const n of chart.notes) {
    if (ids.has(n.id)) errors.push(`重复ID ${n.id}`);
    ids.add(n.id);
    if (n.time < 0 || n.time > chart.duration - 0.5)
      errors.push(`音符超时 ${n.id}`);
    if (n.kind === "step" && !n.direction) errors.push(`缺失方向 ${n.id}`);
    if (n.kind === "pulse" && n.direction) errors.push(`Z0 带方向 ${n.id}`);
  }
  for (let i = 0; i < zs.length; i++) {
    if (i && zs[i].time - zs[i - 1].time < 3) errors.push("Z间隔不足");
    for (const n of chart.notes)
      if (
        n.id !== zs[i].id &&
        n.time >= zs[i].time - 0.5 &&
        n.time <= zs[i].time + 1
      )
        errors.push(`Z恢复区冲突 ${n.id}`);
  }
  return errors;
}
