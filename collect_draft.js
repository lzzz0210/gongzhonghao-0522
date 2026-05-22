/**
 * 微信公众号文章采集 - 草稿箱发布工具
 *
 * 使用方式:
 *   交互模式: node collect_draft.js
 *   自动模式: node collect_draft.js --auto
 *
 * 零依赖 - 仅使用 Node.js 内置模块
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ========== 全局变量 ==========

let config = null;
let appId = '';
let appSecret = '';
let accessTokenCache = { token: null, expiresAt: 0 };
let isAutoMode = process.argv.includes('--auto');

// ========== 配置文件加载 ==========

function loadConfig() {
  const configPath = path.join(__dirname, 'config.js');

  if (!fs.existsSync(configPath)) {
    console.error('\n❌ 错误: config.js 配置文件不存在！\n');
    console.log('请创建 config.js 文件，内容如下:\n');
    console.log(`
module.exports = {
  authKey: '你的-X-Auth-Key',
  appId: 'wx_your_appid',
  appSecret: 'your_appsecret',
  stateFile: './publish_state.json',
  autoTasks: [
    {
      name: '任务名称',
      enabled: true,
      accounts: ['公众号名称'],
      filter: {
        keywords: ['包含的关键词'],
        excludeWords: ['排除的关键词'],
        daysLimit: 7,
        maxArticles: 1
      }
    }
  ]
};
    `.trim());
    console.log('\n');
    process.exit(1);
  }

  config = require(configPath);
  appId = config.appId;
  appSecret = config.appSecret;

  if (!isAutoMode) {
    console.log('✅ 配置加载成功');
  }
}

// ========== 用户输入 ==========

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ========== HTTP 请求 ==========

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    // POST 请求自动设置 Content-Length
    if (options.body) {
      const bodyLen = Buffer.byteLength(options.body);
      reqOptions.headers['Content-Length'] = bodyLen;
    }

    const req = protocol.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';

        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(data.toString()));
          } catch {
            resolve(data.toString());
          }
        } else {
          resolve(data.toString());
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ========== 第三方 API (down.mptext.top) ==========

async function thirdPartyGet(endpoint, params = {}, reqTimeout) {
  const baseUrl = 'https://down.mptext.top';
  const queryString = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const url = `${baseUrl}${endpoint}?${queryString}`;

  const data = await httpRequest(url, {
    headers: { 'X-Auth-Key': config.authKey },
    ...(reqTimeout ? { timeout: reqTimeout } : {})
  });

  if (data.base_resp && data.base_resp.ret !== 0) {
    throw new Error(`API 错误: ${data.base_resp.err_msg || JSON.stringify(data)}`);
  }

  return data;
}

// ========== 公众号操作 ==========

async function searchAccount(keyword) {
  if (!isAutoMode) {
    console.log(`\n🔍 正在搜索公众号: "${keyword}"...`);
  }
  const data = await thirdPartyGet('/api/public/v1/account', { keyword });
  return data.list || [];
}

async function getArticleList(fakeid, begin = 0, size = 20) {
  const data = await thirdPartyGet('/api/public/v1/article', { fakeid, begin, size });
  return {
    list: data.articles || [],
    total: data.total || 0
  };
}

// 分页拉取全部文章（自动模式用）
async function getAllArticles(fakeid) {
  const all = [];
  let begin = 0;
  const pageSize = 20;
  while (true) {
    const data = await thirdPartyGet('/api/public/v1/article', { fakeid, begin, size: pageSize });
    const articles = data.articles || [];
    all.push(...articles);
    if (articles.length < pageSize) break;
    begin += pageSize;
  }
  return all;
}

async function downloadArticle(url) {
  if (!isAutoMode) {
    console.log(`📥 正在下载文章内容...`);
  }
  // 确保 url 是字符串
  const articleUrl = typeof url === 'string' ? url : url.link || url.url;
  const data = await thirdPartyGet('/api/public/v1/download', { url: articleUrl, format: 'html' }, 60000);
  return data;
}

// ========== 微信 API ==========

async function getAccessToken() {
  const now = Date.now();

  if (accessTokenCache.token && accessTokenCache.expiresAt > now) {
    return accessTokenCache.token;
  }

  if (!isAutoMode) {
    console.log('\n🔑 正在获取微信 access_token...');
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const data = await httpRequest(url);

  if (data.errcode) {
    throw new Error(`获取 access_token 失败: ${data.errcode} - ${data.errmsg}`);
  }

  accessTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 300) * 1000
  };

  if (!isAutoMode) {
    console.log('✅ access_token 获取成功');
  }
  return accessTokenCache.token;
}

async function uploadImageToWeixin(imageUrl, accessToken) {
  if (!isAutoMode) {
    console.log('🖼️  正在上传封面图片到素材库...');
  }

  try {
    // 1. 下载图片
    const imageData = await new Promise((resolve, reject) => {
      https.get(imageUrl, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    });

    // 2. 构建 multipart/form-data（永久素材接口）
    const boundary = '----WeChatBoundary' + Math.random().toString(36).substring(2);
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="media"; filename="cover.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n\r\n`,
      'utf-8'
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([header, imageData, footer]);

    // 使用 material/add_material 而不是 media/upload（需要永久素材ID）
    const uploadUrl = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`;

    const result = await new Promise((resolve, reject) => {
      const urlObj = new URL(uploadUrl);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(new Error('解析响应失败'));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (result.errcode) {
      throw new Error(result.errmsg);
    }

    if (!isAutoMode) {
      console.log(`✅ 图片上传成功: ${result.media_id}`);
    }
    return result.media_id;

  } catch (error) {
    if (!isAutoMode) {
      console.log(`⚠️  封面图上传失败: ${error.message}，将使用默认封面`);
    }
    return '';
  }
}

async function createDraft(draftData, accessToken) {
  if (!isAutoMode) {
    console.log('\n📝 正在创建草稿...');
  }

  const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`;

  let result = await httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(draftData)
  });

  // 确保响应被解析为对象
  if (typeof result === 'string') {
    try { result = JSON.parse(result) }
    catch { throw new Error('创建草稿失败: 无法解析响应 ' + result.substring(0, 200)) }
  }

  if (!result || Object.keys(result).length === 0) {
    throw new Error('创建草稿失败: 服务器返回空响应');
  }

  if (result.errcode && result.errcode !== 0) {
    throw new Error(`创建草稿失败: ${result.errcode} - ${result.errmsg}`);
  }

  if (!result.media_id) {
    throw new Error('创建草稿成功但未返回 media_id，响应: ' + JSON.stringify(result));
  }

  return result;
}

// ========== 内容处理 ==========

function extractCoverImage(htmlContent) {
  const patterns = [
    /var msg_cdn_url = "([^"]+)"/,
    /var cover_img = "([^"]+)"/,
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/,
    /og:image"[^>]+content="([^"]+)"/,
    /<img[^>]+class="[^"]*cover[^"]*"[^>]+src="([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = htmlContent.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  const imgMatch = htmlContent.match(/src="(https?:\/\/mmbiz\.qpic\.cn[^"]+)"/);
  return imgMatch ? imgMatch[1] : null;
}

function cleanHtmlContent(htmlContent) {
  // 去除开头的错误代码片段
  htmlContent = htmlContent.replace(/^\s*" id="js_content">/, '');

  // 如果是完整 HTML 页面，提取 #js_content 内部内容
  if (htmlContent.includes('<html') || htmlContent.includes('<!DOCTYPE')) {
    // 尝试提取 id="js_content" 的内容
    const match = htmlContent.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*)<\/div>\s*<\/section>/i);
    if (match && match[1]) {
      htmlContent = match[1];
    } else {
      // 备选：提取 body 内部内容
      const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch && bodyMatch[1]) {
        htmlContent = bodyMatch[1];
      }
    }
  }

  // 移除微信自定义标签（小程序卡片、公众号名片等），草稿 API 不接受
  htmlContent = htmlContent.replace(/<mp-[\w-]+[^>]*>[\s\S]*?<\/mp-[\w-]+>/gi, '');
  htmlContent = htmlContent.replace(/<mp-[\w-]+[^>]*\/?>/gi, '');
  htmlContent = htmlContent.replace(/<\/mp-[\w-]+>/gi, '');
  // 移除 MSO 命名空间标签和条件注释（Word 粘贴残留）
  htmlContent = htmlContent.replace(/<o:p>[\s\S]*?<\/o:p>/gi, '');
  htmlContent = htmlContent.replace(/<!--[\s\S]*?-->/g, '');
  // 移除 script/style 标签
  htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  htmlContent = htmlContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // 移除 data- 属性（可能包含小程序引用）
  htmlContent = htmlContent.replace(/\s+data-[\w-]+="[^"]*"/gi, '');
  htmlContent = htmlContent.replace(/\s+data-[\w-]+='[^']*'/gi, '');

  return htmlContent;
}

// 微信草稿 API content 字段长度限制（约 2 万字符），超出截断
const MAX_CONTENT_LENGTH = 100000;

function trimContent(content) {
  if (content.length <= MAX_CONTENT_LENGTH) return { content, trimmed: false };
  // 在段落或句子边界截断，避免截在 HTML 标签中间
  const truncated = content.substring(0, MAX_CONTENT_LENGTH);
  // 优先找 </section>, </div>, </p> 等块级标签末尾
  const blockEnd = truncated.lastIndexOf('</section>');
  const divEnd = truncated.lastIndexOf('</div>');
  const pEnd = truncated.lastIndexOf('</p>');
  const brEnd = truncated.lastIndexOf('<br');
  const candidate = Math.max(blockEnd, divEnd, pEnd, brEnd);
  if (candidate > MAX_CONTENT_LENGTH * 0.6) {
    const endPos = candidate + (candidate === brEnd ? 0 : (candidate === divEnd ? 6 : (candidate === blockEnd ? 10 : 4)));
    return { content: truncated.substring(0, endPos) + '<p>（内容过长已截断）</p>', trimmed: true };
  }
  // 没有合适的截断点，在最后一个 > 之后截断
  const lastGt = truncated.lastIndexOf('>');
  return { content: truncated.substring(0, lastGt + 1) + '<p>（内容过长已截断）</p>', trimmed: true };
}

// ========== 自动模式核心函数 ==========

// 读取状态文件
function loadState() {
  const stateFile = config.stateFile || './publish_state.json';
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    } catch {
      return { publishedAids: {} };
    }
  }
  return { publishedAids: {} };
}

// 保存状态文件
function saveState(state) {
  const stateFile = config.stateFile || './publish_state.json';
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

// 检查文章是否已发布过
function isPublished(aid, state) {
  const s = state || loadState();
  return s.publishedAids[aid] === true;
}

// 标记文章为已发布
function markPublished(aid, state) {
  const s = state || loadState();
  s.publishedAids[aid] = true;
  if (!state) saveState(s);
}

// 筛选文章
function filterArticles(articles, filterConfig) {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  let filtered = articles.filter(article => {
    // 时间筛选
    if (filterConfig.daysLimit && filterConfig.daysLimit > 0) {
      const articleTime = (article.update_time || 0) * 1000;
      const cutoff = now - filterConfig.daysLimit * msPerDay;
      if (articleTime < cutoff) {
        return false;
      }
    }

    // 关键词筛选
    const title = (article.title || '').toLowerCase();
    if (filterConfig.keywords && filterConfig.keywords.length > 0) {
      const hasKeyword = filterConfig.keywords.some(kw =>
        title.includes(kw.toLowerCase())
      );
      if (!hasKeyword) {
        return false;
      }
    }

    // 排除词筛选
    if (filterConfig.excludeWords && filterConfig.excludeWords.length > 0) {
      const hasExclude = filterConfig.excludeWords.some(kw =>
        title.includes(kw.toLowerCase())
      );
      if (hasExclude) {
        return false;
      }
    }

    return true;
  });

  // 限制最大数量
  if (filterConfig.maxArticles && filterConfig.maxArticles > 0) {
    filtered = filtered.slice(0, filterConfig.maxArticles);
  }

  return filtered;
}

// 带重试的异步操作
async function withRetry(fn, label, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < retries && (err.message.includes('ECONNRESET') || err.message.includes('timeout') || err.message.includes('请求超时'))) {
        if (!isAutoMode) console.log(`     ⚠️  ${label}失败，重试中 (${i + 1}/${retries})...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
}

// 发布单篇文章（带重试）
async function publishArticle(article, accountName, accessToken) {
  // 下载内容，字段是 link 不是 url
  const articleUrl = article.link || article.url;

  let content = await withRetry(() => downloadArticle(articleUrl), '下载');

  // 清理内容
  content = cleanHtmlContent(content);

  // 提取封面图
  const coverUrl = extractCoverImage(content);

  // 上传封面图
  let thumbMediaId = '';
  if (coverUrl) {
    try {
      thumbMediaId = await withRetry(() => uploadImageToWeixin(coverUrl, accessToken), '上传封面');
    } catch {
      thumbMediaId = '';
    }
  }

  // 组装草稿
  const draftArticle = {
    title: article.title || '无标题',
    author: article.author || accountName,
    digest: article.digest || article.title || '',
    content: content,
    thumb_media_id: thumbMediaId,
    need_open_comment: 1,
    only_fans_can_comment: 0
  };

  // 创建草稿
  const draftData = { articles: [draftArticle] };
  const result = await withRetry(() => createDraft(draftData, accessToken), '创建草稿');

  return result;
}

// 执行单个自动任务
async function runAutoTask(task) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📋 任务: ${task.name}`);
  console.log(`账号: ${task.accounts.join(', ')}`);
  console.log(`筛选: 关键词[${task.filter.keywords || []}] 排除[${task.filter.excludeWords || []}] 近${task.filter.daysLimit}天`);

  const accessToken = await getAccessToken();
  let totalPublished = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  // 一次加载状态，内存操作，每成功一篇写回一次
  const state = loadState();

  // 遍历每个目标账号
  for (const accountKeyword of task.accounts) {
    console.log(`\n🔍 搜索公众号: ${accountKeyword}`);

    const accounts = await searchAccount(accountKeyword);
    if (accounts.length === 0) {
      console.log(`⚠️  未找到公众号: ${accountKeyword}`);
      continue;
    }

    // 精确匹配（优先完全匹配）
    let targetAccount = accounts.find(a =>
      (a.nickname || a.name) === accountKeyword
    ) || accounts[0];

    console.log(`✅ 找到: ${targetAccount.nickname || targetAccount.name}`);

    // 获取全部文章（分页拉全）
    const articles = await getAllArticles(targetAccount.fakeid);
    console.log(`📄 获取到 ${articles.length} 篇文章`);

    // 筛选
    const filtered = filterArticles(articles, task.filter);
    console.log(`🔍 筛选后: ${filtered.length} 篇`);

    // 发布符合条件的文章
    for (const article of filtered) {
      const aid = article.aid;

      // 检查是否已发布
      if (isPublished(aid, state)) {
        console.log(`  ⏭️  已发布过，跳过: ${article.title}`);
        totalSkipped++;
        continue;
      }

      console.log(`  📤 发布: ${article.title}`);
      console.log(`     URL: ${article.link || article.url}`);

      try {
        const result = await publishArticle(article, targetAccount.nickname || targetAccount.name, accessToken);
        markPublished(aid, state);
        saveState(state);
        totalPublished++;
        console.log(`  ✅ 发布成功, media_id: ${result && result.media_id}`);
        if (!result || !result.media_id) {
          console.log(`     ⚠️  注意: 草稿创建响应无 media_id，请到草稿箱确认是否成功`);
        }
      } catch (err) {
        totalFailed++;
        console.log(`  ❌ 发布失败: ${err.message}`);
        if (err.message.includes('url不合法') || err.message.includes('过期')) {
          console.log(`     ⚠️  可能是 Auth Key 过期，请到 https://down.mptext.top 续期`);
        }
      }

      // 避免频率限制
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\n📊 任务完成: 成功 ${totalPublished}, 跳过 ${totalSkipped}, 失败 ${totalFailed}`);
  return { published: totalPublished, skipped: totalSkipped, failed: totalFailed };
}

// 执行所有自动任务
async function runAllAutoTasks() {
  console.log('===========================================');
  console.log('  微信公众号文章采集 - 自动模式');
  console.log('===========================================\n');

  const tasks = config.autoTasks || [];
  if (tasks.length === 0) {
    console.log('⚠️  config.js 中没有配置 autoTasks，请添加后再运行 --auto 模式\n');
    process.exit(1);
  }

  let totalPublished = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const task of tasks) {
    if (!task.enabled) {
      console.log(`\n⏭️  跳过禁用任务: ${task.name}`);
      continue;
    }

    try {
      const result = await runAutoTask(task);
      totalPublished += result.published;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
    } catch (err) {
      console.error(`❌ 任务执行失败: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('  🎉 全部任务完成！');
  console.log(`  📊 总计: 成功 ${totalPublished}, 跳过 ${totalSkipped}, 失败 ${totalFailed}`);
  console.log('='.repeat(50) + '\n');
}

// ========== 交互模式 ==========

async function runInteractiveMode() {
  console.log('===========================================');
  console.log('  微信公众号文章采集 - 草稿箱发布工具');
  console.log('  零依赖版本 | Node.js 内置模块驱动');
  console.log('===========================================\n');

  loadConfig();

  try {
    // 1. 搜索公众号
    const keyword = await ask('\n📌 请输入公众号名称关键词: ');
    if (!keyword) {
      console.log('\n❌ 未输入关键词，程序结束。');
      return;
    }

    const accounts = await searchAccount(keyword);

    if (!accounts || accounts.length === 0) {
      console.log('\n❌ 未找到公众号，请尝试其他关键词。');
      return;
    }

    // 显示搜索结果
    console.log(`\n📋 找到 ${accounts.length} 个公众号:\n`);
    accounts.forEach((acc, i) => {
      const name = acc.nickname || acc.name || '未知';
      const alias = acc.alias ? ` (@${acc.alias})` : '';
      console.log(`  [${i + 1}] ${name}${alias}`);
    });

    // 选择公众号
    const choiceStr = await ask('\n🔢 请选择公众号序号: ');
    const choice = parseInt(choiceStr) - 1;

    if (isNaN(choice) || choice < 0 || choice >= accounts.length) {
      console.log('\n❌ 选择无效，程序结束。');
      return;
    }

    const selectedAccount = accounts[choice];
    const accountName = selectedAccount.nickname || selectedAccount.name || '未知';

    // 2. 获取文章列表
    console.log(`\n📚 正在获取 "${accountName}" 的文章列表...`);
    const { list: articles, total } = await getArticleList(selectedAccount.fakeid);

    if (!articles || articles.length === 0) {
      console.log('\n❌ 该公众号没有文章。');
      return;
    }

    console.log(`\n📄 共 ${total} 篇文章，显示前 ${articles.length} 篇:\n`);
    articles.forEach((article, i) => {
      const title = article.title || '无标题';
      const date = article.update_time
        ? new Date(article.update_time * 1000).toLocaleDateString('zh-CN')
        : '未知日期';
      console.log(`  [${i + 1}] ${title}`);
      console.log(`       📅 ${date}`);
    });

    // 选择文章
    const articleChoiceStr = await ask('\n🔢 请选择文章序号（多个用逗号分隔，如 1,3,5）: ');
    const selectedIndices = articleChoiceStr
      .split(',')
      .map(s => parseInt(s.trim()) - 1)
      .filter(i => !isNaN(i) && i >= 0 && i < articles.length);

    if (selectedIndices.length === 0) {
      console.log('\n❌ 选择无效，程序结束。');
      return;
    }

    const selectedArticles = selectedIndices.map(i => articles[i]);

    // 3. 获取 access_token
    const accessToken = await getAccessToken();

    // 4. 处理每篇文章
    const draftArticles = [];

    for (const article of selectedArticles) {
      console.log(`\n${'='.repeat(40)}`);
      console.log(`📄 处理文章: ${article.title || '无标题'}`);

      try {
        // 下载内容（带重试）
        let content = await withRetry(() => downloadArticle(article.link || article.url), '下载');

        // 清理内容
        content = cleanHtmlContent(content);

        // 提取封面图
        const coverUrl = extractCoverImage(content);

        // 上传封面图（带重试）
        let thumbMediaId = '';
        if (coverUrl) {
          try {
            thumbMediaId = await withRetry(() => uploadImageToWeixin(coverUrl, accessToken), '上传封面');
          } catch {
            thumbMediaId = '';
          }
        }

        // 组装草稿文章
        const draftArticle = {
          title: article.title || '无标题',
          author: article.author || accountName,
          digest: article.digest || article.title || '',
          content: finalContent,
          thumb_media_id: thumbMediaId,
          need_open_comment: 1,
          only_fans_can_comment: 0
        };

        draftArticles.push(draftArticle);
        console.log(`✅ 文章处理完成`);

      } catch (err) {
        console.error(`❌ 处理文章失败: ${err.message}`);
      }
    }

    // 5. 创建草稿
    if (draftArticles.length === 0) {
      console.log('\n❌ 没有成功处理的文章，程序结束。');
      return;
    }

    console.log(`\n${'='.repeat(40)}`);
    console.log(`\n📤 正在创建草稿（共 ${draftArticles.length} 篇）...`);

    const draftData = { articles: draftArticles };
    const result = await createDraft(draftData, accessToken);

    // 6. 完成
    console.log('\n');
    console.log('===========================================');
    console.log('  🎉 草稿创建成功！');
    console.log(`  📋 media_id: ${result.media_id}`);
    console.log('===========================================');
    console.log('\n📌 请登录微信公众平台查看草稿箱');
    console.log('   https://mp.weixin.qq.com\n');

  } catch (error) {
    console.error('\n❌ 发生错误:', error.message);
    console.error('\n请检查:');
    console.error('  1. config.js 中的密钥是否正确');
    console.error('  2. 网络连接是否正常');
    console.error('  3. API 密钥是否过期\n');
  }
}

// ========== 主入口 ==========

async function main() {
  loadConfig();

  if (isAutoMode) {
    await runAllAutoTasks();
  } else {
    await runInteractiveMode();
  }
}

// 运行
main().catch((err) => {
  console.error('未捕获的错误:', err);
  process.exit(1);
});