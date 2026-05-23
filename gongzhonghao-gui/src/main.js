const { app, ipcMain, BrowserWindow, dialog, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const { createConfigStore } = require('./main-process/config-store')
const { httpRequest, withRetry, delay } = require('./main-process/http-client')
const { createThirdPartyApi } = require('./main-process/third-party-api')
const {
  extractCover,
  extractFirstImage,
  extractImageUrls,
  removeImageBySource,
  replaceImageSource,
  sanitizeArticleContent
} = require('./main-process/content-utils')
const { createWechatApi } = require('./main-process/wechat-api')
const { createAiClient } = require('./main-process/ai-client')

let squirrelEvent = false

if (process.platform === 'win32') {
  const squirrelCommand = process.argv[1]

  switch (squirrelCommand) {
    case '--squirrel-install':
    case '--squirrel-updated': {
      squirrelEvent = true
      const updateExe = path.resolve(process.execPath, '..', '..', 'Update.exe')
      const exeName = path.basename(process.execPath)

      spawn(updateExe, ['--createShortcut', exeName, '--shortcut-locations', 'StartMenu,Desktop'], { detached: true })
        .on('close', () => app.quit())

      if (squirrelCommand === '--squirrel-install') {
        spawn(updateExe, ['--processStart', exeName], { detached: true })
      }
      break
    }
    case '--squirrel-uninstall': {
      squirrelEvent = true
      const updateExe = path.resolve(process.execPath, '..', '..', 'Update.exe')
      const exeName = path.basename(process.execPath)

      spawn(updateExe, ['--removeShortcut', exeName], { detached: true })
        .on('close', () => app.quit())
      break
    }
    case '--squirrel-obsolete': {
      squirrelEvent = true
      app.quit()
      break
    }
  }
}

const configStore = createConfigStore(app)
const thirdPartyApi = createThirdPartyApi(httpRequest)
const wechatApi = createWechatApi(httpRequest, withRetry)
const aiClient = createAiClient(httpRequest)
let runningTask = null

function dedupeAccounts(accounts) {
  const seen = new Set()
  const result = []

  for (const account of accounts) {
    const key = account.fakeid || account.alias || account.nickname
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(account)
  }

  return result
}

async function searchAccountsByKeywords(authKey, keywords) {
  const allAccounts = []

  for (const keyword of keywords) {
    const data = await thirdPartyApi.get(authKey, '/api/public/v1/account', { keyword })
    allAccounts.push(...(data.list || []))
    await delay(300)
  }

  return dedupeAccounts(allAccounts)
}

function buildQrBlock(qrImageUrl) {
  return [
    '<section style="margin-top:24px;text-align:center;">',
    '<p style="font-size:14px;color:#666;margin-bottom:8px;">扫码关注，获取更多本地活动信息</p>',
    `<img src="${qrImageUrl}" style="max-width:180px;width:180px;height:auto;" />`,
    '</section>'
  ].join('')
}

function isContentTooLongError(err) {
  const message = String(err && err.message ? err.message : err)
  return message.includes('45008') ||
    message.includes('content is too long') ||
    message.includes('too long') ||
    message.includes('内容过长') ||
    message.includes('超出')
}

function isInvalidContentError(err) {
  const message = String(err && err.message ? err.message : err)
  return message.includes('45166') || message.includes('invalid content')
}

function limitText(value, maxLength) {
  const text = String(value || '').trim()
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text
}

async function uploadArticleImages(content, accessToken, log) {
  const imageUrls = extractImageUrls(content)
  if (imageUrls.length === 0) return { content, uploaded: 0, removed: 0 }

  log(`  正在处理正文图片 ${imageUrls.length} 张...`)
  let nextContent = content
  let uploaded = 0
  let removed = 0

  for (const imageUrl of imageUrls) {
    try {
      const uploadedUrl = await wechatApi.uploadInlineImage(imageUrl, accessToken)
      nextContent = replaceImageSource(nextContent, imageUrl, uploadedUrl)
      uploaded++
    } catch (err) {
      nextContent = removeImageBySource(nextContent, imageUrl)
      removed++
      log(`  正文图片处理失败，已移除: ${err.message}`)
    }
  }

  log(`  正文图片: 已上传 ${uploaded} 张${removed ? `，已移除 ${removed} 张` : ''}`)
  return { content: nextContent, uploaded, removed }
}

function registerIpcHandlers() {
  ipcMain.handle('get-config', () => configStore.loadPublicConfig())

  ipcMain.handle('save-config', (event, config) => {
    configStore.saveConfig(config, { preserveSecrets: true })
    return { success: true, config: configStore.loadPublicConfig() }
  })

  ipcMain.handle('choose-qr-image', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择自己的二维码图片',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
      ]
    })

    if (result.canceled || !result.filePaths.length) return ''
    return result.filePaths[0]
  })

  ipcMain.handle('validate-config', async (event, config) => {
    config = configStore.mergePublicConfig(config)
    const errors = []

    try {
      const data = await thirdPartyApi.get(config.authKey, '/api/public/v1/authkey')
      if (data.code !== undefined && data.code !== 0) {
        errors.push(data.message || data.msg || 'Auth Key 无效或已过期')
      }
    } catch (err) {
      errors.push(`Auth Key 验证失败: ${err.message}`)
    }

    try {
      await wechatApi.getAccessToken(config.appId, config.appSecret)
    } catch (err) {
      errors.push(`微信 AppID/AppSecret 验证失败: ${err.message}`)
    }

    return { success: errors.length === 0, errors }
  })

  ipcMain.handle('test-ai-config', async (event, config) => {
    config = configStore.mergePublicConfig(config)
    if (!aiClient.isConfigured(config)) {
      throw new Error('请先启用 AI，并填写 AI Base URL、模型和 API Key')
    }
    return aiClient.test(config)
  })

  ipcMain.handle('search-account', async (event, keyword) => {
    const cfg = configStore.loadConfig()
    const data = await thirdPartyApi.get(cfg.authKey, '/api/public/v1/account', { keyword })
    return data.list || []
  })

  ipcMain.handle('search-accounts-enhanced', async (event, keyword) => {
    const cfg = configStore.loadConfig()
    let keywords = [keyword]
    let aiUsed = false
    let warning = ''

    if (aiClient.isConfigured(cfg)) {
      try {
        keywords = await aiClient.expandSearchKeywords(cfg, keyword)
        aiUsed = true
      } catch (err) {
        warning = `AI 扩展搜索词失败，已使用原关键词搜索: ${err.message}`
      }
    }

    const accounts = await searchAccountsByKeywords(cfg.authKey, keywords)
    return { accounts, keywords, aiUsed, warning }
  })

  ipcMain.handle('get-article-list', async (event, fakeid) => {
    try {
      const cfg = configStore.loadConfig()
      const data = await thirdPartyApi.get(cfg.authKey, '/api/public/v1/article', { fakeid, begin: 0, size: 20 })
      return data.articles || []
    } catch (err) {
      console.error('获取文章列表失败:', err)
      throw err
    }
  })

  ipcMain.handle('publish-articles', async (event, publishConfig) => {
    if (runningTask) return { error: '任务执行中' }
    runningTask = true
    const log = (msg) => event.sender.send('task-log', msg)
    const results = { published: 0, failed: 0 }

    try {
      const cfg = configStore.loadConfig()
      if (!cfg.authKey || !cfg.appId || !cfg.appSecret) {
        throw new Error('请先在配置页面填写密钥并保存')
      }
      if (!publishConfig.articles || publishConfig.articles.length === 0) {
        throw new Error('请选择要发布的文章')
      }

      const accessToken = await wechatApi.getAccessToken(cfg.appId, cfg.appSecret)
      log('Token 获取成功')

      for (const article of publishConfig.articles) {
        log(`发布: ${article.title}`)
        try {
          log('  下载文章内容...')
          const content = await thirdPartyApi.get(cfg.authKey, '/api/public/v1/download', { url: article.url, format: 'html' }, 3, 60000)
          const sanitizeOptions = { removeOriginalQr: cfg.removeOriginalQrEnabled }
          const sanitized = sanitizeArticleContent(content, sanitizeOptions)
          let finalContent = sanitized.content
          const removedBlocks = sanitized.report.mpBlocks + sanitized.report.wxOpenBlocks + sanitized.report.iframeBlocks + sanitized.report.objectBlocks + sanitized.report.embedBlocks + sanitized.report.mediaBlocks
          if (removedBlocks > 0) log(`  已移除不可发布组件 ${removedBlocks} 个`)
          if (sanitized.report.qrImages > 0) log(`  已移除疑似原二维码 ${sanitized.report.qrImages} 张`)
          const coverCandidates = [...new Set([extractCover(content), extractFirstImage(finalContent)].filter(Boolean))]

          let thumbMediaId = ''
          for (let i = 0; i < coverCandidates.length; i++) {
            const imageUrl = coverCandidates[i]
            try {
              log(i === 0 ? '  上传封面...' : '  尝试使用正文首图作为封面...')
              thumbMediaId = await wechatApi.uploadImage(imageUrl, accessToken)
              log('  封面: 成功')
              break
            } catch (err) {
              log(`  封面上传失败: ${err.message}`)
            }
          }
          if (!thumbMediaId) {
            throw new Error('封面上传失败，微信草稿要求必须有有效封面 media_id')
          }

          const imageResult = await uploadArticleImages(finalContent, accessToken, log)
          finalContent = imageResult.content

          let qrBlock = ''
          if (cfg.appendQrEnabled && cfg.qrImagePath) {
            try {
              log('  上传自己的二维码...')
              const qrImageUrl = await wechatApi.uploadInlineImage(cfg.qrImagePath, accessToken)
              qrBlock = buildQrBlock(qrImageUrl)
              finalContent += qrBlock
              log('  已追加自己的二维码')
            } catch (err) {
              log(`  追加二维码失败: ${err.message}`)
            }
          }

          log('  创建草稿...')
          const draftData = {
            articles: [{
              title: limitText(article.title || '无标题', 64),
              author: (article.author || '').substring(0, 20),
              digest: limitText(article.title || '', 54),
              content: finalContent,
              thumb_media_id: thumbMediaId,
              need_open_comment: 1,
              only_fans_can_comment: 0
            }]
          }
          let result
          try {
            result = await wechatApi.createDraft(draftData, accessToken)
          } catch (err) {
            if (!isContentTooLongError(err) && !isInvalidContentError(err)) throw err
            log(isContentTooLongError(err) ? '  微信提示内容过长，正在压缩后重试...' : '  微信提示正文格式无效，正在严格清洗后重试...')
            const retrySanitized = sanitizeArticleContent(content, {
              ...sanitizeOptions,
              strict: isInvalidContentError(err),
              maxContentLength: isContentTooLongError(err) ? 180000 : undefined
            })
            const retryImages = await uploadArticleImages(retrySanitized.content, accessToken, log)
            draftData.articles[0].content = retryImages.content + qrBlock
            result = await wechatApi.createDraft(draftData, accessToken)
          }
          results.published++
          log(`  成功 (media_id: ${result.media_id || '无'})`)
        } catch (err) {
          results.failed++
          log(`  失败: ${err.message}`)
        }
        await delay(1000)
      }
      log(`完成: 成功 ${results.published}, 失败 ${results.failed}`)
    } catch (err) {
      results.error = err.message
      log(`错误: ${err.message}`)
    } finally {
      runningTask = false
    }
    return results
  })
}

function configureWebRequests(session) {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' 'unsafe-eval' 'unsafe-inline' https:; img-src 'self' data: https: http://mmbiz.qpic.cn http://res.wx.qq.com; style-src 'self' 'unsafe-inline' https:; connect-src 'self' https: ws://localhost:*;"]
      }
    })
  })

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.includes('mmbiz.qpic.cn') || details.url.includes('res.wx.qq.com')) {
      details.requestHeaders.Referer = 'https://mp.weixin.qq.com/'
    }
    callback({ requestHeaders: details.requestHeaders })
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (url === MAIN_WINDOW_WEBPACK_ENTRY) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
  })

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY)
}

if (!squirrelEvent) {
  registerIpcHandlers()

  app.whenReady().then(() => {
    const { session } = require('electron')
    configureWebRequests(session)
    createMainWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
