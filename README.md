# 微信公众号文章采集工具

这是一个用于采集微信公众号文章，并发布到微信公众号草稿箱的工具项目。当前主要开发方向是 `gongzhonghao-gui/` 桌面应用，根目录下的 `collect_draft.js` 仍保留为命令行自动化工具。

## 项目组成

| 路径 | 说明 |
| --- | --- |
| `gongzhonghao-gui/` | Electron 桌面应用，面向普通使用者，支持搜索公众号、筛选文章、批量发布到草稿箱 |
| `collect_draft.js` | Node.js 命令行工具，支持交互模式和 `--auto` 自动任务模式 |
| `config.example.js` | CLI 配置模板，复制为 `config.js` 后填写密钥 |
| `api.md` / `API.html` | 第三方文章下载 API 的参考文档 |

## 核心流程

1. 使用第三方 API `https://down.mptext.top` 搜索公众号、获取文章列表、下载文章 HTML。
2. 清洗公众号文章 HTML，移除微信草稿接口不支持的组件。
3. 提取或兜底选择文章封面图，并上传到微信公众号素材库。
4. 上传正文图片，替换为微信公众号可用的图片地址。
5. 调用微信公众号 `draft/add` 接口创建草稿。

## 桌面应用

桌面应用是当前推荐使用方式。

```bash
cd gongzhonghao-gui
npm install
npm run start
```

打包安装包：

```bash
cd gongzhonghao-gui
npm run make
```

打包产物默认输出到：

```text
gongzhonghao-gui/out/make/
```

更多说明见 [gongzhonghao-gui/README.md](gongzhonghao-gui/README.md)。

## CLI 工具

CLI 适合定时任务、批量自动采集等场景。

首次使用前复制配置模板：

```bash
copy config.example.js config.js
```

填写 `config.js` 中的：

- `authKey`：第三方 API 密钥。
- `appId`：微信公众号 AppID。
- `appSecret`：微信公众号 AppSecret。
- `autoTasks`：自动任务配置。

运行方式：

```bash
node collect_draft.js
node collect_draft.js --auto
```

`config.js` 和 `publish_state.json` 已在 `.gitignore` 中排除，不应提交真实密钥或发布状态文件。

## 环境要求

- Node.js 16+，建议使用当前 LTS 版本。
- npm。
- 可访问 `down.mptext.top`、`api.weixin.qq.com`、微信图片域名。
- 微信公众号后台已配置 API IP 白名单。

## 安全说明

- GUI 会把 `authKey`、`appSecret`、`aiApiKey` 保存到 Electron `userData/config.json`，并优先使用系统安全存储能力加密。
- CLI 的 `config.js` 是明文配置文件，请只保存在本机或可信环境。
- 不要把真实密钥、打包产物、运行日志提交到仓库。

## 常用开发命令

```bash
# GUI
cd gongzhonghao-gui
npm install
npm run start
npm run package
npm run make

# CLI
node collect_draft.js
node collect_draft.js --auto
```
