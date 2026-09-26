/*
 * 阶段验收截图脚本：加载 dist/ 扩展 → 打开 team.html → 等待挂载 → 截图。
 * 用法：node scripts/screenshot-team-page.mjs <输出名> [--seed]
 *   <输出名>  截图写入 screenshots/<输出名>.png
 *   --seed    通过 chrome.storage 注入演示数据（群聊/成员/消息），便于检查非空渲染
 * 同时打印页面 console 错误与关键元素存在性，作为白屏/挂载失败的早期信号。
 */
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'screenshots')
await mkdir(outDir, { recursive: true })

const name = process.argv[2] || 'team-page'
const seed = process.argv.includes('--seed')

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-shot-'))
const browser = await puppeteer.launch({
  headless: true,
  userDataDir,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
})

const consoleErrors = []
try {
  // service worker 存活即扩展已加载，从它的 URL 拿扩展 id
  const swTarget = await browser.waitForTarget(target => target.type() === 'service_worker', { timeout: 30_000 })
  const extensionId = new URL(swTarget.url()).host
  console.log('extension id:', extensionId)

  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  // 给 React 挂载 / vanilla 装配 / iframe 建立留一点时间
  await new Promise(resolve => setTimeout(resolve, 2500))

  if (seed) {
    // 从页面上下文写入旧版单键（loadStore 读到后会 normalizeStore +
    // saveStore 自动迁移到分片 v2）——SW 侧写入在部分 Chrome 版本上
    // 会在 SW 空闲回收后丢失，页面侧写入与真实用户路径一致。
    await page.evaluate(async () => {
      const now = Date.now()
      const store = {
        version: 7,
        currentChatId: 'chat-seed-1',
        chatOrder: ['chat-seed-1'],
        chatsById: {
          'chat-seed-1': {
            id: 'chat-seed-1',
            name: '产品需求评审',
            mode: 'collaborative',
            roleIds: ['role-a', 'role-b', 'role-ext'],
            messageIds: ['msg-1', 'msg-2', 'msg-3', 'msg-4'],
            nextMessageSeq: 5,
            status: 'ready',
            createdAt: now - 86_400_000,
            updatedAt: now,
          },
        },
        rolesById: {
          'role-a': { id: 'role-a', chatId: 'chat-seed-1', name: '产品经理', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'deepseek' },
          'role-b': { id: 'role-b', chatId: 'chat-seed-1', name: '工程师', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'chatgpt' },
          'role-ext': { id: 'role-ext', chatId: 'chat-seed-1', name: '外部顾问', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, modelSource: 'external' },
        },
        messagesById: {
          'msg-1': { id: 'msg-1', chatId: 'chat-seed-1', seq: 1, type: 'user', content: '各位好，今天对齐一下 v2 的排期。', createdAt: now - 3_600_000, status: 'received' },
          'msg-2': { id: 'msg-2', chatId: 'chat-seed-1', seq: 2, type: 'assistant', roleId: 'role-a', roleName: '产品经理', content: '**排期建议**：\n\n1. 周一完成需求冻结\n2. 周三出交互稿\n3. 下周一提测', createdAt: now - 3_500_000, status: 'received' },
          'msg-3': { id: 'msg-3', chatId: 'chat-seed-1', seq: 3, type: 'user', content: '前端这块有问题吗？', mentionedRoleIds: ['role-b'], createdAt: now - 3_400_000, status: 'received' },
          'msg-4': { id: 'msg-4', chatId: 'chat-seed-1', seq: 4, type: 'assistant', roleId: 'role-b', roleName: '工程师', content: '没问题，组件拆分已经在做了。', createdAt: now - 3_300_000, status: 'received' },
        },
      }
      await chrome.storage.local.set({ 'openteam.groupStore': store })
    })
    console.log('seeded legacy store key from page (auto-migrates to v2 on reload)')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })
    await new Promise(resolve => setTimeout(resolve, 2500))
  }

  const presence = await page.evaluate(() => {
    const ids = ['app', 'chat-list', 'chat-title', 'chat-subtitle', 'composer', 'message-input',
      'target-preview', 'iframe-host', 'notes-panel', 'role-panel', 'role-list', 'error']
    const found = {}
    for (const id of ids) {
      const el = document.getElementById(id)
      found[id] = el ? { hidden: el.hidden, children: el.children.length } : null
    }
    found.__chatItems = document.querySelectorAll('#chat-list .chat-item').length
    found.__messageRows = document.querySelectorAll('#messages .message-row').length
    found.__reactMounted = Boolean(document.querySelector('[data-react-root], #app')?.closest('body'))
    found.__title = document.getElementById('chat-title')?.textContent
    return found
  })
  console.log('element presence:', JSON.stringify(presence, null, 1))

  // 验收探针：--seed 时头部/摘要必须反映种子数据（React 数据流 + 文本未被回写）
  const probe = await page.evaluate(() => ({
    title: document.getElementById('chat-title')?.textContent,
    subtitle: document.getElementById('chat-subtitle')?.textContent,
    summary: document.getElementById('store-summary')?.textContent,
    chatItems: document.querySelectorAll('#chat-list .chat-item').length,
    messageRows: document.querySelectorAll('#messages .message-row').length,
  }))
  console.log('probe:', JSON.stringify(probe))
  if (seed) {
    const expected = { title: '产品需求评审', chatItems: 1, messageRows: 4 }
    const mismatches = Object.entries(expected).filter(([key, value]) => probe[key] !== value)
    if (!probe.summary.startsWith('1 个群聊')) mismatches.push(['summary', probe.summary])
    if (mismatches.length > 0) {
      console.error('seed acceptance mismatch:', JSON.stringify(mismatches))
      process.exitCode = 3
    }
  }

  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: false })
  console.log(`saved screenshots/${name}.png`)
} finally {
  await browser.close()
}

if (consoleErrors.length > 0) {
  console.log(`\nconsole/page errors (${consoleErrors.length}):`)
  for (const line of consoleErrors.slice(0, 20)) console.log('  -', line)
  process.exitCode = 2
}
