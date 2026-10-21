import type { Block } from "./body-game";
import type { Hand, PalmFrame, PalmProgress, PalmPose } from "./palm";
export const SLIDER_RULE = "body-slider-1.6.0";
export const SLIDER_RADIUS = 0.2;
export interface SliderProgress extends PalmProgress {
  coverage: number;
  unknown: number;
  touching: boolean;
  hand: Hand | null;
  elapsed: number;
}
export function sliderHandX(p: PalmPose) {
  return Number.isFinite(p.laneX) ? p.laneX! : null;
}
export function sliderProgress(
  states: PalmFrame[],
  note: Block,
  at: number,
): SliderProgress {
  const start = note.sliderStart!,
    end = note.time,
    to = Math.min(at, end),
    duration = note.hold!,
    elapsed = Math.max(0, to - start);
  const allowed: Hand[] =
    note.x < 0 ? ["left"] : note.x > 0 ? ["right"] : ["left", "right"];
  const perHand = (hand: Hand): SliderProgress => {
    let held = 0,
      unknown = 0,
      current: PalmFrame | null = null,
      cursor = start;
    const apply = (until: number) => {
      if (until <= cursor) return;
      if (!current) {
        unknown += until - cursor;
        cursor = until;
        return;
      }
      const pose = current[hand],
        x = sliderHandX(pose);
      const freshTo = Math.min(until, current.captured + 0.18);
      const reliable =
        pose.reliable &&
        x !== null &&
        current.effective - current.captured <= 0.1800001 &&
        current.captured <= current.effective + 0.001;
      const valid = reliable ? Math.max(0, freshTo - cursor) : 0;
      if (pose.raised && x !== null && Math.abs(x - note.x) <= SLIDER_RADIUS)
        held += valid;
      unknown += until - cursor - valid;
      cursor = until;
    };
    for (const f of states) {
      if (f.effective > to) break;
      if (f.effective <= start) {
        current = f;
        continue;
      }
      apply(f.effective);
      current = f;
    }
    if (elapsed > 0) apply(to);
    let latest: PalmFrame | null = null;
    for (let i = states.length - 1; i >= 0; i--)
      if (states[i].effective <= at) {
        latest = states[i];
        break;
      }
    const p = latest?.[hand],
      x = p ? sliderHandX(p) : null;
    const fresh =
      !!latest &&
      at - latest.captured <= 0.1800001 &&
      at - latest.captured >= -0.001 &&
      at >= latest.effective;
    const touching =
      !!p &&
      p.reliable &&
      p.raised &&
      fresh &&
      x !== null &&
      Math.abs(x - note.x) <= SLIDER_RADIUS;
    const coverage = duration ? held / duration : 0,
      ready = at >= end && coverage >= 0.85 - 1e-7;
    const technical =
      !ready &&
      (elapsed
        ? unknown / Math.max(elapsed, 0.001) > 0.2
        : !p?.reliable || !fresh);
    return {
      held,
      progress: Math.min(1, coverage),
      ready,
      technical,
      coverage,
      unknown,
      touching,
      hand,
      elapsed,
      reason:
        at < start
          ? "手掌对准上方光带"
          : technical
            ? !fresh
              ? "等待新鲜手部画面"
              : p?.reason || "等待手掌输入"
            : !p?.raised
              ? p?.reason || "举起并张开手掌"
              : touching
                ? "保持到长条结束"
                : "把手掌移到上方亮起的轨道",
    };
  };
  const candidates = allowed
    .map(perHand)
    .sort(
      (a, b) =>
        b.held - a.held ||
        Number(b.touching) - Number(a.touching) ||
        a.unknown - b.unknown,
    );
  const best = candidates[0];
  if (
    note.x === 0 &&
    !best.ready &&
    candidates.some((p) => p.unknown / Math.max(p.elapsed, 0.001) > 0.2)
  )
    return {
      ...best,
      technical: true,
      reason: candidates.find((p) => p.technical)?.reason || "等待手掌输入",
    };
  return best;
}
