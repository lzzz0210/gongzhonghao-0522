# 公众号文章采集桌面应用

`gongzhonghao-gui` 是一个基于 Electron 的桌面应用，用于搜索微信公众号、查看文章列表、筛选文章，并把选中的文章发布到微信公众号草稿箱。

当前版本：`1.0.7`

## 主要功能

- 搜索微信公众号，展示头像、名称和简介。
- 支持 AI 扩展搜索关键词，提升本地活动类公众号的召回效果。
- 查看公众号最近文章列表，展示标题、封面和日期。
- 按标题关键词筛选文章。
- 批量发布选中文章到微信公众号草稿箱。
- 自动清洗文章 HTML，移除微信草稿接口不支持的组件。
- 上传封面图和正文图片，转换为微信公众号可用素材。
- 可选移除原文尾部疑似二维码。
- 可选在文章末尾追加自己的二维码图片。
- 本地保存配置，敏感密钥优先使用 Electron `safeStorage` 加密。
- 外部帮助链接会在系统浏览器中打开，不在 Electron 窗口内加载。

## 运行环境

- Node.js 16+，建议使用当前 LTS 版本。
- npm。
- Windows/macOS/Linux。当前打包配置主要面向 Windows。
- 能访问以下服务：
  - `https://down.mptext.top`
  - `https://api.weixin.qq.com`
  - 微信图片域名，如 `mmbiz.qpic.cn`

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run start
```

运行后会启动 Electron 桌面窗口。Webpack renderer dev server 默认监听：

```text
http://localhost:9000
```

## 打包

生成应用目录：

```bash
npm run package
```

生成可分发安装包和 zip：

```bash
npm run make
```

产物默认输出到：

```text
out/make/
```

Windows 下常见产物：

- `out/make/squirrel.windows/x64/公众号文章采集-<version> Setup.exe`
- `out/make/zip/win32/x64/公众号文章采集-win32-x64-<version>.zip`

## 使用前准备

首次使用需要准备以下信息。

| 配置项 | 说明 |
| --- | --- |
| Auth Key | 第三方 API 密钥，用于搜索公众号、获取文章列表和下载文章内容 |
| AppID | 微信公众号后台的 AppID |
| AppSecret | 微信公众号后台的 AppSecret |
| AI Base URL / Model / API Key | 可选，启用 AI 搜索增强时填写 |
| 二维码图片 | 可选，用于发布时追加自己的二维码 |

还需要在微信公众号后台配置 API IP 白名单，否则微信接口可能返回无权限或 IP 不在白名单的错误。

## 使用流程

1. 打开应用，进入“配置”页。
2. 填写 Auth Key、AppID、AppSecret。
3. 可选启用 AI 搜索增强、追加二维码、移除原文二维码。
4. 点击“保存”，应用会先验证配置，通过后再保存。
5. 进入“任务”页，输入公众号名称并搜索。
6. 选择目标公众号，等待文章列表加载。
7. 勾选要发布的文章，可用关键词筛选。
8. 点击“发布选中文章”，在底部日志查看进度和结果。

发布成功后，文章会出现在微信公众号后台的草稿箱中。

## 配置存储

配置保存在 Electron 的 `userData/config.json` 中，不在项目目录内。

敏感字段包括：

- `authKey`
- `appSecret`
- `aiApiKey`

应用会优先使用 Electron `safeStorage` 加密这些字段。读取到旧版明文配置时，下一次保存会自动迁移为加密格式。渲染进程只会得到“是否已保存密钥”的状态，不会直接拿到完整密钥。

## 项目结构

```text
gongzhonghao-gui/
├─ src/
│  ├─ main.js                       # Electron 主进程和 IPC 入口
│  ├─ preload.js                    # contextBridge 暴露安全 API
│  ├─ renderer.js                   # 页面交互逻辑
│  ├─ index.html                    # 页面结构和样式
│  └─ main-process/
│     ├─ ai-client.js               # AI 搜索关键词扩展
│     ├─ config-store.js            # 本地配置读写和密钥加密
│     ├─ content-utils.js           # 文章 HTML 清洗、图片提取和替换
│     ├─ http-client.js             # HTTP 请求和重试工具
│     ├─ third-party-api.js         # down.mptext.top API 封装
│     └─ wechat-api.js              # 微信 token、素材上传、草稿创建
├─ forge.config.js                  # Electron Forge 配置
├─ package.json
└─ package-lock.json
```

## 常见问题

### 依赖安装失败

先确认 Node.js 和 npm 可用：

```bash
node --version
npm --version
```

如果安装很慢或超时，通常是网络访问 npm 或 Electron 资源不稳定导致，可以换网络后重试。

### 配置验证失败

检查以下内容：

- Auth Key 是否有效，第三方 API 登录态可能会过期。
- AppID 和 AppSecret 是否来自同一个公众号。
- 微信公众号后台是否配置了当前机器公网 IP 白名单。
- 当前账号是否有素材和草稿相关接口权限。

### 发布失败

查看底部执行日志。常见原因包括：

- 文章没有可用封面图，微信草稿接口要求必须有 `thumb_media_id`。
- 正文包含微信草稿接口不支持的组件，应用会尝试清洗后重试。
- 正文图片上传失败，应用会移除失败图片并继续。
- 内容过长，应用会尝试截断后重试。

### 图片不显示

确认网络可以访问微信图片域名。应用会为微信图片请求设置 Referer，并把正文图片上传到公众号后再写入草稿。

## 开发注意事项

- 不要提交 `out/`、`.run-logs/`、真实配置或打包产物。
- `npm run make` 会生成 `.webpack/` 临时文件和 `out/` 产物；提交前只保留源码、`package.json`、`package-lock.json` 等必要文件。
- 若修改配置结构，要保持旧用户配置的兼容读取。
- 发布流程涉及真实公众号接口，功能测试前建议先用测试公众号或低风险文章。
