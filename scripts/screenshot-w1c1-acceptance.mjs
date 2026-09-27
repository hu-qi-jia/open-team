/*
 * W1-C1 阶段验收探针：TemporaryPersonModal / BuiltinTemplateDetailModal
 * 换 Radix Dialog 后的回归——宽度/居中/关闭路径（关闭钮、Escape、
 * 遮罩点击）/打开聚焦/双主题截图。断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `w1c1-${name}.png`) })
  console.log(`saved screenshots/w1c1-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w1c1-'))
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

  // 种子数据：一条群聊 + 两个人员（添加人员弹窗需要选中群聊守卫通过）
  await page.evaluate(async () => {
    const now = Date.now()
    const chat = {
      id: 'chat-seed-1',
      name: '产品需求评审',
      mode: 'collaborative',
      roleIds: ['role-pm', 'role-eng'],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 86_400_000,
      updatedAt: now,
    }
    const roles = [
      { id: 'role-pm', chatId: chat.id, name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责需求拆解' },
      { id: 'role-eng', chatId: chat.id, name: '工程', chatSite: 'deepseek', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责方案落地' },
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

  const dialogProbe = selector => page.evaluate(id => {
    const el = document.getElementById(id)
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      role: el.getAttribute('role'),
      hidden: el.hidden,
      width: style.width,
      maxWidth: style.maxWidth,
      position: style.position,
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      zIndex: style.zIndex,
    }
  }, selector)
  const exists = selector => page.evaluate(id => document.getElementById(id) !== null, selector)

  // ---- 1. 内置人员详情弹窗（Radix） ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await sleep(400)
  // legacy 弹窗内的按钮用 DOM click 派发（puppeteer 坐标点击偶发不可点判定）
  await page.evaluate(() => { document.getElementById('people-library-tab-builtin')?.click() })
  await sleep(300)
  await page.evaluate(() => { document.querySelector('#people-library-list .template-detail')?.click() })
  await page.waitForSelector('#builtin-template-detail-modal', { timeout: 5000 })
  await sleep(500)

  const detailDark = await dialogProbe('builtin-template-detail-modal')
  check('detail dialog mounted as role=dialog', detailDark?.role === 'dialog' && detailDark.hidden === false, JSON.stringify(detailDark))
  check('detail dialog width capped at 720px', detailDark?.width === '720px', detailDark?.width)
  check('detail dialog has no legacy hidden attribute', detailDark?.hidden === false)
  await shot(page, '01-builtin-detail-dark')

  // Escape：Radix 关详情层；人员库自己的 document 级 Escape 监听也关闭
  // 它（旧版两套监听并存时即为双关，行为保真）
  await page.keyboard.press('Escape')
  await sleep(500)
  check('detail closes on Escape', !(await exists('builtin-template-detail-modal')))
  check('people library closes on its own legacy Escape listener', await page.evaluate(() => document.getElementById('people-library-modal')?.hidden === true))

  // 重开人员库 → 详情弹窗，遮罩点击只关 Radix 详情层（点不到 z-9 的人员库遮罩）
  await page.evaluate(() => { document.getElementById('open-people-library')?.click() })
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await sleep(300)
  await page.evaluate(() => { document.getElementById('people-library-tab-builtin')?.click() })
  await sleep(200)
  await page.evaluate(() => { document.querySelector('#people-library-list .template-detail')?.click() })
  await page.waitForSelector('#builtin-template-detail-modal', { timeout: 5000 })
  await sleep(300)
  await page.mouse.click(30, 30)
  await sleep(800)
  check('detail closes on overlay click', !(await exists('builtin-template-detail-modal')))
  check('people library stays open after overlay click', await page.evaluate(() => document.getElementById('people-library-modal')?.hidden === false))

  // 清理预览态后切浅色再截一张
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)
  await page.click('#theme-light')
  await sleep(400)
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await sleep(300)
  await page.evaluate(() => { document.getElementById('people-library-tab-builtin')?.click() })
  await sleep(200)
  await page.evaluate(() => { document.querySelector('#people-library-list .template-detail')?.click() })
  await page.waitForSelector('#builtin-template-detail-modal', { timeout: 5000 })
  await sleep(500)
  const detailLight = await dialogProbe('builtin-template-detail-modal')
  check('detail dialog light theme width still 720px', detailLight?.width === '720px', detailLight?.width)
  await shot(page, '02-builtin-detail-light')
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)

  // ---- 2. 临时添加弹窗（Radix，经添加人员弹窗叠层打开） ----
  await page.click('#toggle-people-drawer')
  await sleep(400)
  await page.evaluate(() => { document.querySelector('#add-role-form button[type="submit"]')?.click() })
  await page.waitForSelector('#add-person-modal:not([hidden])', { timeout: 5000 })
  await sleep(300)
  await page.evaluate(() => { document.getElementById('open-temporary-person')?.click() })
  await page.waitForSelector('#temporary-person-modal', { timeout: 5000 })
  await sleep(500)

  const tempProbe = await page.evaluate(() => {
    const el = document.getElementById('temporary-person-modal')
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      role: el.getAttribute('role'),
      width: style.width,
      focusedIsName: document.activeElement?.id === 'temporary-person-name',
      nameValue: document.getElementById('temporary-person-name')?.value,
    }
  })
  check('temporary dialog mounted, width 520px', tempProbe?.role === 'dialog' && tempProbe.width === '520px', JSON.stringify(tempProbe))
  check('name field focused on open (onOpenAutoFocus prevent + self focus)', tempProbe?.focusedIsName === true)
  check('form was reset on open', tempProbe?.nameValue === '')
  await shot(page, '03-temporary-dark')

  // Escape 关闭，添加人员弹窗（legacy）保持
  await page.keyboard.press('Escape')
  await sleep(500)
  check('temporary closes on Escape', !(await exists('temporary-person-modal')))
  check('add-person modal stays open below', await exists('add-person-modal'))

  // 重开校验焦点回落，然后切浅色截图
  await page.evaluate(() => { document.getElementById('open-temporary-person')?.click() })
  await page.waitForSelector('#temporary-person-modal', { timeout: 5000 })
  await sleep(400)
  const refocus = await page.evaluate(() => document.activeElement?.id === 'temporary-person-name')
  check('name field re-focused on reopen', refocus)
  await page.evaluate(() => { document.getElementById('close-temporary-person')?.click() })
  await sleep(500)

  await page.evaluate(() => { document.getElementById('close-add-person')?.click() })
  await page.click('#close-people-drawer')
  await sleep(300)
  await page.click('#theme-dark')
  await sleep(400)

  await page.click('#toggle-people-drawer')
  await sleep(300)
  await page.evaluate(() => { document.querySelector('#add-role-form button[type="submit"]')?.click() })
  await page.waitForSelector('#add-person-modal:not([hidden])', { timeout: 5000 })
  await sleep(200)
  await page.click('#open-temporary-person')
  await page.waitForSelector('#temporary-person-modal', { timeout: 5000 })
  await sleep(500)
  const tempLight = await dialogProbe('temporary-person-modal')
  check('temporary dialog dark theme width still 520px', tempLight?.width === '520px', tempLight?.width)
  await shot(page, '04-temporary-dark-reopen')

  console.log('\n==== W1-C1 acceptance summary ====')
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
