import type {
  Point,
  Action,
  Calibration,
  MotionFrame,
  Direction,
} from "./types";
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const CALIBRATION_CONFIDENCE = 0.65;
export const KEY_JOINTS = [
  { id: 11, label: "左肩" },
  { id: 12, label: "右肩" },
  { id: 23, label: "左髋" },
  { id: 24, label: "右髋" },
] as const;
export function jointStatus(
  p: Point | undefined,
  threshold = CALIBRATION_CONFIDENCE,
): "missing" | "outside" | "uncertain" | "ready" {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return "missing";
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return "outside";
  if (
    (p.visibility ?? 0) < threshold ||
    (p.presence !== undefined && p.presence < threshold)
  )
    return "uncertain";
  return "ready";
}
export function inspectPose(points: Point[]) {
  const joints = KEY_JOINTS.map((j) => ({
    ...j,
    status: jointStatus(points[j.id]),
    visibility: points[j.id]?.visibility ?? 0,
    presence: points[j.id]?.presence,
  }));
  const shoulderReady = joints.slice(0, 2).every((j) => j.status === "ready");
  const fullReady = joints.every((j) => j.status === "ready");
  const failures = joints.filter((j) => j.status !== "ready");
  const reason =
    points.length === 0
      ? "未检测到人体，请进入镜头范围"
      : failures.length
        ? failures
            .map(
              (j) =>
                `${j.label}${j.status === "outside" ? "在画面外" : j.status === "missing" ? "无数据" : `置信度不足（${Math.round(Math.min(j.visibility, j.presence ?? 1) * 100)}%）`}`,
            )
            .join("、")
        : "双肩双髋可用";
  return { joints, shoulderReady, fullReady, reason };
}
export function shoulderMeasures(p: Point[]) {
  if (!inspectPose(p).shoulderReady) return null;
  const shoulder = dist(p[11], p[12]),
    top = mid(p[11], p[12]);
  if (shoulder < 0.025) return null;
  return { shoulder, centerX: top.x, centerY: top.y + shoulder * 0.35 };
}
export function bodyMeasures(p: Point[]) {
  if (!inspectPose(p).fullReady) return null;
  const upper = shoulderMeasures(p);
  if (!upper) return null;
  const shoulder = upper.shoulder,
    hip = dist(p[23], p[24]);
  const top = mid(p[11], p[12]),
    bottom = mid(p[23], p[24]);
  const torso = dist(top, bottom);
  if (hip < 0.015 || torso < 0.03) return null;
  return {
    shoulder,
    hip,
    torso,
    centerX: (top.x + bottom.x) / 2,
    centerY: top.y + torso * 0.25,
    ratio: shoulder / torso,
    tilt: Math.abs(top.x - bottom.x) / torso,
  };
}
export function makeCalibration(
  frames: Point[][],
  profile: "full-body" | "upper-body" = "full-body",
): Calibration | null {
  if (profile === "upper-body") {
    const v = frames.map(shoulderMeasures).filter((x) => x !== null);
    if (v.length < 20) return null;
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const shoulder = median(v.map((x) => x.shoulder));
    return {
      version: "motion-0.2",
      profile,
      centerX: median(v.map((x) => x.centerX)),
      centerY: median(v.map((x) => x.centerY)),
      shoulder,
      hip: 0,
      torso: 0,
      ratio: 0,
      reachX: shoulder * 2.1,
      reachY: shoulder * 3,
      z0: false,
      z1: false,
      threshold: 0.035,
    };
  }
  const v = frames.map(bodyMeasures).filter((x) => x !== null);
  if (v.length < 20) return null;
  const med = (k: keyof (typeof v)[number]) =>
    v.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(v.length / 2)];
  return {
    version: "motion-0.2",
    profile,
    centerX: med("centerX"),
    centerY: med("centerY"),
    shoulder: med("shoulder"),
    hip: med("hip"),
    torso: med("torso"),
    ratio: med("ratio"),
    reachX: med("shoulder") * 2.1,
    reachY: med("torso") * 2.6,
    z0: false,
    z1: false,
    threshold: 0.035,
  };
}
// Keep recent usable evidence, instead of restarting every 3s or requiring 40
// raw frames. Invalid/stale observations cannot accumulate into a calibration.
export class CalibrationCapture {
  samples: { points: Point[]; time: number }[] = [];
  add(points: Point[], time: number) {
    const upper = shoulderMeasures(points);
    if (!upper) {
      this.samples = [];
      return;
    }
    const previous = this.samples.at(-1);
    if (previous) {
      const prior = shoulderMeasures(previous.points)!;
      if (
        time - previous.time > 300 ||
        Math.abs(upper.centerX - prior.centerX) > upper.shoulder * 0.12 ||
        Math.abs(upper.centerY - prior.centerY) > upper.shoulder * 0.12 ||
        Math.abs(Math.log(upper.shoulder / prior.shoulder)) > 0.06
      )
        this.samples = [];
    }
    this.samples.push({ points, time });
    this.samples = this.samples.filter((x) => time - x.time <= 4000);
  }
  candidate(profile: "full-body" | "upper-body", now: number) {
    if (!this.samples.length || now - this.samples.at(-1)!.time > 300)
      return null;
    const valid = this.samples.filter((x) =>
      profile === "full-body"
        ? bodyMeasures(x.points)
        : shoulderMeasures(x.points),
    );
    if (valid.length < 20 || valid.at(-1)!.time - valid[0].time < 2000)
      return null;
    return makeCalibration(
      valid.map((x) => x.points),
      profile,
    );
  }
  progress(profile: "full-body" | "upper-body", now: number) {
    const valid = this.samples.filter((x) =>
      profile === "full-body"
        ? bodyMeasures(x.points)
        : shoulderMeasures(x.points),
    );
    if (!valid.length || now - valid.at(-1)!.time > 300) return 0;
    return Math.min(
      1,
      valid.length / 20,
      (valid.at(-1)!.time - valid[0].time) / 2000,
    );
  }
}
export class MotionTracker {
  calibration: Calibration | null = null;
  lastTime = 0;
  filtered = 1;
  anchor = 1;
  lastScale = 1;
  stableSince = 0;
  cooldown = 0;
  candidate = 0;
  candidateSign = 0;
  depthCount = 0;
  phase = "稳定中";
  swayLocked = 0;
  nextId = 0;
  previous: { left: Point | null; right: Point | null } = {
    left: null,
    right: null,
  };
  previousAt = 0;
  handAnchor: { left: Point | null; right: Point | null } = {
    left: null,
    right: null,
  };
  handSince = { left: 0, right: 0 };
  reset(c = this.calibration) {
    this.calibration = c;
    this.lastTime = 0;
    this.filtered = 1;
    this.anchor = 1;
    this.lastScale = 1;
    this.stableSince = 0;
    this.cooldown = 0;
    this.candidate = 0;
    this.previous = { left: null, right: null };
    this.handAnchor = { left: null, right: null };
    this.previousAt = 0;
    this.phase = "稳定中";
  }
  process(points: Point[], time: number, processing = 0): MotionFrame {
    const c = this.calibration,
      m = bodyMeasures(points);
    const upper = shoulderMeasures(points);
    const dt = (time - this.lastTime) / 1000;
    const gap = this.lastTime > 0 && dt > 0.18;
    this.lastTime = time;
    const empty: MotionFrame = {
      points,
      time,
      quality: 0,
      depthQuality: 0,
      scale: this.filtered,
      delta: 0,
      status: "未就绪",
      reason: c
        ? inspectPose(points).reason
        : inspectPose(points).reason + "；先完成站位校准",
      direction: "uncertain",
      hands: { left: null, right: null },
      actions: [],
      confidence: 0,
      processing,
    };
    if (!upper || !c) {
      this.previous = { left: null, right: null };
      this.handAnchor = { left: null, right: null };
      this.candidate = 0;
      this.stableSince = 0;
      this.cooldown = Math.max(this.cooldown, time + 300);
      return empty;
    }
    if (gap) {
      this.previous = { left: null, right: null };
      this.handAnchor = { left: null, right: null };
      this.candidate = 0;
      this.stableSince = 0;
      this.cooldown = Math.max(this.cooldown, time + 300);
      this.phase = "稳定中";
    }
    const actions: Action[] = [];
    const hands: { left: Point | null; right: Point | null } = {
      left: null,
      right: null,
    };
    for (const hand of ["left", "right"] as const) {
      const p = points[hand === "left" ? 15 : 16];
      if (!p || (p.visibility ?? 0) < 0.6) {
        this.previous[hand] = null;
        this.handAnchor[hand] = null;
        continue;
      }
      const h = {
        x: clamp(0.5 + (c.centerX - p.x) / c.reachX, -0.1, 1.1),
        y: clamp(0.5 + (p.y - c.centerY) / c.reachY, -0.1, 1.1),
      };
      hands[hand] = h;
      const prev = this.previous[hand];
      const anchor = this.handAnchor[hand];
      if (prev && dt > 0 && dt < 0.18) {
        const dx = h.x - prev.x,
          dy = h.y - prev.y;
        const moved = !anchor || dist(anchor, h) > 0.065;
        if (moved && time - this.handSince[hand] > 85) {
          actions.push({
            id: `h-${this.nextId++}`,
            time,
            kind: "hand",
            hand,
            x: h.x,
            y: h.y,
            prevX: anchor?.x ?? prev.x,
            prevY: anchor?.y ?? prev.y,
            dx: anchor ? h.x - anchor.x : dx,
            dy: anchor ? h.y - anchor.y : dy,
            speed: Math.hypot(dx, dy) / dt,
            confidence: p.visibility ?? 0,
          });
          this.handAnchor[hand] = h;
          this.handSince[hand] = time;
        }
      } else this.handAnchor[hand] = h;
      this.previous[hand] = h;
    }
    const side = (upper.centerX - c.centerX) / c.shoulder;
    if (Math.abs(side) > 0.28 && time > this.swayLocked) {
      actions.push({
        id: `s-${this.nextId++}`,
        time,
        kind: "sway",
        confidence: Math.min(
          points[11].visibility ?? 0,
          points[12].visibility ?? 0,
        ),
      });
      this.swayLocked = time + 1000;
    }
    if (!m || c.profile === "upper-body" || !c.hip || !c.torso) {
      this.candidate = 0;
      this.stableSince = 0;
      this.phase = "未就绪";
      this.cooldown = time + 300;
      return {
        ...empty,
        quality: 1,
        hands,
        actions,
        status: "上半身可用 · Z未就绪",
        reason:
          c.profile === "upper-body"
            ? "上半身 XY 模式；Z需要双肩双髋重新校准"
            : inspectPose(points).reason,
      };
    }
    const scales = [m.shoulder / c.shoulder, m.hip / c.hip, m.torso / c.torso];
    const raw = [...scales].sort((a, b) => a - b)[1];
    const disagreement = Math.max(...scales) - Math.min(...scales);
    const ratioChange = Math.abs(m.ratio / c.ratio - 1);
    const reason =
      m.tilt > 0.36
        ? "身体倾斜"
        : ratioChange > 0.23
          ? "转身或弯腰"
          : disagreement > 0.24
            ? "尺度证据不一致"
            : raw < 0.65 || raw > 1.6
              ? "请回到舒适范围"
              : "";
    const confidence = clamp(1 - disagreement * 2 - ratioChange);
    const alpha = 1 - Math.exp(-Math.max(0.001, dt) / 0.07);
    this.filtered += alpha * (raw - this.filtered);
    const velocity = dt > 0 ? Math.abs(this.filtered - this.lastScale) / dt : 0;
    this.lastScale = this.filtered;
    const delta = Math.log(this.filtered / this.anchor);
    let direction: Direction | "uncertain" | "stable" = "stable";
    if (reason || confidence < 0.65) {
      this.candidate = 0;
      this.stableSince = 0;
      this.phase = "不确定";
      direction = "uncertain";
    } else if (time < this.cooldown) {
      this.phase = "恢复锁定";
      this.candidate = 0;
      this.stableSince = 0;
    } else if (
      this.phase === "恢复锁定" ||
      this.phase === "稳定中" ||
      this.phase === "不确定" ||
      this.phase === "未就绪"
    ) {
      if (velocity < 0.07) {
        if (!this.stableSince) this.stableSince = time;
        if (time - this.stableSince >= 300) {
          this.anchor = this.filtered;
          this.phase = "可触发";
          this.stableSince = 0;
        }
      } else this.stableSince = 0;
    } else if (Math.abs(delta) > c.threshold) {
      const sign = Math.sign(delta);
      direction =
        confidence >= 0.75
          ? sign > 0
            ? "toward_camera"
            : "away_from_camera"
          : "uncertain";
      if (!this.candidate || sign !== this.candidateSign) {
        this.candidate = time;
        this.candidateSign = sign;
      }
      this.phase = "移动确认";
      if (time - this.candidate >= 120) {
        actions.push({
          id: `z-${this.nextId++}`,
          time: this.candidate,
          kind: "depth",
          direction:
            direction === "uncertain" ? undefined : (direction as Direction),
          directionConfidence: confidence,
          confidence,
        });
        this.depthCount++;
        this.cooldown = time + 1000;
        this.phase = "恢复锁定";
        this.candidate = 0;
      }
    } else {
      this.candidate = 0;
      this.phase = "可触发";
    }
    return {
      points,
      time,
      quality: 1,
      depthQuality: reason || confidence < 0.65 ? 0 : 1,
      scale: this.filtered,
      delta,
      status: this.phase,
      reason,
      direction,
      hands,
      actions,
      confidence,
      processing,
    };
  }
}
