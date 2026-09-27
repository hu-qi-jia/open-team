/*
 * W1-C3 阶段验收探针：AddPersonModal（820px）/ PersonTemplateModal
 * （520px）换 Radix Dialog 后的回归——宽度/居中、打开聚焦、关闭路径
 * （关闭钮、Escape、遮罩点击）、临时添加叠层、双主题截图。
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
  await page.screenshot({ path: path.join(outDir, `w1c3-${name}.png`) })
  console.log(`saved screenshots/w1c3-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w1c3-'))
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

  const probe = id => page.evaluate(modalId => {
    const el = document.getElementById(modalId)
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      role: el.getAttribute('role'),
      width: style.width,
      maxWidth: style.maxWidth,
      background: style.backgroundColor,
    }
  }, id)
  const exists = id => page.evaluate(modalId => document.getElementById(modalId) !== null, id)

  // ---- 1. 添加人员弹窗（820px，经成员抽屉表单打开） ----
  await page.click('#toggle-people-drawer')
  await sleep(400)
  await page.evaluate(() => { document.querySelector('#add-role-form button[type="submit"]')?.click() })
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(500)

  const addDark = await probe('add-person-modal')
  check('add-person dialog mounted, width 820px', addDark?.role === 'dialog' && addDark.width === '820px', JSON.stringify(addDark))
  check('default custom person seeded in list', await page.evaluate(() => document.querySelectorAll('#add-library-people-list .select-row').length > 0))
  await shot(page, '01-add-person-dark')

  // 临时添加叠层（C1 已验，这里只确认入口仍通）
  await page.evaluate(() => { document.getElementById('open-temporary-person')?.click() })
  await page.waitForSelector('#temporary-person-modal', { timeout: 5000 })
  await sleep(300)
  check('temporary dialog stacks above add-person', await exists('temporary-person-modal') && await exists('add-person-modal'))
  await page.keyboard.press('Escape')
  await sleep(500)
  check('temporary closes, add-person stays', !(await exists('temporary-person-modal')) && await exists('add-person-modal'))

  // 遮罩点击关闭 add-person（真实鼠标点遮罩）
  await page.mouse.click(30, 30)
  await sleep(800)
  check('add-person closes on overlay click', !(await exists('add-person-modal')))

  // 内容区点击不关闭
  await page.evaluate(() => { document.querySelector('#add-role-form button[type="submit"]')?.click() })
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(300)
  await page.evaluate(() => { document.querySelector('#add-library-people-form')?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await sleep(300)
  check('form click keeps add-person open', await exists('add-person-modal'))
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('#close-people-drawer')
  await sleep(300)

  // ---- 2. 人员编辑弹窗（520px，人员库「新建」打开，聚焦名称框） ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await sleep(400)
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(500)

  const editorDark = await probe('person-template-modal')
  const focusIsName = await page.evaluate(() => document.activeElement?.id === 'template-name')
  check('person editor dialog mounted, width 520px', editorDark?.role === 'dialog' && editorDark.width === '520px', JSON.stringify(editorDark))
  check('name field focused on open (onOpenAutoFocus)', focusIsName)
  check('radio site controls rendered', await page.evaluate(() => document.querySelectorAll('input[name="template-chat-site"]').length === 6))
  await shot(page, '02-person-editor-dark')

  // Escape：Radix 关编辑器；人员库自带的 document 级 Escape 监听也关闭
  // 它——双关与 W1 前行为一致（同 C1 详情弹窗的验证结论）
  await page.keyboard.press('Escape')
  await sleep(500)
  check('person editor closes on Escape', !(await exists('person-template-modal')))
  check('people library also closes on Escape (legacy double-close preserved)', await page.evaluate(() => document.getElementById('people-library-modal')?.hidden === true))

  // 重开人员库与编辑器：遮罩点击只关编辑器（Radix 遮罩 z-50 拦截，点不到库）
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await sleep(400)
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(300)
  await page.mouse.click(30, 30)
  await sleep(800)
  check('person editor closes on overlay click', !(await exists('person-template-modal')))
  check('people library stays open after overlay click', await page.evaluate(() => document.getElementById('people-library-modal')?.hidden === false))

  // 重开校验焦点回落 + GPTs 条件字段随单选显隐
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(400)
  check('name field re-focused on reopen', await page.evaluate(() => document.activeElement?.id === 'template-name'))
  await page.evaluate(() => { document.getElementById('template-site-chatgpt')?.click() })
  await sleep(200)
  check('gpts conditional field appears', await exists('template-chatgpt-gpts-field'))
  await shot(page, '03-person-editor-gpts-dark')

  // 切浅色截图（先关编辑器，人员库仍开）
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('#theme-light')
  await sleep(400)
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(500)
  const editorLight = await probe('person-template-modal')
  check('person editor light theme width still 520px', editorLight?.width === '520px', editorLight?.width)
  await shot(page, '04-person-editor-light')
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W1-C3 acceptance summary ====')
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
