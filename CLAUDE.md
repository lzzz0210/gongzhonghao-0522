# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个**微信公众号文章采集工具**，包含两个组件：

1. **gongzhonghao-gui/** - Electron 桌面应用程序，用于交互式采集文章
2. **collect_draft.js** - Node.js 命令行工具，用于自动发布文章到草稿箱

两个组件共享相同的核心流程：搜索公众号 → 获取文章列表 → 下载文章 → 提取封面 → 上传素材 → 创建微信草稿。

## 第三方 API（down.mptext.top）

两个组件都依赖此 API 进行公众号搜索、文章列表获取和文章内容下载。API 文档见 [api.md](api.md)，离线参考页见 [API.html](API.html)。

| 端点 | 用途 |
|------|------|
| `GET /api/public/v1/account?keyword=` | 搜索公众号 |
| `GET /api/public/v1/article?fakeid=&begin=&size=` | 获取文章列表（size 最大 20） |
| `GET /api/public/v1/download?url=&format=html` | 下载文章内容 |
| `GET /api/public/v1/authkey` | 验证 API 密钥有效性 |

所有请求需携带 `X-Auth-Key` 请求头。密钥有效期与登录会话一致（4 天）。

## 常用命令

### GUI 应用程序 (gongzhonghao-gui/)
```bash
cd gongzhonghao-gui
npm install          # 安装依赖
npm run start        # 开发模式运行
npm run package      # 构建可分发包
npm run make         # 创建安装程序（Windows Squirrel .exe）
```

### CLI 命令行工具（根目录）
```bash
node collect_draft.js           # 交互模式：手动选择公众号和文章
node collect_draft.js --auto    # 自动模式：读取 config.js 中的 autoTasks 批量执行
```

项目没有配置 linter、格式化工具或测试框架。

## 架构说明

### GUI 应用程序 (gongzhonghao-gui/)

**构建链**：Electron + Electron Forge + Webpack（Babel 转译 JS，style-loader/css-loader 处理 CSS）

**进程模型**：
- `src/main.js` — 主进程。所有 HTTP 请求、微信 API 调用、文件读写均在此执行。渲染进程通过 IPC 调用这些能力。
- `src/preload.js` — 通过 `contextBridge` 暴露 `window.electronAPI`，提供 5 个 IPC 通道（getConfig, saveConfig, searchAccount, getArticleList, publishArticles）和一个日志回调。
- `src/renderer.js` — 渲染进程。三页签 UI（配置/任务/使用说明），纯 DOM 操作无框架。
- `src/index.html` — 页面结构与内联 CSS 样式。
- `forge.config.js` — Electron Forge 配置，入口点由 Webpack 插件生成（`MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY` 等变量在构建时注入）。

**GUI 配置存储**：配置保存在 `app.getPath('userData')/config.json`（JSON 格式），与 CLI 的 `config.js` 完全独立。

**安全设置**：`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, `webSecurity: false`。CSP 头在主进程中动态修改以允许微信图片域名。通过 `onBeforeSendHeaders` 设置 Referer 绕过微信图片防盗链。

### 命令行工具 (collect_draft.js)

- 零依赖，仅使用 Node.js 内置模块（https, http, fs, path, readline）
- 配置模板见 [config.example.js](config.example.js)，复制为 `config.js` 后填入真实密钥即可使用
- `config.js` 导出包含 `authKey`、`appId`、`appSecret`、`stateFile`、`autoTasks` 的配置对象
- `publish_state.json` 记录已发布的文章 ID（`{ "publishedAids": { "aid": true } }`），防止重复发布
- 自动模式下每个任务按 `filter.keywords` / `filter.excludeWords` / `filter.daysLimit` / `filter.maxArticles` 筛选文章
- 文章发布间隔 1 秒以避免微信频率限制

**autoTasks 配置结构**：每个任务包含 `name`、`enabled`、`accounts`（公众号名称数组）和 `filter` 对象（`keywords` 标题关键词、`excludeWords` 排除词、`daysLimit` 天数限制 0=不限、`maxArticles` 每次最多发布篇数）。

### 两个组件的差异

| 特性 | CLI (`collect_draft.js`) | GUI (`main.js`) |
|------|--------------------------|-----------------|
| HTTP 重试 | 无自动重试（仅下载环节重试 2 次） | 所有第三方 API 请求重试 3 次 |
| 并发控制 | 串行执行 | 通过 `runningTask` 锁防止并发 |
| 配置格式 | `config.js` (CommonJS 模块) | `config.json` (JSON) |

### 核心采集流程

1. 通过第三方 API（`https://down.mptext.top`，需 `X-Auth-Key` 请求头）搜索公众号、获取文章列表、下载文章 HTML
2. 从 HTML 中提取封面图 URL（尝试多种正则模式匹配 `og:image` 或 `mmbiz.qpic.cn` 图片）
3. 通过 `cleanHtmlContent` 提取 `#js_content` 内部内容，去除页面框架
4. 封面图通过 `material/add_material` 接口（永久素材）上传到微信，失败则使用空封面
5. 通过 `draft/add` 接口创建草稿，article 对象包含 title/author/digest/content/thumb_media_id

### access_token 缓存

CLI 和 GUI 各自独立维护内存缓存，提前 5 分钟（300 秒）过期刷新。两个组件不共享缓存。

### `config.js` 安全注意事项

`config.js` 包含真实的 API 密钥（authKey、appId、appSecret），**不应提交到版本控制**。建议在 `.gitignore` 中排除此文件。