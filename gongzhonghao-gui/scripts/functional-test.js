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

const DEFAULT_CONFIG_PATHS = [
  path.join(process.env.APPDATA || '', '公众号文章采集', 'config.json'),
  path.join(process.env.APPDATA || '', 'gongzhonghao-gui', 'config.json')
]

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || true]
}))

const keyword = String(args.keyword || '北京本地宝')
const articleKeyword = String(args.article || '北京初夏6个宝藏赏花地推荐')
const shouldCreateDraft = args.draft !== 'false'

function log(message) {
  console.log(`[功能测试] ${message}`)
}

function requireValue(value, label) {
  if (!value) throw new Error(`缺少配置: ${label}`)
}

function loadConfig() {
  const configPath = args.config || DEFAULT_CONFIG_PATHS.find(item => item && fs.existsSync(item))
  if (!configPath) throw new Error('没有找到 GUI 配置文件')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  log(`读取配置: ${configPath}`)
  return config
}

function isContentTooLongError(err) {
  const message = String(err && err.message ? err.message : err)
  return message.includes('45008') || message.includes('too long') || message.includes('内容过长') || message.includes('超出')
}

function isInvalidContentError(err) {
  const message = String(err && err.message ? err.message : err)
  return message.includes('45166') || message.includes('invalid content')
}

async function searchAccounts(thirdPartyApi, authKey, keywords) {
  const accounts = []
  const seen = new Set()
  for (const item of keywords) {
    const data = await thirdPartyApi.get(authKey, '/api/public/v1/account', { keyword: item })
    for (const account of data.list || []) {
      const key = account.fakeid || account.alias || account.nickname
      if (!key || seen.has(key)) continue
      seen.add(key)
      accounts.push(account)
    }
    await delay(200)
  }
  return accounts
}

async function getAllArticles(thirdPartyApi, authKey, fakeid) {
  const all = []
  for (let begin = 0; begin < 100; begin += 20) {
    const data = await thirdPartyApi.get(authKey, '/api/public/v1/article', { fakeid, begin, size: 20 })
    const articles = data.articles || []
    all.push(...articles)
    if (articles.length < 20) break
  }
  return all
}

async function uploadArticleImages(wechatApi, content, accessToken) {
  let nextContent = content
  let uploaded = 0
  let removed = 0
  const urls = extractImageUrls(content)
  log(`正文图片数量: ${urls.length}`)

  for (const imageUrl of urls) {
    try {
      const uploadedUrl = await wechatApi.uploadInlineImage(imageUrl, accessToken)
      nextContent = replaceImageSource(nextContent, imageUrl, uploadedUrl)
      uploaded++
    } catch (err) {
      nextContent = removeImageBySource(nextContent, imageUrl)
      removed++
      log(`正文图片上传失败并移除: ${err.message}`)
    }
  }

  return { content: nextContent, uploaded, removed }
}

async function main() {
  const config = loadConfig()
  requireValue(config.authKey, 'Auth Key')
  requireValue(config.appId, 'AppID')
  requireValue(config.appSecret, 'AppSecret')

  const thirdPartyApi = createThirdPartyApi(httpRequest)
  const wechatApi = createWechatApi(httpRequest, withRetry)
  const aiClient = createAiClient(httpRequest)

  log('验证采集 API...')
  await thirdPartyApi.get(config.authKey, '/api/public/v1/authkey')

  log('验证微信 access_token...')
  const accessToken = await wechatApi.getAccessToken(config.appId, config.appSecret)

  let searchKeywords = [keyword]
  const aiConfig = { ...config, aiEnabled: Boolean(config.aiApiKey) }
  if (aiClient.isConfigured(aiConfig)) {
    log('测试 AI 配置并扩展搜索词...')
    try {
      await aiClient.test(aiConfig)
      searchKeywords = await aiClient.expandSearchKeywords(aiConfig, keyword)
      log(`AI 搜索词: ${searchKeywords.join('、')}`)
    } catch (err) {
      log(`AI 测试失败，已降级为普通搜索: ${err.message}`)
    }
  } else {
    log('AI 配置不完整，跳过 AI 测试')
  }

  log('搜索公众号...')
  const accounts = await searchAccounts(thirdPartyApi, config.authKey, searchKeywords)
  log(`去重后公众号数量: ${accounts.length}`)
  const account = accounts.find(item => (item.nickname || '').includes(keyword)) || accounts[0]
  if (!account) throw new Error('没有搜索到公众号')
  log(`选择公众号: ${account.nickname || account.name || account.fakeid}`)

  log('拉取文章列表...')
  const articles = await getAllArticles(thirdPartyApi, config.authKey, account.fakeid)
  log(`文章数量: ${articles.length}`)
  const article = articles.find(item => (item.title || '').includes(articleKeyword)) || articles[0]
  if (!article) throw new Error('没有找到可测试文章')
  const articleUrl = article.link || article.url
  log(`选择文章: ${article.title}`)

  log('下载并清洗正文...')
  const rawContent = await thirdPartyApi.get(config.authKey, '/api/public/v1/download', { url: articleUrl, format: 'html' }, 3, 60000)
  const sanitizeOptions = { removeOriginalQr: Boolean(config.removeOriginalQrEnabled) }
  const sanitized = sanitizeArticleContent(rawContent, sanitizeOptions)
  log(`清洗后长度: ${sanitized.content.length}`)

  log('上传封面...')
  const coverCandidates = [...new Set([extractCover(rawContent), extractFirstImage(sanitized.content)].filter(Boolean))]
  let thumbMediaId = ''
  for (const imageUrl of coverCandidates) {
    try {
      thumbMediaId = await wechatApi.uploadImage(imageUrl, accessToken)
      break
    } catch (err) {
      log(`封面候选上传失败: ${err.message}`)
    }
  }
  if (!thumbMediaId) throw new Error('封面上传失败')
  log('封面上传成功')

  log('上传并替换正文图片...')
  const imageResult = await uploadArticleImages(wechatApi, sanitized.content, accessToken)
  log(`正文图片上传成功 ${imageResult.uploaded} 张，移除 ${imageResult.removed} 张`)

  if (!shouldCreateDraft) {
    log('已跳过创建草稿')
    return
  }

  log('创建测试草稿...')
  const draftData = {
    articles: [{
      title: `[功能测试] ${(article.title || '无标题').substring(0, 54)}`.substring(0, 64),
      author: (account.nickname || '').substring(0, 20),
      digest: (article.title || '').substring(0, 54),
      content: imageResult.content,
      thumb_media_id: thumbMediaId,
      need_open_comment: 1,
      only_fans_can_comment: 0
    }]
  }

  try {
    const result = await wechatApi.createDraft(draftData, accessToken)
    log(`草稿创建成功: ${result.media_id}`)
  } catch (err) {
    if (!isInvalidContentError(err) && !isContentTooLongError(err)) throw err
    log(isInvalidContentError(err) ? '草稿创建失败: 正文格式无效，严格清洗后重试' : '草稿创建失败: 内容过长，压缩后重试')
    const retrySanitized = sanitizeArticleContent(rawContent, {
      ...sanitizeOptions,
      strict: isInvalidContentError(err),
      maxContentLength: isContentTooLongError(err) ? 180000 : undefined
    })
    const retryImages = await uploadArticleImages(wechatApi, retrySanitized.content, accessToken)
    draftData.articles[0].content = retryImages.content
    const result = await wechatApi.createDraft(draftData, accessToken)
    log(`草稿创建成功: ${result.media_id}`)
  }
}

main().catch(err => {
  console.error(`[功能测试] 失败: ${err.message}`)
  process.exitCode = 1
})
