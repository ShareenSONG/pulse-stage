import { BODY_MAP, BODY_RULE, type PilotState } from "./body";
export type BodyGrade = "Perfect" | "Great" | "Good" | "Miss" | "Protected";
export interface Block {
  id: string;
  kind?: "body" | "palm";
  hand?: "left" | "right";
  hold?: number;
  sliderStart?: number;
  beat: number;
  time: number;
  x: number;
  halfWidth: number;
  accent: boolean;
  group: string;
}
export interface BodyChart {
  id: string;
  version: string;
  audioVersion: string;
  playStyle: "body-pilot";
  ruleVersion: string;
  mapVersion: string;
  duration: number;
  bpm: number;
  offset: number;
  leadTime: number;
  events: Block[];
}
export interface BodyJudgement {
  id: string;
  round: number;
  block: Block;
  grade: BodyGrade;
  error: number | null;
  factor: number;
  state: PilotState | null;
  reason: string;
  judgedAt: number;
  held?: number;
  coverage?: number;
  chargedAt?: number;
}
export function validateBodyChart(c: BodyChart) {
  const slider = c.ruleVersion === "body-slider-1.6.0";
  const mixed = slider || c.ruleVersion === "body-palm-1.5.0";
  const bodyEvents = c.events.filter((b) => b.kind !== "palm");
  const palmEvents = c.events.filter((b) => b.kind === "palm");
  if (
    c.playStyle !== "body-pilot" ||
    (!mixed && c.ruleVersion !== BODY_RULE) ||
    c.mapVersion !== BODY_MAP ||
    c.duration !== 64 ||
    c.bpm !== 120 ||
    bodyEvents.length !== 60 ||
    (mixed ? palmEvents.length !== 8 : palmEvents.length !== 0) ||
    c.leadTime < 2
  )
    throw Error("身体谱面版本或长度不正确");
  const ids = new Set<string>();
  let previous: Block | null = null;
  let changeAt = -Infinity;
  let lastExtreme: { x: number; time: number } | null = null;
  for (const b of c.events) {
    if (
      ids.has(b.id) ||
      !Number.isFinite(b.time) ||
      !Number.isFinite(b.beat) ||
      Math.abs(b.time - (c.offset + (b.beat * 60) / c.bpm)) > 1e-6 ||
      !Number.isInteger(b.beat) ||
      ![-0.65, 0, 0.65].includes(b.x) ||
      b.halfWidth !== 0.12 ||
      typeof b.accent !== "boolean"
    )
      throw Error("方块字段或拍点不正确");
    ids.add(b.id);
    if (b.kind === "palm") {
      if (
        !mixed ||
        (slider
          ? ![0.5, 1].includes(b.hold!) ||
            !Number.isFinite(b.sliderStart) ||
            Math.abs(b.sliderStart! + b.hold! - b.time) > 1e-6 ||
            !Number.isInteger(b.sliderStart! * 2) ||
            (b.x < 0
              ? b.hand !== "left"
              : b.x > 0
                ? b.hand !== "right"
                : b.hand !== undefined)
          : !["left", "right"].includes(b.hand!) ||
            b.hold !== 0.45 ||
            b.x !== (b.hand === "left" ? -0.65 : 0.65))
      )
        throw Error("掌推字段错误");
      const before = bodyEvents.filter((n) => n.time < b.time - 1.5).at(-1);
      if (
        b.time < 14 ||
        (before && before.x !== 0) ||
        bodyEvents.some(
          (n) => n.time >= b.time - 1.5 && n.time <= b.time + 0.5 && n.x !== 0,
        )
      )
        throw Error("掌推须在居中段落引入");
      continue;
    }
    if (b.kind && b.kind !== "body") throw Error("未知操作");
    if (previous) {
      if (b.time <= previous.time) throw Error("重复或逆序拍点");
      if (b.x !== previous.x) {
        if (
          b.time - previous.time < 1 ||
          b.time - changeAt < 2 ||
          Math.abs(b.x - previous.x) > 1
        )
          throw Error("身体换位过急");
        changeAt = b.time;
      }
    }
    if (b.x !== 0) {
      if (lastExtreme && lastExtreme.x !== b.x && b.time - lastExtreme.time < 3)
        throw Error("横跨跑道余量不足");
      lastExtreme = { x: b.x, time: b.time };
    }
    ids.add(b.id);
    previous = b;
  }
  if (
    c.events.some((b, i) => i > 0 && b.time < c.events[i - 1].time) ||
    palmEvents.some((b, i) => i > 0 && b.time - palmEvents[i - 1].time < 2)
  )
    throw Error("谱面顺序或掌推间隔错误");
  if (c.events[0].time < 2 || c.events.at(-1)!.time > 62.5)
    throw Error("准备或收尾时间不足");
  return c;
}
export class BodyGame {
  states: PilotState[] = [];
  results = new Map<string, BodyJudgement>();
  combo = 0;
  maxCombo = 0;
  assisted = false;
  round = 0;
  onJudge: (j: BodyJudgement) => void = () => {};
  constructor(public chart: BodyChart) {
    validateBodyChart(chart);
  }
  push(state: PilotState) {
    if (this.states.length && state.effective < this.states.at(-1)!.effective)
      return;
    this.states.push({ ...state });
    // Retain 4 seconds plus one predecessor for a delayed render frame.
    const cutoff = state.effective - 4;
    while (this.states.length > 2 && this.states[1].effective < cutoff)
      this.states.shift();
  }
  tick(time: number) {
    for (const block of this.chart.events) {
      if (block.time > time) break;
      if (this.results.has(block.id)) continue;
      const result = this.evaluate(block, time);
      const j: BodyJudgement = {
        id: `${this.round}/${block.id}`,
        round: this.round,
        block,
        judgedAt: time,
        ...result,
      };
      const grade = j.grade;
      if (grade === "Protected") this.assisted = true;
      this.results.set(block.id, j);
      if (grade === "Perfect" || grade === "Great") this.combo++;
      else this.combo = 0;
      this.maxCombo = Math.max(this.combo, this.maxCombo);
      this.onJudge(j);
    }
  }
  evaluate(
    block: Block,
    _time: number,
  ): Omit<BodyJudgement, "id" | "round" | "block" | "judgedAt"> {
    let state: PilotState | null = null;
    for (let i = this.states.length - 1; i >= 0; i--)
      if (this.states[i].effective <= block.time) {
        state = this.states[i];
        break;
      }
    const age = state ? (block.time - state.captured) * 1000 : Infinity;
    const reliable = !!state && state.reliable && age >= -1 && age <= 180;
    const error = reliable ? Math.abs(state!.x - block.x) : null;
    const grade: BodyGrade =
      error === null
        ? "Protected"
        : error <= 0.0600001
          ? "Perfect"
          : error <= 0.1200001
            ? "Great"
            : error <= 0.2000001
              ? "Good"
              : "Miss";
    const factor =
      grade === "Perfect"
        ? 1
        : grade === "Great"
          ? 0.8
          : grade === "Good"
            ? 0.5
            : 0;
    return {
      grade,
      error,
      factor,
      state,
      reason: reliable
        ? ""
        : !state
          ? "无驾驶状态"
          : !state.reliable
            ? state.reason
            : "姿态已过期",
    };
  }
  rewind(from: number) {
    this.round++;
    this.assisted = true;
    this.states = [];
    for (const [id, j] of this.results)
      if (j.block.time >= from) this.results.delete(id);
    this.combo = 0;
    this.maxCombo = 0;
    for (const j of this.results.values()) {
      if (j.grade === "Perfect" || j.grade === "Great") this.combo++;
      else this.combo = 0;
      this.maxCombo = Math.max(this.combo, this.maxCombo);
    }
  }
  get score() {
    return Math.round(
      (1e6 * [...this.results.values()].reduce((a, j) => a + j.factor, 0)) /
        this.chart.events.length,
    );
  }
  get accuracy() {
    return this.score / 10000;
  }
  get counts() {
    const c: Record<BodyGrade, number> = {
      Perfect: 0,
      Great: 0,
      Good: 0,
      Miss: 0,
      Protected: 0,
    };
    for (const j of this.results.values()) c[j.grade]++;
    return c;
  }
  get bands() {
    return [-0.65, 0, 0.65].map((x) => {
      const all = [...this.results.values()].filter(
        (j) => j.block.kind !== "palm" && j.block.x === x,
      );
      return all.length
        ? Math.round((100 * all.reduce((n, j) => n + j.factor, 0)) / all.length)
        : 0;
    });
  }
}
