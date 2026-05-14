# 快捷批量重命名

面向行政、电商、自媒体和财务整理场景的小体积跨平台本地批量重命名工具。

## 已实现能力

- 文件导入：选择文件、选择文件夹、拖拽、粘贴路径、递归扫描。
- 场景预设：行政资料整理、电商 SKU 整理、自媒体素材整理、发票合同归档。
- 规则流水线：编号、日期、关键词、查找替换、清理、前后缀、大小写、扩展名、CSV 映射。
- 安全预览：实时显示原文件名、新文件名、可执行、跳过、冲突和错误状态。
- 风险拦截：重名、磁盘已有目标、非法字符、空文件名、路径过长、大小写变化提示。
- 执行与撤销：执行前 dry-run，执行后保存最近一次撤销记录。

## 常用命令

```bash
npm install
npm run dev
npm run dev:tauri
npm run build
npm run build:tauri
npm run dist
npm run dist:tauri:mac
npm test
npm run lint
```

如果 Electron 下载较慢，可以使用镜像：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install
```

## 桌面启动

构建后直接启动 Electron 生产界面：

```bash
npm run build
node_modules/electron/dist/electron.exe .
```

开发模式：

```bash
npm run dev
```

Tauri 开发模式：

```bash
npm run dev:tauri
```

Tauri 版本保留现有 React 界面，使用 `src-tauri` 中的 Rust 命令替代 Electron 主进程的本地文件能力。构建 Tauri 版本前需要安装 Rust 工具链、Cargo、Visual Studio Build Tools 和 Windows SDK。

## 发布构建

默认发布命令走 Tauri 小体积 Windows 版，并会把可执行文件复制到 `release/快捷批量重命名.exe`：

```bash
npm run dist
```

macOS 小体积版也走 Tauri。请在 Mac 上执行：

```bash
npm run dist:tauri:mac
```

免安装便携版会输出 `.app` 压缩包，用户解压后双击 `.app` 使用：

```bash
npm run dist:tauri:mac:portable
```

本地测试不签名时可执行：

```bash
npm run dist:tauri:mac:unsigned
```

Apple Silicon 和 Intel 分别构建可以使用：

```bash
npm run dist:tauri:mac:arm64
npm run dist:tauri:mac:x64
```

如果没有 Mac 机器，把项目推到 GitHub 后，在 Actions 里手动运行 `Build macOS Portable`。完成后下载 `quick-batch-renamer-macos-portable` artifact，里面就是免安装 Mac 版 zip。

## CSV 映射格式

CSV 需要包含两列：

```csv
原文件名,新文件名
old-a.txt,new-a.txt
old-b.txt,new-b.txt
```

工具会按原文件名匹配，预览无误后再执行真实改名。
