from pathlib import Path
import shutil, hashlib, zipfile, json, argparse

project = Path(__file__).resolve().parents[1]
version = json.loads((project/'package.json').read_text())['version']
parser = argparse.ArgumentParser(description='Package a complete local game release')
parser.add_argument('--output-dir', type=Path, default=project/'releases')
args = parser.parse_args()
out = args.output_dir.resolve()/f'PulseStage-v{version}-complete'
archive = out.parent / (out.name + '.zip')
if out.exists() or archive.exists():
    raise SystemExit('发行目录已存在，请先改用新版本号，避免覆盖已交付文件。')
out.mkdir(parents=True)
shutil.copytree(project/'dist', out/'dist')
for name in ['serve.mjs','启动游戏-Mac.command','启动游戏-Windows.bat']:
    shutil.copy2(project/'distribution'/name,out/name)
source=out/'source'
source.mkdir()
for name in ['src','scripts','tests','public','legacy','distribution','docs','.github']:
    if (project/name).exists():
        shutil.copytree(project/name,source/name,ignore=shutil.ignore_patterns('.DS_Store','__pycache__'))
for name in ['package.json','package-lock.json','tsconfig.json','index.html','README.md','VERIFICATION.md','THIRD_PARTY_NOTICES.md','.nvmrc','.gitignore','启动星跃律动.command']:
    if (project/name).exists(): shutil.copy2(project/name,source/name)
(out/'开始前请读我.txt').write_text('''星跃律动 Pulse Stage v0.5.0 完整发行包

这是什么
包含已构建的游戏、完整源代码、全部模型/WASM/谱面、开发测试与说明。
不含你的摄像头画面、个人校准、游玩成绩、开发电脑依赖或测试录屏。
当前仍是体感原型，真人手掌识别精度尚未完成多人验收。

试玩（无需重新编译，无需下载游戏依赖）
1. 将压缩包完整解压，不要只取出 index.html。
2. 电脑需先安装 Node.js 22 或更新的受支持版本：https://nodejs.org/
3. Mac：双击“启动游戏-Mac.command”。Windows：双击“启动游戏-Windows.bat”。
4. 浏览器将自动打开本机地址；若未打开，复制启动窗口中的地址到电脑浏览器。
5. 允许摄像头，完成身体定位；也可以先选键盘试玩。
6. 保持启动窗口运行。结束时关闭窗口或按 Ctrl+C。

手动启动：在此文件夹打开终端，运行 node serve.mjs。
启动器每次自动选择空闲端口，不依赖开发者的5188端口。
Mac和Windows的启动脚本已提供；本轮实际验证平台为Mac，Windows启动仍需目标机器复测。
安装Node后，本机运行不需要外网，摄像头数据不会上传。
摄像头授权可能随本机端口变化需重新允许。

操作
身体左右移动控制下层飞行器，音乐拍点触碰方块；
张开手掌、伸直至少三根手指，举到肩部附近，控制上层光点接住长条并保持。
左道左掌、右道右掌、中道任一掌。先在动作实验室练习。
键盘 A/S/D 控制身体位置；按住 Q/W/E 对应上层左/中/右道；Esc暂停。
如果摄像头无法开启，检查浏览器授权和设备占用；不要直接双击dist/index.html。

用于网页上线
将 dist 内的内容部署到一个HTTPS网站的根目录。不要只上传index.html；models、wasm、pose-worker.js必须一起上传。
当前资源使用 /models、/wasm 等根路径，不能直接放到 /my-game/ 等子目录。
打开网页后同样需要允许摄像头；识别在访客设备本地进行，首次需要下载模型。
本压缩包本身不代表网站已经上线。

继续开发
source 内为源码。进入source后依次运行 npm ci、npm test、npm run build。
模型资源已包含；如需重新准备资源，运行 npm run assets。
详细玩法与验证边界见source/README.md、VERIFICATION.md与docs/requirements目录。

SHA256SUMS.txt记录发行文件摘要，可用于核验是否传输完整。
''',encoding='utf-8')
files=sorted(p for p in out.rglob('*') if p.is_file())
(out/'SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(out).as_posix()}\n' for p in files),encoding='utf-8')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(out.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(out.parent).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'files':len(files)+1,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},ensure_ascii=False))
