const fs = require('fs')
const path = require('path')

const DEFAULT_CONFIG = {
  authKey: '',
  appId: '',
  appSecret: '',
  aiEnabled: false,
  aiProvider: 'minimax',
  aiBaseUrl: 'https://api.minimaxi.com/v1',
  aiModel: 'MiniMax-M2.7-highspeed',
  aiApiKey: '',
  appendQrEnabled: false,
  removeOriginalQrEnabled: false,
  qrImagePath: ''
}

function createConfigStore(app) {
  const configPath = path.join(app.getPath('userData'), 'config.json')

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) }
      }
    } catch {}
    return { ...DEFAULT_CONFIG }
  }

  function saveConfig(data) {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  return { loadConfig, saveConfig, configPath }
}

module.exports = { createConfigStore }
