import http from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "dist"));
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm", ".task": "application/octet-stream",
  ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.includes("\0")) throw Error("Invalid path");
    const candidate = resolve(root, "." + pathname);
    if (candidate !== root && !candidate.startsWith(root + sep)) throw Error("Forbidden");
    const info = await stat(candidate);
    const file = await realpath(info.isDirectory() ? resolve(candidate, "index.html") : candidate);
    if (!file.startsWith(root + sep)) throw Error("Forbidden");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(self), microphone=()",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("File not found");
  }
});
server.on("error", e => { console.error("启动失败：", e.message); process.exitCode = 1; });
server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`\n星跃律动 v0.5.0\n${url}\n\n请允许浏览器使用摄像头。画面只在本机处理。\n关闭此窗口或按 Ctrl+C 停止。\n`);
  if (!process.argv.includes("--no-open")) {
    const [command, args] = process.platform === "darwin" ? ["open", [url]]
      : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => console.log("请复制上面的地址到浏览器。")); child.unref();
  }
});
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
