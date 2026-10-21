import * as THREE from "three";
import type { Chart, Judgement, MotionFrame, Note } from "./types";
import type { Game } from "./game";
import { XY_RADIUS } from "./xy-game";
const LEFT = "#ffd27a",
  RIGHT = "#63e6ff";
export class Stage {
  scene = new THREE.Scene();
  renderer: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
  canvas = document.createElement("canvas");
  ctx: CanvasRenderingContext2D;
  group = new THREE.Group();
  rings: THREE.Mesh[] = [];
  particles: THREE.Points;
  clock = new THREE.Clock();
  width = 1;
  height = 1;
  low = false;
  bursts: {
    x: number;
    y: number;
    color: string;
    born: number;
    text: string;
  }[] = [];
  game: Game | null = null;
  time = 0;
  frame: MotionFrame | null = null;
  active = false;
  fps = 0;
  frameCount = 0;
  window = 0;
  simulationHands: {
    left: { x: number; y: number } | null;
    right: { x: number; y: number } | null;
  } = { left: null, right: null };
  simulationAt = 0;
  traceAt = 0;
  trails: Record<"left" | "right", { x: number; y: number; born: number }[]> = {
    left: [],
    right: [],
  };
  clearTrails() {
    this.trails = { left: [], right: [] };
    this.traceAt = 0;
    this.bursts = [];
  }
  constructor(public host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setClearColor("#070b19", 1);
    this.renderer.domElement.className = "world";
    host.append(this.renderer.domElement);
    this.canvas.className = "notes-layer";
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.scene.fog = new THREE.FogExp2("#070b19", 0.038);
    this.camera.position.set(0, 2.8, 12);
    this.camera.lookAt(0, 1, -12);
    const grid = new THREE.GridHelper(120, 60, "#294761", "#172334");
    grid.position.y = -2;
    grid.position.z = -35;
    this.scene.add(grid);
    const mat = (color: string, opacity = 0.75) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
      });
    for (let i = 0; i < 13; i++) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(6.3 + i * 0.14, 0.018, 6, 100),
        mat(i % 2 ? "#764bbe" : "#3d849d", 0.35),
      );
      r.position.set(0, 2, -i * 6 - 12);
      this.scene.add(r);
      this.rings.push(r);
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 13; i++) {
        const pillar = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 3 + (i % 3), 1.4),
          mat(side === -1 ? LEFT : RIGHT, 0.3),
        );
        pillar.position.set(side * (5.5 + i * 0.3), -0.3, -i * 5);
        this.scene.add(pillar);
      }
    for (const x of [-3, -1.5, 1.5, 3]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.015, 90),
        mat(x < 0 ? LEFT : RIGHT, 0.55),
      );
      line.position.set(x, -1.97, -30);
      this.scene.add(line);
    }
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.6),
      new THREE.MeshBasicMaterial({
        color: "#b3a1ff",
        wireframe: true,
        transparent: true,
        opacity: 0.75,
      }),
    );
    diamond.position.set(0, 2, -5);
    this.group.add(diamond);
    const inner = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.8),
      new THREE.MeshBasicMaterial({
        color: "#48d9f0",
        transparent: true,
        opacity: 0.18,
      }),
    );
    inner.position.copy(diamond.position);
    this.group.add(inner);
    this.scene.add(this.group);
    const positions = new Float32Array(450 * 3);
    let seed = 15;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (rand() - 0.5) * 60;
      positions[i + 1] = (rand() - 0.3) * 30;
      positions[i + 2] = -rand() * 80;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#adc8ff",
        size: 0.055,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.scene.add(this.particles);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    this.renderer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.canvas.width = this.width * Math.min(devicePixelRatio, 2);
    this.canvas.height = this.height * Math.min(devicePixelRatio, 2);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }
  flash(j: Judgement) {
    const n = j.note;
    this.bursts.push({
      x: n.x,
      y: n.y,
      color:
        j.grade === "Miss" || j.grade === "Wrong Direction"
          ? "#e6a6b4"
          : n.hand === "right"
            ? RIGHT
            : LEFT,
      born: performance.now(),
      text:
        j.grade === "Protected"
          ? "识别保护"
          : j.grade === "Wrong Direction"
            ? "方向相反"
            : j.grade.toUpperCase(),
    });
  }
  draw(now: number) {
    const t = now / 1000;
    this.group.visible = !this.active;
    this.group.rotation.z = Math.sin(t * 0.2) * 0.12;
    this.group.children.forEach((m, i) => {
      m.rotation.x = t * (i ? 0.1 : 0.08);
      m.rotation.y = t * (i ? 0.2 : 0.1);
    });
    this.rings.forEach((r, i) => (r.rotation.z = t * 0.015 * (i % 2 ? 1 : -1)));
    this.particles.rotation.y = t * 0.003;
    if (!this.low || this.frameCount % 2 === 0)
      this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    if (now - this.window > 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.window);
      this.frameCount = 0;
      this.window = now;
    }
    const ctx = this.ctx,
      w = this.width,
      h = this.height;
    ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.active || !this.game) return;
    // Visual depth expresses timing only. Collision uses these fixed XY targets.
    const modern = this.game.chart.ruleVersion === "xy-1.3.0";
    ctx.strokeStyle = "#6ad9ff28";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.13, h * 0.76);
    ctx.lineTo(w * 0.87, h * 0.76);
    ctx.stroke();
    if (modern) {
      for (const n of this.game.chart.notes) {
        if (
          this.game.results.has(n.id) ||
          n.time - this.time > 1.7 ||
          n.time - this.time < -0.26
        )
          continue;
        const xs = n.kind === "double" ? [0.32, 0.68] : [n.x];
        for (const x of xs) {
          ctx.strokeStyle =
            (n.kind === "double"
              ? x < 0.5
                ? LEFT
                : RIGHT
              : n.hand === "left"
                ? LEFT
                : RIGHT) + "35";
          ctx.setLineDash([3, 8]);
          ctx.beginPath();
          ctx.ellipse(
            x * w,
            n.y * h,
            XY_RADIUS * w,
            XY_RADIUS * h,
            0,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    for (const n of this.game.chart.notes) {
      if (this.game.results.has(n.id)) continue;
      const dt = n.time - this.time;
      if (dt > 2 || dt < -0.5) continue;
      const scale = Math.max(0.22, 1 - dt * 0.36),
        x = 0.5 + (n.x - 0.5) * scale,
        y = 0.37 + (n.y - 0.37) * scale;
      const size = Math.min(w, h) * 0.05 * scale;
      ctx.save();
      ctx.globalAlpha = dt > 1.5 ? (2 - dt) * 2 : 1;
      this.note(n, x * w, y * h, size, dt);
      ctx.restore();
    }
    const live = this.frame && now - this.frame.time < 250;
    const hands = this.frame
      ? live
        ? this.frame.hands
        : { left: null, right: null }
      : now - this.simulationAt < 220
        ? this.simulationHands
        : { left: null, right: null };
    if (this.frame?.time !== this.traceAt && live) {
      this.traceAt = this.frame!.time;
      for (const hand of ["left", "right"] as const) {
        const p = hands[hand];
        if (p) this.trails[hand].push({ x: p.x, y: p.y, born: now });
        else this.trails[hand] = [];
      }
    }
    for (const hand of ["left", "right"] as const) {
      this.trails[hand] = this.trails[hand].filter((p) => now - p.born < 220);
      const trail = this.trails[hand];
      if (trail.length > 1 && hands[hand]) {
        ctx.strokeStyle = hand === "left" ? LEFT : RIGHT;
        ctx.lineWidth = 5;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = this.low ? 0 : 14;
        for (let i = 1; i < trail.length; i++) {
          if (trail[i].born - trail[i - 1].born > 150) continue;
          ctx.globalAlpha = (i / trail.length) * 0.8;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x * w, trail[i - 1].y * h);
          ctx.lineTo(trail[i].x * w, trail[i].y * h);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
    }
    for (const hand of ["left", "right"] as const) {
      const p = hands[hand];
      if (!p) continue;
      const x = p.x * w,
        y = p.y * h;
      ctx.shadowBlur = this.low ? 0 : 18;
      ctx.shadowColor = hand === "left" ? LEFT : RIGHT;
      ctx.strokeStyle = hand === "left" ? LEFT : RIGHT;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    this.bursts = this.bursts.filter((b) => now - b.born < 650);
    for (const b of this.bursts) {
      const success = !["MISS", "识别保护", "方向相反"].includes(b.text);
      const age = (now - b.born) / 650;
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x * w, b.y * h, 20 + age * 90, 0, Math.PI * 2);
      ctx.stroke();
      if (success) {
        ctx.fillStyle = b.color;
        for (let i = 0; i < (this.low ? 6 : 14); i++) {
          const angle = i * 2.399,
            dist = 20 + age * (70 + (i % 4) * 20);
          ctx.save();
          ctx.translate(
            b.x * w + Math.cos(angle) * dist,
            b.y * h + Math.sin(angle) * dist * 0.7,
          );
          ctx.rotate(angle + age * 3);
          ctx.fillRect(-3, -3, 6 * (1 - age), 6 * (1 - age));
          ctx.restore();
        }
      }
      ctx.fillStyle = b.color;
      ctx.textAlign = "center";
      ctx.font = `italic 800 ${Math.max(18, w * 0.022)}px system-ui`;
      ctx.fillText(b.text, w * 0.5, h * 0.78 - age * 15);
      ctx.globalAlpha = 1;
    }
  }
  note(n: Note, x: number, y: number, r: number, dt: number) {
    const c = this.ctx;
    const color =
      n.kind === "pulse"
        ? "#ffe39b"
        : n.kind === "step"
          ? n.direction === "toward_camera"
            ? "#a5f4d1"
            : "#ffc18b"
          : n.hand === "right"
            ? RIGHT
            : LEFT;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 2.5;
    c.shadowColor = color;
    c.shadowBlur = this.low ? 0 : 15;
    if (n.kind === "double") {
      for (const hx of [0.32, 0.68])
        this.note(
          { ...n, kind: "slash", hand: hx < 0.5 ? "left" : "right" },
          this.width * (0.5 + (hx - 0.5) * Math.max(0.22, 1 - dt * 0.36)),
          y,
          r,
          dt,
        );
      return;
    }
    if (n.kind === "pulse" || n.kind === "step") {
      c.beginPath();
      c.arc(x, y, r * 1.3, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(x, y, r * 0.9, 0, Math.PI * 2);
      c.stroke();
      c.font = `700 ${r * 0.5}px system-ui`;
      c.textAlign = "center";
      c.fillText(
        n.kind === "pulse"
          ? "前后动一下"
          : n.direction === "toward_camera"
            ? "靠近"
            : "远离",
        x,
        y + r * 0.16,
      );
      if (n.kind === "step") {
        const s = n.direction === "toward_camera" ? 1 : -1;
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(x + side * r * 1.6, y - r * 0.3);
          c.lineTo(x + side * r * (1.6 - 0.35 * s), y);
          c.lineTo(x + side * r * 1.6, y + r * 0.3);
          c.stroke();
        }
      }
    } else if (n.kind === "sway") {
      c.font = `800 ${r}px system-ui`;
      c.textAlign = "center";
      c.fillText("↔", x, y + r * 0.3);
      c.font = `600 ${r * 0.4}px system-ui`;
      c.fillText("侧摆", x, y - r);
    } else if (n.kind === "slash") {
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillStyle = color + "22";
      c.fillRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
      c.strokeRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44);
      c.restore();
      c.font = `700 ${r * 0.65}px system-ui`;
      c.textAlign = "center";
      c.fillStyle = color;
      c.fillText(n.hand === "left" ? "L" : "R", x, y + r * 0.22);
    } else {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = color + "35";
      c.fill();
      c.beginPath();
      c.arc(x, y, r * 0.28, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    }
    if (dt >= 0 && dt < 0.5) {
      c.strokeStyle = "#ffffffaa";
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, r * (1 + dt * 1.4), 0, Math.PI * 2);
      c.stroke();
    }
    c.shadowBlur = 0;
  }
}
