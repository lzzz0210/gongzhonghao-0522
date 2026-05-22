const http = require('http')
const https = require('https')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function httpRequest(url, options = {}) {
  const timeout = options.timeout || 30000

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const protocol = urlObj.protocol === 'https:' ? https : http
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }

    if (options.body) {
      reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body)
    }

    const req = protocol.request(reqOptions, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const data = Buffer.concat(chunks)
        const contentType = res.headers['content-type'] || ''

        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(data.toString()))
          } catch {
            resolve(data.toString())
          }
        } else {
          resolve(data.toString())
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy()
      reject(new Error('request timeout'))
    })

    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

async function withRetry(fn, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = err.message.includes('ECONNRESET') ||
        err.message.includes('timeout') ||
        err.message.includes('request timeout')

      if (i < retries && retryable) {
        await delay(2000)
        continue
      }
      throw err
    }
  }
}

module.exports = { delay, httpRequest, withRetry }
