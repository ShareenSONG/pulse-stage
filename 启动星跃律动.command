#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新的受支持版本。'
  read '?按回车退出'
  exit 1
fi
if curl --max-time 1 -fs http://127.0.0.1:5188/ 2>/dev/null | /usr/bin/grep -q 'Pulse Stage'; then
  printf '\n星跃律动已经在运行，请用 Chrome 打开 http://127.0.0.1:5188/ 。\n'
  read '?按回车关闭此窗口（不会停止已有游戏）'
  exit 0
fi
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f public/models/pose_landmarker_lite.task ]; then npm run assets; fi
printf '\n星跃律动将在 http://127.0.0.1:5188/ 运行。\n用 Chrome 打开；结束时在此窗口按 Control+C。\n\n'
npm run dev
