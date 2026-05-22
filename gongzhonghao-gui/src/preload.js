const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  chooseQrImage: () => ipcRenderer.invoke('choose-qr-image'),
  validateConfig: (config) => ipcRenderer.invoke('validate-config', config),
  testAiConfig: (config) => ipcRenderer.invoke('test-ai-config', config),
  searchAccount: (keyword) => ipcRenderer.invoke('search-account', keyword),
  searchAccountsEnhanced: (keyword) => ipcRenderer.invoke('search-accounts-enhanced', keyword),
  getArticleList: (fakeid) => ipcRenderer.invoke('get-article-list', fakeid),
  publishArticles: (config) => ipcRenderer.invoke('publish-articles', config),
  onLog: (callback) => ipcRenderer.on('task-log', (event, msg) => callback(msg))
})
