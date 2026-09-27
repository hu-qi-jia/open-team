/*
 * W1-C4 阶段验收探针：PeopleLibraryModal（640px）/ ExternalModelsModal
 * （520px）换 Radix Dialog 后的回归——宽度/居中、打开聚焦、关闭路径
 * （关闭钮、Escape、遮罩点击）、叠层逐层关闭（原 document 级 Escape
 * 双关语义随 Radix 移除）、删除确认 AlertDialog、双主题截图。
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
  await page.screenshot({ path: path.join(outDir, `w1c4-${name}.png`) })
  console.log(`saved screenshots/w1c4-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w1c4-'))
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
    const customTemplate = {
      id: 'template-custom-1',
      type: 'custom',
      name: '数据分析师',
      description: '负责数据洞察',
      defaultChatSite: 'deepseek',
      systemPrompt: '你是数据分析师',
      createdAt: now,
      updatedAt: now,
    }
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
            'external-model-1': {
              id: 'external-model-1',
              name: '本地模型',
              format: 'openai',
              baseUrl: 'https://api.example.test/v1',
              apiKey: 'sk-test',
              modelName: 'local-chat-model',
              createdAt: now,
              updatedAt: now,
            },
          },
        },
        roleTemplateOrder: [customTemplate.id],
        roleTemplatesById: { [customTemplate.id]: customTemplate },
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

  // ---- 1. 人员库（640px，经 Rail 打开） ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(500)

  const libDark = await probe('people-library-modal')
  check('people library dialog mounted, width 640px', libDark?.role === 'dialog' && libDark.width === '640px', JSON.stringify(libDark))
  check('custom tab active with seeded template', await page.evaluate(() => {
    const list = document.querySelector('#people-library-list')
    return Boolean(list?.textContent.includes('数据分析师'))
  }))
  await shot(page, '01-people-library-dark')

  // ---- 2. 人员编辑叠层（520px，新建；Escape 逐层关闭——库保持打开） ----
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(500)

  const editorDark = await probe('person-template-modal')
  const focusIsName = await page.evaluate(() => document.activeElement?.id === 'template-name')
  check('person editor dialog mounted, width 520px', editorDark?.role === 'dialog' && editorDark.width === '520px', JSON.stringify(editorDark))
  check('name field focused on open (onOpenAutoFocus)', focusIsName)
  await shot(page, '02-person-editor-over-library-dark')

  await page.keyboard.press('Escape')
  await sleep(500)
  check('person editor closes on Escape', !(await exists('person-template-modal')))
  check('people library stays open (layered Escape, no legacy double-close)', await exists('people-library-modal'))

  // 遮罩点击只关编辑器（Radix 遮罩 z-50 拦截，点不到库）
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(300)
  await page.mouse.click(30, 30)
  await sleep(800)
  check('person editor closes on overlay click', !(await exists('person-template-modal')))
  check('people library stays open after overlay click', await exists('people-library-modal'))

  // ---- 3. 内置详情叠层：Escape 逐层关闭 ----
  await page.evaluate(() => { document.getElementById('people-library-tab-builtin')?.click() })
  await sleep(300)
  await page.evaluate(() => { document.querySelector('#people-library-list .template-detail')?.click() })
  await page.waitForSelector('#builtin-template-detail-modal', { timeout: 5000 })
  await sleep(400)
  await shot(page, '03-builtin-detail-over-library-dark')
  await page.keyboard.press('Escape')
  await sleep(500)
  check('builtin detail closes on Escape', !(await exists('builtin-template-detail-modal')))
  check('people library stays open after detail Escape', await exists('people-library-modal'))

  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(500)
  check('people library closes via close button', !(await exists('people-library-modal')))

  // 遮罩点击关库（真实鼠标点左上角空白处）
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(400)
  await page.mouse.click(30, 30)
  await sleep(800)
  check('people library closes on overlay click', !(await exists('people-library-modal')))

  // ---- 4. 外部模型（520px，经 Rail 打开，聚焦名称框） ----
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(500)

  const extDark = await probe('external-models-modal')
  const extFocus = await page.evaluate(() => document.activeElement?.id === 'external-model-name')
  check('external models dialog mounted, width 520px', extDark?.role === 'dialog' && extDark.width === '520px', JSON.stringify(extDark))
  check('name field focused on open (onOpenAutoFocus)', extFocus)
  check('native select rendered with two formats', await page.evaluate(() =>
    document.querySelectorAll('#external-model-format option').length === 2))
  check('model card actions present (test/edit/delete)', await page.evaluate(() => {
    const list = document.querySelector('#external-models-list')
    return Boolean(list?.querySelector('.external-model-test'))
      && Boolean(list?.querySelector('.external-model-edit'))
      && Boolean(list?.querySelector('.external-model-delete'))
  }))
  await shot(page, '04-external-models-dark')

  // 关闭钮后草稿重置（close() 清 EMPTY_DRAFT）
  await page.evaluate(() => { document.getElementById('external-model-name')?.focus() })
  await page.keyboard.type('中转模型')
  await page.evaluate(() => { document.getElementById('close-external-models')?.click() })
  await sleep(500)
  check('external models closes via close button', !(await exists('external-models-modal')))
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  check('draft reset after close/reopen', await page.evaluate(() =>
    document.getElementById('external-model-name')?.value === ''))

  // Escape 关闭
  await page.keyboard.press('Escape')
  await sleep(500)
  check('external models closes on Escape', !(await exists('external-models-modal')))

  // 遮罩点击关闭
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  await page.mouse.click(30, 30)
  await sleep(800)
  check('external models closes on overlay click', !(await exists('external-models-modal')))

  // 删除确认 AlertDialog
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  await page.evaluate(() => { document.querySelector('.external-model-delete')?.click() })
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 })
  await sleep(300)
  check('delete confirm alertdialog shows model name', await page.evaluate(() =>
    document.querySelector('[role="alertdialog"]')?.textContent.includes('本地模型') === true))
  await shot(page, '05-external-model-delete-confirm-dark')
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('[role="alertdialog"] button')].find(button => button.textContent === '取消')
    cancel?.click()
  })
  await sleep(400)
  check('cancel dismisses confirm and keeps modal open', !(await page.evaluate(() => Boolean(document.querySelector('[role="alertdialog"]')))) && await exists('external-models-modal'))
  await page.evaluate(() => { document.getElementById('close-external-models')?.click() })
  await sleep(400)

  // ---- 5. 双主题截图 ----
  await page.click('#theme-light')
  await sleep(400)
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(400)
  const libLight = await probe('people-library-modal')
  check('people library light theme width still 640px', libLight?.width === '640px', libLight?.width)
  await shot(page, '06-people-library-light')
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)

  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  const extLight = await probe('external-models-modal')
  check('external models light theme width still 520px', extLight?.width === '520px', extLight?.width)
  await shot(page, '07-external-models-light')
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W1-C4 acceptance summary ====')
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
