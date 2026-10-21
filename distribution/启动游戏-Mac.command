#!/bin/zsh
cd -- "$(dirname -- "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22 或更新的受支持版本：https://nodejs.org/'
  read '?按回车退出'
  exit 1
fi
node serve.mjs
