/*
 * W1-C2 阶段验收探针：AllNotesModal 换 Radix Dialog 后的回归——
 * 1160px 宽度/居中、双栏工作区、关闭路径（关闭钮、Escape、遮罩点击）、
 * 关闭再重开编辑器重建、双主题截图。断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `w1c2-${name}.png`) })
  console.log(`saved screenshots/w1c2-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w1c2-'))
const browser = await puppeteer.launch({
  headless: true,
  userDataDir,
  protocolTimeout: 60_000,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
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

  await page.evaluate(async () => {
    const now = Date.now()
    const chat = {
      id: 'chat-seed-1',
      name: '产品需求评审',
      mode: 'collaborative',
      roleIds: ['role-pm'],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 86_400_000,
      updatedAt: now,
    }
    const roles = [
      { id: 'role-pm', chatId: chat.id, name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责需求拆解' },
    ]
    await chrome.storage.local.set({
      'openteam.groupStore': {
        version: 7,
        currentChatId: chat.id,
        chatOrder: [chat.id],
        chatsById: { [chat.id]: chat },
        rolesById: Object.fromEntries(roles.map(role => [role.id, role])),
        messagesById: {},
        orchestrationFlowsById: {},
        orchestrationRunsById: {},
        activeOrchestrationRunIdByChatId: {},
        settings: {},
      },
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  const probe = () => page.evaluate(() => {
    const el = document.getElementById('all-notes-modal')
    if (!el) return null
    const style = getComputedStyle(el)
    const editor = document.getElementById('all-notes-editor')
    return {
      role: el.getAttribute('role'),
      width: style.width,
      maxWidth: style.maxWidth,
      background: style.backgroundColor,
      listItems: document.querySelectorAll('#all-notes-modal [data-note-target-id]').length,
      activeLabel: document.querySelector('#all-notes-modal .all-note-target.active .all-note-target-title')?.textContent,
      editorMounted: editor !== null,
      editorChildCount: editor?.childElementCount ?? 0,
      toolbarButtons: document.querySelectorAll('#all-notes-modal .note-tool-btn').length,
    }
  })
  const exists = () => page.evaluate(() => document.getElementById('all-notes-modal') !== null)

  // ---- 打开全部笔记（Radix） ----
  // #open-all-notes 是 uiBus 命令名，不是 DOM id：Rail 退役（5b14885）时入口钮
  // 变成了 AppShellFrame 的 ToolButton（无 id，只有 aria-label）。仅换选择器。
  await page.click('button[aria-label="全部笔记"]')
  await page.waitForSelector('#all-notes-modal', { timeout: 5000 })
  await sleep(500)

  const dark = await probe()
  check('dialog mounted as role=dialog', dark?.role === 'dialog', JSON.stringify(dark))
  // S5-T2：全部笔记弹窗宽度由 legacy 的 980 改为 1160（2xl），用户已批准；期望随之更新。
  check('dialog width 1160px', dark?.width === '1160px', dark?.width)
  check('workspace targets rendered (global + chat)', dark?.listItems === 2, String(dark?.listItems))
  check('toolbar rendered', dark?.toolbarButtons === 7, String(dark?.toolbarButtons))
  check('prosemirror editor created', dark?.editorMounted && dark.editorChildCount > 0, `children=${dark?.editorChildCount}`)
  await shot(page, '01-all-notes-dark')

  // 编辑器输入 → 250ms 防抖落保存（重开后的内容断言验证保存链路）
  await page.evaluate(() => {
    const editorEl = document.querySelector('#all-notes-editor .ProseMirror')
    editorEl?.focus()
    document.execCommand('insertText', false, '验收探针笔记内容')
  })
  await sleep(600)

  // Escape 关闭
  await page.keyboard.press('Escape')
  await sleep(600)
  check('dialog closes on Escape', !(await exists()))

  // 重开：编辑器在新容器上重建（engine.destroy 后 ensureEditor）
  await page.click('button[aria-label="全部笔记"]')
  await page.waitForSelector('#all-notes-modal', { timeout: 5000 })
  await sleep(500)
  const reopened = await probe()
  check('reopened dialog width still 1160px', reopened?.width === '1160px', reopened?.width)
  check('editor rebuilt after reopen', reopened?.editorMounted && reopened.editorChildCount > 0, `children=${reopened?.editorChildCount}`)
  const contentAfterReopen = await page.evaluate(() => document.querySelector('#all-notes-editor .ProseMirror')?.textContent ?? '')
  check('persisted note content shown after reopen', contentAfterReopen.includes('验收探针笔记内容'), contentAfterReopen.slice(0, 40))

  // 遮罩点击关闭（真实鼠标点到内容区外的遮罩上）
  await page.mouse.click(30, 30)
  await sleep(800)
  check('dialog closes on overlay click', !(await exists()))

  // 内容区点击不关闭
  await page.click('button[aria-label="全部笔记"]')
  await page.waitForSelector('#all-notes-modal', { timeout: 5000 })
  await sleep(400)
  await page.evaluate(() => { document.querySelector('.all-notes-workspace')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await sleep(300)
  check('workspace click keeps dialog open', await exists())

  // 先关弹窗再切浅色（遮罩会拦截 #theme-light 的坐标点击），重开截图
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('#theme-light')
  await sleep(400)
  await page.click('button[aria-label="全部笔记"]')
  await page.waitForSelector('#all-notes-modal', { timeout: 5000 })
  await sleep(400)
  const light = await probe()
  check('light theme width still 1160px', light?.width === '1160px', light?.width)
  await shot(page, '02-all-notes-light')
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W1-C2 acceptance summary ====')
  if (failures.length > 0) {
    console.error(`FAILED checks (${failures.length}):`, failures.join(' | '))
    process.exitCode = 3
  } else {
    console.log('all checks passed')
  }
} finally {
  await Promise.race([
    browser.close(),
    sleep(10_000).then(() => browser.process()?.kill()),
  ])
}

if (consoleErrors.length > 0) {
  console.log(`\nconsole/page errors (${consoleErrors.length}):`)
  for (const line of consoleErrors.slice(0, 20)) console.log('  -', line)
  if (process.exitCode === undefined) process.exitCode = 2
}
