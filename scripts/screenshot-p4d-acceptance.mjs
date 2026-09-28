/*
 * P4d 阶段验收探针：成员抽屉开合（React 自持）、群模板弹窗全流程
 * （快速建群 → 从模板中创建 → 搜索/分类 → 选中 → 确认建群）、
 * AI 站点登录桥（chrome.tabs.create 经 services）、编排弹窗回归。
 * 加载 dist/ 扩展 → 注入种子数据 → 逐步交互并截图；断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `p4d-${name}.png`) })
  console.log(`saved screenshots/p4d-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-p4d-'))
const browser = await puppeteer.launch({
  headless: true,
  userDataDir,
  protocolTimeout: 60_000,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
    // 角色站点（chatgpt/deepseek/gemini…）在本环境不可达，悬挂的跨源
    // 导航会拖垮 headless 渲染进程的 CDP 会话；让 DNS 立即失败
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

  // 种子数据：一条群聊 + 两个人员 + 已保存流程 + 运行中编排 run + 外部模型
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
    const flow = {
      id: 'flow-seed-1',
      chatId: chat.id,
      name: '默认编排',
      description: '产出初稿并复核',
      stages: [
        { id: 'stage-a', kind: 'roles', name: '分析', roleIds: ['role-pm'] },
        { id: 'stage-b', kind: 'roles', name: '实现', roleIds: ['role-eng'] },
      ],
      graph: {
        stageNodes: [
          { id: 'stage-a', kind: 'roles', name: '分析', roleIds: ['role-pm'], position: { x: 60, y: 80 } },
          { id: 'stage-b', kind: 'roles', name: '实现', roleIds: ['role-eng'], position: { x: 280, y: 80 } },
        ],
        edges: [{ sourceStageId: 'stage-a', targetStageId: 'stage-b' }],
      },
      maxRounds: 2,
      maxNodeExecutions: 50,
      createdAt: now,
      updatedAt: now,
    }
    const run = {
      id: 'run-seed-1',
      chatId: chat.id,
      flowId: flow.id,
      status: 'running',
      currentRound: 1,
      maxNodeExecutions: 50,
      maxRounds: 2,
      stageRuns: [
        { stageId: 'stage-a', stageIndex: 0, kind: 'roles', round: 1, status: 'completed', roleRuns: {} },
        { stageId: 'stage-b', stageIndex: 1, kind: 'roles', round: 1, status: 'running', roleRuns: { 'role-eng': { roleId: 'role-eng', status: 'running' } } },
      ],
      createdAt: now - 60_000,
      updatedAt: now,
    }
    const store = {
      version: 7,
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: Object.fromEntries(roles.map(role => [role.id, role])),
      messagesById: {},
      orchestrationFlowsById: { [flow.id]: flow },
      orchestrationRunsById: { [run.id]: run },
      activeOrchestrationRunIdByChatId: { [chat.id]: run.id },
      settings: {
        externalModelOrder: ['model-seed-1'],
        externalModelsById: {
          'model-seed-1': {
            id: 'model-seed-1',
            name: 'OpenRouter 中转',
            format: 'openai',
            baseUrl: 'https://relay.example.com/v1',
            apiKey: 'sk-seed-test',
            modelName: 'gpt-4o',
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    }
    await chrome.storage.local.set({ 'openteam.groupStore': store })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2500)

  // S3：抽屉改由 Sheet 承载（根元素不再是 aside），open 判定用 classList 逐 token
  // 检查——类名表里另有 data-[state=open] 变体类，substring 判定会恒真
  const drawerClass = () => document.querySelector('.role-panel')?.className ?? ''

  // ---- 1. 成员抽屉：开关按钮（React 自持，P4d 收编） ----
  check('restore-chat button is rendered by React', await page.evaluate(() => Boolean(document.getElementById('restore-chat'))))
  await page.click('#toggle-people-drawer')
  await sleep(400)
  check('drawer opens from the header toggle', await page.evaluate(() => Boolean(document.querySelector('.role-panel')?.classList.contains('open'))), await page.evaluate(drawerClass))
  await shot(page, '01-drawer-open')

  await page.click('#close-people-drawer')
  await sleep(400)
  check('drawer closes from the collapse button', await page.evaluate(() => {
    const drawer = document.querySelector('.role-panel')
    return drawer !== null && !drawer.classList.contains('open')
  }))

  // 外点关闭：点头部标题（抽屉与开关之外的真实 DOM；iframe 内点击本就不冒泡，与旧行为一致）
  await page.click('#toggle-people-drawer')
  await sleep(300)
  await page.click('#chat-title')
  await sleep(400)
  check('drawer closes on outside click', await page.evaluate(() => {
    const drawer = document.querySelector('.role-panel')
    return drawer !== null && !drawer.classList.contains('open')
  }))

  // ---- 2. 群模板弹窗全流程（P4d React 化的主体） ----
  await page.click('#quick-create-chat')
  await page.waitForSelector('#create-chat-form', { timeout: 5000 })
  await page.click('#open-group-template-create')
  await page.waitForSelector('#group-template-modal:not([hidden])', { timeout: 5000 })
  await sleep(500)
  const pickerProbe = await page.evaluate(() => ({
    options: document.querySelectorAll('#group-template-list .group-template-option').length,
    categories: document.querySelectorAll('#group-template-categories .group-template-category-filter').length,
    confirmDisabled: document.getElementById('confirm-group-template-create')?.disabled,
    focusedIsSearch: document.activeElement?.id === 'group-template-search',
  }))
  check('template picker lists all builtin templates', pickerProbe.options >= 20, String(pickerProbe.options))
  check('template picker renders category filters', pickerProbe.categories >= 5, String(pickerProbe.categories))
  check('confirm disabled before any selection', pickerProbe.confirmDisabled === true)
  check('search input is focused on open', pickerProbe.focusedIsSearch)
  await shot(page, '02-template-picker')

  // 搜索过滤
  await page.type('#group-template-search', 'Agent')
  await sleep(400)
  const searchProbe = await page.evaluate(() => [...document.querySelectorAll('.group-template-option strong')].map(el => el.textContent))
  check('search filters to the Agent template', searchProbe.join(',') === 'AI Agent 开发群', searchProbe.join(','))
  await shot(page, '03-template-search')

  // 清空搜索 → 选模板 → 确认可用
  await page.click('#group-template-search', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await sleep(300)
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.group-template-option')]
      .find(el => el.querySelector('strong')?.textContent === 'AI Agent 开发群')
    card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(400)
  const agentCard = await page.evaluate(() => ({
    pressed: [...document.querySelectorAll('.group-template-option')]
      .find(el => el.querySelector('strong')?.textContent === 'AI Agent 开发群')?.getAttribute('aria-pressed'),
    confirmDisabled: document.getElementById('confirm-group-template-create')?.disabled,
  }))
  check('template card selects and enables confirm', agentCard?.pressed === 'true' && agentCard?.confirmDisabled === false, JSON.stringify(agentCard))
  await shot(page, '04-template-selected')

  // 确认创建：弹窗 + 快速建群表单都应收起
  await page.click('#confirm-group-template-create')
  await sleep(500)
  const afterConfirm = await page.evaluate(() => ({
    modalHidden: document.getElementById('group-template-modal')?.hidden,
    formGone: !document.getElementById('create-chat-form'),
  }))
  check('confirm closes the template modal', afterConfirm.modalHidden === true)
  check('confirm collapses the quick-create form', afterConfirm.formGone)

  // background 落库后新群出现在侧栏
  await page.waitForFunction(() => document.querySelector('#chat-list')?.textContent.includes('AI Agent 开发群'), { timeout: 20_000 })
  check('created template chat appears in the sidebar', true)
  await shot(page, '05-template-chat-created')

  // ---- 3. 编排弹窗回归（P4c 面在 P4d 删除后仍正常） ----
  await page.click('#open-orchestration')
  await page.waitForSelector('#orchestration-modal:not([hidden])', { timeout: 5000 })
  await sleep(1200)
  const orchProbe = await page.evaluate(() => ({
    people: document.querySelectorAll('#orchestration-people-list .orchestration-person').length,
    canvas: Boolean(document.querySelector('#orchestration-stage-canvas')),
  }))
  check('orchestration modal still lists roles and mounts the canvas', orchProbe.people >= 2 && orchProbe.canvas, JSON.stringify(orchProbe))
  await shot(page, '06-orchestration-regression')
  await page.click('#close-orchestration')
  await sleep(400)

  // ---- 4. AI 站点登录桥（services.openAiSiteLogin → chrome.tabs.create） ----
  // 本环境外站点不可达，登录页签可能拖垮 CDP 会话，故放最后且容错
  const loginTabPromise = browser.waitForTarget(target => target.url().startsWith('https://chatgpt.com'), { timeout: 15_000 }).catch(() => null)
  await Promise.race([
    page.evaluate(() => document.getElementById('open-gemini-login')?.click()).catch(() => 'click-failed'),
    sleep(15_000).then(() => 'click-timeout'),
  ])
  const loginTab = await loginTabPromise
  check('login button opens the selected role site in a new tab', Boolean(loginTab), loginTab?.url() ?? 'no tab')

  console.log('\n==== P4d acceptance summary ====')
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
