/*
 * W2-1 阶段验收探针：弹窗内 + 状态卡按钮换 shadcn Button 后的回归——
 * - 映射抽查：default / outline / ghost / destructive / xs / icon-sm / icon-xs；
 * - 钩子类保留：.orchestration-arrange 绝对定位、.orchestration-auto 最小宽、
 *   以及 .pagination-btn .template-edit .external-model-test .note-tool-btn 等；
 * - 编排状态卡（种子运行中 run）浮动卡内的 xs 紧凑按钮；
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
  await page.screenshot({ path: path.join(outDir, `w2-1-${name}.png`) })
  console.log(`saved screenshots/w2-1-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w2-1-'))
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
    const flow = {
      id: 'flow-seed-1',
      chatId: chat.id,
      name: '评审流程',
      description: '写文章',
      stages: [
        { id: 'stage-plan', kind: 'roles', name: '规划', roleIds: ['role-pm'], description: '拆解需求' },
        { id: 'stage-write', kind: 'roles', name: '写作', roleIds: ['role-dev'], description: '产出内容' },
      ],
      graph: { stageNodes: [], edges: [] },
      maxNodeExecutions: 20,
      maxRounds: 20,
      createdAt: now - 3_600_000,
      updatedAt: now - 1_800_000,
    }
    const run = {
      id: 'run-seed-1',
      chatId: chat.id,
      flowId: flow.id,
      status: 'running',
      currentRound: 1,
      maxNodeExecutions: 20,
      maxRounds: 20,
      stageRuns: [
        { stageId: 'stage-plan', stageIndex: 0, kind: 'roles', round: 1, status: 'completed', roleRuns: { 'role-pm': { roleId: 'role-pm', status: 'completed' } }, startedAt: now - 1_800_000, completedAt: now - 1_700_000 },
        { stageId: 'stage-write', stageIndex: 1, kind: 'roles', round: 1, status: 'running', roleRuns: { 'role-dev': { roleId: 'role-dev', status: 'running' } }, startedAt: now - 1_800_000 },
      ],
      createdAt: now - 1_800_000,
      updatedAt: now - 1_800_000, // 故意过期：触发「强制重置」动作
    }
    await chrome.storage.local.set({
      'openteam.groupStore': {
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

  const variantOf = (page, selector) => page.evaluate(sel => {
    const el = document.querySelector(sel)
    return el instanceof HTMLElement ? { variant: el.dataset.variant, size: el.dataset.size } : null
  }, selector)

  // ---- 人员库：新建 default / 编辑 ghost / 删除 destructive / 分页 ghost ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(500)
  check('#new-template is shadcn default button', (await variantOf(page, '#new-template'))?.variant === 'default')
  const detailBtn = await variantOf(page, '#people-library-list .template-detail')
  check('library card 详情 is ghost sm', detailBtn?.variant === 'ghost' && detailBtn?.size === 'sm', JSON.stringify(detailBtn))
  const pageBtn = await variantOf(page, '.pagination-btn')
  check('pagination button keeps hook class on Button', pageBtn?.variant === 'ghost' && pageBtn?.size === 'sm', JSON.stringify(pageBtn))
  await shot(page, '01-people-library-dark')

  // ---- 人员模板编辑器：AI 生成 ghost / 保存 default ----
  await page.evaluate(() => { document.getElementById('new-template')?.click() })
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(400)
  const genBtn = await variantOf(page, '#generate-template-persona')
  check('#generate-template-persona is ghost sm', genBtn?.variant === 'ghost' && genBtn?.size === 'sm', JSON.stringify(genBtn))
  const savePerson = await variantOf(page, '#person-template-modal button[type="submit"]')
  check('保存人员 submit is default sm', savePerson?.variant === 'default' && savePerson?.size === 'sm', JSON.stringify(savePerson))
  await shot(page, '02-person-template-dark')
  await page.evaluate(() => { document.getElementById('close-person-template')?.click() })
  await sleep(400)
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)

  // ---- 外部模型：测试 ghost / 删除 destructive / 新建 outline ----
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  const testBtn = await variantOf(page, '.external-model-test')
  check('.external-model-test is ghost sm', testBtn?.variant === 'ghost' && testBtn?.size === 'sm', JSON.stringify(testBtn))
  const delBtn = await variantOf(page, '.external-model-delete')
  check('.external-model-delete is destructive sm', delBtn?.variant === 'destructive' && delBtn?.size === 'sm', JSON.stringify(delBtn))
  const resetBtn = await variantOf(page, '#reset-external-model-form')
  check('#reset-external-model-form is outline sm', resetBtn?.variant === 'outline' && resetBtn?.size === 'sm', JSON.stringify(resetBtn))
  await shot(page, '03-external-models-dark')
  await page.evaluate(() => { document.getElementById('close-external-models')?.click() })
  await sleep(400)

  // ---- 编排状态卡：浮动卡 + xs 紧凑按钮 ----
  const statusProbe = await page.evaluate(() => {
    const card = document.querySelector('.orchestration-status-floating')
    if (!card) return null
    const buttons = [...card.querySelectorAll('button[data-slot="button"]')].map(el => ({ text: el.textContent?.trim(), variant: el.dataset.variant, size: el.dataset.size }))
    return { buttons }
  })
  check('status card floating with Button actions', statusProbe !== null && statusProbe.buttons.length >= 2, JSON.stringify(statusProbe))
  check('status actions use compact xs sizes', (statusProbe?.buttons ?? []).every(btn => btn.size === 'xs' || btn.size === 'icon-xs'), JSON.stringify(statusProbe?.buttons))
  check('强制重置 destructive present on stale run', (statusProbe?.buttons ?? []).some(btn => btn.text === '强制重置' && btn.variant === 'destructive'))
  await shot(page, '04-status-card-dark')

  // ---- 编排主弹窗：保存 outline / 运行 default / 钩子类布局保持 ----
  await page.evaluate(() => { document.getElementById('open-orchestration')?.click() })
  await page.waitForSelector('#orchestration-modal', { timeout: 5000 })
  await sleep(1500)
  check('#save-orchestration outline sm', (await variantOf(page, '#save-orchestration'))?.variant === 'outline')
  check('#run-orchestration default sm', (await variantOf(page, '#run-orchestration'))?.variant === 'default')
  check('#open-orchestration-template outline sm', (await variantOf(page, '#open-orchestration-template'))?.variant === 'outline')
  const arrangeProbe = await page.evaluate(() => {
    const el = document.getElementById('arrange-orchestration')
    if (!el) return null
    const style = getComputedStyle(el)
    return { position: style.position, minWidth: style.minWidth }
  })
  check('#arrange-orchestration keeps absolute hook layout', arrangeProbe?.position === 'absolute', JSON.stringify(arrangeProbe))
  const autoBtnProbe = await page.evaluate(() => {
    const el = document.getElementById('auto-orchestration')
    return el ? { minWidth: getComputedStyle(el).minWidth, alignSelf: getComputedStyle(el).alignSelf } : null
  })
  check('#auto-orchestration keeps stretch + min-width hook', autoBtnProbe?.alignSelf === 'stretch' && autoBtnProbe?.minWidth === '104px', JSON.stringify(autoBtnProbe))
  await shot(page, '05-orchestration-dark')
  await page.evaluate(() => { document.getElementById('close-orchestration')?.click() })
  await sleep(500)

  // ---- 笔记工具条：note-tool-btn 全部换 Button 且保留钩子类 ----
  await page.evaluate(() => { document.getElementById('open-all-notes')?.click() })
  await page.waitForSelector('#all-notes-modal', { timeout: 5000 })
  await sleep(500)
  const notesProbe = await page.evaluate(() => {
    const tools = [...document.querySelectorAll('.note-tool-btn')]
    return { total: tools.length, asButton: tools.filter(el => el.matches('button[data-slot="button"]')).length }
  })
  check('all-notes toolbar buttons are Buttons keeping hook class', notesProbe.total >= 8 && notesProbe.total === notesProbe.asButton, JSON.stringify(notesProbe))
  await shot(page, '06-all-notes-dark')
  await page.evaluate(() => { document.getElementById('close-all-notes')?.click() })
  await sleep(400)

  // ---- 浅色主题 ----
  await page.click('#theme-light')
  await sleep(400)
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(500)
  await shot(page, '07-people-library-light')
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)
  await page.evaluate(() => { document.getElementById('open-orchestration')?.click() })
  await page.waitForSelector('#orchestration-modal', { timeout: 5000 })
  await sleep(1500)
  await shot(page, '08-orchestration-light')
  await page.evaluate(() => { document.getElementById('close-orchestration')?.click() })
  await sleep(400)
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W2-1 acceptance summary ====')
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
