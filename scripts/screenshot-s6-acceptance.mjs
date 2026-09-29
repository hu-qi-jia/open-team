/*
 * S6 验收探针（编排三弹窗 → AppModal 公共壳 + X6 画布规则搬家 + 状态卡定位）。
 *
 * 断言组：
 *   s6-1  主弹窗壳契约：#orchestration-modal 宽 2xl=1160、fixed 高 min(760,100vh-48)、
 *         圆角、bg == --popover、data-slot 头/体/脚三段齐、关闭钮恰 1 可见 svg
 *   s6-2  首焦与模板选择弹窗：#orchestration-task 聚焦；模板弹窗宽 lg=720、
 *         height=auto、#orchestration-template-content 在场、首卡聚焦
 *   s6-3  自动编排弹窗：宽 xl=820、#orchestration-auto-input 聚焦且在 footer 槽内
 *   s6-4  关闭语义（button-only，与 s5-5 相反）：三弹窗 Escape **均不关**、
 *         背板 pointerdown **均不关**（完整指针序列）、#close-* 点击仍关
 *   s6-5  footer 钉底：主弹窗 #orchestration-max-rounds 在 footer 槽内、
 *         footer 贴 content 底缘（fixed 高 + grid 三行）
 *   s6-6  画布在场与 X6 视觉抽验：.orchestration-stage-canvas + .x6-graph 在场、
 *         .x6-node 数 === 种子 stage 数、vertex fill 亮暗两态取自迁移后的规则
 *   s6-7  状态卡锚点（S2 铁律 §B.5）：position === 'absolute'、offsetParent === #app
 *         （最近 positioned 祖先就是它——「fixed 被劫持」与「absolute 锚 #app」
 *         重合的机器判据）、right:70/bottom:128 相对 #app ±3px
 *   s6-8  静态审计：legacy.css 剥注释后画布族/状态卡族 0 处；orchestration-canvas.css
 *         11 处；dist team.css 画布 11 处；StatusCard TSX 携 absolute utilities；globals @import
 *   s6-9  亮暗双主题截图
 *
 * 口径纪律：与 s3/s4/s5 一致——CSS 计数都是**剥掉注释后的出现次数**；断言失败
 * exitCode 3，控制台/页面报错 exitCode 2。加载 dist/ 扩展 → 注入种子 → 交互 +
 * 截图 + 断言；种子前先 chrome.storage.local.clear()。
 */
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
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
function info(label, detail) {
  console.log(`INFO  ${label} — ${detail}`)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `s6-${name}.png`) })
  console.log(`saved screenshots/s6-${name}.png`)
}

// S7/T2：元素级截图（状态卡特写，明暗双主题视觉存档）——puppeteer API
async function shotEl(page, selector, name) {
  const el = await page.$(selector)
  if (!el) throw new Error(`shotEl: ${selector} not found`)
  await el.screenshot({ path: path.join(outDir, `s6-${name}.png`) })
  console.log(`saved screenshots/s6-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const round = value => Math.round(value * 100) / 100
const near = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance

// ---------------------------------------------------------------------------
// 静态审计（s6-8）：读 src 与 dist，不依赖浏览器
// ---------------------------------------------------------------------------
const stripCssComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '')
const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1
const legacyRaw = await readFile(path.join(root, 'src/teamPage/ui/styles/legacy.css'), 'utf8')
const canvasRaw = await readFile(path.join(root, 'src/teamPage/ui/styles/orchestration-canvas.css'), 'utf8')
const globalsRaw = await readFile(path.join(root, 'src/teamPage/ui/styles/globals.css'), 'utf8')
const distCss = await readFile(path.join(dist, 'team.css'), 'utf8')
const legacyCss = stripCssComments(legacyRaw)
const canvasCss = stripCssComments(canvasRaw)

{
  const legacyCanvas = countOccurrences(legacyCss, '.orchestration-stage-canvas')
  check('s6-8 legacy.css has zero canvas-family occurrences after S6 relocation (comments stripped)',
    legacyCanvas === 0, `occurrences ${legacyCanvas}`)
  const canvasRules = countOccurrences(canvasCss, '.orchestration-stage-canvas .x6-')
  check('s6-8 orchestration-canvas.css carries the relocated 11 .x6-* descendant rules',
    canvasRules === 11, `occurrences ${canvasRules}`)
  const distCanvas = countOccurrences(distCss, '.orchestration-stage-canvas .x6-')
  check('s6-8 dist team.css carries the 11 relocated .x6-* rules (unlayered, via globals @import)',
    distCanvas === 11, `occurrences ${distCanvas}`)
  // S7/T2：状态卡族随组件 utilities 化退役——legacy/dist 源不再有该族规则；
  // absolute 定位结论改由 TSX utilities 承担（s6-7 运行时锚点断言继续覆盖）。
  const legacyStatusFamily = countOccurrences(legacyCss, '.orchestration-status')
  check('s6-8 legacy.css has zero status-card family occurrences after S7/T2 relocation (comments stripped)',
    legacyStatusFamily === 0, `occurrences ${legacyStatusFamily}`)
  const statusTsx = await readFile(path.join(root, 'src/teamPage/ui/components/orchestration/OrchestrationStatusCard.tsx'), 'utf8')
  check('s6-8 OrchestrationStatusCard.tsx carries position:absolute via floating utilities (S2 rule B.5)',
    /'absolute right-\[70px\] bottom-\[128px\] z-\[8\]'/.test(statusTsx), 'floating utilities present')
  check('s6-8 globals.css imports orchestration-canvas.css',
    globalsRaw.includes('@import "./orchestration-canvas.css";'), 'import statement present')
}

// ---------------------------------------------------------------------------
// 浏览器段
// ---------------------------------------------------------------------------
const userDataDir = await mkdtemp(path.join(tmpdir(), 's6-acceptance-'))
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
const KILL_CSS = '* { transition: none !important; animation: none !important; }'
const SETTLE = 1500

try {
  const swTarget = await browser.waitForTarget(target => target.type() === 'service_worker', { timeout: 30_000 })
  const extensionId = new URL(swTarget.url()).host
  console.log('extension id:', extensionId)

  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
  page.on('console', message => {
    if (message.type() !== 'error') return
    const location = message.location()
    const url = location.url ?? ''
    if (url !== '' && !url.startsWith('chrome-extension://')) return
    consoleErrors.push(`${message.text()}  @${url}:${location.lineNumber ?? ''}`)
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })

  /* 种子：当前群聊 chat-s6-1（collaborative）+ 2 成员 + 编排 flow（3 节点带图）+
   * running run（状态卡渲染输入）+ flow 顺序表（主弹窗 handleOpen 的加载入口）。
   * flow/run 字段与 OrchestrationStatusCard.test.tsx baseFixture 逐字同构。 */
  const seed = async theme => {
    await page.evaluate(async ({ theme: nextTheme }) => {
      await chrome.storage.local.clear()
      localStorage.setItem('openteam.theme', nextTheme)
      const now = Date.now()
      const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
      const chatIds = Array.from({ length: 6 }, (_, index) => `chat-s6-${index + 1}`)
      const chatId = 'chat-s6-1'
      const flow = {
        id: 'flow-s6-1',
        chatId,
        name: 'S6 验收流程',
        stages: [
          { id: 'stage-1', kind: 'roles', name: '分析', roleIds: ['role-s6-1'] },
          { id: 'stage-2', kind: 'roles', name: '实现', roleIds: ['role-s6-2'] },
          { id: 'stage-3', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-s6-1'], maxAttempts: 3, onMaxAttempts: 'continue' } },
        ],
        graph: {
          stageNodes: [
            { id: 'stage-1', kind: 'roles', name: '分析', roleIds: ['role-s6-1'], position: { x: 40, y: 70 } },
            { id: 'stage-2', kind: 'roles', name: '实现', roleIds: ['role-s6-2'], position: { x: 220, y: 70 } },
            { id: 'stage-3', kind: 'review', name: '复核', roleIds: [], review: { reviewerRoleIds: ['role-s6-1'], maxAttempts: 3, onMaxAttempts: 'continue' }, position: { x: 400, y: 60 } },
          ],
          edges: [
            { sourceStageId: 'stage-1', targetStageId: 'stage-2' },
            { sourceStageId: 'stage-2', targetStageId: 'stage-3' },
            { sourceStageId: 'stage-3', targetStageId: 'stage-2', sourcePort: 'fail', vertices: [{ x: 440, y: 180 }, { x: 220, y: 180 }] },
          ],
        },
        maxRounds: 2,
        createdAt: now,
        updatedAt: now,
      }
      const run = {
        id: 'run-s6-1',
        chatId,
        flowId: flow.id,
        status: 'running',
        currentRound: 1,
        maxNodeExecutions: 50,
        maxRounds: 2,
        stageRuns: [{
          stageId: 'stage-1',
          stageIndex: 0,
          kind: 'roles',
          round: 1,
          status: 'running',
          roleRuns: { 'role-s6-1': { roleId: 'role-s6-1', status: 'running' } },
        }],
        createdAt: now,
        updatedAt: now,
      }
      const taskMessage = {
        id: 'msg-s6-task',
        chatId,
        seq: 1,
        type: 'user',
        content: 'S6 探针任务：验证三弹窗与画布迁移。',
        targetRoleIds: [],
        mentionedRoleIds: [],
        mentionsAll: false,
        orchestrationRunId: run.id,
        orchestrationKind: 'task',
        createdAt: now,
        status: 'received',
      }
      await chrome.storage.local.set({
        'openteam.groupStore': {
          version: 7,
          currentChatId: chatId,
          chatOrder: chatIds,
          chatsById: Object.fromEntries(chatIds.map((id, index) => [id, {
            id,
            name: `S6 群聊 ${index + 1}`,
            mode: id === chatId ? 'collaborative' : 'independent',
            roleIds: id === chatId ? ['role-s6-1', 'role-s6-2'] : [],
            messageIds: id === chatId ? [taskMessage.id] : [],
            nextMessageSeq: id === chatId ? 2 : 1,
            status: id === chatId ? 'running' : 'ready',
            createdAt: now - index * 1000,
            updatedAt: now,
          }])),
          rolesById: {
            'role-s6-1': { id: 'role-s6-1', chatId, name: '产品', chatSite: 'chatgpt', status: 'thinking', contextCursor: 0, createdAt: now, updatedAt: now },
            'role-s6-2': { id: 'role-s6-2', chatId, name: '研发', chatSite: 'deepseek', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now },
          },
          messagesById: { [taskMessage.id]: taskMessage },
          orchestrationFlowsById: { [flow.id]: flow },
          orchestrationFlowOrderByChatId: { [chatId]: [flow.id] },
          orchestrationRunsById: { [run.id]: run },
          activeOrchestrationRunIdByChatId: { [chatId]: run.id },
          globalNote: doc('S6 全局笔记，用于探针。'),
          chatNotesById: {},
          // 自动编排入口的守卫（ensureExternalApiConfigured）要求至少一个
          // 四元组齐全的外部模型，否则 #auto-orchestration 点击后只弹 toast。
          settings: {
            language: 'zh-CN',
            externalModelOrder: ['ext-s6-1'],
            externalModelsById: {
              'ext-s6-1': { id: 'ext-s6-1', name: 'S6 探针模型', format: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: 'sk-s6-probe', modelName: 's6-probe', createdAt: now, updatedAt: now },
            },
          },
        },
      })
    }, { theme })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })
    await sleep(2500)
  }

  await seed('dark')
  check('s6-0 dark theme applied after seeding', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'),
    `dataset.theme=${await page.evaluate(() => document.documentElement.dataset.theme)}`)

  /* 过渡防线（s5 同款）：几何读取前按死过渡 */
  const installKillSwitch = () => page.evaluate(css => {
    const previous = document.getElementById('s6-kill-switch')
    if (previous) previous.remove()
    const style = document.createElement('style')
    style.id = 's6-kill-switch'
    style.textContent = css
    document.head.appendChild(style)
  }, KILL_CSS)
  const settle = async (ms = SETTLE) => {
    await installKillSwitch()
    await sleep(ms)
  }
  await settle()

  /* 打开 / 关闭 helper（入口链：ChatHeader #open-orchestration → 主弹窗内
   * #open-orchestration-template / #auto-orchestration） */
  const exists = id => page.evaluate(modalId => document.getElementById(modalId) !== null, id)
  const waitGone = async (id, timeout = 6000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (!(await exists(id))) return true
      await sleep(150)
    }
    return false
  }
  const openMain = async () => {
    await page.evaluate(() => document.getElementById('open-orchestration')?.click())
    await page.waitForSelector('#orchestration-modal', { timeout: 8000 })
    // kill switch 安装**前**轮询采样：X6 的 SVG 渲染晚于 modal 挂载（waitForSelector
    // 返回时 port 还没画出来）；port-body 的 0.16s transition 是迁移规则的生效证据。
    // ⚠️ kill switch 常驻 head（installKillSwitch 不自动摘），必须先摘再读，
    // 否则 * { transition: none !important } 让 computed transitionDuration 恒为 0s。
    await page.evaluate(() => document.getElementById('s6-kill-switch')?.remove())
    let portTransition = null
    for (let started = Date.now(); Date.now() - started < 5000;) {
      portTransition = await page.evaluate(() => {
        const port = document.querySelector('#orchestration-modal .orchestration-stage-canvas .x6-port-body')
        return port ? getComputedStyle(port).transitionDuration : null
      })
      if (portTransition !== null) break
      await sleep(150)
    }
    await settle()
    return portTransition
  }
  const openTemplate = async () => {
    await page.evaluate(() => document.getElementById('open-orchestration-template')?.click())
    await page.waitForSelector('#orchestration-template-modal', { timeout: 8000 })
    await settle()
  }
  const openAuto = async () => {
    await page.evaluate(() => document.getElementById('auto-orchestration')?.click())
    await page.waitForSelector('#orchestration-auto-modal', { timeout: 8000 })
    await settle()
  }
  const closeById = async (closeId, modalId) => {
    await page.evaluate(id => document.getElementById(id)?.click(), closeId)
    const gone = await waitGone(modalId)
    await sleep(400)
    return gone
  }
  /** 完整指针序列的背板点击（Radix onInteractOutside 监听 pointerdown） */
  const clickBackdrop = async () => {
    await page.mouse.move(60, 475)
    await page.mouse.down()
    await page.mouse.up()
    await sleep(600)
  }

  /* 弹窗几何测量（s5 measureDialog 的聚焦版） */
  const measureModal = contentId => page.evaluate(id => {
    const el = document.getElementById(id)
    if (!el) return { found: false }
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--popover)'
    document.body.appendChild(probe)
    const popoverResolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    const body = el.querySelector(':scope > [data-slot="modal-body"]')
    const footer = el.querySelector(':scope > [data-slot="modal-footer"]')
    const closeButton = el.querySelector(`button[aria-label^="关闭"]`)
    return {
      found: true,
      rect: {
        width: Math.round(rect.width * 100) / 100,
        height: Math.round(rect.height * 100) / 100,
        left: Math.round(rect.left), top: Math.round(rect.top),
        right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      },
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      popoverResolved,
      hasBody: body !== null,
      hasFooter: footer !== null,
      footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom) : null,
      closeButton: closeButton ? {
        svgs: closeButton.querySelectorAll('svg').length,
        visibleSvgs: [...closeButton.querySelectorAll('svg')].filter(svg => svg.getClientRects().length > 0).length,
        text: (closeButton.textContent ?? '').trim(),
      } : null,
    }
  }, contentId)

  const portTransitionDark = await openMain()

  /* ---------------- s6-1 主弹窗壳契约 ---------------- */
  {
    const main = await measureModal('orchestration-modal')
    check('s6-1 orchestration modal present', main.found)
    check('s6-1 main modal width is the 2xl token (1160 @1500 viewport)',
      near(main.rect.width, 1160, 1), `width=${main.rect.width}`)
    check('s6-1 main modal height is the fixed token (min(760, 100vh-48) = 760 @950 viewport)',
      near(main.rect.height, 760, 1), `height=${main.rect.height}`)
    check('s6-1 main modal corners rounded (10px)',
      main.borderRadius === '10px', `borderRadius=${main.borderRadius}`)
    check('s6-1 main modal background equals the popover token',
      main.backgroundColor === main.popoverResolved,
      `bg=${main.backgroundColor} popover=${main.popoverResolved}`)
    check('s6-1 main modal carries body and footer slots',
      main.hasBody && main.hasFooter, `body=${main.hasBody} footer=${main.hasFooter}`)
    check('s6-1 main modal close button has exactly one visible svg and no text node',
      main.closeButton !== null && main.closeButton.svgs === 1 && main.closeButton.visibleSvgs === 1 && main.closeButton.text === '',
      JSON.stringify(main.closeButton))
  }

  /* ---------------- s6-2 首焦 + 模板选择弹窗 ---------------- */
  check('s6-2 initial focus lands on #orchestration-task',
    await page.evaluate(() => document.activeElement?.id ?? '') === 'orchestration-task',
    `active=${await page.evaluate(() => document.activeElement?.id ?? '')}`)

  await openTemplate()
  {
    const template = await measureModal('orchestration-template-modal')
    check('s6-2 template picker present', template.found)
    check('s6-2 template picker width is the lg token (720 @1500 viewport)',
      near(template.rect.width, 720, 1), `width=${template.rect.width}`)
    check('s6-2 template picker keeps #orchestration-template-content',
      await page.evaluate(() => document.getElementById('orchestration-template-content') !== null))
    check('s6-2 template picker initial focus lands on the first card',
      await page.evaluate(() => document.activeElement?.id ?? '') === 'orchestration-template-card-first',
      `active=${await page.evaluate(() => document.activeElement?.id ?? '')}`)
  }

  /* ---------------- s6-4 关闭语义：模板选择（button-only） ---------------- */
  {
    await page.keyboard.press('Escape')
    const survivesEscape = await exists('orchestration-template-modal')
    await clickBackdrop()
    const survivesBackdrop = await exists('orchestration-template-modal')
    check('s6-4 template picker survives Escape (button-only, opposite of s5-5)', survivesEscape)
    check('s6-4 template picker survives backdrop pointerdown (button-only)', survivesBackdrop)
    const closedByX = await closeById('close-orchestration-template', 'orchestration-template-modal')
    check('s6-4 template picker closes via #close-orchestration-template', closedByX)
  }

  /* ---------------- s6-3 + s6-4 自动编排弹窗 ---------------- */
  {
    await openAuto()
    const auto = await measureModal('orchestration-auto-modal')
    check('s6-3 auto modal present', auto.found)
    check('s6-3 auto modal width is the xl token (820 @1500 viewport)',
      near(auto.rect.width, 820, 1), `width=${auto.rect.width}`)
    check('s6-3 auto modal keeps body and footer slots (composer in footer)',
      auto.hasBody && auto.hasFooter, `body=${auto.hasBody} footer=${auto.hasFooter}`)
    const focusInFooter = await page.evaluate(() => {
      const input = document.getElementById('orchestration-auto-input')
      const footer = input?.closest('[data-slot="modal-footer"]')
      return input !== null && footer !== null && footer.contains(input)
    })
    check('s6-3 #orchestration-auto-input lives inside the footer slot', focusInFooter)
    check('s6-3 auto modal initial focus lands on #orchestration-auto-input',
      await page.evaluate(() => document.activeElement?.id ?? '') === 'orchestration-auto-input',
      `active=${await page.evaluate(() => document.activeElement?.id ?? '')}`)

    await page.keyboard.press('Escape')
    const survivesEscape = await exists('orchestration-auto-modal')
    await clickBackdrop()
    const survivesBackdrop = await exists('orchestration-auto-modal')
    check('s6-4 auto modal survives Escape (button-only)', survivesEscape)
    check('s6-4 auto modal survives backdrop pointerdown (button-only)', survivesBackdrop)
    const closedByX = await closeById('close-auto-orchestration', 'orchestration-auto-modal')
    check('s6-4 auto modal closes via #close-auto-orchestration', closedByX)
  }

  /* ---------------- s6-5 主弹窗关闭语义（最后关，画布断言要用它） ---------------- */
  {
    await page.keyboard.press('Escape')
    const survivesEscape = await exists('orchestration-modal')
    await clickBackdrop()
    const survivesBackdrop = await exists('orchestration-modal')
    check('s6-5 main modal survives Escape (button-only)', survivesEscape)
    check('s6-5 main modal survives backdrop pointerdown (button-only)', survivesBackdrop)
  }

  /* ---------------- s6-6 画布在场与 X6 视觉抽验 ---------------- */
  /* ⚠️ 前提修正（对照真实 DOM dump）：.x6-graph 类挂在宿主自身；vertex 视觉由
   * decorator 层 .x6-edge-tool-vertex 承担——迁移族里的 `.vertices .vertex` 现实
   * DOM 不渲染（原文保号搬迁，其存在性由 s6-8 静态计数覆盖），动态抽验改用
   * 现实生效的三条：node cursor / port-body transition / host 定位。 */
  {
    const canvas = await page.evaluate(() => {
      const host = document.querySelector('#orchestration-modal .orchestration-stage-canvas')
      const node = host?.querySelector('.x6-node') ?? null
      return {
        hostPresent: host !== null,
        hostIsGraphRoot: host?.classList.contains('x6-graph') ?? false,
        nodes: host ? host.querySelectorAll('.x6-node').length : 0,
        nodeCursor: node ? getComputedStyle(node).cursor : null,
        portCount: host ? host.querySelectorAll('.x6-port-body').length : 0,
      }
    })
    check('s6-6 canvas host (.orchestration-stage-canvas) is present in the main modal', canvas.hostPresent)
    check('s6-6 canvas host itself is the X6 graph root (.x6-graph)',
      canvas.hostIsGraphRoot, `hostIsGraphRoot=${canvas.hostIsGraphRoot}`)
    check('s6-6 X6 node count equals the seeded stage count (3)',
      canvas.nodes === 3, `nodes=${canvas.nodes}`)
    check('s6-6 relocated rule applies: nodes show cursor:move',
      canvas.nodeCursor === 'move', `cursor=${canvas.nodeCursor}`)
    check('s6-6 relocated rule applies: port bodies keep the 0.16s transition',
      portTransitionDark !== null && portTransitionDark.includes('0.16'), `transitionDuration=${portTransitionDark}`)
    check('s6-6 X6 port bodies are rendered (7 = 2+2+3 across the seeded stages)',
      canvas.portCount === 7, `ports=${canvas.portCount}`)
    await shot(page, 'main-dark-canvas')
  }

  /* ---------------- s6-5（收尾）主弹窗 × 关闭 ---------------- */
  {
    const closedByX = await closeById('close-orchestration', 'orchestration-modal')
    check('s6-5 main modal closes via #close-orchestration', closedByX)
  }

  /* ---------------- s6-7 状态卡锚点 ---------------- */
  {
    const card = await page.evaluate(() => {
      const el = document.querySelector('.orchestration-status-floating')
      if (!el) return { found: false }
      const rect = el.getBoundingClientRect()
      const app = document.getElementById('app')
      const appRect = app?.getBoundingClientRect()
      return {
        found: true,
        position: getComputedStyle(el).position,
        offsetParentId: el.offsetParent instanceof HTMLElement ? el.offsetParent.id : String(el.offsetParent === null ? 'null' : 'non-element'),
        appPresent: app !== null,
        cardRight: Math.round(rect.right * 100) / 100,
        cardBottom: Math.round(rect.bottom * 100) / 100,
        appRight: appRect ? Math.round(appRect.right * 100) / 100 : null,
        appBottom: appRect ? Math.round(appRect.bottom * 100) / 100 : null,
      }
    })
    check('s6-7 status card rendered (.orchestration-status-floating)', card.found)
    check('s6-7 status card is position:absolute (S2 rule B.5)',
      card.found && card.position === 'absolute', `position=${card.position}`)
    check('s6-7 status card offsetParent is #app (containing block overlap proof)',
      card.found && card.offsetParentId === 'app', `offsetParent=${card.offsetParentId}`)
    const rightDelta = card.found && card.appRight !== null ? round(card.appRight - card.cardRight) : null
    const bottomDelta = card.found && card.appBottom !== null ? round(card.appBottom - card.cardBottom) : null
    check('s6-7 status card sits right:70px from the #app right edge',
      near(rightDelta ?? -1, 70), `right delta=${rightDelta}`)
    check('s6-7 status card sits bottom:128px from the #app bottom edge',
      near(bottomDelta ?? -1, 128), `bottom delta=${bottomDelta}`)
    // S7/T2：状态卡特写（暗色，utilities 迁移后视觉存档）
    await shotEl(page, '.orchestration-status-floating', 'status-card-dark')
  }

  /* ---------------- s6-9 亮色主题复拍 ---------------- */
  await seed('light')
  check('s6-9 light theme applied after re-seeding',
    await page.evaluate(() => document.documentElement.dataset.theme === 'light'))
  await settle()
  {
    await openMain()
    const canvas = await page.evaluate(() => {
      const node = document.querySelector('#orchestration-modal .orchestration-stage-canvas .x6-node')
      return node ? getComputedStyle(node).cursor : null
    })
    check('s6-9 light theme keeps the relocated rules live (node cursor:move)',
      canvas === 'move', `cursor=${canvas}`)
    await shot(page, 'main-light-canvas')
    await closeById('close-orchestration', 'orchestration-modal')
    // S7/T2：状态卡特写（亮色；同种子 running run 下应渲染，缺席则跳过）
    if (await page.$('.orchestration-status-floating')) {
      await shotEl(page, '.orchestration-status-floating', 'status-card-light')
    }
  }
} catch (error) {
  consoleErrors.push(`probe failure: ${error.message}`)
} finally {
  await browser.close()
}

if (consoleErrors.length > 0) {
  console.log('console/page errors:')
  for (const line of consoleErrors) console.log(`  ${line}`)
  process.exitCode = 2
} else if (failures.length > 0) {
  console.log(`failed checks (${failures.length}):`)
  for (const label of failures) console.log(`  ${label}`)
  process.exitCode = 3
} else {
  console.log('==== S6 acceptance summary ====')
  console.log('all checks passed')
}
