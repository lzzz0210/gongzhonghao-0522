const fs = require('fs')
const path = require('path')
const { httpRequest, withRetry, delay } = require('../src/main-process/http-client')
const { createThirdPartyApi } = require('../src/main-process/third-party-api')
const { createWechatApi } = require('../src/main-process/wechat-api')
const { createAiClient } = require('../src/main-process/ai-client')
const {
  extractCover,
  extractFirstImage,
  extractImageUrls,
  removeImageBySource,
  replaceImageSource,
  sanitizeArticleContent
} = require('../src/main-process/content-utils')

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || true]
}))

const configPath = args.config || path.join(process.env.APPDATA || '', '公众号文章采集', 'config.json')
const accountKeyword = String(args.keyword || '北京本地宝')
const targetArticleKeyword = String(args.article || '北京初夏6个宝藏赏花地推荐')
const maxDrafts = Number(args.maxDrafts || 3)
const createDrafts = args.draft !== 'false'
const qrTestImage = String(args.qr || path.join(__dirname, '..', 'src', 'baimingdan.png'))

function log(step, message) {
  console.log(`[FULL-TEST][${step}] ${message}`)
}

function assertValue(value, label) {
  if (!value) throw new Error(`missing ${label}`)
}

function isContentTooLongError(err) {
  const message = String(err && err.message ? err.message : err)
  return message.includes('45008') || message.includes('too long') || message.includes('内容过长') || message.includes('超出')
}

function isInvalidContentError(err) {
  const message = String(err && err.message ? err.message : err)
  return message.includes('45166') || message.includes('invalid content')
}

function buildQrBlock(qrImageUrl) {
  return [
    '<section style="margin-top:24px;text-align:center;">',
    '<p style="font-size:14px;color:#666;margin-bottom:8px;">扫码关注，获取更多本地活动信息</p>',
    `<img src="${qrImageUrl}" style="max-width:180px;width:180px;height:auto;" />`,
    '</section>'
  ].join('')
}

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  log('CONFIG', `loaded ${configPath}`)
  assertValue(config.authKey, 'authKey')
  assertValue(config.appId, 'appId')
  assertValue(config.appSecret, 'appSecret')
  return config
}

async function searchAccounts(api, authKey, keywords) {
  const seen = new Set()
  const accounts = []
  for (const keyword of keywords) {
    const data = await api.get(authKey, '/api/public/v1/account', { keyword })
    const list = data.list || []
    log('SEARCH', `${keyword}: ${list.length}`)
    for (const account of list) {
      const key = account.fakeid || account.alias || account.nickname
      if (!key || seen.has(key)) continue
      seen.add(key)
      accounts.push(account)
    }
    await delay(200)
  }
  return accounts
}

async function getArticles(api, authKey, fakeid, pages = 3) {
  const articles = []
  for (let i = 0; i < pages; i++) {
    const data = await api.get(authKey, '/api/public/v1/article', { fakeid, begin: i * 20, size: 20 })
    const list = data.articles || []
    articles.push(...list)
    log('ARTICLES', `page ${i + 1}: ${list.length}`)
    if (list.length < 20) break
  }
  return articles.filter(item => item.link || item.url)
}

async function uploadArticleImages(wechatApi, content, accessToken) {
  const imageUrls = extractImageUrls(content)
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
    }
  }
  return { content: nextContent, imageCount: imageUrls.length, uploaded, removed }
}

async function uploadCover(wechatApi, rawContent, cleanedContent, accessToken) {
  const coverCandidates = [...new Set([extractCover(rawContent), extractFirstImage(cleanedContent)].filter(Boolean))]
  for (const imageUrl of coverCandidates) {
    try {
      return await wechatApi.uploadImage(imageUrl, accessToken)
    } catch (err) {
      log('COVER', `candidate failed: ${err.message}`)
    }
  }
  throw new Error('cover upload failed')
}

async function buildDraftContent({ api, wechatApi, authKey, accessToken, article, removeOriginalQr, appendQr }) {
  const rawContent = await api.get(authKey, '/api/public/v1/download', { url: article.link || article.url, format: 'html' }, 3, 60000)
  const sanitized = sanitizeArticleContent(rawContent, { removeOriginalQr })
  const thumbMediaId = await uploadCover(wechatApi, rawContent, sanitized.content, accessToken)
  const images = await uploadArticleImages(wechatApi, sanitized.content, accessToken)
  let content = images.content
  let qrUploaded = false

  if (appendQr) {
    const qrImageUrl = await wechatApi.uploadInlineImage(qrTestImage, accessToken)
    content += buildQrBlock(qrImageUrl)
    qrUploaded = true
  }

  return {
    rawContent,
    content,
    thumbMediaId,
    stats: {
      length: sanitized.content.length,
      removedBlocks: sanitized.report.mpBlocks + sanitized.report.wxOpenBlocks + sanitized.report.iframeBlocks + sanitized.report.objectBlocks + sanitized.report.embedBlocks + sanitized.report.mediaBlocks,
      qrRemoved: sanitized.report.qrImages,
      imageCount: images.imageCount,
      uploadedImages: images.uploaded,
      removedImages: images.removed,
      qrUploaded
    }
  }
}

async function createOneDraft(ctx, article, index, opts = {}) {
  const built = await buildDraftContent({ ...ctx, article, removeOriginalQr: Boolean(opts.removeOriginalQr), appendQr: Boolean(opts.appendQr) })
  const draftData = {
    articles: [{
      title: `[FULL-TEST-${index}] ${(article.title || 'Untitled').substring(0, 45)}`.substring(0, 64),
      author: (ctx.accountName || '').substring(0, 20),
      digest: (article.title || '').substring(0, 54),
      content: built.content,
      thumb_media_id: built.thumbMediaId,
      need_open_comment: 1,
      only_fans_can_comment: 0
    }]
  }

  if (!createDrafts) {
    log('DRAFT', `skip create: ${draftData.articles[0].title}`)
    return { skipped: true, stats: built.stats }
  }

  try {
    const result = await ctx.wechatApi.createDraft(draftData, ctx.accessToken)
    return { mediaId: result.media_id, stats: built.stats }
  } catch (err) {
    if (!isInvalidContentError(err) && !isContentTooLongError(err)) throw err
    log('DRAFT', `retry after ${isInvalidContentError(err) ? 'invalid-content' : 'too-long'}`)
    const retrySanitized = sanitizeArticleContent(built.rawContent, {
      removeOriginalQr: Boolean(opts.removeOriginalQr),
      strict: isInvalidContentError(err),
      maxContentLength: isContentTooLongError(err) ? 180000 : undefined
    })
    const retryImages = await uploadArticleImages(ctx.wechatApi, retrySanitized.content, ctx.accessToken)
    draftData.articles[0].content = retryImages.content
    const result = await ctx.wechatApi.createDraft(draftData, ctx.accessToken)
    return {
      mediaId: result.media_id,
      retried: true,
      stats: { ...built.stats, retryUploadedImages: retryImages.uploaded, retryRemovedImages: retryImages.removed }
    }
  }
}

function chooseArticles(articles) {
  const chosen = []
  const target = articles.find(item => (item.title || '').includes(targetArticleKeyword))
  if (target) chosen.push(target)
  for (const item of articles) {
    if (chosen.length >= maxDrafts) break
    if (!chosen.some(existing => (existing.link || existing.url) === (item.link || item.url))) chosen.push(item)
  }
  return chosen
}

async function main() {
  const config = loadConfig()
  const api = createThirdPartyApi(httpRequest)
  const wechatApi = createWechatApi(httpRequest, withRetry)
  const aiClient = createAiClient(httpRequest)

  log('CONFIG', 'validate collector auth')
  await api.get(config.authKey, '/api/public/v1/authkey')
  log('CONFIG', 'validate wechat token')
  const accessToken = await wechatApi.getAccessToken(config.appId, config.appSecret)

  let keywords = [accountKeyword, '本地宝', '活动', '周末活动']
  const aiConfig = { ...config, aiEnabled: Boolean(config.aiApiKey) }
  if (aiClient.isConfigured(aiConfig)) {
    try {
      await aiClient.test(aiConfig)
      keywords = await aiClient.expandSearchKeywords(aiConfig, accountKeyword)
      log('AI', `ok, keywords=${keywords.length}`)
    } catch (err) {
      log('AI', `failed and fallback: ${err.message}`)
    }
  } else {
    log('AI', 'not configured')
  }

  const accounts = await searchAccounts(api, config.authKey, keywords.slice(0, 6))
  log('SEARCH', `dedup accounts=${accounts.length}`)
  const account = accounts.find(item => (item.nickname || '').includes(accountKeyword)) ||
    accounts.find(item => (item.nickname || '').includes('北京本地宝')) ||
    accounts[0]
  if (!account) throw new Error('no account found')
  log('SEARCH', `selected=${account.nickname || account.name || account.fakeid}`)

  const articles = await getArticles(api, config.authKey, account.fakeid, 4)
  log('ARTICLES', `total=${articles.length}`)
  const selected = chooseArticles(articles)
  if (selected.length === 0) throw new Error('no articles selected')
  log('ARTICLES', `selected=${selected.map(item => item.title).join(' | ')}`)

  const ctx = {
    api,
    wechatApi,
    authKey: config.authKey,
    accessToken,
    accountName: account.nickname || account.name || ''
  }

  const results = []
  for (let i = 0; i < selected.length; i++) {
    const article = selected[i]
    const opts = {
      appendQr: i === 0 && fs.existsSync(qrTestImage),
      removeOriginalQr: i === 1
    }
    log('DRAFT', `start ${i + 1}/${selected.length}: ${article.title}`)
    const result = await createOneDraft(ctx, article, i + 1, opts)
    results.push({ title: article.title, ...result })
    log('DRAFT', `done ${i + 1}: ${JSON.stringify(result)}`)
  }

  log('SUMMARY', JSON.stringify(results.map(item => ({
    title: item.title,
    mediaId: item.mediaId || '',
    retried: Boolean(item.retried),
    skipped: Boolean(item.skipped),
    stats: item.stats
  })), null, 2))
}

main().catch(err => {
  console.error(`[FULL-TEST][FAIL] ${err.stack || err.message}`)
  process.exitCode = 1
})
