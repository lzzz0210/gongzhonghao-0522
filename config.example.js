// 微信公众号文章采集配置
// 使用前请填入你的密钥，并将此文件重命名为 config.js

module.exports = {
  // 第三方 API（down.mptext.top）认证密钥
  // 登录 https://down.mptext.top 后在 API 页面查看
  authKey: 'your_auth_key_here',

  // 微信公众平台 AppID 和 AppSecret
  // 登录 https://mp.weixin.qq.com 后在 设置与开发 → 基本配置 中查看
  appId: 'wx_your_appid',
  appSecret: 'your_appsecret',

  // ========== 自动化任务配置 ==========
  // 设置后可以使用 `node collect_draft.js --auto` 全自动执行

  // 状态文件路径（记录已发布文章，避免重复）
  stateFile: './publish_state.json',

  // 自动化任务列表
  autoTasks: [
    {
      name: '示例任务',
      enabled: false,
      // 要采集的公众号名称列表（会自动搜索匹配）
      accounts: ['公众号名称'],
      // 文章筛选规则
      filter: {
        // 文章标题包含这些关键词才会发布
        keywords: ['关键词'],
        // 排除标题包含这些关键词的文章
        excludeWords: ['广告'],
        // 只看近几天的新文章（0表示不限制）
        daysLimit: 7,
        // 每次最多发布几篇
        maxArticles: 1
      }
    }
  ]
};
