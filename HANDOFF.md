# 新窗口上下文交接

这份文档用于在新的 Codex/IDE 窗口中快速接上当前项目上下文，避免重新摸索项目结构和近期改动。

## 当前仓库状态

- 仓库路径：`C:\LiuZhaoWorkspace\project\gongzhonghao-auto`
- 远程仓库：`https://github.com/lzzz0210/gongzhonghao-0522.git`
- 当前分支：`main`
- 当前 GUI 版本：`1.0.8`
- 重要历史提交：
  - `c1fc807 Update project documentation`
  - `4fd17b4 Harden GUI release build`

当前主要开发对象是 `gongzhonghao-gui/` Electron 桌面应用。根目录 `collect_draft.js` 是旧的 CLI 工具，仍保留可用，但不是当前重点。

## 项目目标

做一个给别人使用的微信公众号文章采集桌面工具：

1. 搜索微信公众号。
2. 拉取公众号文章列表。
3. 选择/筛选文章。
4. 下载并清洗文章 HTML。
5. 上传封面和正文图片到微信公众号。
6. 创建微信公众号草稿。

依赖的外部服务：

- 第三方文章 API：`https://down.mptext.top`
- 微信公众号 API：`https://api.weixin.qq.com`
- 可选 AI 搜索增强：OpenAI-compatible chat completions 格式；GUI 已内置国内服务商预设，包括 MiniMax、DeepSeek、阿里百炼 / 通义千问、Kimi / Moonshot、智谱 GLM、火山方舟 / 豆包、百度千帆 / 文心、腾讯混元、讯飞星火、硅基流动，并保留自定义兼容接口。

## 关键目录

```text
.
├─ README.md                       # 项目总说明
├─ HANDOFF.md                      # 当前交接文档
├─ collect_draft.js                # CLI 采集/发布工具
├─ config.example.js               # CLI 配置模板
└─ gongzhonghao-gui/
   ├─ README.md                    # GUI 桌面应用说明
   ├─ package.json                 # Electron 应用版本和命令
   ├─ forge.config.js              # Electron Forge 打包配置
   └─ src/
      ├─ main.js                   # Electron 主进程和 IPC
      ├─ preload.js                # contextBridge 暴露 API
      ├─ renderer.js               # 前端页面交互逻辑
      ├─ index.html                # UI 和样式
      └─ main-process/
         ├─ ai-client.js
         ├─ config-store.js
         ├─ content-utils.js
         ├─ http-client.js
         ├─ third-party-api.js
         └─ wechat-api.js
```

## 最近完成的工作

### 1. GUI 稳定性和安全修复

提交：`4fd17b4 Harden GUI release build`

已修复：

- 修正 `@electron-forge/plugin-webpack` 版本，解决新环境 `npm install` 失败。
- GUI 版本升级到 `1.0.7`。
- 使用 Electron `safeStorage` 加密保存 `authKey`、`appSecret`、`aiApiKey`。
- 渲染进程不再直接获取完整密钥，只获取 `hasAuthKey` 等布尔状态。
- `access_token` 缓存按 `appId/appSecret` 区分，避免切换公众号后复用旧 token。
- 发布流程外层失败会返回 `result.error`，避免界面误显示成功。
- 去掉 `webSecurity: false`。
- 外部链接统一通过系统浏览器打开。
- 图片上传增加超时，避免任务卡死。
- 切换公众号时清空已勾选文章。
- `authKey` 和 `appSecret` 输入框改为 password。
- 保存配置时先验证，通过后再落盘。

### 2. 文档更新

提交：`c1fc807 Update project documentation`

已更新：

- 根目录 `README.md`：项目整体说明、GUI/CLI 两个入口、核心流程、运行/打包命令、安全说明。
- `gongzhonghao-gui/README.md`：桌面应用功能、配置、使用流程、打包产物、配置存储、常见问题和开发注意事项。

### 3. 国内 AI 预设与 1.0.8 版本

本轮更新：

- GUI 版本升级到 `1.0.8`。
- AI 服务商下拉框新增国内常用服务商预设。
- 选择服务商后自动填充默认 `Base URL` 和推荐模型，模型字段仍可手动修改。
- 根目录和 GUI README 已补充国内 AI 预设说明。
- `.gitignore` 已排除本地源码快照压缩包，避免误提交分发文件。

## 已验证命令

在 `gongzhonghao-gui/` 下验证过：

```bash
npm install
npm run package
npm run make
npm audit --omit=dev
```

结果：

- `npm install` 成功。
- `npm run package` 成功。
- `npm run make` 成功。
- `npm audit --omit=dev` 返回 `found 0 vulnerabilities`。

打包产物位置：

```text
gongzhonghao-gui/out/make/
```

Windows 产物示例：

```text
gongzhonghao-gui/out/make/squirrel.windows/x64/公众号文章采集-1.0.8 Setup.exe
gongzhonghao-gui/out/make/zip/win32/x64/公众号文章采集-win32-x64-1.0.8.zip
```

注意：`out/` 已被 `.gitignore` 排除，不会提交到仓库。

## 本地运行方式

```bash
cd gongzhonghao-gui
npm run start
```

运行后 Electron 桌面窗口标题为：

```text
公众号文章采集
```

开发服务默认地址：

```text
http://localhost:9000
```

历史运行日志目录：

```text
gongzhonghao-gui/.run-logs/
```

该目录只是本地辅助日志，不应提交。

## 配置和密钥

GUI 配置不存放在项目目录中，而是保存到 Electron `userData/config.json`。

敏感字段：

- `authKey`
- `appSecret`
- `aiApiKey`

当前实现会优先使用 Electron `safeStorage` 加密。旧版明文配置在下次保存时会迁移为加密格式。

CLI 工具使用根目录 `config.js`。该文件包含明文密钥，已经在 `.gitignore` 中排除。

## 常见注意事项

- PowerShell 输出中文时可能显示乱码，但文件本身是 UTF-8，代码和 README 中的中文内容正常。
- `npm run package` / `npm run make` 会刷新 `.webpack/` 临时构建文件。如果 `.webpack/` 出现在 git 状态中，提交前应清理或还原。
- 不要提交：
  - `out/`
  - `node_modules/`
  - `.run-logs/`
  - `config.js`
  - `publish_state.json`
  - 任何真实密钥
- 微信公众号 API 需要配置 IP 白名单，否则 token 或草稿接口会失败。
- 第三方 Auth Key 有有效期，过期后需要到 `down.mptext.top` 重新获取。

## 下一步建议

- 给 GUI 加一个“导出诊断日志”按钮，方便非技术用户反馈问题。
- 给发布成功的文章做本地记录，避免 GUI 模式重复发布。
- 给文章列表增加分页或“加载更多”，当前 GUI 只取第一页文章。
- 把正文清洗和发布流程加上单元测试，尤其是 `content-utils.js`。
- 为 release 增加 GitHub tag 和 release notes，而不仅是提交到 `main`。

## 接手时先做什么

新的工作窗口可以先运行：

```bash
git status --short --branch
git log --oneline -5
cd gongzhonghao-gui
npm install
npm run start
```

如果要继续发版：

```bash
cd gongzhonghao-gui
npm version patch --no-git-tag-version
npm run make
```

确认无误后再提交 `package.json`、`package-lock.json` 和相关源码/文档改动。
