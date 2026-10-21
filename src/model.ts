/** The same immutable bundle is used by the worker and shown in diagnostics. */
export const POSE_MODEL = {
  name: "MediaPipe Pose Landmarker Lite",
  sdk: "@mediapipe/tasks-vision 0.10.32",
  asset: "/models/pose_landmarker_lite.task",
  bundle: "float16 / 1",
  delegate: "GPU preferred / CPU fallback",
  landmarks: 33,
  people: 1,
};

export const HAND_MODEL = {
  name: "MediaPipe Hand Landmarker",
  sdk: POSE_MODEL.sdk,
  asset: "/models/hand_landmarker.task",
  bundle: "float16 / 1",
  delegate: "GPU preferred / CPU fallback",
  landmarks: 21,
  hands: 2,
};
