/*
 * W1-C5 阶段验收探针：GroupTemplateModal（1500px）换 Radix Dialog 后的
 * 回归——宽度/居中、打开聚焦搜索框、选中联动确认按钮、关闭路径（关闭钮、
 * Escape），以及「背板点击不关闭」的原行为保真（onInteractOutside
 * preventDefault）、双主题截图。
 * 断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `w1c5-${name}.png`) })
  console.log(`saved screenshots/w1c5-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w1c5-'))
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

  // ---- 打开：快速建群 + → 从模板中创建 ----
  await page.evaluate(() => { document.getElementById('quick-create-chat')?.click() })
  await sleep(400)
  await page.evaluate(() => { document.getElementById('open-group-template-create')?.click() })
  await page.waitForSelector('#group-template-modal', { timeout: 5000 })
  await sleep(600)

  const probe = await page.evaluate(() => {
    const el = document.getElementById('group-template-modal')
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      role: el.getAttribute('role'),
      width: style.width,
      maxWidth: style.maxWidth,
      height: style.height,
    }
  })
  check('group template dialog mounted, width 1500px', probe?.role === 'dialog' && probe.width === '1500px', JSON.stringify(probe))
  check('search field focused on open (onOpenAutoFocus)', await page.evaluate(() => document.activeElement?.id === 'group-template-search'))
  check('template options rendered', await page.evaluate(() => document.querySelectorAll('.group-template-option').length > 5))
  await shot(page, '01-group-template-dark')

  // ---- 选中联动确认按钮 ----
  await page.evaluate(() => { document.querySelector('.group-template-option')?.click() })
  await sleep(200)
  check('select enables confirm button', await page.evaluate(() => {
    const confirm = document.getElementById('confirm-group-template-create')
    return confirm instanceof HTMLButtonElement && !confirm.disabled
  }))
  check('selected option marked active', await page.evaluate(() => document.querySelector('.group-template-option.active') !== null))

  // ---- 背板点击不关闭（C5 核心契约） ----
  await page.mouse.click(20, 20)
  await sleep(800)
  check('overlay click does NOT close (onInteractOutside prevented)', await page.evaluate(() => document.getElementById('group-template-modal') !== null))
  await shot(page, '02-group-template-after-overlay-click')

  // 内容区点击也不关闭
  await page.evaluate(() => { document.querySelector('.group-template-toolbar')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await sleep(300)
  check('content click keeps dialog open', await page.evaluate(() => document.getElementById('group-template-modal') !== null))

  // ---- Escape 关闭并重置 ----
  await page.keyboard.press('Escape')
  await sleep(600)
  check('Escape closes dialog', await page.evaluate(() => document.getElementById('group-template-modal') === null))

  await page.evaluate(() => { document.getElementById('open-group-template-create')?.click() })
  await page.waitForSelector('#group-template-modal', { timeout: 5000 })
  await sleep(400)
  check('reopen is reset (confirm disabled, no active option)', await page.evaluate(() => {
    const confirm = document.getElementById('confirm-group-template-create')
    return confirm instanceof HTMLButtonElement && confirm.disabled
      && document.querySelector('.group-template-option.active') === null
  }))

  // ---- 过滤与空态 ----
  await page.evaluate(() => {
    const tech = [...document.querySelectorAll('.group-template-category-filter')].find(button => button.textContent === '技术研发')
    tech?.click()
  })
  await sleep(300)
  check('category filter narrows list', await page.evaluate(() => {
    const names = [...document.querySelectorAll('.group-template-option strong')].map(el => el.textContent)
    return names.length === 3 && names.includes('软件开发群') && names.includes('AI Agent 开发群')
  }))
  await page.evaluate(() => {
    const input = document.getElementById('group-template-search')
    if (input instanceof HTMLInputElement) {
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, '不存在的模板')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await sleep(300)
  check('empty state renders on no match', await page.evaluate(() => document.querySelector('.group-template-empty')?.textContent.includes('没有找到匹配的小组') === true))
  await shot(page, '03-group-template-empty-dark')

  // 空态恢复：清空搜索
  // `.btn` 在 S5/T3 被摘掉（空态改 shadcn Button，钩子类只剩
  // .group-template-empty-actions）——只把选择器换成后代 `button`，其余不动。
  await page.evaluate(() => {
    const clear = [...document.querySelectorAll('.group-template-empty-actions button')].find(button => button.textContent === '清空搜索')
    clear?.click()
  })
  await sleep(300)
  check('清空搜索 restores filtered list and refocuses search', await page.evaluate(() =>
    document.querySelectorAll('.group-template-option').length === 3
    && document.activeElement?.id === 'group-template-search'))

  // ---- 关闭钮 ----
  await page.evaluate(() => { document.getElementById('close-group-template-modal')?.click() })
  await sleep(600)
  check('close button closes dialog', await page.evaluate(() => document.getElementById('group-template-modal') === null))

  // ---- 浅色主题 ----
  await page.click('#theme-light')
  await sleep(400)
  await page.evaluate(() => { document.getElementById('quick-create-chat')?.click() })
  await sleep(300)
  await page.evaluate(() => { document.getElementById('open-group-template-create')?.click() })
  await page.waitForSelector('#group-template-modal', { timeout: 5000 })
  await sleep(600)
  const lightProbe = await page.evaluate(() => {
    const el = document.getElementById('group-template-modal')
    return el ? { width: getComputedStyle(el).width } : null
  })
  check('light theme width still 1500px', lightProbe?.width === '1500px', lightProbe?.width)
  await shot(page, '04-group-template-light')
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W1-C5 acceptance summary ====')
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
