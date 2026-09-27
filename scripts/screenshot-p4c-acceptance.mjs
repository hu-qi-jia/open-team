/*
 * P4c 阶段验收探针：编排弹窗 + 画布 + 模板 + 自动编排面板 + 状态卡。
 * 加载 dist/ 扩展 → 注入种子数据（含运行中编排 run）→ 逐步交互并截图；
 * 任一断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `p4c-${name}.png`) })
  console.log(`saved screenshots/p4c-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-p4c-'))
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

  // 种子数据：一条群聊 + 两个人员 + 已保存流程 + 运行中编排 run（状态卡）
  await page.evaluate(async () => {
    const now = Date.now()
    const chat = {
      id: 'chat-seed-1',
      name: '产品需求评审',
      mode: 'collaborative',
      roleIds: ['role-pm', 'role-eng'],
      messageIds: ['msg-task-1'],
      nextMessageSeq: 2,
      status: 'running',
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
        { id: 'stage-c', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-pm'], instructions: '', maxAttempts: 3, onMaxAttempts: 'continue' } },
      ],
      graph: {
        stageNodes: [
          { id: 'stage-a', kind: 'roles', name: '分析', roleIds: ['role-pm'], position: { x: 60, y: 80 } },
          { id: 'stage-b', kind: 'roles', name: '实现', roleIds: ['role-eng'], position: { x: 280, y: 80 } },
          { id: 'stage-c', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-pm'], instructions: '', maxAttempts: 3, onMaxAttempts: 'continue' }, position: { x: 500, y: 70 } },
        ],
        edges: [
          { sourceStageId: 'stage-a', targetStageId: 'stage-b' },
          { sourceStageId: 'stage-b', targetStageId: 'stage-c' },
        ],
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
    const message = {
      id: 'msg-task-1',
      chatId: chat.id,
      seq: 1,
      type: 'user',
      content: '请按编排推进评审任务',
      targetRoleIds: [],
      mentionedRoleIds: [],
      mentionsAll: false,
      orchestrationRunId: run.id,
      orchestrationKind: 'task',
      createdAt: now - 60_000,
      status: 'received',
    }
    const store = {
      version: 7,
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: Object.fromEntries(roles.map(role => [role.id, role])),
      messagesById: { [message.id]: message },
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

  // 状态卡应随种子 run 直接出现
  const statusProbe = await page.evaluate(() => {
    const card = document.querySelector('.orchestration-status:not(.orchestration-status-collapsed)')
    return {
      exists: Boolean(card),
      label: card?.textContent ?? '',
      mini: Boolean(document.querySelector('svg.orchestration-mini-flow')),
    }
  })
  check('status card renders for the running seed run', statusProbe.exists)
  check('status card shows progress 2 / 50', statusProbe.label.includes('编排运行中') && statusProbe.label.includes('2 / 50'), statusProbe.label.slice(0, 60))
  check('status card embeds the mini flow svg', statusProbe.mini)
  await shot(page, '01-status-card')

  // ---- 1. 打开编排弹窗 ----
  await page.click('#open-orchestration')
  await page.waitForSelector('#orchestration-modal:not([hidden])', { timeout: 5000 })
  await sleep(1200)
  const modalProbe = await page.evaluate(() => ({
    people: document.querySelectorAll('#orchestration-people-list .orchestration-person').length,
    canvas: Boolean(document.querySelector('#orchestration-stage-canvas')),
    emptyHintHidden: document.getElementById('orchestration-empty-hint')?.hidden,
  }))
  check('modal lists the two seed roles', modalProbe.people === 2, String(modalProbe.people))
  check('canvas mounted inside the modal', modalProbe.canvas)
  check('empty hint visible before any node', modalProbe.emptyHintHidden === false)
  await shot(page, '02-orchestration-open')

  // ---- 2. 拖人成节点（模拟 dataTransfer drop），点击节点打开设置 ----
  await page.evaluate(() => {
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'role-pm', types: ['application/x-openteam-role-id'] } })
    document.querySelector('#orchestration-stage-canvas').dispatchEvent(drop)
  })
  await sleep(800)
  const afterDrop = await page.evaluate(() => ({
    nodes: document.querySelectorAll('#orchestration-stage-canvas .x6-node').length,
    emptyHintHidden: document.getElementById('orchestration-empty-hint')?.hidden,
  }))
  check('drop creates a canvas node and hides the empty hint', afterDrop.nodes === 1 && afterDrop.emptyHintHidden === true, JSON.stringify(afterDrop))

  // 放置不选中（与原行为一致）：点击节点中心打开设置面板
  const nodeBox = await page.evaluate(() => {
    const node = document.querySelector('#orchestration-stage-canvas .x6-node')
    const rect = node?.getBoundingClientRect()
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : undefined
  })
  check('canvas node is clickable on screen', Boolean(nodeBox))
  if (nodeBox) {
    await page.mouse.click(nodeBox.x, nodeBox.y)
    await sleep(500)
  }
  const settingsProbe = await page.evaluate(() => ({
    settings: Boolean(document.querySelector('#orchestration-stage-settings')),
    nodeName: document.querySelector('#orchestration-stage-settings input')?.value ?? '',
  }))
  check('node click opens the stage settings', settingsProbe.settings)
  check('stage settings prefill the role name', settingsProbe.nodeName === '产品', settingsProbe.nodeName)
  await page.evaluate(() => {
    const textarea = document.querySelector('#orchestration-stage-settings textarea')
    if (!textarea) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, '输出需求清单与优先级')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.type('#orchestration-task', '完成需求评审编排')
  await shot(page, '03-stage-settings')

  // 第二个节点 + 整理
  await page.evaluate(() => {
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'role-eng', types: ['application/x-openteam-role-id'] } })
    document.querySelector('#orchestration-stage-canvas').dispatchEvent(drop)
  })
  await sleep(500)
  await page.click('#arrange-orchestration')
  await sleep(800)
  const arrangedProbe = await page.evaluate(() => document.querySelectorAll('#orchestration-stage-canvas .x6-node').length)
  check('two nodes on the canvas after drops', arrangedProbe === 2, String(arrangedProbe))
  await shot(page, '04-two-nodes-arranged')

  // ---- 3. 模板选择（画布已有节点 → 替换确认）----
  await page.click('#open-orchestration-template')
  await page.waitForSelector('#orchestration-template-modal:not([hidden])', { timeout: 5000 })
  await sleep(400)
  const templateProbe = await page.evaluate(() => document.querySelectorAll('#orchestration-template-content [data-template-id]').length)
  check('template picker lists builtin templates', templateProbe >= 5, String(templateProbe))
  await shot(page, '05-template-picker')
  await page.evaluate(() => document.querySelector('[data-template-id="review-loop"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 })
  await sleep(400)
  await shot(page, '06-template-replace-confirm')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent === '替换')
    button?.click()
  })
  await sleep(1500)
  const afterTemplate = await page.evaluate(() => ({
    pickerHidden: document.getElementById('orchestration-template-modal')?.hidden,
    nodes: document.querySelectorAll('#orchestration-stage-canvas .x6-node').length,
    task: document.getElementById('orchestration-task')?.value ?? '',
  }))
  check('replace confirm applies the template', afterTemplate.pickerHidden === true && afterTemplate.nodes >= 3, JSON.stringify(afterTemplate))
  check('template keeps the user-written task', afterTemplate.task === '完成需求评审编排', afterTemplate.task)
  await shot(page, '07-template-applied')

  // ---- 4. 自动编排面板（仅打开与输入，不触发真实生成）----
  // 模板建人的后台往返期间按钮 disabled，等空闲后再进面板
  await page.waitForFunction(() => !document.getElementById('auto-orchestration')?.disabled, { timeout: 15_000 })
  await page.click('#auto-orchestration')
  await page.waitForSelector('#orchestration-auto-modal:not([hidden])', { timeout: 5000 })
  await sleep(400)
  await page.type('.orchestration-auto-input', '增加一轮交叉审核')
  const autoProbe = await page.evaluate(() => ({
    empty: document.querySelector('#orchestration-auto-content .orchestration-auto-empty')?.textContent ?? '',
    input: document.querySelector('.orchestration-auto-input')?.value ?? '',
  }))
  check('auto panel shows the empty hint', autoProbe.empty.includes('自动编排'), autoProbe.empty)
  check('auto instruction accepted', autoProbe.input === '增加一轮交叉审核', autoProbe.input)
  await shot(page, '08-auto-panel')
  await page.click('#close-auto-orchestration')
  await sleep(300)
  await page.click('#close-orchestration')
  await sleep(500)
  const modalClosed = await page.evaluate(() => document.getElementById('orchestration-modal')?.hidden)
  check('orchestration modal closes', modalClosed === true)

  console.log('\n==== P4c acceptance summary ====')
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
