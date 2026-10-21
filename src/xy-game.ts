import { Game } from "./game";
import type { Action, Grade, Judgement, Note } from "./types";
export const XY_RULE = "xy-1.3.0";
export const XY_RADIUS = 0.07;
export const XY_WINDOW = 0.26;
export const XY_BUFFER = 0.25;
const factor = (g: Grade) =>
  g === "Perfect" ? 1 : g === "Great" ? 0.8 : g === "Good" ? 0.5 : 0;
export function xyGrade(error: number): Grade {
  return error <= 0.1000001 ? "Perfect" : error <= 0.1800001 ? "Great" : "Good";
}
// First observed segment intersection with a fixed XY target; not callback arrival.
export function crossing(a: Action, x: number, y: number, r = XY_RADIUS) {
  const ax = a.prevX ?? a.x!,
    ay = a.prevY ?? a.y!,
    dx = a.x! - ax,
    dy = a.y! - ay;
  const ox = ax - x,
    oy = ay - y,
    A = dx * dx + dy * dy,
    B = 2 * (ox * dx + oy * dy),
    C = ox * ox + oy * oy - r * r;
  if (A < 1e-9) return null;
  let u = 0;
  if (C > 0) {
    const D = B * B - 4 * A * C;
    if (D < 0) return null;
    u = (-B - Math.sqrt(D)) / (2 * A);
    if (u < 0 || u > 1) return null;
  }
  return (a.prevTime ?? a.time) + (a.time - (a.prevTime ?? a.time)) * u;
}
export class XYGame extends Game {
  hits = new Map<string, Map<string, { time: number; factor: number }>>();
  get accuracy() {
    return (
      (100 * [...this.results.values()].reduce((s, j) => s + j.factor, 0)) /
      this.chart.notes.length
    );
  }
  window() {
    return XY_WINDOW;
  }
  private commit(
    n: Note,
    grade: Grade,
    error = 0,
    action?: string,
    value = factor(grade),
  ) {
    if (this.results.has(n.id)) return;
    const j: Judgement = { note: n, grade, error, action, factor: value };
    this.results.set(n.id, j);
    if (grade === "Perfect" || grade === "Great") {
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    } else this.combo = 0;
    if (grade === "Protected") this.assisted = true;
    this.onJudge(j);
  }
  consume(a: Action) {
    if (
      a.kind !== "hand" ||
      a.confidence < 0.65 ||
      !a.hand ||
      this.consumed.has(a.id) ||
      (a.speed ?? 0) < 0.3 ||
      Math.hypot(a.dx ?? 0, a.dy ?? 0) < 0.035
    )
      return;
    const candidates = this.chart.notes
      .flatMap((n) => {
        if (
          this.results.has(n.id) ||
          (n.hand && n.hand !== a.hand) ||
          this.hits.get(n.id)?.has(a.hand!)
        )
          return [];
        const x = n.kind === "double" ? (a.hand === "left" ? 0.32 : 0.68) : n.x;
        const time = crossing(a, x, n.y);
        if (time === null || Math.abs(time - n.time) > XY_WINDOW + 1e-9)
          return [];
        return [{ n, time, error: time - n.time }];
      })
      .sort(
        (a, b) => Math.abs(a.error) - Math.abs(b.error) || a.n.time - b.n.time,
      );
    const hit = candidates[0];
    if (!hit) return;
    this.consumed.add(a.id);
    const { n, time, error } = hit,
      grade = xyGrade(Math.abs(error));
    if (n.kind !== "double") {
      this.commit(n, grade, error, a.id);
      return;
    }
    const pair = this.hits.get(n.id) ?? new Map();
    this.hits.set(n.id, pair);
    pair.set(a.hand, { time, factor: factor(grade) });
    if (pair.size < 2) return;
    const [left, right] = [pair.get("left")!, pair.get("right")!];
    const maxError = Math.max(
      Math.abs(left.time - n.time),
      Math.abs(right.time - n.time),
    );
    if (Math.abs(left.time - right.time) > 0.1400001) {
      this.commit(
        n,
        "Miss",
        maxError,
        a.id,
        Math.max(left.factor, right.factor) / 2,
      );
      return;
    }
    this.commit(n, xyGrade(maxError), maxError, a.id);
  }
  tick(time: number) {
    for (const n of this.chart.notes)
      if (!this.results.has(n.id) && time > n.time + XY_WINDOW + XY_BUFFER) {
        const p = this.hits.get(n.id);
        const partial = p
          ? [...p.values()].reduce((s, h) => s + h.factor / 2, 0)
          : 0;
        this.commit(n, "Miss", 0, undefined, partial);
      }
  }
  protect(from: number, to: number) {
    for (const n of this.chart.notes)
      if (n.time >= from && n.time <= to) this.commit(n, "Protected");
    this.assisted = true;
  }
  protectHand(from: number, to: number, hand: "left" | "right") {
    for (const n of this.chart.notes)
      if (n.time >= from && n.time <= to && (!n.hand || n.hand === hand))
        this.commit(n, "Protected");
  }
  rewind(from: number) {
    for (const [id, r] of this.results)
      if (r.note.time >= from) this.results.delete(id);
    this.hits.clear();
    this.consumed.clear();
    this.combo = 0;
    this.maxCombo = 0;
    for (const r of [...this.results.values()].sort(
      (a, b) => a.note.time - b.note.time,
    )) {
      this.combo =
        r.grade === "Perfect" || r.grade === "Great" ? this.combo + 1 : 0;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    this.assisted = true;
  }
}
