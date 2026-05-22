const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')

function createWechatApi(httpRequest, withRetry) {
  let accessTokenCache = { token: null, expiresAt: 0 }

  async function getAccessToken(appId, appSecret) {
    const now = Date.now()
    if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
      return accessTokenCache.token
    }

    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
    const data = await httpRequest(url)
    if (data.errcode) throw new Error(`获取 token 失败: ${data.errmsg}`)

    accessTokenCache = {
      token: data.access_token,
      expiresAt: now + (data.expires_in - 300) * 1000
    }
    return accessTokenCache.token
  }

  function getImageFormat(source) {
    try {
      const urlObj = new URL(source)
      const wxFormat = urlObj.searchParams.get('wx_fmt') || urlObj.searchParams.get('tp')
      if (wxFormat) return wxFormat.toLowerCase().replace('jpeg', 'jpg')
    } catch {}

    const ext = path.extname(source.split('?')[0]).toLowerCase().replace('.', '')
    return ext || 'jpg'
  }

  function getContentType(source) {
    const ext = getImageFormat(source)
    if (ext === '.png') return 'image/png'
    if (ext === 'png') return 'image/png'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    return 'image/jpeg'
  }

  function getImageFileName(source) {
    const ext = getImageFormat(source)
    const safeExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'jpg'
    const baseName = path.basename(source.split('?')[0])
    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(baseName)) return baseName
    return `image.${safeExt === 'jpeg' ? 'jpg' : safeExt}`
  }

  function normalizeDownloadUrl(imageUrl) {
    try {
      const urlObj = new URL(imageUrl.replace(/&amp;/g, '&'))
      if (urlObj.hostname.includes('mmbiz.qpic.cn')) {
        if (urlObj.searchParams.get('tp') === 'webp') urlObj.searchParams.delete('tp')
        if (!urlObj.searchParams.get('wx_fmt')) urlObj.searchParams.set('wx_fmt', 'jpeg')
      }
      return urlObj.toString()
    } catch {
      return imageUrl.replace(/&amp;/g, '&')
    }
  }

  function detectImageMeta(buffer, source) {
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { contentType: 'image/jpeg', filename: 'image.jpg' }
    }
    if (buffer.length >= 8 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { contentType: 'image/png', filename: 'image.png' }
    }
    if (buffer.length >= 6 && (buffer.slice(0, 6).toString() === 'GIF87a' || buffer.slice(0, 6).toString() === 'GIF89a')) {
      return { contentType: 'image/gif', filename: 'image.gif' }
    }
    if (buffer.length >= 12 && buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
      throw new Error('微信图文图片接口不支持 webp，已跳过')
    }
    return { contentType: getContentType(source), filename: getImageFileName(source) }
  }

  async function downloadImage(imageUrl, redirectCount = 0) {
    const cleanUrl = normalizeDownloadUrl(imageUrl)
    const urlObj = new URL(cleanUrl)
    const protocol = urlObj.protocol === 'https:' ? https : http

    return new Promise((resolve, reject) => {
      const req = protocol.request({
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          Referer: 'https://mp.weixin.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
        }
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectCount >= 5) {
            reject(new Error('图片下载跳转次数过多'))
            return
          }
          const redirectUrl = new URL(res.headers.location, cleanUrl).toString()
          resolve(downloadImage(redirectUrl, redirectCount + 1))
          return
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`图片下载失败: HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(30000, () => {
        req.destroy()
        reject(new Error('图片下载超时'))
      })
      req.end()
    })
  }

  async function readImageSource(imageSource) {
    if (/^https?:\/\//i.test(imageSource)) {
      return downloadImage(imageSource)
    }
    return fs.promises.readFile(imageSource)
  }

  async function postImageMultipart(uploadUrl, imageSource, fieldName = 'media') {
    const imageData = await readImageSource(imageSource)
    const boundary = '----WeChatBoundary' + Math.random().toString(36).substring(2)
    const imageMeta = detectImageMeta(imageData, imageSource)
    const filename = imageMeta.filename
    const contentType = imageMeta.contentType
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`, 'utf-8')
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8')
    const body = Buffer.concat([header, imageData, footer])

    return new Promise((resolve, reject) => {
      const urlObj = new URL(uploadUrl)
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }
      const req = https.request(options, (res) => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()))
          } catch {
            reject(new Error('解析图片上传响应失败'))
          }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  async function uploadImage(imageUrl, accessToken) {
    return withRetry(async () => {
      const uploadUrl = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`
      const result = await postImageMultipart(uploadUrl, imageUrl)
      if (result.errcode) throw new Error(`${result.errcode} - ${result.errmsg}`)
      if (!result.media_id) throw new Error('上传封面成功但未返回 media_id')
      return result.media_id
    })
  }

  async function uploadInlineImage(imageSource, accessToken) {
    const uploadUrl = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${accessToken}`
    const result = await withRetry(() => postImageMultipart(uploadUrl, imageSource))
    if (result.errcode) throw new Error(`上传正文图片失败: ${result.errcode} - ${result.errmsg}`)
    if (!result.url) throw new Error('上传正文图片成功但未返回 url')
    return result.url
  }

  async function createDraft(draftData, accessToken) {
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`
    let result = await httpRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(draftData)
    })

    if (typeof result === 'string') {
      try {
        result = JSON.parse(result)
      } catch {
        throw new Error('创建草稿失败: 无法解析响应 ' + result.substring(0, 200))
      }
    }
    if (!result || Object.keys(result).length === 0) throw new Error('服务器返回空响应')
    if (result.errcode) throw new Error(`创建草稿失败: ${result.errcode} - ${result.errmsg}`)
    if (!result.media_id) throw new Error('创建草稿成功但未返回 media_id，响应: ' + JSON.stringify(result))

    return result
  }

  return { createDraft, getAccessToken, uploadImage, uploadInlineImage }
}

module.exports = { createWechatApi }
