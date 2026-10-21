import test from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../src/camera";
import { inputHealth } from "../src/input-health";

// Deliberately simulate a browser which pauses video when its DOM subtree is
// removed. This reproduces the failing lab -> home -> play lifecycle without
// asking a test runner to record a real person.
class Element {
  parent: Element | null = null;
  children: Element[] = [];
  root = false;
  style = { cssText: "", opacity: "" };
  className = "";
  muted = false;
  playsInline = false;
  autoplay = false;
  paused = true;
  readyState = 3;
  currentTime = 0;
  srcObject: any = null;
  get isConnected(): boolean {
    return this.root || Boolean(this.parent?.isConnected);
  }
  setAttribute() {}
  append(e: Element) {
    e.remove();
    e.parent = this;
    this.children.push(e);
  }
  prepend(e: Element) {
    this.append(e);
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
    this.paused = true;
  }
  set innerHTML(_value: string) {
    for (const e of [...this.children]) e.remove();
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
}
test("camera keeps capturing after lab content is destroyed and on home/play/results", async (t) => {
  const names = [
    "document",
    "navigator",
    "Worker",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "createImageBitmap",
  ];
  const old = new Map(
    names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  t.after(() => {
    for (const name of names) {
      const d = old.get(name);
      if (d) Object.defineProperty(globalThis, name, d);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const body = new Element();
  body.root = true;
  const page = new Element();
  body.append(page);
  let frameRequests = 0,
    stopped = 0,
    terminated = 0,
    bitmapCloses = 0;
  const track = {
    onended: null,
    stop() {
      stopped++;
    },
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  class WorkerMock {
    onmessage: any;
    onerror: any;
    task = "pose";
    postMessage(message: any) {
      if (message.type === "init") {
        this.task = message.task ?? "pose";
        queueMicrotask(() =>
          this.onmessage({ data: { type: "ready", delegate: "CPU" } }),
        );
      } else if (this.task === "hands") {
        queueMicrotask(() =>
          this.onmessage({
            data: {
              type: "hands",
              timestamp: message.timestamp,
              handInput: { available: true, detections: [], processing: 12 },
            },
          }),
        );
      } else {
        frameRequests++;
        queueMicrotask(() =>
          this.onmessage({
            data: {
              type: "pose",
              points: [],
              timestamp: message.timestamp,
              processing: 143,
            },
          }),
        );
      }
    }
    terminate() {
      terminated++;
    }
  }
  const env: Record<string, unknown> = {
    document: { body, createElement: () => new Element() },
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    Worker: WorkerMock,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    createImageBitmap: async (video: Element) => {
      assert.equal(video.isConnected, true, "inference source was detached");
      assert.equal(video.paused, false, "inference source stopped playing");
      return {
        close() {
          bitmapCloses++;
        },
      };
    },
  };
  for (const [name, value] of Object.entries(env))
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  const camera = new Camera();
  let results = 0;
  camera.onPose = () => results++;
  await camera.start();
  await Promise.resolve();
  const worker = camera.worker,
    source = camera.video;
  const slot = new Element();
  page.append(slot);
  camera.mountPreview(slot as any, true);
  assert.notEqual(camera.preview, source);
  for (const route of ["home", "play", "results", "home"]) {
    page.innerHTML = `<main>${route}</main>`;
    assert.equal(source.isConnected, true, route);
    assert.equal(camera.preview.isConnected, false, route);
    assert.equal(source.paused, false, route);
    assert.equal(camera.worker, worker, "route switch must not recreate model");
    source.currentTime += 0.1;
    camera.lastSent = -1000;
    await camera.loop();
    await Promise.resolve();
  }
  assert.ok(frameRequests >= 4);
  assert.ok(results >= 4);
  assert.equal(stopped, 0);
  assert.equal(terminated, 0);
  camera.setPreviewVisible(false);
  source.currentTime += 0.1;
  camera.lastSent = -1000;
  await camera.loop();
  await Promise.resolve();
  assert.ok(frameRequests >= 5, "hiding preview must not stop inference");
  const oldHands = camera.handWorker;
  camera.handDelegate = "GPU";
  camera.failHands("test: GPU context lost");
  await Promise.resolve();
  assert.notEqual(
    camera.handWorker,
    oldHands,
    "hand GPU failure must retry CPU",
  );
  assert.equal(camera.handDelegate, "CPU");
  assert.equal(
    camera.worker,
    worker,
    "hand failure must not restart body tracking",
  );
  source.currentTime += 0.1;
  camera.lastSent = -1000;
  const before = results;
  await camera.loop();
  await Promise.resolve();
  assert.ok(
    results > before,
    "body inference must continue during hand fallback",
  );
  camera.stop();
  assert.equal(stopped, 1);
  assert.equal(
    terminated,
    3,
    "GPU hand worker, CPU retry, and pose worker must be released",
  );
  assert.equal(camera.active, false);
  assert.equal(source.srcObject, null);
  assert.equal(
    bitmapCloses,
    0,
    "ownership transferred to worker; source thread must not close transferred bitmaps",
  );
});
const sample = {
  active: true,
  ready: true,
  busy: false,
  now: 10000,
  startedAt: 1000,
  lastFrameAt: 9980,
  lastResultAt: 9857,
  fps: 7,
};
test("143ms/7fps inference is slow practice, never a camera-disconnect pause", () => {
  const result = inputHealth(sample);
  assert.equal(result.state, "slow");
  assert.equal(result.pause, false);
  assert.equal(result.slow, true);
});
test("fresh video but stalled worker has a distinct diagnostic", () => {
  const result = inputHealth({ ...sample, busy: true, lastResultAt: 7000 });
  assert.equal(result.state, "inference-stalled");
  assert.equal(result.pause, true);
});
test("a real capture stall still pauses", () => {
  assert.equal(
    inputHealth({ ...sample, lastFrameAt: 7000, lastResultAt: 7100 }).state,
    "capture-stalled",
  );
});
test("first-frame warmup is not prematurely treated as a fault", () => {
  assert.equal(
    inputHealth({ ...sample, startedAt: 9500, lastFrameAt: 0, lastResultAt: 0 })
      .pause,
    false,
  );
});
