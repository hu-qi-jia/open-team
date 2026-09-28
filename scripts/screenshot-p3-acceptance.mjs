/*
 * P3 阶段验收探针：笔记面板（编辑/防抖保存/划词插入/拖拽/缩放）、
 * 全部笔记弹窗、角色卡提示词弹窗。加载 dist/ 扩展 → 注入种子数据 →
 * 逐步交互并截图，每步打印断言结果；任一断言失败置 exitCode 3。
 */
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'screenshots')
await mkdir(outDir, { recursive: true })

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `p3-${name}.png`) })
  console.log(`saved screenshots/p3-${name}.png`)
}

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-p3-'))
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

  // 种子数据：群聊 + 成员 + 消息 + 全局/群聊笔记（含富文本 doc 结构）
  await page.evaluate(async () => {
    const now = Date.now()
    const note = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const store = {
      version: 7,
      currentChatId: 'chat-seed-1',
      chatOrder: ['chat-seed-1'],
      chatsById: {
        'chat-seed-1': {
          id: 'chat-seed-1',
          name: '产品需求评审',
          mode: 'collaborative',
          roleIds: ['role-a', 'role-b'],
          messageIds: ['msg-1', 'msg-2'],
          nextMessageSeq: 3,
          status: 'ready',
          createdAt: now - 86_400_000,
          updatedAt: now,
        },
      },
      rolesById: {
        'role-a': { id: 'role-a', chatId: 'chat-seed-1', name: '产品经理', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'deepseek', prompt: '你是一名资深产品经理，负责需求拆解与排期。' },
        'role-b': { id: 'role-b', chatId: 'chat-seed-1', name: '工程师', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'chatgpt', prompt: '你是一名前端工程师，负责组件实现。' },
      },
      messagesById: {
        'msg-1': { id: 'msg-1', chatId: 'chat-seed-1', seq: 1, type: 'user', content: '各位好，今天对齐一下 v2 的排期。', createdAt: now - 3_600_000, status: 'received' },
        'msg-2': { id: 'msg-2', chatId: 'chat-seed-1', seq: 2, type: 'assistant', roleId: 'role-a', roleName: '产品经理', content: '排期建议：周一完成需求冻结，周三出交互稿。', createdAt: now - 3_500_000, status: 'received' },
      },
      globalNote: note('全局备忘：下周同步发布节奏'),
      chatNotesById: { 'chat-seed-1': note('群聊笔记：v2 目标是性能与体验') },
    }
    await chrome.storage.local.set({ 'openteam.groupStore': store })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await new Promise(resolve => setTimeout(resolve, 2500))

  // ---- 1. 基线：角色面板可见（RolePanel React 化后的角色卡） ----
  const roleProbe = await page.evaluate(() => ({
    roleCards: document.querySelectorAll('#role-list .role-card, #role-list li').length,
    roleSummary: document.getElementById('role-summary')?.textContent,
    chatTitle: document.getElementById('chat-title')?.textContent,
  }))
  console.log('role probe:', JSON.stringify(roleProbe))
  check('role cards render (2 seeded)', roleProbe.roleCards >= 2, `cards=${roleProbe.roleCards}`)
  await shot(page, '01-base-role-panel')

  // ---- 2. 打开笔记面板（头部开关），懒加载编辑器，群聊笔记内容就位 ----
  await page.click('#toggle-notes-panel')
  await page.waitForSelector('#notes-panel.open', { timeout: 10_000 })
  await page.waitForSelector('#notes-editor .ProseMirror', { timeout: 15_000 })
  await new Promise(resolve => setTimeout(resolve, 600))
  const openProbe = await page.evaluate(() => ({
    open: document.getElementById('notes-panel')?.classList.contains('open'),
    editorText: document.querySelector('#notes-editor .ProseMirror')?.textContent,
    chatTabActive: document.getElementById('chat-note-tab')?.classList.contains('active'),
    ariaExpanded: document.getElementById('toggle-notes-panel')?.getAttribute('aria-expanded'),
  }))
  console.log('notes open probe:', JSON.stringify(openProbe))
  check('panel opens via header toggle', openProbe.open && openProbe.ariaExpanded === 'true')
  check('chat note content loaded into editor', openProbe.editorText?.includes('v2 目标是性能与体验'), openProbe.editorText)
  check('chat scope tab active', openProbe.chatTabActive === true)
  await shot(page, '02-notes-panel-open')

  // ---- 3. 编辑 + 250ms 防抖保存（等待落盘后回读 chrome.storage） ----
  const before = await page.evaluate(() => document.querySelector('#notes-editor .ProseMirror')?.textContent)
  await page.click('#notes-editor .ProseMirror')
  await page.keyboard.type('（已追加）')
  await new Promise(resolve => setTimeout(resolve, 900)) // 250ms 防抖 + SW 落盘
  const saved = await page.evaluate(async () => {
    const all = await chrome.storage.local.get(null)
    return JSON.stringify(all).includes('（已追加）')
  })
  check('debounced edit persisted to storage (250ms → GROUP_NOTE_SAVE)', saved === true)
  await shot(page, '03-notes-panel-edited')

  // ---- 4. 拖拽 + 缩放 ----
  const geomBefore = await page.evaluate(() => {
    const panel = document.getElementById('notes-panel')
    return { left: panel.style.left, top: panel.style.top, width: panel.style.width, height: panel.style.height }
  })
  const handle = await page.$('#notes-drag-handle')
  const hb = await handle.boundingBox()
  await page.mouse.move(hb.x + 40, hb.y + 8)
  await page.mouse.down()
  await page.mouse.move(hb.x - 120, hb.y + 108, { steps: 5 })
  await page.mouse.up()
  const dragProbe = await page.evaluate(() => {
    const panel = document.getElementById('notes-panel')
    return { left: panel.style.left, top: panel.style.top, draggingClassCleared: !panel.classList.contains('dragging') }
  })
  console.log('drag:', JSON.stringify({ before: geomBefore, after: dragProbe }))
  check('drag repositions panel via inline style', dragProbe.left !== geomBefore.left && dragProbe.top !== geomBefore.top)
  check('dragging class cleared on pointerup', dragProbe.draggingClassCleared)

  const resizeHandle = await page.$('#notes-resize-handle')
  const rb = await resizeHandle.boundingBox()
  const sizeBefore = await page.evaluate(() => {
    const rect = document.getElementById('notes-panel').getBoundingClientRect()
    return { w: rect.width, h: rect.height }
  })
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2)
  await page.mouse.down()
  await page.mouse.move(rb.x + 140, rb.y + 120, { steps: 5 })
  await page.mouse.up()
  const sizeAfter = await page.evaluate(() => {
    const rect = document.getElementById('notes-panel').getBoundingClientRect()
    return { w: Math.round(rect.width), h: Math.round(rect.height) }
  })
  console.log('resize:', JSON.stringify({ before: sizeBefore, after: sizeAfter }))
  check('resize grows the panel', sizeAfter.w > sizeBefore.w + 50 && sizeAfter.h > sizeBefore.h + 50)
  await shot(page, '04-notes-panel-drag-resize')

  // ---- 5. 划词「加入笔记」→ 桥接插入当前群笔记并即时保存 ----
  const selectedText = await page.evaluate(() => {
    const target = document.querySelector('#messages .message-row p, #messages p')
    if (!target?.firstChild) throw new Error('no message text node for selection')
    const range = document.createRange()
    range.selectNodeContents(target.firstChild)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return selection.toString()
  })
  await page.waitForSelector('.mark-menu', { timeout: 5000 })
  await shot(page, '05a-mark-menu')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.mark-menu button')].find(b => b.textContent?.includes('加入笔记'))
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 700)) // 即时保存落盘
  const insertProbe = await page.evaluate(() => ({
    panelOpen: document.getElementById('notes-panel')?.classList.contains('open'),
    editorText: document.querySelector('#notes-editor .ProseMirror')?.textContent,
  }))
  console.log('insert probe:', JSON.stringify({ selectedText: selectedText.slice(0, 24), ...insertProbe }))
  check('mark menu opens notes panel', insertProbe.panelOpen === true)
  check('selection inserted into active note', selectedText.trim().length > 0 && (insertProbe.editorText ?? '').includes(selectedText.trim()), insertProbe.editorText)
  await shot(page, '05-mark-insert')

  // ---- 6. 全部笔记弹窗：列表 / 切目标 / Escape 关闭 ----
  await page.evaluate(() => document.getElementById('notes-panel')?.classList.add('shot-ignore'))
  // #open-all-notes 是 uiBus 命令名，不是 DOM id：Rail 退役（5b14885）时入口钮
  // 变成了 AppShellFrame 的 ToolButton（无 id，只有 aria-label）。仅换选择器。
  await page.click('button[aria-label="全部笔记"]')
  await page.waitForSelector('#all-notes-modal:not([hidden])', { timeout: 5000 })
  await page.waitForSelector('#all-notes-editor .ProseMirror', { timeout: 10_000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  const modalProbe = await page.evaluate(() => ({
    items: document.querySelectorAll('#all-notes-list .all-note-target').length,
    activeTitle: document.getElementById('all-notes-active-title')?.textContent,
    editorText: document.querySelector('#all-notes-editor .ProseMirror')?.textContent,
  }))
  console.log('all-notes probe:', JSON.stringify(modalProbe))
  check('all-notes lists global + chat entries', modalProbe.items >= 2, `items=${modalProbe.items}`)
  check('active target defaults to current chat', modalProbe.activeTitle === '产品需求评审', modalProbe.activeTitle)
  await page.evaluate(() => {
    const button = document.querySelector('#all-notes-list [data-note-target-id="global"]')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise(resolve => setTimeout(resolve, 400))
  const switchProbe = await page.evaluate(() => ({
    editorText: document.querySelector('#all-notes-editor .ProseMirror')?.textContent,
    activeTitle: document.getElementById('all-notes-active-title')?.textContent,
  }))
  check('switching to global swaps editor content', switchProbe.editorText?.includes('全局备忘') === true, switchProbe.editorText)
  await shot(page, '06-all-notes-modal')
  await page.keyboard.press('Escape')
  await new Promise(resolve => setTimeout(resolve, 300))
  const closed = await page.evaluate(() => document.getElementById('all-notes-modal')?.hidden)
  check('Escape closes all-notes modal', closed === true)

  // ---- 7. 角色卡：提示词详情弹窗 ----
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#role-list button')].find(b =>
      (b.getAttribute('aria-label') ?? '').includes('的提示词'))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise(resolve => setTimeout(resolve, 400))
  const promptProbe = await page.evaluate(() => ({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    title: document.getElementById('role-prompt-detail-title')?.textContent,
  }))
  console.log('prompt dialog probe:', JSON.stringify(promptProbe))
  check('role prompt dialog opens', promptProbe.dialogOpen === true, promptProbe.title)
  await shot(page, '07-role-prompt-dialog')
  await page.keyboard.press('Escape')

  console.log('\n==== P3 acceptance summary ====')
  if (failures.length > 0) {
    console.error(`FAILED checks (${failures.length}):`, failures.join(' | '))
    process.exitCode = 3
  } else {
    console.log('all checks passed')
  }
} finally {
  await browser.close()
}

if (consoleErrors.length > 0) {
  console.log(`\nconsole/page errors (${consoleErrors.length}):`)
  for (const line of consoleErrors.slice(0, 20)) console.log('  -', line)
  if (process.exitCode === undefined) process.exitCode = 2
}
