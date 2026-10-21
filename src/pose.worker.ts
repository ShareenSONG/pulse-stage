/// <reference lib="webworker" />
import {
  FilesetResolver,
  PoseLandmarker,
  HandLandmarker,
} from "@mediapipe/tasks-vision";
import { POSE_MODEL, HAND_MODEL } from "./model";
let pose: PoseLandmarker | null = null;
let hands: HandLandmarker | null = null;
let task: "pose" | "hands" = "pose";
let delegate: "CPU" | "GPU" = "CPU";
self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === "init") {
    task = e.data.task ?? "pose";
    try {
      const files = await FilesetResolver.forVisionTasks("/wasm");
      if (task === "pose") {
        const options = {
          runningMode: "VIDEO" as const,
          numPoses: 1,
          minPoseDetectionConfidence: 0.6,
          minPosePresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        };
        try {
          pose = await PoseLandmarker.createFromOptions(files, {
            ...options,
            baseOptions: { modelAssetPath: POSE_MODEL.asset, delegate: "GPU" },
          });
          delegate = "GPU";
        } catch {
          pose = await PoseLandmarker.createFromOptions(files, {
            ...options,
            baseOptions: { modelAssetPath: POSE_MODEL.asset, delegate: "CPU" },
          });
        }
      } else {
        const options = {
          runningMode: "VIDEO" as const,
          numHands: 2,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
        };
        // Hand inference uses its own worker/context. CPU fallback is explicit.
        if (e.data.delegate !== "CPU")
          try {
            hands = await HandLandmarker.createFromOptions(files, {
              ...options,
              baseOptions: {
                modelAssetPath: HAND_MODEL.asset,
                delegate: "GPU",
              },
            });
            delegate = "GPU";
          } catch {
            /* Use CPU if GPU initialization is unsupported. */
          }
        if (!hands) {
          hands = await HandLandmarker.createFromOptions(files, {
            ...options,
            baseOptions: { modelAssetPath: HAND_MODEL.asset, delegate: "CPU" },
          });
          delegate = "CPU";
        }
      }
      self.postMessage({ type: "ready", task, delegate });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err), task });
    }
  } else if (e.data.type === "frame") {
    const { bitmap, timestamp } = e.data;
    const start = performance.now();
    try {
      if (task === "pose") {
        const result = pose!.detectForVideo(bitmap, timestamp);
        self.postMessage({
          type: "pose",
          points: result.landmarks[0] ?? [],
          timestamp,
          processing: performance.now() - start,
        });
      } else {
        const found = hands!.detectForVideo(bitmap, timestamp);
        self.postMessage({
          type: "hands",
          timestamp,
          handInput: {
            available: true,
            delegate,
            detections: found.landmarks.map((points, i) => ({
              points,
              label: found.handedness[i]?.[0]?.categoryName ?? "Unknown",
              handednessScore: found.handedness[i]?.[0]?.score ?? 0,
            })),
            processing: performance.now() - start,
          },
        });
      }
    } catch (err) {
      self.postMessage({ type: "error", message: String(err), task });
    } finally {
      bitmap.close();
    }
  }
};
