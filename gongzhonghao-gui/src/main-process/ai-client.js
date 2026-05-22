function buildChatUrl(baseUrl) {
  const normalized = (baseUrl || '').replace(/\/+$/, '')
  return `${normalized}/chat/completions`
}

function stripThinking(content) {
  return String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

function parseJsonArray(content) {
  const cleaned = stripThinking(content).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      const parsed = JSON.parse(match[0])
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
}

function inferCity(keyword) {
  const cities = ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '重庆', '天津', '武汉', '西安', '苏州', '长沙', '郑州', '青岛', '厦门', '福州', '合肥', '济南', '沈阳', '大连', '宁波', '无锡', '佛山', '东莞']
  return cities.find(city => String(keyword).includes(city)) || ''
}

function localSearchKeywordFallback(keyword) {
  const city = inferCity(keyword)
  const prefix = city || String(keyword).replace(/活动|本地宝|周末|亲子|展览/g, '').trim()
  const base = [
    keyword,
    prefix && `${prefix}本地宝`,
    prefix && `${prefix}活动`,
    prefix && `${prefix}周末活动`,
    prefix && `${prefix}亲子活动`,
    prefix && `${prefix}展览`,
    prefix && `${prefix}博物馆`,
    prefix && `${prefix}文旅`,
    prefix && `${prefix}公园`,
    prefix && `${prefix}同城活动`,
    '本地宝',
    '周末活动',
    '亲子活动',
    '展览活动'
  ]

  return [...new Set(base.filter(Boolean))].slice(0, 15)
}

function createAiClient(httpRequest) {
  function isConfigured(config) {
    return Boolean(config.aiEnabled && config.aiApiKey && config.aiBaseUrl && config.aiModel)
  }

  async function chat(config, messages, options = {}) {
    const result = await httpRequest(buildChatUrl(config.aiBaseUrl), {
      method: 'POST',
      timeout: options.timeout || 30000,
      headers: {
        Authorization: `Bearer ${config.aiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens || 800,
        stream: false
      })
    })

    if (typeof result === 'string') throw new Error('AI returned a non-JSON response')
    if (result.base_resp && result.base_resp.status_code !== 0) {
      throw new Error(result.base_resp.status_msg || 'AI request failed')
    }
    if (result.error) throw new Error(result.error.message || JSON.stringify(result.error))

    const content = result.choices?.[0]?.message?.content
    if (!content) throw new Error('AI returned empty content')
    return stripThinking(content)
  }

  async function test(config) {
    const content = await chat(config, [
      { role: 'system', content: 'You are a configuration test assistant.' },
      { role: 'user', content: 'Reply with exactly: AI_CONFIG_OK' }
    ], { maxTokens: 50 })
    return { success: true, message: content }
  }

  async function expandSearchKeywords(config, keyword) {
    const content = await chat(config, [
      {
        role: 'system',
        content: 'You generate Chinese WeChat public-account search keywords. Return only a valid JSON array of strings. No markdown, no explanation.'
      },
      {
        role: 'user',
        content: `Input keyword: ${keyword}
Generate 10 to 14 short Chinese search keywords for finding local activity-related WeChat public accounts.
Cover directions such as city/local life, weekend activities, parent-child activities, culture and tourism, exhibitions, museums, parks, official city accounts, and local guide accounts.
Return example format: ["北京活动","北京周末活动","北京亲子活动"]`
      }
    ], { maxTokens: 500, temperature: 0.4 })

    const keywords = parseJsonArray(content)
      .map(item => String(item).trim())
      .filter(Boolean)

    const merged = [...new Set([keyword, ...keywords])].slice(0, 15)
    return merged.length > 1 ? merged : localSearchKeywordFallback(keyword)
  }

  return { expandSearchKeywords, isConfigured, test }
}

module.exports = { createAiClient }
