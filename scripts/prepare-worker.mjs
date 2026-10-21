import { build } from "esbuild";
await build({
  entryPoints: ["src/pose.worker.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "public/pose-worker.js",
  minify: true,
});
console.log("本地姿态识别 Worker 已构建");
