export interface InputHealthSample {
  active: boolean;
  ready: boolean;
  busy: boolean;
  now: number;
  startedAt: number;
  lastFrameAt: number;
  lastResultAt: number;
  fps: number;
}
export function inputHealth(s: InputHealthSample) {
  if (!s.active || !s.ready)
    return { state: "off", message: "摄像头未开启", pause: true, slow: false };
  if (s.now - s.startedAt < 3000 && !s.lastResultAt)
    return {
      state: "warming",
      message: "正在等待第一帧识别",
      pause: false,
      slow: false,
    };
  if (s.busy && s.now - (s.lastResultAt || s.startedAt) > 2500)
    return {
      state: "inference-stalled",
      message: "模型超过2.5秒未返回结果，请重试摄像头",
      pause: true,
      slow: false,
    };
  if (s.now - (s.lastFrameAt || s.startedAt) > 1800)
    return {
      state: "capture-stalled",
      message: "视频超过1.8秒没有新帧，请检查镜头或重新连接",
      pause: true,
      slow: false,
    };
  if (s.now - (s.lastResultAt || s.startedAt) > 2500)
    return {
      state: "inference-stalled",
      message: "视频仍在采集，但模型超过2.5秒未返回结果",
      pause: true,
      slow: false,
    };
  if (s.fps > 0 && s.fps < 20)
    return {
      state: "slow",
      message: `识别偏慢 ${s.fps.toFixed(1)} FPS · 继续练习，成绩标为辅助`,
      pause: false,
      slow: true,
    };
  return {
    state: "healthy",
    message: `持续识别 ${s.fps.toFixed(1)} FPS`,
    pause: false,
    slow: false,
  };
}
