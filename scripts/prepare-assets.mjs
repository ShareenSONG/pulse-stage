import { mkdir, cp, access, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const model = "public/models/pose_landmarker_lite.task";
await mkdir("public/models", { recursive: true });
await mkdir("public/wasm", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/wasm", {
  recursive: true,
});
try {
  await access(model);
} catch {
  const r = await fetch(
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  );
  if (!r.ok) throw Error(`模型下载失败 ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  await writeFile(model, data);
  console.log(
    "模型已准备",
    data.length,
    "bytes",
    createHash("sha256").update(data).digest("hex"),
  );
}
const handModel = "public/models/hand_landmarker.task";
try {
  await access(handModel);
} catch {
  const r = await fetch(
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  );
  if (!r.ok) throw Error(`手部模型下载失败 ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer());
  const hash = createHash("sha256").update(data).digest("hex");
  if (
    hash !== "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
  )
    throw Error("手部模型校验失败");
  await writeFile(handModel, data);
  console.log(
    "手部模型已准备",
    data.length,
    createHash("sha256").update(data).digest("hex"),
  );
}
await mkdir("public/charts", { recursive: true });
for (const duration of [32, 60])
  for (const mode of ["XY", "Z0", "Z1"])
    for (const reverse of [false, true]) {
      if (reverse && mode !== "Z1") continue;
      const zs = duration === 32 ? [10, 22] : [10, 22, 34, 46, 54];
      let notes = [],
        id = 0;
      for (let t = 2; t < duration - 1; t += 0.5) {
        if (zs.some((z) => t >= z - 2 && t <= z + 1.5)) continue;
        const b = Math.round(t * 2),
          left = b % 2 === 0;
        const kind =
          b % 12 === 0
            ? "sway"
            : b % 8 === 0
              ? "double"
              : b % 4 < 2
                ? "slash"
                : "catch";
        const y = b % 6 === 0 ? 0.32 : b % 6 === 3 ? 0.64 : 0.48;
        notes.push({
          id: `n${id++}`,
          time: t,
          kind,
          x: left ? 0.32 : 0.68,
          y,
          ...(["catch", "slash"].includes(kind)
            ? { hand: left ? "left" : "right" }
            : {}),
          ...(kind === "slash" ? { dx: 0, dy: b % 4 === 0 ? -1 : 1 } : {}),
        });
      }
      for (let i = 0; i < zs.length; i++)
        notes.push({
          id: `z${i}`,
          time: zs[i],
          kind: mode === "XY" ? "double" : mode === "Z0" ? "pulse" : "step",
          x: 0.5,
          y: 0.5,
          ...(mode === "Z1"
            ? {
                direction:
                  (i % 2 === 0) !== reverse
                    ? "toward_camera"
                    : "away_from_camera",
              }
            : {}),
        });
      notes.sort((a, b) => a.time - b.time);
      await writeFile(
        `public/charts/${duration}-${mode}${reverse ? "-reverse" : ""}.json`,
        JSON.stringify(
          {
            id: `neon-bloom-${duration}-${mode}${reverse ? "-reverse" : ""}`,
            version: "0.1.0",
            bpm: 120,
            duration,
            mode,
            notes,
          },
          null,
          2,
        ),
      );
    }
console.log("本地 WASM、模型和三配置谱面已准备");
