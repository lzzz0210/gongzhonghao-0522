// ========== 全局状态 ==========
let currentConfig = null
let selectedAccount = null
let articleList = []
let selectedArticles = new Set()

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hasEffectiveSecret(config, field) {
  const flag = `has${field.charAt(0).toUpperCase()}${field.slice(1)}`
  return Boolean(config[field] || currentConfig?.[flag])
}

const AI_PROVIDER_PRESETS = {
  minimax: {
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M2.7-highspeed'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  },
  'aliyun-qwen': {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.6-plus'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6'
  },
  'zhipu-glm': {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.1'
  },
  'volcengine-doubao': {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-250615'
  },
  'baidu-qianfan': {
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-5.0'
  },
  'tencent-hunyuan': {
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    model: 'hunyuan-turbos-latest'
  },
  'iflytek-spark': {
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    model: '4.0Ultra'
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Pro/zai-org/GLM-4.7'
  }
}

function getAiProviderPreset(provider) {
  return AI_PROVIDER_PRESETS[provider] || null
}

function applyAiProviderPreset(provider, options = {}) {
  const preset = getAiProviderPreset(provider)
  if (!preset) return

  if (options.force || !aiBaseUrlInput.value.trim()) {
    aiBaseUrlInput.value = preset.baseUrl
  }
  if (options.force || !aiModelInput.value.trim()) {
    aiModelInput.value = preset.model
  }
}

function refreshSecretPlaceholders() {
  authKeyInput.placeholder = currentConfig?.hasAuthKey ? '已保存，留空表示不修改' : '第三方API密钥'
  appSecretInput.placeholder = currentConfig?.hasAppSecret ? '已保存，留空表示不修改' : '...'
  aiApiKeyInput.placeholder = currentConfig?.hasAiApiKey ? '已保存，留空表示不修改' : 'sk-...'
}

// ========== 界面元素 ==========
const tabConfig = document.getElementById('tabConfig')
const tabTask = document.getElementById('tabTask')
const tabHelp = document.getElementById('tabHelp')
const pageConfig = document.getElementById('pageConfig')
const pageTask = document.getElementById('pageTask')
const pageHelp = document.getElementById('pageHelp')

const authKeyInput = document.getElementById('authKey')
const appIdInput = document.getElementById('appId')
const appSecretInput = document.getElementById('appSecret')
const aiEnabledInput = document.getElementById('aiEnabled')
const aiProviderInput = document.getElementById('aiProvider')
const aiBaseUrlInput = document.getElementById('aiBaseUrl')
const aiModelInput = document.getElementById('aiModel')
const aiApiKeyInput = document.getElementById('aiApiKey')
const appendQrEnabledInput = document.getElementById('appendQrEnabled')
const removeOriginalQrEnabledInput = document.getElementById('removeOriginalQrEnabled')
const qrImagePathInput = document.getElementById('qrImagePath')
const saveBtn = document.getElementById('saveBtn')
const testAiBtn = document.getElementById('testAiBtn')
const chooseQrBtn = document.getElementById('chooseQrBtn')

const searchAccountInput = document.getElementById('searchAccountInput')
const searchAccountBtn = document.getElementById('searchAccountBtn')
const accountListEl = document.getElementById('accountList')
const articleCard = document.getElementById('articleCard')
const selectedAccountEl = document.getElementById('selectedAccount')
const filterKeyword = document.getElementById('filterKeyword')
const articleListEl = document.getElementById('articleList')
const publishBtn = document.getElementById('publishBtn')
const selectedCountEl = document.getElementById('selectedCount')
const logBox = document.getElementById('logBox')

// ========== Tab 切换 ==========
tabConfig.addEventListener('click', () => {
  tabConfig.classList.add('active')
  tabTask.classList.remove('active')
  tabHelp.classList.remove('active')
  pageConfig.classList.remove('hidden')
  pageTask.classList.add('hidden')
  pageHelp.classList.add('hidden')
})

tabTask.addEventListener('click', () => {
  tabTask.classList.add('active')
  tabConfig.classList.remove('active')
  tabHelp.classList.remove('active')
  pageTask.classList.remove('hidden')
  pageConfig.classList.add('hidden')
  pageHelp.classList.add('hidden')
})

tabHelp.addEventListener('click', () => {
  tabHelp.classList.add('active')
  tabConfig.classList.remove('active')
  tabTask.classList.remove('active')
  pageHelp.classList.remove('hidden')
  pageConfig.classList.add('hidden')
  pageTask.classList.add('hidden')
})

// ========== 日志 ==========
function log(msg, type = 'info') {
  const line = document.createElement('div')
  line.className = 'log-line ' + type
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  logBox.appendChild(line)
  logBox.scrollTop = logBox.scrollHeight
}

// ========== 配置保存 ==========
function readConfigForm() {
  const aiProvider = aiProviderInput.value
  const aiPreset = getAiProviderPreset(aiProvider)
  return {
    authKey: authKeyInput.value.trim(),
    appId: appIdInput.value.trim(),
    appSecret: appSecretInput.value.trim(),
    aiEnabled: aiEnabledInput.checked,
    aiProvider,
    aiBaseUrl: aiBaseUrlInput.value.trim() || aiPreset?.baseUrl || '',
    aiModel: aiModelInput.value.trim() || aiPreset?.model || '',
    aiApiKey: aiApiKeyInput.value.trim(),
    appendQrEnabled: appendQrEnabledInput.checked,
    removeOriginalQrEnabled: removeOriginalQrEnabledInput.checked,
    qrImagePath: qrImagePathInput.value.trim()
  }
}

saveBtn.addEventListener('click', async () => {
  const config = readConfigForm()
  if (!hasEffectiveSecret(config, 'authKey') || !config.appId || !hasEffectiveSecret(config, 'appSecret')) {
    log('请填写完整的密钥配置', 'error')
    return
  }
  if (config.aiEnabled && (!hasEffectiveSecret(config, 'aiApiKey') || !config.aiBaseUrl || !config.aiModel)) {
    log('启用 AI 后需要填写 AI Base URL、模型和 API Key', 'error')
    return
  }
  if (config.appendQrEnabled && !config.qrImagePath) {
    log('启用追加二维码后需要选择自己的二维码图片', 'error')
    return
  }
  saveBtn.disabled = true
  try {
    log('正在验证配置...', 'info')

    const validation = await window.electronAPI.validateConfig(config)
    if (validation.success) {
      const result = await window.electronAPI.saveConfig(config)
      currentConfig = result.config || currentConfig
      authKeyInput.value = ''
      appSecretInput.value = ''
      aiApiKeyInput.value = ''
      refreshSecretPlaceholders()
      log('配置验证通过并已保存', 'success')
    } else {
      validation.errors.forEach(error => log(error, 'error'))
    }
  } catch (err) {
    log(`配置保存失败: ${err.message}`, 'error')
  } finally {
    saveBtn.disabled = false
  }
})

testAiBtn.addEventListener('click', async () => {
  const config = readConfigForm()
  if (!config.aiEnabled || !hasEffectiveSecret(config, 'aiApiKey') || !config.aiBaseUrl || !config.aiModel) {
    log('请先启用 AI，并填写 AI Base URL、模型和 API Key', 'error')
    return
  }

  testAiBtn.disabled = true
  try {
    log('正在测试 AI 配置...', 'info')
    const result = await window.electronAPI.testAiConfig(config)
    log(result.message || 'AI 配置正常', 'success')
  } catch (err) {
    log(`AI 测试失败: ${err.message}`, 'error')
  } finally {
    testAiBtn.disabled = false
  }
})

chooseQrBtn.addEventListener('click', async () => {
  try {
    const filePath = await window.electronAPI.chooseQrImage()
    if (filePath) qrImagePathInput.value = filePath
  } catch (err) {
    log(`选择二维码失败: ${err.message}`, 'error')
  }
})

aiProviderInput.addEventListener('change', () => {
  applyAiProviderPreset(aiProviderInput.value, { force: true })
})

// ========== 搜索公众号 ==========
searchAccountBtn.addEventListener('click', searchAccount)
searchAccountInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') searchAccount()
})

async function searchAccount() {
  const keyword = searchAccountInput.value.trim()
  if (!keyword) return

  if (!currentConfig || !currentConfig.hasAuthKey) {
    log('请先在配置页面填写并保存密钥', 'error')
    return
  }

  log(`搜索公众号: ${keyword}`)
  accountListEl.innerHTML = '<div style="color:#999;padding:20px;text-align:center">搜索中...</div>'
  searchAccountBtn.disabled = true

  try {
    const result = await window.electronAPI.searchAccountsEnhanced(keyword)
    const accounts = result.accounts || []
    accountListEl.innerHTML = ''

    if (result.warning) {
      log(result.warning, 'error')
    }
    if (result.aiUsed) {
      log(`AI 扩展搜索词: ${result.keywords.join('、')}`, 'info')
    }
    log(`找到 ${accounts.length} 个公众号`)

    if (accounts.length === 0) {
      accountListEl.innerHTML = '<div style="color:#999;padding:20px;text-align:center">未找到相关公众号</div>'
      return
    }

    accounts.forEach((acc) => {
      renderAccountItem(acc)
    })
  } catch (err) {
    accountListEl.innerHTML = `<div style="color:#f48771;padding:20px;text-align:center">搜索失败: ${esc(err.message)}</div>`
    log(`搜索失败: ${err.message}`, 'error')
  } finally {
    searchAccountBtn.disabled = false
  }
}

// ========== 渲染公众号列表项 ==========
function renderAccountItem(acc) {
  const name = acc.nickname || '未知'
  const intro = acc.signature || '暂无简介'
  const avatar = acc.round_head_img || ''

  const item = document.createElement('div')
  item.className = 'account-item'
  item.dataset.fakeid = acc.fakeid

  const safeName = esc(name)
  const safeIntro = esc(intro)
  const safeAvatar = esc(avatar)
  const initial = esc(name.charAt(0))

  if (avatar) {
    item.innerHTML = `
      <img class="avatar" src="${safeAvatar}" alt="${safeName}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="avatar-placeholder" style="display:none">${initial}</div>
      <div class="info">
        <div class="name">${safeName}</div>
        <div class="intro">${safeIntro}</div>
      </div>
    `
  } else {
    item.innerHTML = `
      <div class="avatar-placeholder">${initial}</div>
      <div class="info">
        <div class="name">${safeName}</div>
        <div class="intro">${safeIntro}</div>
      </div>
    `
  }

  item.onclick = () => selectAccount(acc, item)
  accountListEl.appendChild(item)
}

// ========== 选择公众号 ==========
async function selectAccount(account, element) {
  // 移除之前的选中状态
  document.querySelectorAll('.account-item').forEach(el => el.classList.remove('selected'))
  element.classList.add('selected')

  const name = account.nickname || account.name || '未知'
  selectedAccount = account
  selectedArticles.clear()
  updateSelectedCount()
  selectedAccountEl.textContent = name ? ` - ${name}` : ''

  log(`已选择公众号: ${name}`)

  // 获取文章列表
  articleCard.classList.remove('hidden')
  articleListEl.innerHTML = '<div style="color:#999;padding:40px;text-align:center">加载文章列表...</div>'
  filterKeyword.value = ''

  try {
    const articles = await window.electronAPI.getArticleList(account.fakeid)
    articleList = articles
    renderArticleList()
    log(`获取到 ${articles.length} 篇文章`)
  } catch (err) {
    articleListEl.innerHTML = `<div style="color:#f48771;padding:40px;text-align:center">获取文章失败: ${esc(err.message)}</div>`
    log(`获取文章失败: ${err.message}`, 'error')
  }
}

// ========== 渲染文章列表 ==========
function renderArticleList() {
  const keyword = filterKeyword.value.trim().toLowerCase()
  const filtered = keyword
    ? articleList.filter(a => (a.title || '').toLowerCase().includes(keyword))
    : articleList

  articleListEl.innerHTML = ''

  if (filtered.length === 0) {
    articleListEl.innerHTML = '<div style="color:#999;padding:40px;text-align:center">暂无文章</div>'
    return
  }

  filtered.forEach((article) => {
    const date = article.update_time
      ? new Date(article.update_time * 1000).toLocaleDateString('zh-CN')
      : '未知日期'
    const title = article.title || '无标题'
    const url = article.link || article.url || ''
    const cover = article.cover || ''

    const safeTitle = esc(title)
    const safeUrl = esc(url)
    const safeCover = esc(cover)
    const safeDate = esc(date)

    const item = document.createElement('div')
    item.className = 'article-item'

    if (cover) {
      item.innerHTML = `
        <input type="checkbox" data-url="${safeUrl}" data-title="${safeTitle}">
        <img class="cover" src="${safeCover}" alt="${safeTitle}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="cover-placeholder" style="display:none">📄</div>
        <div class="info">
          <div class="title">${safeTitle}</div>
          <div class="meta"><span class="date">${safeDate}</span></div>
        </div>
      `
    } else {
      item.innerHTML = `
        <input type="checkbox" data-url="${safeUrl}" data-title="${safeTitle}">
        <div class="cover-placeholder">📄</div>
        <div class="info">
          <div class="title">${safeTitle}</div>
          <div class="meta"><span class="date">${safeDate}</span></div>
        </div>
      `
    }

    const checkbox = item.querySelector('input')
    checkbox.checked = selectedArticles.has(url)
    checkbox.onchange = () => {
      if (checkbox.checked) {
        selectedArticles.add(url)
      } else {
        selectedArticles.delete(url)
      }
      updateSelectedCount()
    }

    articleListEl.appendChild(item)
  })

  updateSelectedCount()
}

// ========== 关键词筛选 ==========
const filterBtn = document.getElementById('filterBtn')
const clearFilterBtn = document.getElementById('clearFilterBtn')

filterBtn.addEventListener('click', () => {
  renderArticleList()
})

clearFilterBtn.addEventListener('click', () => {
  filterKeyword.value = ''
  renderArticleList()
})

filterKeyword.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    renderArticleList()
  }
})

// ========== 更新选中数量 ==========
function updateSelectedCount() {
  const count = selectedArticles.size
  selectedCountEl.textContent = count > 0 ? `已选择 ${count} 篇` : ''
  publishBtn.disabled = count === 0
}

// ========== 发布文章 ==========
publishBtn.addEventListener('click', async () => {
  if (publishBtn.disabled) return
  publishBtn.disabled = true

  try {
    if (!currentConfig || !currentConfig.hasAuthKey || !currentConfig.appId || !currentConfig.hasAppSecret) {
      log('请先在配置页面填写并保存密钥', 'error')
      return
    }

    const currentSelectedUrls = new Set(selectedArticles)
    const currentArticleList = [...articleList]
    const currentAccount = selectedAccount

    if (currentSelectedUrls.size === 0) {
      log('请先选择要发布的文章', 'error')
      return
    }

    const articlesToPublish = []
    for (const url of currentSelectedUrls) {
      const article = currentArticleList.find(a => (a.link || a.url) === url)
      if (article) {
        articlesToPublish.push({
          title: article.title || '无标题',
          url: url,
          author: (currentAccount?.nickname || currentAccount?.name || '').substring(0, 20)
        })
      }
    }

    if (articlesToPublish.length === 0) {
      log('未找到选中文章，请重新选择', 'error')
      return
    }

    const config = {
      articles: articlesToPublish
    }

    log(`开始发布 ${config.articles.length} 篇文章...`)

    const result = await window.electronAPI.publishArticles(config)
    if (result.error) {
      log(result.error, 'error')
    } else {
      log(`发布完成: 成功 ${result.published}, 失败 ${result.failed}`, result.failed > 0 ? 'error' : 'success')
    }
  } catch (err) {
    log(`发布失败: ${err.message}`, 'error')
  } finally {
    publishBtn.disabled = false
  }
})

// ========== 帮助图片 ==========
const imgAuthKey = require('./AuthKey.png')
const imgAppId = require('./AppIdandAppSecret.png')
const imgAppSecret = require('./AppIdandAppSecret.png')
const imgBaimingdan = require('./baimingdan.png')

// 设置帮助页图片 src
const setImg = (id, src) => { const el = document.getElementById(id); if (el) el.src = src }
setImg('imgAuthKey', imgAuthKey)
setImg('imgAppId', imgAppId)
setImg('imgAppSecret', imgAppSecret)
setImg('imgBaimingdan', imgBaimingdan)

// ========== 初始化 ==========
async function init() {
  try {
    const cfg = await window.electronAPI.getConfig()
    currentConfig = cfg
    authKeyInput.value = cfg.authKey || ''
    appIdInput.value = cfg.appId || ''
    appSecretInput.value = cfg.appSecret || ''
    aiEnabledInput.checked = Boolean(cfg.aiEnabled)
    aiProviderInput.value = cfg.aiProvider || 'minimax'
    if (!aiProviderInput.value) aiProviderInput.value = 'minimax'
    const aiPreset = getAiProviderPreset(aiProviderInput.value)
    aiBaseUrlInput.value = cfg.aiBaseUrl || aiPreset?.baseUrl || ''
    aiModelInput.value = cfg.aiModel || aiPreset?.model || ''
    aiApiKeyInput.value = cfg.aiApiKey || ''
    appendQrEnabledInput.checked = Boolean(cfg.appendQrEnabled)
    removeOriginalQrEnabledInput.checked = Boolean(cfg.removeOriginalQrEnabled)
    qrImagePathInput.value = cfg.qrImagePath || ''
    refreshSecretPlaceholders()
    log('配置加载完成')
  } catch (err) {
    log('配置加载失败', 'error')
  }
}

// 防止热更新时重复注册监听器
if (!window._logListenerRegistered) {
  window._logListenerRegistered = true
  window.electronAPI.onLog((msg) => {
    const type = msg.includes('成功') ? 'success' : msg.includes('失败') || msg.includes('错误') ? 'error' : 'info'
    log(msg, type)
  })
}

init()
