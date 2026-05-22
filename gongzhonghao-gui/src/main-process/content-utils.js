function countMatches(content, pattern) {
  return (content.match(pattern) || []).length
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function normalizeImageUrl(value) {
  const url = decodeHtmlAttribute(value).trim()
  if (!url || url.startsWith('data:')) return ''
  if (url.startsWith('//')) return `https:${url}`
  return /^https?:\/\//i.test(url) ? url : ''
}

function getTagAttr(tag, attrName) {
  const match = tag.match(new RegExp(`\\s${attrName}=["']([^"']+)["']`, 'i'))
  return match ? match[1] : ''
}

function extractCover(htmlContent) {
  const patterns = [
    /var msg_cdn_url = "([^"]+)"/,
    /var cover_img = "([^"]+)"/,
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/,
    /src="(https?:\/\/mmbiz\.qpic\.cn[^"]+)"/
  ]

  for (const pattern of patterns) {
    const match = htmlContent.match(pattern)
    if (match && match[1]) return match[1].replace(/&amp;/g, '&')
  }

  return null
}

function extractFirstImage(htmlContent) {
  const match = htmlContent.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)
  if (!match || !match[1]) return null
  const url = match[1].replace(/&amp;/g, '&')
  return /^https?:\/\//i.test(url) ? url : null
}

function extractArticleBody(htmlContent) {
  let content = htmlContent.replace(/^\s*" id="js_content">/, '')

  if (content.includes('<html') || content.includes('<!DOCTYPE')) {
    const match = content.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*)<\/div>\s*<\/section>/i)
    if (match && match[1]) {
      content = match[1]
    } else {
      const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      if (bodyMatch && bodyMatch[1]) content = bodyMatch[1]
    }
  }

  return content
}

function removeUnsupportedBlocks(content, report) {
  const blockPatterns = [
    { key: 'mpBlocks', pattern: /<mp-[\w-]+[^>]*>[\s\S]*?<\/mp-[\w-]+>/gi },
    { key: 'wxOpenBlocks', pattern: /<wx-open-[\w-]+[^>]*>[\s\S]*?<\/wx-open-[\w-]+>/gi },
    { key: 'iframeBlocks', pattern: /<iframe[^>]*>[\s\S]*?<\/iframe>/gi },
    { key: 'objectBlocks', pattern: /<object[^>]*>[\s\S]*?<\/object>/gi },
    { key: 'embedBlocks', pattern: /<embed[^>]*\/?>/gi },
    { key: 'mediaBlocks', pattern: /<(video|audio|source|svg|canvas)\b[^>]*>[\s\S]*?<\/\1>/gi },
    { key: 'scriptBlocks', pattern: /<script[^>]*>[\s\S]*?<\/script>/gi },
    { key: 'styleBlocks', pattern: /<style[^>]*>[\s\S]*?<\/style>/gi }
  ]

  for (const item of blockPatterns) {
    report[item.key] += countMatches(content, item.pattern)
    content = content.replace(item.pattern, '')
  }

  content = content.replace(/<mp-[\w-]+[^>]*\/?>/gi, '')
  content = content.replace(/<\/mp-[\w-]+>/gi, '')
  content = content.replace(/<wx-open-[\w-]+[^>]*\/?>/gi, '')
  content = content.replace(/<\/wx-open-[\w-]+>/gi, '')
  content = content.replace(/<o:p>[\s\S]*?<\/o:p>/gi, '')
  content = content.replace(/<!--[\s\S]*?-->/g, '')
  content = content.replace(/<link\b[^>]*>/gi, '')
  content = content.replace(/<meta\b[^>]*>/gi, '')
  content = normalizeImageTags(content)
  content = content.replace(/\s+data-[\w-]+="[^"]*"/gi, '')
  content = content.replace(/\s+data-[\w-]+='[^']*'/gi, '')
  content = content.replace(/\s+on\w+="[^"]*"/gi, '')
  content = content.replace(/\s+on\w+='[^']*'/gi, '')
  content = content.replace(/<a\b([^>]*href=["'](?:weixin|weapp|wxapp):[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi, '<span>$2</span>')

  return content
}

function normalizeImageTags(content) {
  return content.replace(/<img\b[^>]*>/gi, (imgTag) => {
    const src = normalizeImageUrl(getTagAttr(imgTag, 'src'))
    const lazySrc = normalizeImageUrl(getTagAttr(imgTag, 'data-src') || getTagAttr(imgTag, 'data-original') || getTagAttr(imgTag, 'data-backsrc'))
    const imageUrl = lazySrc || src
    if (!imageUrl) return ''

    if (/\ssrc=["'][^"']*["']/i.test(imgTag)) {
      return imgTag.replace(/\ssrc=["'][^"']*["']/i, ` src="${imageUrl}"`)
    }
    return imgTag.replace(/<img/i, `<img src="${imageUrl}"`)
  })
}

function extractImageUrls(content) {
  const urls = []
  content.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (tag, src) => {
    const url = normalizeImageUrl(src)
    if (url) urls.push(url)
    return tag
  })
  return [...new Set(urls)]
}

function replaceImageSource(content, oldUrl, newUrl) {
  const encodedOldUrl = oldUrl.replace(/&/g, '&amp;')
  return content.split(oldUrl).join(newUrl).split(encodedOldUrl).join(newUrl)
}

function removeImageBySource(content, imageUrl) {
  const encodedUrl = imageUrl.replace(/&/g, '&amp;')
  const patterns = [
    new RegExp(`<img\\b[^>]*\\bsrc=["']${escapeRegExp(imageUrl)}["'][^>]*>`, 'gi'),
    new RegExp(`<img\\b[^>]*\\bsrc=["']${escapeRegExp(encodedUrl)}["'][^>]*>`, 'gi')
  ]
  return patterns.reduce((next, pattern) => next.replace(pattern, ''), content)
}

function strictCleanContent(content) {
  return content
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '<span>$1</span>')
    .replace(/\s+(id|class|style|role|aria-[\w-]+|tabindex)=["'][^"']*["']/gi, '')
}

function removeOriginalQr(content) {
  const tailLength = Math.min(content.length, 12000)
  const head = content.slice(0, content.length - tailLength)
  let tail = content.slice(content.length - tailLength)
  const suspiciousText = /(二维码|扫码|扫一扫|长按|识别|关注|公众号|客服|微信|加群|入群|联系)/i
  const suspiciousAttr = /(qrcode|qr_code|二维码|扫码|weixin|wechat|客服|contact|follow|group)/i
  let removed = 0

  tail = tail.replace(/<img\b[^>]*>/gi, (imgTag, offset) => {
    const context = tail.slice(Math.max(0, offset - 300), Math.min(tail.length, offset + imgTag.length + 300))
    if (suspiciousAttr.test(imgTag) || suspiciousText.test(context)) {
      removed++
      return ''
    }
    return imgTag
  })

  return { content: head + tail, removed }
}

function trimContent(content, maxLength) {
  if (!maxLength || content.length <= maxLength) return { content, trimmed: false }

  const truncated = content.substring(0, maxLength)
  const blockEnd = truncated.lastIndexOf('</section>')
  const divEnd = truncated.lastIndexOf('</div>')
  const pEnd = truncated.lastIndexOf('</p>')
  const brEnd = truncated.lastIndexOf('<br')
  const candidate = Math.max(blockEnd, divEnd, pEnd, brEnd)

  if (candidate > maxLength * 0.6) {
    const endPos = candidate + (candidate === brEnd ? 0 : (candidate === divEnd ? 6 : (candidate === blockEnd ? 10 : 4)))
    return { content: truncated.substring(0, endPos), trimmed: true }
  }

  const lastGt = truncated.lastIndexOf('>')
  const endPos = lastGt > 0 ? lastGt + 1 : maxLength
  return { content: truncated.substring(0, endPos), trimmed: true }
}

function sanitizeArticleContent(htmlContent, options = {}) {
  const report = {
    mpBlocks: 0,
    wxOpenBlocks: 0,
    iframeBlocks: 0,
    objectBlocks: 0,
    embedBlocks: 0,
    mediaBlocks: 0,
    scriptBlocks: 0,
    styleBlocks: 0,
    qrImages: 0,
    trimmed: false
  }

  let content = extractArticleBody(htmlContent)
  content = removeUnsupportedBlocks(content, report)
  if (options.strict) content = strictCleanContent(content)

  if (options.removeOriginalQr) {
    const qrResult = removeOriginalQr(content)
    content = qrResult.content
    report.qrImages = qrResult.removed
  }

  const trimmed = trimContent(content, options.maxContentLength)
  report.trimmed = trimmed.trimmed

  return { content: trimmed.content, report }
}

function cleanHtml(htmlContent) {
  return sanitizeArticleContent(htmlContent).content
}

module.exports = {
  cleanHtml,
  extractCover,
  extractFirstImage,
  extractImageUrls,
  removeImageBySource,
  replaceImageSource,
  sanitizeArticleContent,
  trimContent
}
