import type { SliderGame } from "./slider-game";
import type { BodyJudgement } from "./body-game";
import { clamp } from "./body";
export type Shake = "off" | "light" | "standard";
export function impactPreset(accent: boolean, setting: Shake, low: boolean) {
  return {
    amplitude:
      setting === "off"
        ? 0
        : (accent ? 5 : 2.5) *
          (setting === "light" ? 0.45 : 1) *
          (low ? 0.6 : 1),
    duration: accent ? 120 : 80,
  };
}
export class BodyStage {
  canvas = document.createElement("canvas");
  ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;
  active = false;
  low = false;
  shake: Shake = "standard";
  time = 0;
  x = 0;
  reliable = true;
  visiblePilot = true;
  fps = 60;
  game: SliderGame | null = null;
  bursts: { j: BodyJudgement; at: number; shown: boolean }[] = [];
  onVisual: (id: string, musicTime: number) => void = () => {};
  last = 0;
  turn = 0;
  oldX = 0;
  constructor(host: HTMLElement) {
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    const d = Math.min(devicePixelRatio, 2);
    this.canvas.width = this.width * d;
    this.canvas.height = this.height * d;
    this.canvas.style.width = this.width + "px";
    this.canvas.style.height = this.height + "px";
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  clear() {
    this.bursts = [];
    this.turn = 0;
  }
  flash(j: BodyJudgement) {
    this.bursts.push({ j, at: performance.now(), shown: false });
  }
  draw(now: number) {
    const c = this.ctx,
      w = this.width,
      h = this.height,
      t = this.active ? Math.max(0, this.time) : now / 1000;
    if (this.last)
      this.fps =
        this.fps * 0.95 + Math.min(120, 1000 / (now - this.last)) * 0.05;
    this.last = now;
    const mid = this.active ? w * 0.5 : w * 0.6,
      hy = h * (this.active ? 0.29 : 0.45),
      line = h * 0.78,
      half = Math.min(w * 0.34, 520),
      roadBottom = h * 1.12;
    const point = (x: number, z: number) => ({
      x: mid + x * half * z,
      y: hy + (line - hy) * z,
    });
    c.clearRect(0, 0, w, h);
    const bg = c.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#070b1b");
    bg.addColorStop(0.55, "#0c1422");
    bg.addColorStop(1, "#090e1c");
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const halo = c.createRadialGradient(mid, hy, 0, mid, hy, w * 0.55);
    halo.addColorStop(0, "#29506c30");
    halo.addColorStop(0.4, "#17355822");
    halo.addColorStop(1, "#0000");
    c.fillStyle = halo;
    c.fillRect(0, 0, w, h);
    // Sparse stars and music instrument. These are decorative, never hit feedback.
    for (let i = 0; i < 70; i++) {
      const x = ((((Math.sin(i * 127.1) * 43758.5453) % 1) + 1) % 1) * w,
        y = ((((Math.cos(i * 31.3) * 5353) % 1) + 1) % 1) * h * 0.65;
      c.fillStyle = i % 3 ? "#8293c048" : "#83e8ff88";
      c.fillRect(x, y, i % 9 ? 1 : 2, i % 9 ? 1 : 2);
    }
    const radius = Math.min(
        w * (this.active ? 0.11 : 0.16),
        h * (this.active ? 0.19 : 0.25),
      ),
      pulse = this.low ? 0 : Math.exp(-(t % 0.5) * 15);
    c.save();
    c.translate(mid, hy - 20);
    c.strokeStyle = "#7eacc23b";
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(0, 0, radius * 1.55, radius * 0.38, -0.25, 0, Math.PI * 2);
    c.stroke();
    c.rotate(-Math.PI / 2);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2,
        v = 8 + (1 + Math.sin(i * 0.7 + t * 2)) * 8 + pulse * 9;
      c.strokeStyle = i % 8 === 0 ? "#b7dce9" : "#6c91a15a";
      c.lineWidth = i % 8 === 0 ? 3 : 1.5;
      c.beginPath();
      c.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
      c.lineTo(Math.cos(a) * (radius + v), Math.sin(a) * (radius + v));
      c.stroke();
    }
    c.restore();
    // Stage architecture: equalizer pylons frame the arena without covering notes.
    if (!this.low) {
      for (const side of [-1, 1])
        for (let i = 0; i < 9; i++) {
          const z = 0.16 + (i / 9) * 1.18;
          const p = point(side * 1.38, z),
            width = 15 + z * 14;
          const height =
            (22 + z * 100) * (1 + pulse * 0.1 + Math.sin(t * 1.5 + i) * 0.06);
          const g = c.createLinearGradient(0, p.y - height, 0, p.y + 30);
          g.addColorStop(0, side < 0 ? "#83d7e442" : "#c5a3e33a");
          g.addColorStop(1, "#17283700");
          c.fillStyle = g;
          c.beginPath();
          c.moveTo(p.x - width / 2, p.y);
          c.lineTo(p.x - width / 2, p.y - height);
          c.lineTo(p.x + width / 2, p.y - height - 10 * z);
          c.lineTo(p.x + width / 2, p.y);
          c.fill();
          c.strokeStyle = side < 0 ? "#9fe6ec25" : "#d7b2e825";
          c.beginPath();
          c.moveTo(p.x - width / 2, p.y - height);
          c.lineTo(p.x + width / 2, p.y - height - 10 * z);
          c.stroke();
        }
      if (!this.active) {
        c.save();
        c.translate(mid, hy - 20);
        for (const size of [1.35, 1.6]) {
          c.strokeStyle = "#b6d5e113";
          c.lineWidth = 1;
          c.beginPath();
          c.arc(0, 0, radius * size, 0, Math.PI * 2);
          c.stroke();
        }
        // Rotating crystal belongs to the in-game stage, not a static placeholder.
        const r = radius * 0.48,
          a = t * 0.24;
        const vertices = [
          { x: 0, y: -r },
          { x: 0, y: r },
          ...[0, 1, 2, 3].map((i) => ({
            x: Math.cos(a + (i * Math.PI) / 2) * r * 0.82,
            y: Math.sin(a + (i * Math.PI) / 2) * r * 0.32,
          })),
        ];
        c.lineWidth = 1;
        c.strokeStyle = "#c2c5f164";
        for (let i = 2; i < 6; i++)
          for (const j of [0, 1, i === 5 ? 2 : i + 1]) {
            c.beginPath();
            c.moveTo(vertices[i].x, vertices[i].y);
            c.lineTo(vertices[j].x, vertices[j].y);
            c.stroke();
          }
        c.fillStyle = "#8cd5ec17";
        c.beginPath();
        c.moveTo(vertices[0].x, vertices[0].y);
        c.lineTo(vertices[2].x, vertices[2].y);
        c.lineTo(vertices[3].x, vertices[3].y);
        c.closePath();
        c.fill();
        c.restore();
      }
    }
    c.textAlign = "center";
    // Fixed road and hit line: never transformed by impact shake.
    c.beginPath();
    c.moveTo(mid - 12, hy);
    c.lineTo(mid + 12, hy);
    c.lineTo(mid + half * 1.65, roadBottom);
    c.lineTo(mid - half * 1.65, roadBottom);
    c.closePath();
    const rg = c.createLinearGradient(0, hy, 0, h);
    rg.addColorStop(0, "#1a1a3b00");
    rg.addColorStop(1, "#132945a0");
    c.fillStyle = rg;
    c.fill();
    for (const x of [-1, -0.325, 0.325, 1]) {
      const p = point(x, 1.7);
      c.strokeStyle = Math.abs(x) === 1 ? "#8a63ff7a" : "#7e74bb25";
      c.lineWidth = Math.abs(x) === 1 ? 2 : 1;
      c.beginPath();
      c.moveTo(mid + x * 8, hy);
      c.lineTo(p.x, p.y);
      c.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const z = ((i / 12 + ((t * 0.22) % 1)) % 1) ** 2 * 1.7,
        p = point(-1, z),
        q = point(1, z);
      c.strokeStyle = `rgba(112,130,210,${z * 0.12})`;
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
    }
    c.strokeStyle = "#b5eaff66";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(mid - half, line);
    c.lineTo(mid + half, line);
    c.stroke();
    for (const x of [-0.65, 0, 0.65]) {
      const p = point(x, 1);
      c.fillStyle = "#aaa6db65";
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    if (this.active && this.game) {
      const upcoming = this.game.chart.events
        .filter(
          (b) =>
            b.kind !== "palm" &&
            !this.game!.results.has(b.id) &&
            b.time - this.time <= this.game!.chart.leadTime &&
            b.time - this.time >= -0.05,
        )
        .sort((a, b) => b.time - a.time);
      for (const b of upcoming) {
        const d = clamp(
            1 - (b.time - this.time) / this.game.chart.leadTime,
            0,
            1,
          ),
          z = 0.055 + 0.945 * d * d,
          p = point(b.x, z),
          bw = half * b.halfWidth * z,
          bh = Math.max(4, 24 * z),
          deep = 9 * z;
        const color = b.accent ? "#ffd689" : "#d58dff";
        c.save();
        c.shadowColor = color;
        c.shadowBlur = this.low ? 0 : 12 * z;
        c.fillStyle = b.accent ? "#806349" : "#614394";
        c.strokeStyle = color;
        c.lineWidth = 1.4;
        c.beginPath();
        c.rect(p.x - bw, p.y - bh, bw * 2, bh);
        c.fill();
        c.stroke();
        c.fillStyle = b.accent ? "#ffe1a660" : "#d7acff60";
        c.beginPath();
        c.moveTo(p.x - bw, p.y - bh);
        c.lineTo(p.x - bw + deep, p.y - bh - deep);
        c.lineTo(p.x + bw + deep, p.y - bh - deep);
        c.lineTo(p.x + bw, p.y - bh);
        c.closePath();
        c.fill();
        c.stroke();
        c.shadowBlur = 0;
        c.strokeStyle = "#fff9";
        c.beginPath();
        c.moveTo(p.x - bw * 0.4, p.y - bh * 0.5);
        c.lineTo(p.x + bw * 0.4, p.y - bh * 0.5);
        c.stroke();
        c.restore();
      }
    }
    this.bursts = this.bursts.filter((b) => now - b.at < 800);
    for (const b of this.bursts)
      if (!b.shown) {
        b.shown = true;
        this.onVisual(b.j.id, this.time);
      }
    const success = this.bursts.filter(
        (b) => b.j.factor > 0 && b.j.block.kind !== "palm",
      ),
      latest = success.at(-1);
    let sx = 0,
      sy = 0,
      press = 0;
    if (latest) {
      const age = now - latest.at,
        preset = impactPreset(latest.j.block.accent, this.shake, this.low),
        d = clamp(1 - age / preset.duration, 0, 1);
      sx = Math.sin(age * 0.16) * preset.amplitude * d;
      sy = Math.cos(age * 0.2) * preset.amplitude * d * 0.5;
      press = Math.sin(clamp(age / 220, 0, 1) * Math.PI) * 0.2;
    }
    for (const { j, at } of success) {
      const age = (now - at) / 1000,
        p = point(j.block.x, 1),
        a = clamp(1 - age / 0.65, 0, 1),
        color = j.block.accent ? "255,215,146" : "150,222,255";
      if (!this.low) {
        const glow = c.createRadialGradient(
          p.x,
          p.y,
          0,
          p.x,
          p.y,
          90 + age * 110,
        );
        glow.addColorStop(0, `rgba(${color},${a * 0.18})`);
        glow.addColorStop(1, `rgba(${color},0)`);
        c.fillStyle = glow;
        c.fillRect(p.x - 200, p.y - 200, 400, 400);
        c.strokeStyle = `rgba(${color},${a * 0.35})`;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(p.x - 40 - age * 60, p.y + 8);
        c.lineTo(p.x, p.y - 80 - age * 60);
        c.lineTo(p.x + 40 + age * 60, p.y + 8);
        c.stroke();
      }
      c.save();
      c.translate(sx, sy);
      c.strokeStyle = `rgba(${color},${a * 0.7})`;
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(p.x, p.y, 12 + age * 130, 3 + age * 32, 0, 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < (this.low ? 6 : 16); i++) {
        const angle = i * 2.399,
          size = 3 * (1 - age);
        c.fillStyle = `rgba(${color},${a})`;
        c.save();
        c.translate(
          p.x + Math.cos(angle) * age * (80 + i * 8),
          p.y - 25 + Math.sin(angle) * age * 90 + age * age * 60,
        );
        c.rotate(angle + age * 5);
        c.fillRect(-size, -size, size * 2, size * 2);
        c.restore();
      }
      c.restore();
    }
    // One ship. Cosmetic shell may recoil; center light is always authoritative.
    const pilot = point(this.active ? this.x : 0, 1);
    this.turn = this.turn * 0.86 + (this.x - this.oldX) * 2;
    this.oldX = this.x;
    c.save();
    c.globalAlpha = !this.active
      ? 1
      : !this.visiblePilot
        ? 0
        : this.reliable
          ? 1
          : 0.4;
    c.translate(pilot.x, pilot.y);
    const trail = c.createLinearGradient(0, 0, 0, 85);
    trail.addColorStop(0, "#7beaffb0");
    trail.addColorStop(1, "#7beaff00");
    c.fillStyle = trail;
    c.beginPath();
    c.moveTo(-10, 10);
    c.lineTo(0, 90 + pulse * 15);
    c.lineTo(10, 10);
    c.fill();
    c.save();
    c.translate(sx, sy);
    c.rotate(clamp(this.turn, -0.14, 0.14));
    c.scale(1 + press * 0.3, 1 - press);
    const sw = half * 0.08;
    c.shadowColor = "#8fefff";
    c.shadowBlur = this.low ? 0 : 18;
    c.fillStyle = "#b9f5ff";
    c.strokeStyle = "#f1ffff";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -28);
    c.lineTo(sw, 9);
    c.lineTo(sw * 0.25, 5);
    c.lineTo(0, 14);
    c.lineTo(-sw * 0.25, 5);
    c.lineTo(-sw, 9);
    c.closePath();
    c.fill();
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = "#35296f";
    c.beginPath();
    c.moveTo(0, -18);
    c.lineTo(sw * 0.3, 5);
    c.lineTo(0, 1);
    c.lineTo(-sw * 0.3, 5);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(0, 0, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
    if (this.active && this.game) {
      const lift = h * 0.22;
      const upper = (x: number, z: number) => {
        const p = point(x, z);
        return { x: p.x, y: p.y - lift * z };
      };
      const nowFrame = this.game.palms
        .filter((f) => f.effective <= this.time)
        .at(-1);
      // Upper rail is a raised copy of the same three lanes. The lower hit line
      // and ship collider remain untouched.
      c.save();
      for (const x of [-0.65, 0, 0.65]) {
        const p = upper(x, 1),
          far = upper(x, 0.06),
          floor = point(x, 1),
          rw = half * 0.15;
        c.strokeStyle = "#a4d8d82c";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(far.x, far.y);
        c.lineTo(p.x, p.y);
        c.stroke();
        c.setLineDash([3, 7]);
        c.strokeStyle = "#b3cbd21c";
        c.beginPath();
        c.moveTo(p.x, p.y + 9);
        c.lineTo(floor.x, floor.y - 25);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = "#10212bce";
        c.strokeStyle = "#b3d7db6b";
        c.lineWidth = 1.4;
        c.beginPath();
        c.roundRect(p.x - rw, p.y - 8, rw * 2, 16, 5);
        c.fill();
        c.stroke();
      }
      c.restore();
      const zAt = (target: number) => {
        const d = clamp(
          1 - (target - this.time) / this.game!.chart.leadTime,
          0,
          1,
        );
        return 0.055 + 0.945 * d * d;
      };
      const sliders = this.game.chart.events.filter(
        (b) =>
          b.kind === "palm" &&
          !this.game!.results.has(b.id) &&
          b.sliderStart! - this.time <= this.game!.chart.leadTime &&
          b.time >= this.time,
      );
      for (const b of sliders) {
        const p = this.game.progress(b, this.time),
          headZ = zAt(b.sliderStart!),
          tailZ = zAt(b.time),
          head = upper(b.x, headZ),
          tail = upper(b.x, tailZ),
          color = b.x < 0 ? "#a2e9dc" : b.x > 0 ? "#f1ce8b" : "#d5f1fa",
          radius = half * 0.12;
        c.save();
        c.shadowColor = color;
        c.shadowBlur = this.low
          ? 0
          : p.touching && this.time >= b.sliderStart!
            ? 20
            : 9;
        c.fillStyle = p.touching ? "#bdeee354" : "#76cfcf33";
        c.strokeStyle = color;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(head.x - radius * headZ, head.y);
        c.lineTo(tail.x - radius * tailZ, tail.y);
        c.lineTo(tail.x + radius * tailZ, tail.y);
        c.lineTo(head.x + radius * headZ, head.y);
        c.closePath();
        c.fill();
        c.stroke();
        // Head cap and tail cap: the ribbon is consumed by the upper hit line.
        c.fillStyle = color;
        c.beginPath();
        c.roundRect(
          head.x - radius * headZ,
          head.y - 5 * headZ,
          radius * headZ * 2,
          10 * headZ,
          3,
        );
        c.fill();
        c.fillRect(tail.x - radius * tailZ, tail.y - 2, radius * tailZ * 2, 4);
        if (this.time >= b.sliderStart!) {
          const target = upper(b.x, 1);
          c.strokeStyle = p.touching ? color : "#c5a3b3";
          c.lineWidth = 3;
          c.beginPath();
          c.ellipse(
            target.x,
            target.y,
            18 + (p.touching ? 3 : 0),
            11,
            0,
            0,
            Math.PI * 2,
          );
          c.stroke();
          if (p.touching) {
            // Sparks appear only for a currently touching, fresh hand.
            c.lineWidth = 2;
            c.beginPath();
            c.arc(
              target.x,
              target.y - 3,
              28,
              -Math.PI / 2,
              -Math.PI / 2 + Math.PI * 2 * p.progress,
            );
            c.stroke();
            if (!this.low)
              for (let i = 0; i < 10; i++) {
                const phase = (this.time * 3 + i * 0.17) % 1,
                  a = i * 2.399;
                c.globalAlpha = 1 - phase;
                c.fillStyle = color;
                c.fillRect(
                  target.x + Math.cos(a) * phase * 54,
                  target.y - 5 - Math.abs(Math.sin(a)) * phase * 48,
                  2,
                  2 + phase * 5,
                );
              }
            c.globalAlpha = 1;
          }
          c.shadowBlur = 0;
          c.font = "15px system-ui";
          c.fillStyle = "#dbe9ef";
          c.fillText(
            p.touching ? "保持…" : "手掌对准光带",
            target.x,
            target.y - 24,
          );
        }
        c.restore();
      }
      // Only fresh, reliable raised hands produce upper-layer control paddles.
      if (nowFrame && this.time - nowFrame.captured <= 0.18)
        for (const hand of ["left", "right"] as const) {
          const pose = nowFrame[hand];
          if (!pose.reliable || !pose.raised || pose.laneX === undefined)
            continue;
          const p = upper(pose.laneX, 1),
            color = hand === "left" ? "#a2e9dc" : "#f1ce8b";
          c.save();
          c.strokeStyle = color;
          c.fillStyle = "#102433";
          c.lineWidth = 2.5;
          c.shadowColor = color;
          c.shadowBlur = this.low ? 0 : 10;
          c.beginPath();
          c.ellipse(p.x, p.y, half * 0.08, 12, 0, 0, Math.PI * 2);
          c.fill();
          c.stroke();
          c.beginPath();
          c.moveTo(p.x - 5, p.y + 2);
          c.lineTo(p.x - 5, p.y - 5);
          c.moveTo(p.x, p.y + 2);
          c.lineTo(p.x, p.y - 7);
          c.moveTo(p.x + 5, p.y + 2);
          c.lineTo(p.x + 5, p.y - 4);
          c.stroke();
          c.shadowBlur = 0;
          c.font = "11px system-ui";
          c.fillStyle = color;
          c.fillText(hand === "left" ? "L" : "R", p.x, p.y + 30);
          c.restore();
        }
      for (const b of this.bursts.filter((b) => b.j.block.kind === "palm")) {
        const a = clamp(1 - (now - b.at) / 650, 0, 1),
          p = upper(b.j.block.x, 1);
        c.save();
        c.globalAlpha = a;
        c.strokeStyle = b.j.factor ? "#d9f6ec" : "#a5a6b5";
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(
          p.x,
          p.y,
          20 + (1 - a) * 60,
          10 + (1 - a) * 25,
          0,
          0,
          Math.PI * 2,
        );
        c.stroke();
        c.fillStyle = c.strokeStyle;
        c.font = "600 18px system-ui";
        c.fillText(
          b.j.grade === "Protected"
            ? "输入保护"
            : b.j.grade === "Good"
              ? "部分接住"
              : b.j.factor
                ? "滑块完成"
                : "滑块错过",
          p.x,
          p.y - 28,
        );
        c.restore();
      }
    }
    const j = this.bursts.at(-1);
    if (j && this.active && j.j.block.kind !== "palm") {
      const a = clamp(1 - (now - j.at) / 750, 0, 1);
      c.globalAlpha = a;
      c.fillStyle =
        j.j.grade === "Miss"
          ? "#b0a1bf"
          : j.j.grade === "Protected"
            ? "#d6b486"
            : "#e5f6ff";
      c.font = "italic 700 25px system-ui";
      c.fillText(
        j.j.grade === "Protected" ? "输入保护" : j.j.grade.toUpperCase(),
        mid,
        line - 95,
      );
      c.globalAlpha = 1;
    }
  }
}
