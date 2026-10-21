# 第三方资源与来源

本项目不是 Starri、Nex Playground、舞力全开或节奏大师的官方项目。仅参考体感节奏玩法和未来舞台的表现方向；仓库不包含这些游戏的原始角色、音乐、录屏或美术资源。游戏中的 Neon Bloom 为本项目程序生成的原创合成音乐，场景由 Canvas 绘制。

## MediaPipe

- SDK：`@mediapipe/tasks-vision` **0.10.32**，包声明许可为 **Apache-2.0**。
- [上游仓库](https://github.com/google-ai-edge/mediapipe)、[Apache 2.0 完整文本](docs/third-party/MediaPipe-LICENSE.txt)。
- `public/wasm/` 来自该 SDK；`public/pose-worker.js` 由本项目与 SDK 打包生成。
- Pose Landmarker Lite：`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
- Hand Landmarker：`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
- [人体模型说明](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)、[手部模型说明](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)。模型归原发布方，SDK与模型的原始许可和使用说明适用，项目自有代码不会覆盖第三方条款。

## Three.js

依赖保留 `three` 0.180.0，历史场景实现使用，目前主舞台使用 Canvas 2D。Three.js 采用 MIT 许可，见 [许可文本](docs/third-party/Three-LICENSE.txt)。

## 其他开发依赖

Vite、TypeScript、esbuild、tsx、Prettier 及类型声明的版本锁定在 `package-lock.json`，各自许可见对应上游包。本仓库未替用户自有代码指定统一开源许可证；公开可见不等于对全部内容授予相同使用许可。
