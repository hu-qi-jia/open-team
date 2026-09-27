/*
 * W1-C6 阶段验收探针：编排三层弹窗（主 1160 / 模板选择 760 / 自动编排 860）
 * 换 Radix Dialog 后的回归——
 * - 三层全部「仅按钮可关」：Escape / 背板点击都不关闭，只能走各自关闭钮；
 * - 首开聚焦（主=任务输入框，模板=第一张卡，自动=输入框）；
 * - 子弹窗与主弹窗同屏叠放、关闭子弹窗后主弹窗恢复可点（pointer-events）；
 * - 拖人员入画布（合成 drop 事件）仍能创建节点；
 * - 双主题截图。断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `w1c6-${name}.png`) })
  console.log(`saved screenshots/w1c6-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w1c6-'))
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
      roleIds: ['role-pm', 'role-dev'],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 86_400_000,
      updatedAt: now,
    }
    const roles = [
      { id: 'role-pm', chatId: chat.id, name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责需求拆解' },
      { id: 'role-dev', chatId: chat.id, name: '研发', chatSite: 'deepseek', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责技术方案' },
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
        settings: {
          externalModelOrder: ['external-model-1'],
          externalModelsById: {
            'external-model-1': { id: 'external-model-1', name: '本地模型', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', modelName: 'local-chat-model', createdAt: now, updatedAt: now },
          },
        },
      },
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  // ---- 打开主编排弹窗 ----
  await page.evaluate(() => { document.getElementById('open-orchestration')?.click() })
  await page.waitForSelector('#orchestration-modal', { timeout: 5000 })
  await sleep(1500) // 等待 X6 画布初始化

  const mainProbe = await page.evaluate(() => {
    const el = document.getElementById('orchestration-modal')
    if (!el) return null
    const style = getComputedStyle(el)
    return { role: el.getAttribute('role'), width: style.width, maxWidth: style.maxWidth, height: style.height }
  })
  check('main dialog mounted, width 1160px', mainProbe?.role === 'dialog' && mainProbe.width === '1160px', JSON.stringify(mainProbe))
  check('task input focused on open (onOpenAutoFocus)', await page.evaluate(() => document.activeElement?.id === 'orchestration-task'))
  check('empty hint visible on blank canvas', await page.evaluate(() => document.getElementById('orchestration-empty-hint')?.hidden === false))
  await shot(page, '01-orchestration-main-dark')

  // ---- 仅按钮可关：Escape / 背板点击都不关 ----
  await page.keyboard.press('Escape')
  await sleep(600)
  check('Escape does NOT close main dialog', await page.evaluate(() => document.getElementById('orchestration-modal') !== null))
  await page.mouse.click(20, 20)
  await sleep(800)
  check('overlay click does NOT close main dialog', await page.evaluate(() => document.getElementById('orchestration-modal') !== null))

  // ---- 拖人员入画布（合成 drop） ----
  await page.evaluate(() => {
    const canvas = document.getElementById('orchestration-stage-canvas')
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'role-pm', types: ['application/x-openteam-role-id'] } })
    canvas?.dispatchEvent(drop)
  })
  await sleep(1000)
  check('synthetic role drop creates a node (empty hint hides)', await page.evaluate(() => document.getElementById('orchestration-empty-hint')?.hidden === true))

  // ---- 模板选择子弹窗：叠放 + 聚焦 + 仅按钮可关 ----
  await page.evaluate(() => { document.getElementById('open-orchestration-template')?.click() })
  await page.waitForSelector('#orchestration-template-modal', { timeout: 5000 })
  await sleep(500)
  const pickerProbe = await page.evaluate(() => {
    const el = document.getElementById('orchestration-template-modal')
    if (!el) return null
    return { width: getComputedStyle(el).width, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.id) }
  })
  check('template picker mounted at 760px stacked above main', pickerProbe?.width === '760px' && pickerProbe.dialogs.includes('orchestration-modal') && pickerProbe.dialogs[pickerProbe.dialogs.length - 1] === 'orchestration-template-modal', JSON.stringify(pickerProbe))
  check('first template card focused on open', await page.evaluate(() => document.activeElement?.classList.contains('orchestration-template-card')))
  await shot(page, '02-orchestration-template-picker-dark')

  await page.keyboard.press('Escape')
  await sleep(500)
  check('Escape does NOT close template picker', await page.evaluate(() => document.getElementById('orchestration-template-modal') !== null))
  await page.mouse.click(20, 20)
  await sleep(800)
  check('overlay click does NOT close template picker', await page.evaluate(() => document.getElementById('orchestration-template-modal') !== null))
  await page.evaluate(() => { document.getElementById('close-orchestration-template')?.click() })
  await sleep(600)
  check('picker close button unmounts picker, main stays', await page.evaluate(() =>
    document.getElementById('orchestration-template-modal') === null && document.getElementById('orchestration-modal') !== null))

  // ---- 自动编排子弹窗：聚焦输入框 + 覆盖时主弹窗不可点（Radix modal 语义） ----
  await page.evaluate(() => { document.getElementById('auto-orchestration')?.click() })
  await page.waitForSelector('#orchestration-auto-modal', { timeout: 5000 })
  await sleep(500)
  const autoProbe = await page.evaluate(() => {
    const el = document.getElementById('orchestration-auto-modal')
    if (!el) return null
    return { width: getComputedStyle(el).width, inputPointerEvents: getComputedStyle(document.getElementById('save-orchestration') ?? document.body).pointerEvents }
  })
  check('auto dialog mounted at 860px', autoProbe?.width === '860px', JSON.stringify(autoProbe))
  check('auto input focused on open', await page.evaluate(() => document.activeElement?.classList.contains('orchestration-auto-input')))
  check('main modal not clickable while auto dialog open (modal stacking)', autoProbe?.inputPointerEvents === 'none', autoProbe?.inputPointerEvents)
  await shot(page, '03-orchestration-auto-dark')

  await page.keyboard.press('Escape')
  await sleep(500)
  check('Escape does NOT close auto dialog', await page.evaluate(() => document.getElementById('orchestration-auto-modal') !== null))
  await page.mouse.click(20, 20)
  await sleep(800)
  check('overlay click does NOT close auto dialog', await page.evaluate(() => document.getElementById('orchestration-auto-modal') !== null))
  await page.evaluate(() => { document.getElementById('close-auto-orchestration')?.click() })
  await sleep(600)
  check('auto close button unmounts dialog, main clickable again', await page.evaluate(() =>
    document.getElementById('orchestration-auto-modal') === null
    && getComputedStyle(document.getElementById('save-orchestration') ?? document.body).pointerEvents !== 'none'))

  // ---- 主弹窗关闭钮 ----
  await page.evaluate(() => { document.getElementById('close-orchestration')?.click() })
  await sleep(600)
  check('main close button unmounts dialog', await page.evaluate(() => document.getElementById('orchestration-modal') === null))

  // ---- 浅色主题 ----
  await page.click('#theme-light')
  await sleep(400)
  await page.evaluate(() => { document.getElementById('open-orchestration')?.click() })
  await page.waitForSelector('#orchestration-modal', { timeout: 5000 })
  await sleep(1500)
  check('light theme main width still 1160px', await page.evaluate(() => getComputedStyle(document.getElementById('orchestration-modal')).width === '1160px'))
  await shot(page, '04-orchestration-main-light')
  await page.evaluate(() => { document.getElementById('open-orchestration-template')?.click() })
  await page.waitForSelector('#orchestration-template-modal', { timeout: 5000 })
  await sleep(500)
  check('light theme picker width still 760px', await page.evaluate(() => getComputedStyle(document.getElementById('orchestration-template-modal')).width === '760px'))
  await shot(page, '05-orchestration-picker-light')
  await page.evaluate(() => { document.getElementById('close-orchestration-template')?.click() })
  await sleep(400)
  await page.evaluate(() => { document.getElementById('close-orchestration')?.click() })
  await sleep(400)
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W1-C6 acceptance summary ====')
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
