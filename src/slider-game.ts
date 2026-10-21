import { BodyGame, type Block, type BodyJudgement } from "./body-game";
import { sliderProgress } from "./slider";
import type { PalmFrame } from "./palm";
export class SliderGame extends BodyGame {
  palms: PalmFrame[] = [];
  pushPalms(frame: PalmFrame) {
    if (this.palms.length && frame.effective <= this.palms.at(-1)!.effective)
      return;
    this.palms.push(frame);
    while (
      this.palms.length > 2 &&
      this.palms[1].effective < frame.effective - 4
    )
      this.palms.shift();
  }
  progress(block: Block, time: number) {
    return sliderProgress(this.palms, block, time);
  }
  evaluate(
    block: Block,
    time: number,
  ): Omit<BodyJudgement, "id" | "round" | "block" | "judgedAt"> {
    if (block.kind !== "palm") return super.evaluate(block, time);
    const p = this.progress(block, block.time);
    const grade = p.technical
      ? "Protected"
      : p.coverage >= 0.95 - 1e-7
        ? "Perfect"
        : p.coverage >= 0.85 - 1e-7
          ? "Great"
          : p.coverage >= 0.65 - 1e-7
            ? "Good"
            : "Miss";
    return {
      grade,
      error: null,
      factor:
        grade === "Perfect"
          ? 1
          : grade === "Great"
            ? 0.8
            : grade === "Good"
              ? 0.5
              : 0,
      state: null,
      held: p.held,
      coverage: p.coverage,
      reason: p.reason,
    };
  }
  rewind(from: number) {
    super.rewind(from);
    this.palms = [];
  }
  get palmsCompleted() {
    return [...this.results.values()].filter(
      (j) =>
        j.block.kind === "palm" &&
        (j.grade === "Perfect" || j.grade === "Great"),
    ).length;
  }
}
