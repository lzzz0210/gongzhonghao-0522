const { delay } = require('./http-client')

const BASE_URL = 'https://down.mptext.top'

function createThirdPartyApi(httpRequest) {
  async function get(authKey, endpoint, params = {}, retries = 3, reqTimeout) {
    const queryString = Object.entries(params)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&')
    const url = `${BASE_URL}${endpoint}?${queryString}`

    let lastError = null
    for (let i = 0; i < retries; i++) {
      try {
        const data = await httpRequest(url, {
          headers: { 'X-Auth-Key': authKey },
          ...(reqTimeout ? { timeout: reqTimeout } : {})
        })

        if (data.base_resp && data.base_resp.ret !== 0) {
          throw new Error(data.base_resp.err_msg || 'API error')
        }
        return data
      } catch (err) {
        lastError = err
        if (i < retries - 1) {
          console.log(`Request failed ${i + 1}/${retries}, retrying...`)
          await delay(2000)
        }
      }
    }

    throw lastError
  }

  return { get }
}

module.exports = { createThirdPartyApi }
