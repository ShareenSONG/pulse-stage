import { BodyGame, type Block, type BodyJudgement } from "./body-game";
import { palmProgress, type PalmFrame, type PalmProgress } from "./palm";
export const PALM_RULE = "body-palm-1.5.0";
export class PalmGame extends BodyGame {
  palms: PalmFrame[] = [];
  charges = new Map<string, { at: number; held: number }>();
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
  progress(block: Block, time: number): PalmProgress {
    const charge = this.charges.get(block.id);
    if (charge && charge.at <= time)
      return {
        held: charge.held,
        progress: 1,
        ready: true,
        technical: false,
        reason: "充能完成",
      };
    return palmProgress(
      this.palms,
      block.hand!,
      block.time - this.chart.leadTime,
      time,
      block.hold,
    );
  }
  tick(time: number) {
    for (const block of this.chart.events) {
      if (
        block.kind !== "palm" ||
        this.results.has(block.id) ||
        this.charges.has(block.id) ||
        time < block.time - this.chart.leadTime
      )
        continue;
      const at = Math.min(time, block.time),
        p = this.progress(block, at);
      if (p.ready) this.charges.set(block.id, { at, held: p.held });
    }
    super.tick(time);
  }
  evaluate(
    block: Block,
    time: number,
  ): Omit<BodyJudgement, "id" | "round" | "block" | "judgedAt"> {
    if (block.kind !== "palm") return super.evaluate(block, time);
    const p = this.progress(block, block.time);
    const grade = p.technical ? "Protected" : p.ready ? "Perfect" : "Miss";
    return {
      grade,
      error: null,
      held: p.held,
      chargedAt: this.charges.get(block.id)?.at,
      factor: grade === "Perfect" ? 1 : 0,
      state: null,
      reason: p.reason,
    };
  }
  rewind(from: number) {
    super.rewind(from);
    this.palms = [];
    for (const b of this.chart.events)
      if (b.time >= from) this.charges.delete(b.id);
  }
  get palmsCompleted() {
    return [...this.results.values()].filter(
      (j) => j.block.kind === "palm" && j.factor > 0,
    ).length;
  }
}
