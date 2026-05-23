const fs = require('fs')
const path = require('path')
const { safeStorage } = require('electron')

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

const SECRET_FIELDS = ['authKey', 'appSecret', 'aiApiKey']
const ENCRYPTED_PREFIX = 'enc:v1:'

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function canEncrypt() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptSecret(value) {
  const text = String(value || '')
  if (!text) return ''
  if (!canEncrypt()) return text
  return ENCRYPTED_PREFIX + safeStorage.encryptString(text).toString('base64')
}

function decryptSecret(value) {
  const text = String(value || '')
  if (!text.startsWith(ENCRYPTED_PREFIX)) return text
  if (!canEncrypt()) return ''

  try {
    const payload = Buffer.from(text.slice(ENCRYPTED_PREFIX.length), 'base64')
    return safeStorage.decryptString(payload)
  } catch {
    return ''
  }
}

function createConfigStore(app) {
  const configPath = path.join(app.getPath('userData'), 'config.json')

  function loadConfig() {
    try {
      if (fs.existsSync(configPath)) {
        const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        const config = { ...DEFAULT_CONFIG, ...rawConfig }
        for (const field of SECRET_FIELDS) {
          config[field] = decryptSecret(config[field])
        }
        return config
      }
    } catch {}
    return { ...DEFAULT_CONFIG }
  }

  function mergeWithStoredSecrets(data) {
    const current = loadConfig()
    const next = { ...DEFAULT_CONFIG, ...current, ...data }

    for (const field of SECRET_FIELDS) {
      if (!data[field] && current[field]) {
        next[field] = current[field]
      }
    }

    return next
  }

  function saveConfig(data, options = {}) {
    const plainConfig = options.preserveSecrets ? mergeWithStoredSecrets(data) : { ...DEFAULT_CONFIG, ...data }
    const storedConfig = { ...plainConfig }

    for (const field of SECRET_FIELDS) {
      storedConfig[field] = encryptSecret(storedConfig[field])
    }

    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(storedConfig, null, 2), 'utf-8')
    return plainConfig
  }

  function loadPublicConfig() {
    const config = loadConfig()
    const publicConfig = { ...config }

    for (const field of SECRET_FIELDS) {
      publicConfig[`has${capitalize(field)}`] = Boolean(config[field])
      publicConfig[field] = ''
    }

    return publicConfig
  }

  function mergePublicConfig(data) {
    return mergeWithStoredSecrets(data)
  }

  return { configPath, loadConfig, loadPublicConfig, mergePublicConfig, saveConfig }
}

module.exports = { createConfigStore }
