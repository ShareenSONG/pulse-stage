import type { Point } from "./types";
import type { HandInput } from "./hands";
import { inputHealth } from "./input-health";
export class Camera {
  video = document.createElement("video");
  preview = document.createElement("video");
  startedAt = 0;
  lastFrameAt = 0;
  lastResultAt = 0;
  processingMs = 0;
  worker: Worker | null = null;
  stream: MediaStream | null = null;
  busy = false;
  ready = false;
  active = false;
  lastVideo = -1;
  lastSent = 0;
  fps = 0;
  frames = 0;
  windowStart = 0;
  generation = 0;
  frameHandle = 0;
  handWorker: Worker | null = null;
  handBusy = false;
  handSent = 0;
  handCaptureAt = 0;
  handResultAt = 0;
  handDelegate = "CPU";
  handRetried = false;
  handTimer: ReturnType<typeof setTimeout> | null = null;
  handFps = 0;
  handFrames = 0;
  handWindow = 0;
  poseDelegate = "CPU";
  handReady = false;
  handError = "";
  hands: HandInput = { available: false, detections: [], processing: 0 };
  onPose: (
    p: Point[],
    time: number,
    processing: number,
    hands?: HandInput,
  ) => void = () => {};
  onHands: (input: HandInput, at: number) => void = () => {};
  onError: (s: string) => void = () => {};
  constructor() {
    // This source must NEVER be moved into replaceable page content.
    // Some browsers pause decoding when the element leaves the document.
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.className = "camera-capture-source";
    this.video.setAttribute("aria-hidden", "true");
    this.video.style.cssText =
      "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:0";
    document.body.append(this.video);
    this.preview.muted = true;
    this.preview.playsInline = true;
    this.preview.autoplay = true;
    this.preview.setAttribute("aria-label", "摄像头预览");
  }
  mountPreview(slot: HTMLElement, visible: boolean) {
    // Only this disposable preview follows the lab. Inference uses video above.
    if (this.preview.srcObject !== this.stream)
      this.preview.srcObject = this.stream;
    slot.prepend(this.preview);
    this.setPreviewVisible(visible);
    if (this.stream) void this.preview.play().catch(() => {});
  }
  setPreviewVisible(visible: boolean) {
    this.preview.style.opacity = visible ? "1" : "0";
  }
  get health() {
    return inputHealth({
      active: this.active,
      ready: this.ready,
      busy: this.busy,
      now: performance.now(),
      startedAt: this.startedAt,
      lastFrameAt: this.lastFrameAt,
      lastResultAt: this.lastResultAt,
      fps: this.fps,
    });
  }
  async start(deviceId?: string) {
    this.stop();
    const generation = ++this.generation;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (generation !== this.generation) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!this.video.isConnected) document.body.append(this.video);
      this.video.srcObject = this.stream;
      await this.video.play();
      this.worker = new Worker("/pose-worker.js");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("模型加载超时，请重试")),
          45000,
        );
        this.worker!.onerror = (e) => {
          clearTimeout(timer);
          reject(new Error(e.message));
          this.onError(e.message);
        };
        this.worker!.onmessage = (e) => {
          if (generation !== this.generation) return;
          if (e.data.type === "ready") {
            clearTimeout(timer);
            this.ready = true;
            this.poseDelegate = e.data.delegate ?? "CPU";

            resolve();
          }
          if (e.data.type === "error") {
            clearTimeout(timer);
            this.busy = false;
            reject(new Error(e.data.message));
            this.onError(e.data.message);
          }
          if (e.data.type === "pose") {
            this.busy = false;
            this.lastResultAt = performance.now();
            this.processingMs = e.data.processing;
            this.frames++;
            const now = performance.now();
            if (now - this.windowStart > 1000) {
              this.fps = (this.frames * 1000) / (now - this.windowStart);
              this.frames = 0;
              this.windowStart = now;
            }
            this.onPose(e.data.points, e.data.timestamp, e.data.processing);
          }
        };
        this.worker!.postMessage({ type: "init" });
      });
      this.handRetried = false;
      this.startHands(generation, "GPU");
      this.active = true;
      this.startedAt = performance.now();
      this.lastFrameAt = 0;
      this.lastResultAt = 0;
      this.windowStart = performance.now();
      this.stream.getVideoTracks()[0].onended = () =>
        this.onError("摄像头已断开");
      this.loop();
    } catch (err) {
      this.stop();
      throw err;
    }
  }
  startHands(generation: number, delegate: "CPU" | "GPU") {
    this.handDelegate = delegate;
    this.handSent = this.handCaptureAt = this.handResultAt = 0;
    this.handWindow = performance.now();
    this.handWorker = new Worker("/pose-worker.js");
    this.handWorker.onmessage = (e) => {
      if (generation !== this.generation) return;
      if (e.data.type === "ready") {
        this.handReady = true;
        if (this.handTimer) clearTimeout(this.handTimer);
        this.handDelegate = e.data.delegate;
      }
      if (e.data.type === "hands") {
        this.handError = "";
        this.handBusy = false;
        this.hands = e.data.handInput;
        this.handCaptureAt = e.data.timestamp;
        this.handResultAt = performance.now();
        this.handFrames++;
        if (this.handResultAt - this.handWindow > 1000) {
          this.handFps =
            (this.handFrames * 1000) / (this.handResultAt - this.handWindow);
          this.handFrames = 0;
          this.handWindow = this.handResultAt;
        }
        this.onHands(this.hands, this.handCaptureAt);
      }
      if (e.data.type === "error") this.failHands(e.data.message);
    };
    this.handWorker.onerror = (e) => this.failHands(e.message);
    this.handWindow = performance.now();
    this.handTimer = setTimeout(() => this.failHands("模型加载超时"), 45000);
    this.handWorker.postMessage({ type: "init", task: "hands", delegate });
  }
  loop = async () => {
    if (!this.active) return;
    const now = performance.now(),
      generation = this.generation;
    if (!this.video.isConnected) document.body.append(this.video);
    if (this.video.paused && this.video.srcObject)
      void this.video.play().catch(() => {});
    if (
      this.ready &&
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.lastVideo
    ) {
      // Track capture freshness even while the worker is busy, so slow inference
      // is never mislabeled as a camera disconnect.
      this.lastVideo = this.video.currentTime;
      this.lastFrameAt = now;
      if (!this.busy && now - this.lastSent > 30) {
        this.lastSent = now;
        this.busy = true;
        try {
          const bitmap = await createImageBitmap(this.video);
          if (this.active && generation === this.generation && this.worker)
            this.worker.postMessage({ type: "frame", bitmap, timestamp: now }, [
              bitmap,
            ]);
          else bitmap.close();
        } catch (err) {
          if (generation === this.generation) {
            this.busy = false;
            this.onError("视频取帧失败：" + String(err));
          }
        }
      }
    }
    if (
      this.handBusy &&
      now - this.handSent > (this.handResultAt ? 2500 : 15000)
    )
      this.failHands("手部推理超时");
    // Independent hand cadence: no frame queue and no reuse of old results.
    if (
      this.handReady &&
      !this.handBusy &&
      this.video.readyState >= 2 &&
      now - this.handSent >= 60 &&
      this.lastFrameAt > this.handSent
    ) {
      this.handBusy = true;
      this.handSent = now;
      try {
        const bitmap = await createImageBitmap(this.video);
        if (this.active && generation === this.generation && this.handWorker)
          this.handWorker.postMessage(
            { type: "frame", bitmap, timestamp: now },
            [bitmap],
          );
        else bitmap.close();
      } catch (e) {
        if (generation === this.generation) this.failHands(String(e));
      }
    }
    if (this.active && generation === this.generation)
      this.frameHandle = requestAnimationFrame(this.loop);
  };
  failHands(message: string) {
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handFps = 0;
    this.handBusy = false;
    this.handReady = false;
    this.handWorker?.terminate();
    this.handWorker = null;
    this.handError = "手部识别暂不可用，请重新连接相机";
    this.hands = {
      available: false,
      detections: [],
      processing: 0,
      error: this.handError,
    };
    this.onHands(this.hands, performance.now());
    if (this.active && !this.handRetried && this.handDelegate === "GPU") {
      this.handRetried = true;
      this.handError = "正在切换手部识别兼容模式…";
      this.startHands(this.generation, "CPU");
      console.info("Hand inference switched to CPU:", message);
    } else console.warn("Hand worker:", message);
  }
  stop() {
    this.generation++;
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = null;
    this.handFps = this.handFrames = this.handWindow = 0;
    cancelAnimationFrame(this.frameHandle);
    this.active = false;
    this.ready = false;
    this.handReady = false;
    this.handBusy = false;
    this.handSent = this.handCaptureAt = this.handResultAt = 0;
    this.handWorker?.terminate();
    this.handWorker = null;
    this.handError = "";
    this.hands = { available: false, detections: [], processing: 0 };
    this.busy = false;
    this.fps = 0;
    this.lastVideo = -1;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.preview.srcObject = null;
    this.preview.pause();
    this.video.srcObject = null;
    this.video.pause();
    this.startedAt = 0;
    this.lastFrameAt = 0;
    this.lastResultAt = 0;
    this.processingMs = 0;
    this.worker?.terminate();
    this.worker = null;
  }
}
