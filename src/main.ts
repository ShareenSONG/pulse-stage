import "./style.css";
import "./body-style.css";
import "./experience.css";
import { Camera } from "./camera";
import { Music } from "./audio";
import { POSE_MODEL, HAND_MODEL } from "./model";
import { jointStatus } from "./motion";
import {
  BodyController,
  BODY_MAP,
  baseline,
  shoulders,
  median,
  clamp,
  type BodyCalibration,
  type PilotState,
  type ShoulderObservation,
} from "./body";
import { validateBodyChart, type BodyChart } from "./body-game";
import { SliderGame } from "./slider-game";
import { SLIDER_RULE, sliderProgress } from "./slider";
import { type Hand, type PalmFrame } from "./palm";
import {
  HandController,
  HAND_MAP,
  HAND_CONNECTIONS,
  emptyPalms,
} from "./hands";
import { homeView, playView, labView } from "./views";
import { BodyStage, type Shake } from "./body-stage";
import type { Point, Input } from "./types";
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const safe = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    toast("本地保存失败，请导出报告");
  }
};
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const VERSION = "0.5.0";
$("#app").innerHTML =
  `<div id="stage"></div><div class="vignette"></div><header class="topbar"><button class="brand" data-go="home" aria-label="返回准备"><span class="brand-mark">P</span><span>PULSE<span class="brand-light">STAGE</span><small>星 跃 律 动</small></span></button><nav class="nav"><button data-go="home" class="nav-item">舞台</button><button data-go="lab" class="nav-item">动作实验室 <span class="tag">LAB</span></button></nav><div class="device"><i id="camera-dot"></i><span id="camera-status">摄像头未开启</span><button id="camera-power" class="icon-btn" title="关闭摄像头" hidden>⏻</button></div></header><main id="content"></main><div id="toast" role="status"></div><div id="hand-cursor" aria-hidden="true"></div><footer class="footer"><span>LOCAL DEMO <b>v${VERSION}</b></span><span>身体驾驶 · 单目识别 · 无手柄</span><span id="fps">MAC / CANVAS</span></footer>`;
const camera = new Camera(),
  music = new Music(),
  stage = new BodyStage($("#stage")),
  controller = new BodyController(),
  handController = new HandController();
let palms = emptyPalms();
let view = "home",
  input: Input = "camera",
  game: SliderGame | null = null,
  playing = false,
  paused = false,
  counting = false,
  finishing = false,
  loading = false,
  generation = 0;
let calibration: BodyCalibration | null = safe<BodyCalibration | null>(
    "pulse-body-calibration",
    null,
  ),
  verified = false,
  points: Point[] = [],
  captureAt = 0,
  processing = 0,
  missingAt = 0,
  slowAt = 0;
let pilot: PilotState = {
    effective: 0,
    captured: 0,
    x: 0,
    reliable: false,
    reason: "等待双肩输入",
  },
  keyboardX = 0,
  keyboardTarget = 0,
  lastNow = performance.now();
let low = safe(
    "pulse-body-low",
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  ),
  shake: Shake = safe("pulse-body-shake", "standard"),
  preview = false;
if (calibration?.version !== BODY_MAP) calibration = null;
stage.low = low;
stage.shake = shake;
let stats = {
  processing: [] as number[],
  fps: [] as number[],
  feedback: [] as {
    id: string;
    lateMs: number;
    visualLateMs: number | null;
    audioLateMs: number | null;
    grade: string;
    stateAgeMs: number | null;
    reason: string;
  }[],
  interruptions: [] as string[],
};
let guide: null | {
  step: number;
  samples: { at: number; value: ShoulderObservation }[];
  hold: { at: number; r: number }[];
  lastCapture: number;
} = null;
let dwellState = { el: null as HTMLElement | null, since: 0, armed: false };
function toast(s: string) {
  $("#toast").textContent = s;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 4000);
}
function resetMenu() {
  dwellState = { el: null, since: 0, armed: false };
  $("#hand-cursor").classList.remove("visible");
}
function bodyReady() {
  return (
    camera.active &&
    verified &&
    pilot.reliable &&
    performance.now() - captureAt <= 250
  );
}
function feedbackControls() {
  return `<label class="feedback-select">撞击震动 <select id="shake" aria-label="撞击震动强度"><option value="off" ${shake === "off" ? "selected" : ""}>关闭</option><option value="light" ${shake === "light" ? "selected" : ""}>轻</option><option value="standard" ${shake === "standard" ? "selected" : ""}>标准</option></select></label><label class="toggle"><input id="low" type="checkbox" ${low ? "checked" : ""}>低特效</label>`;
}
function render() {
  resetMenu();
  stage.active = view === "play";
  $("#content").className = `view-${view} body-mode`;
  $(".topbar").classList.toggle("in-game", view === "play");
  $(".footer").hidden = view === "play";
  if (view === "home")
    $("#content").innerHTML = homeView(input, camera.active, verified);
  if (view === "lab") $("#content").innerHTML = labView(camera.active, preview);
  if (view === "play") $("#content").innerHTML = playView(input, preview);
  if (view === "results" && game) {
    const a = game.accuracy,
      r = a >= 95 ? "S" : a >= 85 ? "A" : a >= 70 ? "B" : a >= 50 ? "C" : "D",
      best =
        safe<Record<string, number>>("pulse-body-bests", {})[bestKey()] ?? 0;
    const full =
      !game.assisted &&
      game.counts.Perfect + game.counts.Great === game.chart.events.length;
    $("#content").innerHTML =
      `<section class="results"><div class="eyebrow">FLIGHT COMPLETE / 64 SECONDS OF LIGHT</div><h1>这一程，<span>节拍与你同频。</span></h1><div class="result-card"><div class="rating">${r}<small>${input === "keyboard" ? "键盘模拟" : game.assisted ? "辅助练习" : "正式完成"}</small></div><div class="result-score"><span>光绽 · ${full ? "全连击" : "68 个节奏目标"}</span><strong>${game.score.toLocaleString()}</strong><p>${input === "keyboard" ? "模拟成绩不写入摄像头纪录" : game.assisted ? "辅助练习不覆盖正式纪录" : `同版本个人最佳 ${best.toLocaleString()}`}</p></div><div class="result-metrics"><div><strong>${a.toFixed(1)}<small>%</small></strong><span>节奏完成度</span></div><div><strong>${game.maxCombo}</strong><span>最高连击</span></div></div></div><div class="judgement-grid">${(["Perfect", "Great", "Good", "Miss", "Protected"] as const).map((k) => `<div><span>${k === "Protected" ? "输入保护" : k}</span><strong>${game!.counts[k]}</strong></div>`).join("")}</div><div class="band-results"><span>滑块 <b>${game.palmsCompleted}/8</b></span>${game.bands.map((v, i) => `<span>${["左位", "中位", "右位"][i]} <b>${v}%</b></span>`).join("")}</div><p class="result-note">${input === "keyboard" ? "本局验证音乐、驾驶与结算流程，不代表真实摄像头识别精度。" : game.assisted ? "保护、低帧率或暂停已记录在报告中。" : "节奏完成度是本局得分指标，不代表模型识别正确率。"}</p><div class="result-actions"><button class="secondary" data-go="home">返回准备</button><button class="secondary" id="export">导出本局 ↗</button><button class="primary" id="play">再飞一次 ▷</button></div></section>`;
  }
  bind();
  mountPreview();
  device();
  document
    .querySelectorAll<HTMLElement>("[data-go]")
    .forEach((el) => el.classList.toggle("active", el.dataset.go === view));
}
function bind() {
  document
    .querySelectorAll<HTMLElement>("[data-go]")
    .forEach((e) => (e.onclick = () => go(e.dataset.go!)));
  document.querySelectorAll<HTMLElement>("[data-input]").forEach(
    (e) =>
      (e.onclick = () => {
        input = e.dataset.input as Input;
        render();
      }),
  );
  $("#enable")?.addEventListener("click", () => void enable());
  $("#play")?.addEventListener("click", () => void start());
  $("#pause")?.addEventListener("click", () => pause("稍作休息，准备好后继续"));
  $("#tutorial")?.addEventListener("click", tutorial);
  $("#settings")?.addEventListener("click", settings);
  $("#practice")?.addEventListener("click", practicePalms);
  $("#export")?.addEventListener("click", report);
  $("#shake")?.addEventListener("change", (e) => {
    shake = (e.target as HTMLSelectElement).value as Shake;
    stage.shake = shake;
    store("pulse-body-shake", shake);
  });
  $("#low")?.addEventListener("change", (e) => {
    low = (e.target as HTMLInputElement).checked;
    stage.low = low;
    store("pulse-body-low", low);
  });
  $("#preview")?.addEventListener("change", (e) => {
    preview = (e.target as HTMLInputElement).checked;
    mountPreview();
  });
  $("#preview-toggle")?.addEventListener("click", () => {
    preview = !preview;
    mountPreview();
    $(".stage-preview")?.classList.toggle("hidden-preview", !preview);
    $("#preview-toggle").textContent = preview ? "隐藏预览" : "显示预览";
  });
}
function mountPreview() {
  const slot = $("#video-slot");
  if (slot) {
    camera.mountPreview(slot, preview);
    if ($("#skeleton")) $("#skeleton").hidden = !preview;
  }
}
function device() {
  const enableButton = $<HTMLButtonElement>("#enable");
  if (enableButton) {
    enableButton.disabled = loading;
    enableButton.textContent = loading
      ? "正在连接摄像头…"
      : camera.active
        ? "重新身体定位 ↗"
        : "开启摄像头 ↗";
  }
  $("#camera-power").hidden = !camera.active;
  $("#camera-dot").classList.toggle("on", camera.active);
  $("#camera-status").textContent = loading
    ? "正在准备相机与模型…"
    : camera.active
      ? `${verified ? "身体已定位" : "相机已连接"}`
      : "相机未开启";
  if ($("#readiness"))
    $("#readiness").textContent =
      input === "keyboard"
        ? ""
        : bodyReady()
          ? "双肩已就绪"
          : verified
            ? "请恢复清晰双肩"
            : "先完成身体定位";
}
function go(next: string) {
  generation++;
  music.pause();
  playing = paused = counting = finishing = false;
  heldKeys.clear();
  practice = null;
  $("#practice-modal")?.remove();
  $("#settings-modal")?.remove();
  guide = null;
  $("#guide")?.remove();
  $("#tutorial-modal")?.remove();
  controller.reset();
  view = next;
  render();
}
$("#camera-power").onclick = () => {
  generation++;
  if (playing) pause("摄像头已关闭");
  camera.stop();
  handController.reset();
  palms = emptyPalms("相机已关闭");
  verified = false;
  points = [];
  captureAt = 0;
  pilot = { ...pilot, x: 0, reliable: false, reason: "相机已关闭" };
  processing = 0;
  guide = null;
  $("#guide")?.remove();
  controller.reset();
  device();
};
async function enable() {
  if (loading) return;
  loading = true;
  device();
  const token = ++generation;
  try {
    if (!camera.active) await camera.start();
    if (token !== generation) return;
    input = "camera";
    view = "lab";
    render();
    beginGuide();
  } catch (e) {
    const name = (e as Error).name;
    const message =
      name === "NotReadableError"
        ? "摄像头暂时无法启动，可能被其他页面或应用占用。释放摄像头后点此重试。"
        : name === "NotAllowedError"
          ? "尚未获得摄像头权限，请在浏览器的网站权限中允许后重试。"
          : name === "NotFoundError"
            ? "没有找到可用摄像头，请连接设备后重试。"
            : "无法开启摄像头：" + String(e);
    pilot = { ...pilot, reliable: false, reason: message };
    toast(message);
  } finally {
    loading = false;
    device();
  }
}
const guideText = [
  [
    "01 / 站稳",
    "双肩入镜，自然站稳",
    "面向屏幕约 2–3 秒，双臂自然垂放即可。左右确认有舒适的活动空间。",
  ],
  [
    "02 / 左侧范围",
    "身体向左，小幅移动",
    "向你自己的左侧舒适横移，保持片刻。不要侧转，也不用抬手。",
  ],
  ["03 / 回中", "回到刚才的中间站位", "身体回中，稳定片刻。"],
  [
    "04 / 右侧范围",
    "身体向右，小幅移动",
    "向你自己的右侧舒适横移，保持片刻。两侧范围分别记录。",
  ],
  ["05 / 回中", "再次回到中间站位", "保持正面，下面试一次左、中、右驾驶。"],
  ["06 / 左位试驾", "把飞行器移到左位", "慢慢向左移动，让位置条停在左侧标记。"],
  [
    "07 / 中位试驾",
    "把飞行器带回中位",
    "回到初始站位。保持即可，不需要挥手触发。",
  ],
  [
    "08 / 右位试驾",
    "把飞行器移到右位",
    "慢慢向右移动到右侧标记，保持片刻完成定位。",
  ],
];
function beginGuide() {
  verified = false;
  controller.reset();
  guide = { step: 0, samples: [], hold: [], lastCapture: 0 };
  showGuide();
}
function showGuide() {
  $("#guide")?.remove();
  if (!guide) return;
  resetMenu();
  const t = guideText[guide.step];
  const e = document.createElement("div");
  e.id = "guide";
  e.className = "modal-backdrop calibration-backdrop";
  e.innerHTML = `<div class="modal calibration-modal"><div class="eyebrow">${t[0]}</div><h2>${t[1]}</h2><p>${t[2]}</p><div class="pilot-meter guide-meter"><span>左</span><i><b id="guide-dot"></b></i><span>右</span></div><div id="guide-state" class="guide-state">等待可靠双肩</div><div class="guide-progress"><i id="guide-bar"></i></div><p id="guide-detail" class="fineprint">只需要双肩，不检查手腕与髋部。</p><button id="cancel-guide" class="text-btn">取消定位</button></div>`;
  document.body.append(e);
  $("#cancel-guide").onclick = () => {
    guide = null;
    e.remove();
    resetMenu();
  };
}
function guidePose(at: number, obs: ShoulderObservation | null, now: number) {
  const g = guide;
  if (!g || at === g.lastCapture) return;
  g.lastCapture = at;
  let amount = 0,
    detail = "双肩清晰后继续";
  if (!obs || now - at > 250) {
    g.samples = [];
    g.hold = [];
    detail = "请正面站稳，让双肩都清楚入镜";
  } else if (g.step === 0) {
    const prev = g.samples.at(-1);
    if (
      prev &&
      (at - prev.at > 350 ||
        Math.abs(obs.center - prev.value.center) / obs.width > 0.09 ||
        Math.abs(obs.width / prev.value.width - 1) > 0.12)
    )
      g.samples = [];
    g.samples.push({ at, value: obs });
    g.samples = g.samples.filter((s) => at - s.at <= 4000);
    const c = baseline(g.samples);
    amount = Math.min(1, g.samples.length / 20, (at - g.samples[0].at) / 2000);
    detail = `稳定样本 ${g.samples.length}/20 · 双肩可用`;
    if (c) {
      calibration = c;
      controller.reset();
      advanceGuide();
      return;
    }
  } else if (calibration) {
    const r = (calibration.center - obs.center) / calibration.width;
    const sane =
      Math.abs(obs.width / calibration.width - 1) < 0.2 &&
      Math.abs(obs.y - calibration.y) / calibration.width < 0.4;
    const target = g.step === 5 ? -0.65 : g.step === 7 ? 0.65 : 0;
    const ok =
      sane &&
      (g.step === 1
        ? r <= -0.25 && r >= -0.65
        : g.step === 3
          ? r >= 0.25 && r <= 0.65
          : [2, 4].includes(g.step)
            ? Math.abs(r) < 0.08
            : pilot.reliable && Math.abs(pilot.x - target) < 0.14);
    if (ok) {
      g.hold.push({ at, r });
      if (g.hold.length > 30) g.hold.shift();
      amount = Math.min(1, (at - g.hold[0].at) / 650, g.hold.length / 5);
    } else g.hold = [];
    detail = !sane
      ? "请保持正面与原先距离"
      : g.step === 1 || g.step === 3
        ? "小幅横移后保持，不需离开镜头"
        : `当前位置 ${pilot.x.toFixed(2)} · ${ok ? "对齐后稍作保持" : "慢慢靠近目标位置"}`;
    if (amount >= 1) {
      if (g.step === 1)
        calibration.left = clamp(-median(g.hold.map((s) => s.r)), 0.25, 0.65);
      if (g.step === 3)
        calibration.right = clamp(median(g.hold.map((s) => s.r)), 0.25, 0.65);
      advanceGuide();
      return;
    }
  }
  if ($("#guide-state"))
    $("#guide-state").textContent =
      amount > 0 ? "保持，正在确认…" : "跟随提示移动身体";
  if ($("#guide-detail")) $("#guide-detail").textContent = detail;
  if ($("#guide-bar")) $("#guide-bar").style.width = `${amount * 100}%`;
}
function advanceGuide() {
  if (!guide) return;
  if (guide.step === 7 && calibration) {
    store("pulse-body-calibration", calibration);
    verified = true;
    guide = null;
    $("#guide")?.remove();
    view = "home";
    render();
    toast("身体定位完成。进入舞台前，先回到中间站位。");
    return;
  }
  guide.step++;
  guide.hold = [];
  showGuide();
}
function tutorial() {
  resetMenu();
  const e = document.createElement("div");
  e.id = "tutorial-modal";
  e.className = "modal-backdrop";
  e.innerHTML = `<div class="modal body-tutorial"><div class="eyebrow">玩法说明</div><h2>下方身体，上方手掌。</h2><div class="tutorial-steps"><div><b>01 ↔</b><h3>左右移动</h3><p>双肩中心控制一架飞行器，向左就向左，向右就向右。</p></div><div><b>02 ♪</b><h3>提前对准</h3><p>方块沿跑道来到光线，在音乐拍点与你撞上。不用等到最后才动。</p></div><div><b>03 ◇◇</b><h3>连拍保持</h3><p>同道方块站好即可接住。上方长条沿轨道过来时，用手掌光点接住头部，保持到尾部通过。</p></div></div><p class="fineprint">下方身体触碰得分，上方手掌接住长条。Q / W / E 模拟上方左 / 中 / 右道，Esc 暂停。</p><button id="close-tutorial" class="primary">知道了，准备飞行 →</button></div>`;
  document.body.append(e);
  $("#close-tutorial").onclick = () => {
    e.remove();
    resetMenu();
  };
}
async function start() {
  if (loading) return;
  if (input === "camera") {
    if (!camera.active || !verified) {
      await enable();
      return;
    }
    if (!bodyReady() || camera.health.pause) {
      toast("请恢复清晰双肩，回到中间站位后重试");
      return;
    }
    if (!camera.handReady || !camera.hands.available) {
      toast(camera.handError || "手部模型正在准备，请稍候再开始");
      return;
    }
    if (Math.abs(pilot.x) > 0.22) {
      toast("先回到中间站位，再开始飞行");
      return;
    }
  }
  loading = true;
  const token = ++generation;
  try {
    const res = await fetch("/charts/body-slider-64.json");
    if (!res.ok) throw Error("谱面加载失败");
    const chart = validateBodyChart((await res.json()) as BodyChart);
    await music.init();
    if (token !== generation) return;
    game = new SliderGame(chart);
    game.assisted = input === "keyboard";
    stage.game = game;
    stage.clear();
    stage.low = low;
    stats = { processing: [], fps: [], feedback: [], interruptions: [] };
    heldKeys.clear();
    keyboardX = keyboardTarget = 0;
    controller.reset();
    missingAt = slowAt = 0;
    game.onJudge = (j) => {
      const lateMs = (j.judgedAt - j.block.time) * 1000;
      if (lateMs > 120) {
        game!.assisted = true;
        noteInterruption("render-late");
      }
      // Very late callbacks are recorded, without replaying a strong old collision.
      if (lateMs <= 120) {
        stage.flash(j);
        const e = $("#streak-feedback");
        if (e && j.factor > 0 && game!.combo > 0 && game!.combo % 10 === 0) {
          e.textContent = `${game!.combo} 连击 · ${game!.combo >= 30 ? "光芒全开" : "节奏升温"}`;
          e.classList.remove("show");
          void e.offsetWidth;
          e.classList.add("show");
        }
      }
      const audioAt =
        j.factor > 0 && lateMs <= 120
          ? music.impact(j.block.accent, j.block.time, j.block.kind === "palm")
          : null;
      stats.feedback.push({
        id: j.id,
        lateMs,
        visualLateMs: null,
        audioLateMs: audioAt === null ? null : (audioAt - j.block.time) * 1000,
        grade: j.grade,
        stateAgeMs: j.state ? (j.block.time - j.state.captured) * 1000 : null,
        reason: j.reason,
      });
    };
    view = "play";
    playing = true;
    paused = false;
    counting = true;
    finishing = false;
    render();
    music.play(0, 2);
  } catch (e) {
    toast("无法开始：" + String(e));
  } finally {
    loading = false;
  }
}
stage.onVisual = (id, time) => {
  const event = stats.feedback.find((f) => f.id === id);
  const judgement = game
    ? [...game.results.values()].find((j) => j.id === id)
    : null;
  if (event && judgement)
    event.visualLateMs = Math.max(0, (time - judgement.block.time) * 1000);
};
function noteInterruption(s: string) {
  if (!stats.interruptions.includes(s)) stats.interruptions.push(s);
}
function pause(reason: string) {
  if (!playing || !game) return;
  music.pause();
  heldKeys.clear();
  playing = false;
  paused = true;
  counting = false;
  game.assisted = true;
  noteInterruption(reason);
  resetMenu();
  const el = $("#pause-overlay");
  el.hidden = false;
  el.className = "modal-backdrop";
  el.innerHTML = `<div class="modal"><div class="eyebrow">FLIGHT PAUSED</div><h2>航线等你回来。</h2><p>${escape(reason)}</p><p class="fineprint">继续会从 4 秒乐句边界恢复，撤销回放段旧判定后重算。本局保留辅助标记。</p><div class="modal-actions"><button class="text-btn" id="back">返回准备</button><button class="secondary" id="restart">重新开始</button><button class="primary" id="resume">继续 ▷</button></div></div>`;
  $("#back").onclick = () => go("home");
  $("#restart").onclick = () => void start();
  $("#resume").onclick = async () => {
    if (input === "camera" && (!bodyReady() || camera.health.pause)) {
      toast("请先恢复清晰双肩");
      return;
    }
    try {
      await music.init();
      if (!paused || !game) return;
      const from = Math.max(0, Math.floor(music.offset / 4) * 4);
      game.rewind(from);
      stage.clear();
      controller.reset();
      heldKeys.clear();
      music.play(from, 2);
      playing = true;
      paused = false;
      counting = true;
      missingAt = slowAt = 0;
      el.hidden = true;
      resetMenu();
    } catch (e) {
      toast(String(e));
    }
  };
}
function bestKey() {
  return `body-pilot/${game?.chart.id}/${game?.chart.version}/${SLIDER_RULE}/${BODY_MAP}/${HAND_MAP}/${input}`;
}
function finish() {
  if (!game || finishing) return;
  playing = counting = paused = false;
  finishing = true;
  music.pause();
  resetMenu();
  $("#pause").hidden = true;
  $("#center-message").innerHTML =
    '<strong class="complete-title">FLIGHT<br>COMPLETE</strong><span>这一分钟，节拍与你同频</span>';
  const token = generation;
  setTimeout(() => {
    if (token !== generation || !game) return;
    if (!game.assisted && input === "camera") {
      const bests = safe<Record<string, number>>("pulse-body-bests", {});
      bests[bestKey()] = Math.max(bests[bestKey()] ?? 0, game.score);
      store("pulse-body-bests", bests);
    }
    finishing = false;
    view = "results";
    render();
  }, 1400);
}
camera.onError = (s) => {
  if (playing) pause("输入异常：" + s);
  toast(s);
};
camera.onPose = (p, at, ms) => {
  const now = performance.now();
  points = p;
  captureAt = at;
  processing = ms;
  pilot = controller.process(p, at, now, calibration);
  guidePose(at, shoulders(p), now);
  if (pilot.reliable) missingAt = 0;
  else if (!missingAt) missingAt = now;
  if (input === "camera" && playing && game) {
    game.push({
      ...pilot,
      effective: music.eventTime(now),
      captured: music.eventTime(at),
    });
    stats.processing.push(ms);
    stats.fps.push(camera.fps);
  }
};
camera.onHands = (handInput, at) => {
  const now = performance.now();
  // Association also depends on a fresh body observation. Use the older capture
  // timestamp as the joint evidence age, with current effective arrival time.
  const bodyFresh =
    captureAt > 0 && Math.abs(at - captureAt) <= 180 && now - captureAt <= 180;
  const evidenceAt = Math.min(at, captureAt);
  palms = handController.process(
    bodyFresh ? points : [],
    handInput,
    at,
    calibration,
  );
  if (practice && input === "camera")
    practice.frames.push({
      effective: now / 1000,
      captured: evidenceAt / 1000,
      ...palms,
    });
  if (input === "camera" && playing && game)
    game.pushPalms({
      effective: music.eventTime(now),
      captured: music.eventTime(evidenceAt),
      ...gameArms(bodyFresh && pilot.reliable),
    });
};
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).matches("input,select,textarea")) return;
  if (e.key === "Escape") {
    if (guide) {
      guide = null;
      $("#guide")?.remove();
      resetMenu();
    } else if ($("#tutorial-modal")) {
      $("#tutorial-modal").remove();
      resetMenu();
    } else if ($("#practice-modal")) {
      practice = null;
      $("#practice-modal").remove();
      resetMenu();
    } else if ($("#settings-modal")) {
      $("#settings-modal").remove();
      resetMenu();
    } else if (playing) pause("已暂停");
    return;
  }
  if (
    input === "keyboard" &&
    (view === "play" || !!practice) &&
    ["q", "w", "e"].includes(e.key.toLowerCase())
  ) {
    e.preventDefault();
    heldKeys.add(
      e.key.toLowerCase() === "q"
        ? "left"
        : e.key.toLowerCase() === "w"
          ? "center"
          : "right",
    );
  }
  if (
    input === "keyboard" &&
    view === "play" &&
    ["a", "s", "d", "ArrowLeft", "ArrowRight", "ArrowDown"].includes(e.key)
  ) {
    e.preventDefault();
    keyboardTarget = ["a", "ArrowLeft"].includes(e.key)
      ? -0.65
      : ["d", "ArrowRight"].includes(e.key)
        ? 0.65
        : 0;
  }
});
document.addEventListener("keyup", (e) => {
  if (["q", "w", "e"].includes(e.key.toLowerCase()))
    heldKeys.delete(
      e.key.toLowerCase() === "q"
        ? "left"
        : e.key.toLowerCase() === "w"
          ? "center"
          : "right",
    );
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) pause("页面进入后台，音乐与评分已暂停");
});
window.addEventListener("blur", () => {
  if (playing) pause("窗口失去焦点，音乐与评分已暂停");
});
window.addEventListener("pagehide", () => {
  camera.stop();
  music.pause();
});
function report() {
  const percentile = (a: number[], q: number) =>
    a.length
      ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)]
      : null;
  const data = {
    app: "Pulse Stage",
    version: VERSION,
    requirement: "1.7",
    playStyle: "body-pilot",
    rule: SLIDER_RULE,
    mapping: BODY_MAP,
    handMapping: HAND_MAP,
    createdAt: new Date().toISOString(),
    input,
    model: POSE_MODEL,
    handModel: HAND_MODEL,
    calibration,
    inputHealth: camera.health,
    liveInput: {
      poseDelegate: camera.poseDelegate,
      poseFps: camera.fps,
      handFps: camera.handFps,
      processingMs: processing,
      ageMs: captureAt ? performance.now() - captureAt : null,
      handDelegate: camera.handDelegate,
      handCaptureAgeMs: camera.handCaptureAt
        ? performance.now() - camera.handCaptureAt
        : null,
      handProcessingMs: camera.hands.processing,
      handModelAvailable: camera.hands.available,
      detectedHands: camera.hands.detections.length,
      arms: Object.fromEntries(
        Object.entries(palms).map(([hand, arm]) => [
          hand,
          {
            reliable: arm.reliable,
            raised: arm.raised,
            reason: arm.reason,
            fingers: arm.fingers,
            laneX: arm.laneX,
          },
        ]),
      ),
    },
    chart: game?.chart,
    game: game
      ? {
          score: game.score,
          counts: game.counts,
          maxCombo: game.maxCombo,
          assisted: game.assisted,
          bands: game.bands,
          judgements: [...game.results.values()],
        }
      : null,
    metrics: {
      inferenceP95Ms: percentile(stats.processing, 0.95),
      poseFpsMedian: percentile(stats.fps, 0.5),
      softwareFeedbackP95Ms: percentile(
        stats.feedback.flatMap((f) =>
          f.visualLateMs === null ? [] : [f.visualLateMs],
        ),
        0.95,
      ),
      endToEndLatencyMs: null,
      humanValidatedAccuracy: null,
    },
    stats,
    privacy: "No raw video or continuous landmarks saved",
    verification:
      "Keyboard and synthetic tests do not verify real-camera accuracy.",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `pulse-body-report-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function paintInput(now: number) {
  const o = shoulders(points),
    fresh = now - captureAt <= 180,
    handsFresh =
      camera.active &&
      fresh &&
      now - camera.handCaptureAt <= 180 &&
      now - camera.handResultAt <= 180;
  if ($("#joint-diagnostics"))
    $("#joint-diagnostics").innerHTML =
      `<div class="joint-summary">人体骨骼 33 点 · 手掌骨骼每只 21 点</div><div class="joint-grid">${[11, 12, 13, 14, 15, 16].map((id, i) => `<div class="joint-item ${jointStatus(points[id])}"><b>${["左肩", "右肩", "左肘", "右肘", "左腕", "右腕"][i]}</b><span>${{ ready: "可用", outside: "画面外", uncertain: "置信不足", missing: "无数据" }[jointStatus(points[id])]} · ${Math.round(Math.min(points[id]?.visibility ?? 0, points[id]?.presence ?? 1) * 100)}%</span></div>`).join("")}</div>`;
  if ($("#signal-reason")) {
    $("#signal-reason").textContent = pilot.reason;
    $("#pose-fps").textContent = camera.fps.toFixed(1);
    $("#inference").textContent = processing.toFixed(0) + " ms";
    $("#age").textContent = captureAt
      ? Math.round(now - captureAt) + " ms"
      : "—";
  }
  const livePalms =
    input === "keyboard" && view === "play" ? keyboardArms() : palms;
  if ($("#hand-diagnostics")) {
    $("#hand-diagnostics").innerHTML = (["left", "right"] as const)
      .map((hand) => {
        const p = palms[hand],
          valid = handsFresh && p.reliable;
        const reason = !camera.active
          ? "相机未开启"
          : camera.handError
            ? camera.handError
            : !camera.handReady
              ? "正在准备手部模型…"
              : !handsFresh
                ? "等待新鲜手部画面"
                : p.reason;
        return `<div class="hand-diagnostic ${valid && p.raised ? "ready" : ""}"><b>${hand === "left" ? "左掌" : "右掌"}<i></i></b><span>${escape(reason)}</span><small>${valid ? `${p.points.length} 点 · ${p.fingers} 指伸展` : "等待输入"}</small></div>`;
      })
      .join("");
    $("#hand-engine").textContent = !camera.active
      ? "21 点 / 每只手"
      : camera.hands.available
        ? `${camera.handDelegate} · ${camera.handFps.toFixed(0)} FPS · ${camera.hands.processing.toFixed(0)} ms`
        : camera.handReady
          ? "等待手部画面"
          : "手部模型未就绪";
    for (const hand of ["left", "right"] as const) {
      const e = $("#lab-" + hand),
        p = palms[hand];
      e.style.opacity = handsFresh && p.reliable ? "1" : "0";
      e.style.left = `${50 + (p.laneX ?? 0) * 44}%`;
      e.classList.toggle("open", p.raised);
    }
  }
  for (const hand of ["left", "right"] as const) {
    const e = $("#stage-" + hand + "-hand");
    if (e) {
      const p = livePalms[hand],
        valid = input === "keyboard" || handsFresh;
      e.textContent = `${hand === "left" ? "左掌" : "右掌"} · ${valid && p.reliable && p.raised ? "已就绪" : valid && p.reliable ? "请举掌" : "未入镜"}`;
      e.classList.toggle("ready", valid && p.reliable && p.raised);
    }
  }
  for (const id of ["pilot-dot", "body-dot", "guide-dot"])
    if ($("#" + id)) {
      $("#" + id).style.left = 50 + pilot.x * 45 + "%";
      $("#" + id).style.opacity = o && fresh ? "1" : ".3";
    }
  const canvas = $<HTMLCanvasElement>("#skeleton");
  if (!canvas || !preview) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const d = Math.min(devicePixelRatio, 2);
  canvas.width = r.width * d;
  canvas.height = r.height * d;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(d, d);
  const vw = camera.video.videoWidth || 640,
    vh = camera.video.videoHeight || 480,
    s = Math.min(r.width / vw, r.height / vh),
    w = vw * s,
    h = vh * s;
  ctx.translate((r.width - w) / 2, (r.height - h) / 2);
  const xy = (i: number) => ({ x: (1 - points[i].x) * w, y: points[i].y * h });
  for (const [a, b] of [
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
  ])
    if (
      points[a] &&
      points[b] &&
      jointStatus(points[a]) === "ready" &&
      jointStatus(points[b]) === "ready"
    ) {
      ctx.strokeStyle =
        a === 11 && b === 12
          ? "#d6e9f0"
          : a === 11 || a === 13
            ? "#a2e9dc"
            : "#f1ce8b";
      ctx.lineWidth = a === 11 && b === 12 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(xy(a).x, xy(a).y);
      ctx.lineTo(xy(b).x, xy(b).y);
      ctx.stroke();
    }
  for (const id of [11, 12, 13, 14, 15, 16])
    if (points[id] && jointStatus(points[id]) === "ready") {
      ctx.fillStyle = "#a6f4ff";
      ctx.beginPath();
      ctx.arc(xy(id).x, xy(id).y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  if (handsFresh)
    for (const hand of ["left", "right"] as const) {
      const palm = palms[hand];
      ctx.strokeStyle = hand === "left" ? "#a2e9dc" : "#f1ce8b";
      ctx.fillStyle = ctx.strokeStyle;
      ctx.globalAlpha = palm.reliable ? 1 : 0.4;
      ctx.lineWidth = 1.5;
      for (const [a, b] of HAND_CONNECTIONS) {
        const p = palm.points[a],
          q = palm.points[b];
        if (!p || !q) continue;
        ctx.beginPath();
        ctx.moveTo((1 - p.x) * w, p.y * h);
        ctx.lineTo((1 - q.x) * w, q.y * h);
        ctx.stroke();
      }
      for (const p of palm.points) {
        ctx.beginPath();
        ctx.arc((1 - p.x) * w, p.y * h, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (palm.reliable) {
        ctx.beginPath();
        ctx.arc((1 - palm.x) * w, palm.y * h, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

  if (o) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc((1 - o.center) * w, o.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
function dwell(now: number) {
  const cursor = $("#hand-cursor"),
    p = palms.right;
  if (
    !camera.active ||
    !verified ||
    !p.reliable ||
    !p.raised ||
    now - camera.handCaptureAt > 180 ||
    now - camera.handResultAt > 180 ||
    playing ||
    finishing ||
    guide ||
    practice ||
    !!$("#settings-modal")
  ) {
    cursor.classList.remove("visible");
    dwellState.el = null;
    dwellState.since = now;
    return;
  }
  const x = clamp(1 - p.x, 0, 1) * innerWidth,
    y = clamp(p.y, 0, 1) * innerHeight;
  cursor.style.left = x + "px";
  cursor.style.top = y + "px";
  cursor.classList.add("visible");
  const target =
    document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("button:not(:disabled)") ?? null;
  if (!target) {
    dwellState.armed = true;
    dwellState.el = null;
    cursor.style.setProperty("--progress", "0deg");
    return;
  }
  if (!dwellState.armed) return;
  if (dwellState.el !== target) {
    dwellState.el = target;
    dwellState.since = now;
  }
  const amount = (now - dwellState.since) / 1000;
  cursor.style.setProperty("--progress", Math.min(360, amount * 360) + "deg");
  if (amount >= 1) {
    resetMenu();
    target.click();
  }
}
const heldKeys = new Set<Hand | "center">();
let practice: { step: number; frames: PalmFrame[] } | null = null;
function keyboardArms() {
  const arm = (hand: Hand) => ({
    reliable: true,
    raised: heldKeys.has(hand) || (hand === "left" && heldKeys.has("center")),
    laneX: hand === "left" ? (heldKeys.has("center") ? 0 : -0.65) : 0.65,
    x: hand === "left" ? -0.4 : 0.4,
    y: 0.3,
    reason: "键盘模拟",
  });
  return { left: arm("left"), right: arm("right") };
}
function gameArms(reliable: boolean) {
  const arms = { left: { ...palms.left }, right: { ...palms.right } };
  if (!reliable)
    for (const hand of ["left", "right"] as const)
      arms[hand] = { ...arms[hand], reliable: false, reason: "身体定位不可用" };
  return arms;
}
function settings() {
  if (playing) pause("调整设置");
  $("#settings-modal")?.remove();
  resetMenu();
  const e = document.createElement("div");
  e.id = "settings-modal";
  e.className = "modal-backdrop";
  e.innerHTML = `<div class="modal settings-modal"><h2>舞台设置</h2>${feedbackControls()}<button id="close-settings" class="primary">完成</button></div>`;
  document.body.append(e);
  $("#shake").onchange = (event) => {
    shake = (event.target as HTMLSelectElement).value as Shake;
    stage.shake = shake;
    store("pulse-body-shake", shake);
  };
  $("#low").onchange = (event) => {
    low = (event.target as HTMLInputElement).checked;
    stage.low = low;
    store("pulse-body-low", low);
  };
  $("#close-settings").onclick = () => {
    e.remove();
    resetMenu();
  };
}
function practicePalms() {
  if (input === "camera" && !camera.active) {
    toast("先开启摄像头，或切换键盘试玩后练习");
    return;
  }
  resetMenu();
  heldKeys.clear();
  practice = { step: 0, frames: [] };
  const e = document.createElement("div");
  e.id = "practice-modal";
  e.className = "modal-backdrop";
  e.innerHTML = `<div class="modal palm-practice"><h2>试试上方滑块</h2><div id="practice-hand" class="practice-hand">左道</div><div class="practice-lanes"><b>左</b><b>中</b><b>右</b><i id="practice-left"></i><i id="practice-right"></i></div><p id="practice-instruction">张开手掌，伸直至少三指。移到亮起轨道，保持约1秒。</p><div class="practice-track"><i id="practice-progress"></i></div><p id="practice-state" role="status">${input === "keyboard" ? "按住 Q / W / E 对应上方左 / 中 / 右道" : "保持正面，手掌与手指完整入镜"}</p><button id="close-practice" class="secondary">返回</button></div>`;
  document.body.append(e);
  $("#close-practice").onclick = () => {
    practice = null;
    heldKeys.clear();
    e.remove();
    resetMenu();
  };
}
function paintPractice(now: number) {
  if (!practice || practice.step >= 3) return;
  practice.frames = practice.frames.filter((f) => f.effective >= now - 3);
  const target = [-0.65, 0, 0.65][practice.step];
  const note = {
    id: "practice",
    kind: "palm" as const,
    beat: 0,
    time: now,
    sliderStart: now - 1,
    hold: 1,
    x: target,
    halfWidth: 0.12,
    accent: false,
    group: "practice",
  };
  const p = sliderProgress(practice.frames, note, now);
  $("#practice-progress").style.width = p.progress * 100 + "%";
  $("#practice-state").textContent =
    input === "keyboard"
      ? `按住 ${["Q", "W", "E"][practice.step]}，保持约1秒`
      : p.reason;
  const latest = practice.frames.at(-1);
  document
    .querySelectorAll(".practice-lanes b")
    .forEach((e, i) => e.classList.toggle("active", i === practice!.step));
  for (const hand of ["left", "right"] as const) {
    const cursor = $("#practice-" + hand),
      pose = latest?.[hand];
    cursor.style.opacity =
      pose?.reliable && pose.raised && now - latest!.captured <= 0.18
        ? "1"
        : "0";
    if (pose?.laneX !== undefined)
      cursor.style.left = 50 + pose.laneX * 44 + "%";
  }
  if (p.ready) {
    practice.step++;
    practice.frames = [];
    if (practice.step < 3) {
      $("#practice-hand").textContent = practice.step === 1 ? "中道" : "右道";
      $("#practice-progress").style.width = "0%";
      $("#practice-state").textContent = "上一道已完成，试试下一道";
    } else {
      $("#practice-hand").textContent = "完成";
      $("#practice-state").textContent =
        "上方长条用手掌接住并保持，下方方块继续用身体触碰。";
      $("#practice-instruction").textContent = "准备好后开始这一首。";
      $("#close-practice").textContent = "回到舞台准备";
    }
  }
}
let lastPaint = 0;
function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;
  if (input === "keyboard")
    keyboardX += clamp(keyboardTarget - keyboardX, -dt, dt);
  const time = music.time;
  stage.time = time;
  stage.x = input === "keyboard" ? keyboardX : pilot.x;
  stage.reliable =
    input === "keyboard" || (pilot.reliable && now - captureAt <= 180);
  stage.visiblePilot =
    input === "keyboard" ||
    (now - captureAt <= 280 && (!missingAt || now - missingAt <= 100));
  stage.draw(now);
  if (practice) {
    if (input === "keyboard")
      practice.frames.push({
        effective: now / 1000,
        captured: now / 1000,
        ...keyboardArms(),
      });
    paintPractice(now / 1000);
  }
  if (guide && now - captureAt > 350) {
    guide.hold = [];
    guide.samples = [];
    if ($("#guide-detail"))
      $("#guide-detail").textContent = "等待新鲜双肩画面…";
  }
  if (view === "play" && playing && game) {
    if (counting) {
      const remaining = music.started - (music.ctx?.currentTime ?? 0);
      if (remaining > 0)
        $("#center-message").innerHTML =
          `<strong>${Math.max(1, Math.ceil(remaining / 0.5))}</strong><span>提前对位 · 等方块到拍</span>`;
      else {
        counting = false;
        $("#center-message").innerHTML = "";
      }
    }
    if (input === "keyboard") {
      game.pushPalms({ effective: time, captured: time, ...keyboardArms() });
      game.push({
        effective: time,
        captured: time,
        x: keyboardX,
        reliable: true,
        reason: "manual keyboard simulation",
      });
    }
    if (!counting) {
      if (music.ctx?.state !== "running")
        pause("音乐输出已暂停，请恢复音频后继续");
      if (input === "camera") {
        const health = camera.health;
        if (health.pause) pause(health.message);
        if (health.slow) {
          if (!slowAt) slowAt = now;
          if (now - slowAt > 2000) {
            if (!stats.interruptions.includes("slow-inference"))
              toast("识别偏慢，本局为辅助练习，已降低特效");
            noteInterruption("slow-inference");
            game.assisted = true;
            stage.low = true;
          }
        } else slowAt = 0;
        if (missingAt && now - missingAt > 500) pause(pilot.reason);
        $("#tracking-status").hidden =
          !game.assisted && now - captureAt <= 180 && pilot.reliable;
        $("#tracking-status").textContent =
          (game.assisted ? "辅助练习 · " : "") +
          (now - captureAt > 180
            ? "姿态偏旧，受影响拍点将保护"
            : health.slow
              ? health.message
              : pilot.reason);
      }
      if (playing) {
        game.tick(time);
        const n = game.chart.events.find(
          (b) =>
            b.kind === "palm" &&
            !game!.results.has(b.id) &&
            b.sliderStart! - time <= 2.8,
        );
        const cue = $("#palm-cue");
        if (cue) {
          const message = n
            ? `${n.x < 0 ? "左道" : n.x > 0 ? "右道" : "中道"}滑块 · ${n.x === 0 ? "任一手掌" : n.x < 0 ? "左掌" : "右掌"}接住并保持`
            : "";
          if (cue.textContent !== message) cue.textContent = message;
          cue.classList.toggle("show", !!n);
        }
        if (time >= 64.05) finish();
      }
    }
    if ($("#score"))
      $("#score").textContent = game.score.toString().padStart(7, "0");
    if ($("#combo")) $("#combo").textContent = game.combo.toString();
    if ($("#time"))
      $("#time").textContent =
        `${Math.floor(Math.max(0, time) / 60)}:${Math.floor(
          Math.max(0, time) % 60,
        )
          .toString()
          .padStart(2, "0")}`;
    if ($("#progress"))
      $("#progress").style.width = `${clamp(time / 64, 0, 1) * 100}%`;
  }
  if (now - lastPaint > 100) {
    device();
    paintInput(now);
    dwell(now);
    $("#fps").textContent =
      `${stage.fps.toFixed(0)} FPS / ${camera.active ? camera.fps.toFixed(0) + " POSE" : "LOCAL"}`;
    lastPaint = now;
  }
}
render();
requestAnimationFrame(animate);
