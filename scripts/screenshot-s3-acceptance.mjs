/*
 * S3 面板验收探针（Task 5，harness 模板：screenshot-s2-acceptance.mjs）：
 * 成员抽屉（T2：RolePanel → 非模态 shadcn Sheet）与笔记浮卡（T3：
 * NotesPanel → 浮动 Card + CanvasPortal 宿主 utilities 化）的浏览器级回归，
 * 外加 legacy.css 的零残留审计（T2/T3/T4 三阶段退役结果的静态复核）。
 *
 * - 抽屉（T2）：#app 内 portal、absolute（不是 fixed）、右缘贴合 #app、
 *   宽 min(340, 容器宽−54)、无遮罩、非模态（工作区可点、外点关闭）、
 *   forceMount 常挂载（关闭态 data-state=closed + 右移出界 + pointer-events:none）、
 *   开合钮恰好切换一次（不出现「关→再开」）、打开不夺焦（裁决：onOpenAutoFocus
 *   preventDefault）、成员卡 Avatar 40×40 与状态点色板；
 * - 裁决 11（s3-3 内）：抽屉 z-4 不得盖住浮窗铬件——抽屉打开时
 *   document.elementFromPoint(#close-window 几何中心) 必须命中该钮本身
 *   （.floating-toolbar z-12 > 抽屉 z-4，与退役前的 legacy .role-panel 同层次）；
 * - 笔记浮卡（T3）：fixed 视口贴角（top 72/right 24，在 #app 之外）、圆角 10px、
 *   z-index 18、背景 = --card、shadow-md、data-slot="card"；开合三件套
 *   （open 类 / opacity / visibility / pointer-events）且关闭态编辑器仍在 DOM；
 *   拖拽/缩放沿 p3 的指针模拟，断言内联 left/top、width/height 与过程中
 *   出现的 dragging/resizing 类（几何钩子未被 Card 化破坏）；
 * - 共享族（T3 的「不得删」清单）：打开「全部笔记」弹窗，.notes-editor /
 *   .note-tool-btn 仍有非零尺寸与 legacy 声明的背景/边框/内边距；
 * - legacy 审计（s3-12）：**剥注释口径**（先例：ChatList.test.tsx 的
 *   legacy retirement 用例）——legacy.css 中 .role-panel/.role-scroll/
 *   .role-card/.role-avatar/.role-meta/.status-pill/.status-/.notes-panel/
 *   .notes-resize-handle/.panel-header/.note-scope- 零命中；
 *   .orchestration-stage-canvas 只断言「宿主基块（裸选择器规则）」零命中
 *   ——`.orchestration-stage-canvas .x6-*` 后代族 10 条 + 浅色 1 条属 S6 范围，
 *   T3 报告已声明保留（CanvasPortal.test.tsx 同口径）；
 *   .role-tone-/.site-pill 在 legacy 零命中且在 globals.css **components 层**
 *   命中；T4 范围扩张的 4 簇（.add-person-site-option 族、.role-site-badge、
 *   #iframe-host .role-frame-site、.orchestration-person-site）同样在
 *   components 层；dist/team.css 按 @layer 切块复核（退役族全层零命中、
 *   色板落在 components 层）并确认新增 utilities 真的进了产物
 *   （紧贴 ${ 被静默吞掉的复检）。
 *
 * s3-1..s3-11 的可视断言组在暗色与亮色各跑一遍（s3-7 的亮色段另断抽屉背景
 * = --background，对应 T2 报告的「浅色 --card 白/深色近黑」），断言标签带
 * (dark)/(light) 相位后缀；s3-0 为亮色主题生效 sanity；s3-12 与主题无关，跑一次。
 * s3-2 的窄视口钳制半段排在每段最末（见 runDrawerClampChecks 的注释：该检查会把
 * 钳过的壳几何写进 localStorage，相位中途做会让后续截图与壳尺寸漂移）。
 * 断言失败置 exitCode 3；控制台/页面报错置 exitCode 2。
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
function record(label, detail) {
  console.log(`INFO  ${label}${detail ? ` — ${detail}` : ''}`)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `s3-${name}.png`) })
  console.log(`saved screenshots/s3-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-s3-'))
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
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })

  // 种子：协作群聊（6 个 external 人员覆盖全部 RoleStatus → s3-7 的色板断言；
  // external 不建站点 iframe，探针免网）+ 两条消息 + 全局/群聊笔记 + dark 主题。
  // 主题经 localStorage 'openteam.theme' 切换（与 s1/s2 同机制）。
  await page.evaluate(async () => {
    const now = Date.now()
    const chatId = 'chat-s3-1'
    const note = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const role = (id, name, status, extra = {}) => ({
      id,
      chatId,
      name,
      modelSource: 'external',
      status,
      contextCursor: 0,
      createdAt: now - 7_200_000,
      updatedAt: now - 60_000,
      description: `${name}的职责说明`,
      ...extra,
    })
    const roles = {
      'role-s3-pending': role('role-s3-pending', '待唤醒成员', 'pending'),
      'role-s3-loading': role('role-s3-loading', '加载中成员', 'loading'),
      'role-s3-ready': role('role-s3-ready', '就绪成员', 'ready'),
      'role-s3-thinking': role('role-s3-thinking', '思考中成员', 'thinking', { updatedAt: now }),
      'role-s3-stopped': role('role-s3-stopped', '已停止成员', 'stopped'),
      'role-s3-error': role('role-s3-error', '异常成员', 'error'),
    }
    const message = (id, patch) => ({
      id,
      chatId,
      seq: 0,
      type: 'user',
      content: '',
      status: 'sent',
      createdAt: now,
      ...patch,
    })
    const messages = {
      'msg-s3-1': message('msg-s3-1', {
        seq: 1,
        content: '这条消息用于确认抽屉打开后工作区仍可点选（非模态）。',
        createdAt: now - 32 * 60_000,
      }),
      'msg-s3-2': message('msg-s3-2', {
        seq: 2,
        type: 'assistant',
        roleId: 'role-s3-ready',
        roleName: '就绪成员',
        content: '收到，笔记浮卡与抽屉的验收清单已就位。',
        status: 'received',
        createdAt: now - 31 * 60_000,
      }),
    }
    const chat = (id, name, patch = {}) => ({
      id,
      name,
      mode: 'collaborative',
      roleIds: [],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 3_600_000,
      updatedAt: now,
      ...patch,
    })
    localStorage.setItem('openteam.theme', 'dark')
    localStorage.removeItem('openteam.shellGeometry')
    localStorage.removeItem('openteam.sidebar')
    await chrome.storage.local.set({
      'openteam.groupStore': {
        version: 7,
        currentChatId: chatId,
        chatOrder: [chatId, 'chat-s3-2', 'chat-s3-3'],
        chatsById: {
          [chatId]: chat(chatId, '面板验收群', {
            roleIds: Object.keys(roles),
            messageIds: Object.keys(messages),
            nextMessageSeq: 3,
          }),
          'chat-s3-2': chat('chat-s3-2', '独立专家台', { mode: 'independent', updatedAt: now - 9 * 60_000 }),
          'chat-s3-3': chat('chat-s3-3', '闲聊小组', { updatedAt: now - 90 * 60_000 }),
        },
        rolesById: roles,
        messagesById: messages,
        orchestrationFlowsById: {},
        orchestrationRunsById: {},
        activeOrchestrationRunIdByChatId: {},
        globalNote: note('全局备忘：S3 面板验收（抽屉 + 笔记浮卡）'),
        chatNotesById: { [chatId]: note('群聊笔记：抽屉由 Sheet 承载、笔记浮卡由 Card 承载') },
        settings: { language: 'zh-CN', externalModelOrder: [], externalModelsById: {} },
      },
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  // 页内取色探针：直接比对 computed 值会撞上 oklch/rgba 序列化差异，
  // 用「同一元素里挂一个 var() 引用探针」让浏览器自己解析变量再比对（照抄 s2）。
  const WITH_COLOR_HELPERS = `
    const colorMatchesVar = (el, varName) => {
      if (!el) return null
      const own = getComputedStyle(el).backgroundColor
      const raw = getComputedStyle(el).getPropertyValue(varName).trim()
      if (raw && own === raw) return true
      const probe = document.createElement('span')
      probe.style.display = 'none'
      probe.style.backgroundColor = 'var(' + varName + ')'
      el.appendChild(probe)
      const viaVar = getComputedStyle(probe).backgroundColor
      probe.remove()
      return viaVar === own
    }
  `

  const drawerState = () => page.evaluate(() => {
    const drawer = document.querySelector('.role-panel')
    return {
      present: drawer !== null,
      state: drawer?.getAttribute('data-state') ?? null,
      open: drawer?.classList.contains('open') ?? false,
    }
  })

  const openDrawerByClick = async () => {
    await page.click('#toggle-people-drawer')
    await sleep(600)
  }
  const closeDrawerByCollapse = async () => {
    await page.click('#close-people-drawer')
    await sleep(600)
  }

  // 「恰好切换一次」用 MutationObserver 计数：抽屉的 open 布尔序列去掉连续
  // 重复后，长度必须是 1（多一次即「关→再开」/「开→关」双触发）。
  const drawerOpenSequence = log => {
    const sequence = []
    for (const entry of log) {
      const open = entry.endsWith('open=true')
      if (sequence[sequence.length - 1] !== open) sequence.push(open)
    }
    return sequence
  }
  const startDrawerWatch = () => page.evaluate(() => {
    const panel = document.querySelector('.role-panel')
    window.__s3watch = { log: [] }
    window.__s3watch.observer = new MutationObserver(() => {
      window.__s3watch.log.push(`${panel.getAttribute('data-state')}\u0000open=${panel.classList.contains('open')}`)
    })
    window.__s3watch.observer.observe(panel, { attributes: true, attributeFilter: ['data-state', 'class'] })
  })
  const stopDrawerWatch = () => page.evaluate(() => {
    window.__s3watch.observer.disconnect()
    return { log: window.__s3watch.log, open: document.querySelector('.role-panel').classList.contains('open') }
  })

  // ---- 组 s3-1：抽屉打开时的 DOM/布局契约（T2）----
  async function runDrawerContractChecks(phase, screenshots) {
    await openDrawerByClick()
    const drawer = await page.evaluate(() => {
      const el = document.querySelector('.role-panel')
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        role: el.getAttribute('role'),
        state: el.getAttribute('data-state'),
        slot: el.getAttribute('data-slot'),
        hasOpenClass: el.classList.contains('open'),
        // substring 判定会恒真（类名表含 data-[state=open]:… 变体类），必须逐 token
        classHasOpenSubstring: el.className.includes('open'),
        position: cs.position,
        inApp: Boolean(el.closest('#app')),
        parentId: el.parentElement?.id ?? el.parentElement?.tagName,
        tag: el.tagName,
      }
    })
    check(`s3-1 (${phase}) drawer is a non-modal dialog with data-state=open and .role-panel.open`,
      drawer?.role === 'dialog' && drawer.state === 'open' && drawer.hasOpenClass === true,
      JSON.stringify(drawer))
    check(`s3-1 (${phase}) drawer positioning is absolute (not fixed) and portals inside #app`,
      drawer?.position === 'absolute' && drawer.inApp === true,
      `position ${drawer?.position}, closest(#app) ${drawer?.inApp}, parent #${drawer?.parentId}, tag ${drawer?.tag}`)
    if (screenshots) await shot(page, `drawer-open-${phase}`)
  }

  // ---- 组 s3-2：右缘贴合与宽度钳制（原 .role-panel 的 width:min(380px,100%-54px) → 340px 规格）----
  async function runDrawerGeometryChecks(phase) {
    const geometry = await page.evaluate(() => {
      const drawer = document.querySelector('.role-panel')
      const app = document.getElementById('app')
      const drawerRect = drawer.getBoundingClientRect()
      const appRect = app.getBoundingClientRect()
      return {
        drawerRight: drawerRect.right,
        appRight: appRect.right,
        drawerWidth: drawerRect.width,
        appWidth: appRect.width,
        // #app 是 border-box（1px 边框）：absolute 后代的包含块是 padding box，
        // 即 clientWidth —— max-w-[calc(100%-54px)] 的 100% 解析基准
        appClientWidth: app.clientWidth,
        expectedWidth: Math.min(340, app.clientWidth - 54),
      }
    })
    check(`s3-2 (${phase}) drawer right edge tracks the #app right edge (±1px border)`,
      Math.abs(geometry.drawerRight - geometry.appRight) <= 1,
      `drawer right ${geometry.drawerRight} vs #app right ${geometry.appRight} (Δ ${(geometry.drawerRight - geometry.appRight).toFixed(1)})`)
    check(`s3-2 (${phase}) drawer width is min(340, #app width - 54)`,
      geometry.drawerWidth === geometry.expectedWidth && geometry.drawerWidth === 340,
      `width ${geometry.drawerWidth} = min(340, ${geometry.appClientWidth} - 54 = ${geometry.expectedWidth})`)
  }

  // 窄视口钳制（s3-2 的第二半）：把窗口压到钳制真正生效的宽度（<640px 时
  // sm:max-w-none 不再压过 max-w-[calc(100%-54px)]），断言宽度改由钳制项决定。
  // 单独放在每段的最末：floatingWindow 会把被钳过的几何写回
  // localStorage 'openteam.shellGeometry'（shellGeometry.ts 的
  // clampShellSize = viewport - 48），留在相位中间会让后续截图的壳尺寸漂移。
  async function runDrawerClampChecks(phase) {
    await openDrawerByClick()
    const before = await page.evaluate(() => {
      const rect = document.getElementById('app').getBoundingClientRect()
      return { width: Math.round(rect.width), left: Math.round(rect.left) }
    })
    await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1 })
    await sleep(700)
    const clamped = await page.evaluate(() => {
      const drawer = document.querySelector('.role-panel')
      const app = document.getElementById('app')
      const drawerRect = drawer.getBoundingClientRect()
      const appRect = app.getBoundingClientRect()
      return {
        viewport: window.innerWidth,
        tier: app.dataset.appSize,
        drawerOpen: drawer.classList.contains('open'),
        drawerWidth: drawerRect.width,
        appRight: appRect.right,
        drawerRight: drawerRect.right,
        appClientWidth: app.clientWidth,
        expectedWidth: Math.min(340, app.clientWidth - 54),
        maxWidth: getComputedStyle(drawer).maxWidth,
      }
    })
    check(`s3-2 (${phase}) narrow viewport clamps the drawer to #app width - 54`,
      clamped.drawerOpen === true && clamped.drawerWidth === clamped.expectedWidth && clamped.drawerWidth < 340
      && Math.abs(clamped.drawerRight - clamped.appRight) <= 1,
      JSON.stringify(clamped))
    record(`s3-2 (${phase}) narrow-viewport clamp`, `viewport ${clamped.viewport} (${clamped.tier}) → app ${Math.round(clamped.appClientWidth + 2)}px wide (was ${before.width}px) → drawer width ${clamped.drawerWidth}px, max-width ${clamped.maxWidth}`)
    await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
    await sleep(700)
    await closeDrawerByCollapse()
  }

  // ---- 组 s3-3：无遮罩 / 非模态 / 裁决 11（抽屉不得盖住浮窗铬件）----
  async function runDrawerOverlayChecks(phase) {
    const probe = await page.evaluate(() => {
      const app = document.getElementById('app')
      const drawer = document.querySelector('.role-panel')
      const closeWindow = document.getElementById('close-window')
      const workspace = document.getElementById('workspace')
      const center = (element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      const describe = element => element ? {
        id: element.id || null,
        slot: element.getAttribute?.('data-slot') ?? null,
        tag: element.tagName,
        classes: String(element.className).slice(0, 80),
      } : null
      const closeCenter = center(closeWindow)
      const workspaceCenter = center(workspace)
      return {
        drawerOpen: drawer.classList.contains('open'),
        overlayInApp: app.querySelectorAll('[data-slot="sheet-overlay"]').length,
        scrimInApp: app.querySelectorAll('[class*="bg-black/50"]').length,
        // 非模态：工作区中心必须仍能被工作区内的元素接住（未被遮罩挡死）
        workspaceHit: describe(document.elementFromPoint(workspaceCenter.x, workspaceCenter.y)),
        workspaceHitInsideWorkspace: Boolean(document.elementFromPoint(workspaceCenter.x, workspaceCenter.y)?.closest('#workspace')),
        // 裁决 11：抽屉 z-4 < .floating-toolbar z-12，窗控钮必须仍在最上层
        closeHit: describe(document.elementFromPoint(closeCenter.x, closeCenter.y)),
        closeHitIsButton: Boolean(document.elementFromPoint(closeCenter.x, closeCenter.y)?.closest('#close-window')),
        closeCenter,
      }
    })
    check(`s3-3 (${phase}) no overlay inside #app while the drawer is open`,
      probe.drawerOpen === true && probe.overlayInApp === 0 && probe.scrimInApp === 0,
      `sheet-overlay ${probe.overlayInApp}, bg-black/50 ${probe.scrimInApp}`)
    check(`s3-3 (${phase}) workspace center stays clickable through the non-modal drawer`,
      probe.workspaceHitInsideWorkspace === true, JSON.stringify(probe.workspaceHit))
    check(`s3-3 (${phase}) ruling 11: drawer z-4 does not cover #close-window`,
      probe.closeHitIsButton === true,
      `elementFromPoint(${probe.closeCenter.x.toFixed(1)}, ${probe.closeCenter.y.toFixed(1)}) → ${JSON.stringify(probe.closeHit)}`)
  }

  // ---- 组 s3-4：关闭态常驻（forceMount + data-state 位移，而非卸载）----
  async function runDrawerClosedChecks(phase) {
    await closeDrawerByCollapse()
    const closed = await page.evaluate(() => {
      const drawer = document.querySelector('.role-panel')
      const app = document.getElementById('app')
      if (!drawer) return null
      const rect = drawer.getBoundingClientRect()
      const cs = getComputedStyle(drawer)
      return {
        present: true,
        state: drawer.getAttribute('data-state'),
        open: drawer.classList.contains('open'),
        rectRight: rect.right,
        appRight: app.getBoundingClientRect().right,
        pointerEvents: cs.pointerEvents,
      }
    })
    check(`s3-4 (${phase}) closed drawer stays mounted with data-state=closed`,
      closed?.present === true && closed.state === 'closed' && closed.open === false,
      JSON.stringify(closed))
    check(`s3-4 (${phase}) closed drawer parks outside the #app right edge with pointer-events:none`,
      closed !== null && closed.rectRight > closed.appRight && closed.pointerEvents === 'none',
      `right ${closed?.rectRight} vs #app right ${closed?.appRight} (+${closed ? (closed.rectRight - closed.appRight).toFixed(1) : '-'}px), pointer-events ${closed?.pointerEvents}`)
  }

  // ---- 组 s3-5：外点关闭 + 开合钮恰好切换一次 ----
  async function runDrawerDismissChecks(phase, screenshots) {
    // ① 关闭态 → 真实鼠标点开合钮：恰好一次开
    check(`s3-5 (${phase}) drawer starts closed before the toggle sequence`, (await drawerState()).open === false, JSON.stringify(await drawerState()))
    await startDrawerWatch()
    await openDrawerByClick()
    const opened = await stopDrawerWatch()
    const openSequence = drawerOpenSequence(opened.log)
    check(`s3-5 (${phase}) toggle opens the drawer exactly once`,
      openSequence.length === 1 && openSequence[0] === true && opened.open === true,
      `transitions ${JSON.stringify(openSequence)} (raw ${opened.log.length} mutations)`)
    if (screenshots) await shot(page, `drawer-toggle-open-${phase}`)

    // ② 点工作区（抽屉外）→ 恰好一次关
    const workspaceCenter = await page.evaluate(() => {
      const rect = document.getElementById('workspace').getBoundingClientRect()
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
    await startDrawerWatch()
    await page.mouse.click(workspaceCenter.x, workspaceCenter.y)
    await sleep(600)
    const dismissed = await stopDrawerWatch()
    const dismissSequence = drawerOpenSequence(dismissed.log)
    check(`s3-5 (${phase}) clicking the workspace closes the drawer exactly once`,
      dismissSequence.length === 1 && dismissSequence[0] === false && dismissed.open === false,
      `transitions ${JSON.stringify(dismissSequence)} (raw ${dismissed.log.length} mutations)`)

    // ③ 开合钮自身：打开态下点该钮 → 终态与点击前相反，且不得「关→再开」。
    // 几何事实（实测，非 S3 回归）：抽屉打开时它自己就盖住头部右端的钮位
    // （legacy .role-panel 亦为 absolute right:0/z-4、宽 min(380px,100%-54px)，
    // 覆盖范围只会更大），真实命中路径恒落在抽屉上——故这里用「在钮元素上派发
    // 完整指针序列」的等价写法把事件送进该钮的两个处理器（Radix 外点延迟判定 +
    // React onClick），这正是双触发风险的唯一入口；断言强度不变。
    await openDrawerByClick()
    const preToggle = await drawerState()
    const toggleProbe = await page.evaluate(async () => {
      const panel = document.querySelector('.role-panel')
      const toggle = document.getElementById('toggle-people-drawer')
      const rect = toggle.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const hit = document.elementFromPoint(cx, cy)
      const log = []
      const observer = new MutationObserver(() => log.push(`${panel.getAttribute('data-state')}\u0000open=${panel.classList.contains('open')}`))
      observer.observe(panel, { attributes: true, attributeFilter: ['data-state', 'class'] })
      const base = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, pointerId: 7, pointerType: 'mouse', isPrimary: true }
      toggle.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1 }))
      toggle.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }))
      toggle.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
      toggle.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
      toggle.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }))
      await new Promise(resolve => setTimeout(resolve, 700))
      observer.disconnect()
      return {
        hitAtToggleCenter: {
          id: hit?.id || null,
          slot: hit?.getAttribute?.('data-slot') ?? null,
          insideDrawer: Boolean(hit?.closest('.role-panel')),
        },
        log,
        finalOpen: panel.classList.contains('open'),
        finalState: panel.getAttribute('data-state'),
      }
    })
    const toggleSequence = drawerOpenSequence(toggleProbe.log)
    record(`s3-5 (${phase}) hit test at #toggle-people-drawer center while the drawer is open`, JSON.stringify(toggleProbe.hitAtToggleCenter))
    check(`s3-5 (${phase}) toggle activation flips the drawer exactly once (no close→reopen)`,
      preToggle.open === true && toggleSequence.length === 1 && toggleSequence[0] === false
      && toggleProbe.finalOpen === false && toggleProbe.finalState === 'closed',
      `before open=${preToggle.open} → transitions ${JSON.stringify(toggleSequence)} → final open=${toggleProbe.finalOpen}/${toggleProbe.finalState}`)
  }

  // ---- 组 s3-6：打开不夺焦（onOpenAutoFocus preventDefault）----
  async function runDrawerFocusChecks(phase) {
    // 真实鼠标点击会先把焦点给钮本身；先把焦点落到该钮，再点开抽屉，
    // 这样「焦点是否被抽屉抢走」才是唯一的变量（Radix 默认会把焦点移进 content）
    const before = await page.evaluate(() => {
      const toggle = document.getElementById('toggle-people-drawer')
      toggle.focus()
      return { id: document.activeElement?.id ?? null, insideDrawer: Boolean(document.activeElement?.closest('.role-panel')) }
    })
    await openDrawerByClick()
    const after = await page.evaluate(() => ({
      id: document.activeElement?.id ?? null,
      insideDrawer: Boolean(document.activeElement?.closest('.role-panel')),
      open: document.querySelector('.role-panel').classList.contains('open'),
    }))
    check(`s3-6 (${phase}) opening the drawer does not steal focus`,
      before.id !== null && after.id === before.id && after.insideDrawer === false && after.open === true,
      `activeElement #${before.id} → #${after.id} (insideDrawer ${after.insideDrawer})`)
  }

  // ---- 组 s3-7：成员卡 Avatar 40×40 + 状态点色板（T2 的 STATUS_DOT_CLASS）----
  // 取值源：.superpowers/sdd/2026-09-28-s3-panels-v2/task-2-report.md 的订正表
  const STATUS_DOT_CLASS = {
    pending: 'bg-zinc-400',
    loading: 'bg-amber-500',
    ready: 'bg-emerald-500',
    thinking: 'bg-amber-500',
    stopped: 'bg-amber-500',
    error: 'bg-red-500',
  }
  async function runRoleCardChecks(phase, screenshots) {
    const cards = await page.evaluate(statusDotClass => {
      const measure = element => {
        const rect = element.getBoundingClientRect()
        return { width: Math.round(rect.width), height: Math.round(rect.height) }
      }
      const paletteColor = className => {
        const probe = document.createElement('span')
        probe.className = className
        probe.style.display = 'none'
        document.body.append(probe)
        const color = getComputedStyle(probe).backgroundColor
        probe.remove()
        return color
      }
      const avatars = [...document.querySelectorAll('#role-list .role-card .role-avatar')]
      const badges = [...document.querySelectorAll('#role-list .role-card [data-status]')].map(badge => {
        const dot = badge.querySelector('span')
        const status = badge.getAttribute('data-status')
        const dotColor = dot ? getComputedStyle(dot).backgroundColor : null
        const expected = statusDotClass[status]
        return {
          status,
          dotClasses: dot?.className ?? null,
          dotSize: dot ? measure(dot) : null,
          dotColor,
          expectedClass: expected ?? null,
          expectedColor: expected ? paletteColor(expected) : null,
          classHit: Boolean(dot && expected && dot.classList.contains(expected)),
        }
      })
      return {
        avatarCount: avatars.length,
        avatarSizes: avatars.map(measure),
        avatarRadius: avatars[0] ? getComputedStyle(avatars[0]).borderRadius : null,
        badges,
        cardCount: document.querySelectorAll('#role-list .role-card').length,
      }
    }, STATUS_DOT_CLASS)

    check(`s3-7 (${phase}) role cards render for every seeded member`,
      cards.cardCount === 6 && cards.avatarCount === 6, JSON.stringify({ cards: cards.cardCount, avatars: cards.avatarCount }))
    check(`s3-7 (${phase}) member avatar is 40x40 (size-10) as before the Card migration`,
      cards.avatarSizes.length > 0 && cards.avatarSizes.every(size => size.width === 40 && size.height === 40),
      `sizes ${JSON.stringify(cards.avatarSizes)}, radius ${cards.avatarRadius}`)

    const mismatches = cards.badges.filter(badge => {
      const expected = STATUS_DOT_CLASS[badge.status]
      return !expected || badge.classHit !== true || badge.dotColor !== badge.expectedColor
        || badge.dotSize?.width === 0 || badge.dotSize?.height === 0
    })
    check(`s3-7 (${phase}) every status dot matches the Task 2 STATUS_DOT_CLASS palette`,
      cards.badges.length === 6 && mismatches.length === 0,
      mismatches.length === 0
        ? cards.badges.map(badge => `${badge.status}:${badge.dotClasses?.split(' ').find(cls => cls.startsWith('bg-')) ?? '?'}`).join(' ')
        : JSON.stringify(mismatches))
    record(`s3-7 (${phase}) measured status dot colors`, cards.badges.map(badge => `${badge.status} ${badge.dotColor} (${badge.expectedClass})`).join(' | '))

    if (phase === 'light') {
      const drawerBackground = await page.evaluate(`(() => {
        ${WITH_COLOR_HELPERS}
        return colorMatchesVar(document.querySelector('.role-panel'), '--background')
      })()`)
      check('s3-7 (light) drawer background is --background', drawerBackground === true, `--background match ${drawerBackground}`)
    }
    if (screenshots) await shot(page, `role-cards-${phase}`)
    await closeDrawerByCollapse()
  }

  // ---- 组 s3-8：笔记浮卡初始几何（T3 的 Card 化）----
  async function runNotesCardChecks(phase, screenshots) {
    await page.click('#toggle-notes-panel')
    await page.waitForSelector('#notes-panel.open', { timeout: 10_000 })
    await page.waitForSelector('#notes-editor .ProseMirror', { timeout: 15_000 })
    await sleep(500)
    const card = await page.evaluate(`(() => {
      ${WITH_COLOR_HELPERS}
      const panel = document.getElementById('notes-panel')
      if (!panel) return null
      const rect = panel.getBoundingClientRect()
      const cs = getComputedStyle(panel)
      return {
        slot: panel.getAttribute('data-slot'),
        role: panel.getAttribute('role'),
        tag: panel.tagName,
        position: cs.position,
        top: cs.top,
        right: cs.right,
        rectTop: rect.top,
        rectRight: rect.right,
        viewportWidth: window.innerWidth,
        radius: cs.borderRadius,
        zIndex: cs.zIndex,
        cardColor: colorMatchesVar(panel, '--card'),
        boxShadow: cs.boxShadow,
        inApp: Boolean(panel.closest('#app')),
        inlineLeft: panel.style.left,
      }
    })()`)
    check(`s3-8 (${phase}) notes panel is a fixed floating card anchored top 72 / right 24`,
      card?.position === 'fixed' && card.rectTop === 72 && Math.abs(card.rectRight - (card.viewportWidth - 24)) <= 1
      && !card.inApp && card.inlineLeft === '',
      JSON.stringify({ position: card?.position, rectTop: card?.rectTop, rectRight: card?.rectRight, viewportWidth: card?.viewportWidth, inApp: card?.inApp }))
    check(`s3-8 (${phase}) notes card visuals: radius 10px, z-index 18, bg --card, shadow not none, data-slot=card`,
      card?.slot === 'card' && card.tag === 'DIV' && card.radius === '10px' && card.zIndex === '18'
      && card.cardColor === true && card.boxShadow !== 'none',
      `slot ${card?.slot}/${card?.tag}, radius ${card?.radius}, z ${card?.zIndex}, --card match ${card?.cardColor}, shadow ${card?.boxShadow}`)
    record(`s3-8 (${phase}) notes card box-shadow`, card?.boxShadow ?? 'missing')
    if (screenshots) await shot(page, `notes-open-${phase}`)
  }

  // ---- 组 s3-9：笔记开合三件套 + 关闭态编辑器常驻 ----
  async function runNotesToggleChecks(phase, screenshots) {
    const open = await page.evaluate(() => {
      const panel = document.getElementById('notes-panel')
      const cs = getComputedStyle(panel)
      return {
        open: panel.classList.contains('open'),
        opacity: cs.opacity,
        visibility: cs.visibility,
        pointerEvents: cs.pointerEvents,
        editorInDom: Boolean(document.getElementById('notes-editor')),
        proseMirror: Boolean(document.querySelector('#notes-editor .ProseMirror')),
      }
    })
    check(`s3-9 (${phase}) open notes panel is visible/interactive with the editor mounted`,
      open.open === true && open.opacity === '1' && open.visibility === 'visible' && open.pointerEvents === 'auto' && open.proseMirror === true,
      JSON.stringify(open))

    await page.click('#close-notes-panel')
    await sleep(600)
    const closed = await page.evaluate(() => {
      const panel = document.getElementById('notes-panel')
      const cs = getComputedStyle(panel)
      return {
        open: panel.classList.contains('open'),
        opacity: cs.opacity,
        visibility: cs.visibility,
        pointerEvents: cs.pointerEvents,
        editorInDom: Boolean(document.getElementById('notes-editor')),
      }
    })
    check(`s3-9 (${phase}) closed notes panel hides via open/opacity/visibility/pointer-events and keeps #notes-editor`,
      closed.open === false && closed.opacity === '0' && closed.visibility === 'hidden'
      && closed.pointerEvents === 'none' && closed.editorInDom === true,
      JSON.stringify(closed))
    if (screenshots) await shot(page, `notes-closed-${phase}`)

    await page.click('#toggle-notes-panel')
    await page.waitForSelector('#notes-panel.open', { timeout: 10_000 })
    await sleep(500)
  }

  // ---- 组 s3-10：笔记拖拽 + 缩放（p3 的指针模拟；几何钩子未被 Card 化破坏）----
  async function runNotesGeometryChecks(phase, screenshots) {
    const before = await page.evaluate(() => {
      const panel = document.getElementById('notes-panel')
      const rect = panel.getBoundingClientRect()
      return { inlineLeft: panel.style.left, inlineTop: panel.style.top, left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    })
    const dragHandle = await page.$('#notes-drag-handle')
    const handleBox = await dragHandle.boundingBox()
    await page.mouse.move(handleBox.x + 40, handleBox.y + 8)
    await page.mouse.down()
    await page.mouse.move(handleBox.x - 120, handleBox.y + 108, { steps: 5 })
    await sleep(150)
    const draggingInFlight = await page.evaluate(() => document.getElementById('notes-panel').classList.contains('dragging'))
    await page.mouse.up()
    await sleep(300)
    const afterDrag = await page.evaluate(() => {
      const panel = document.getElementById('notes-panel')
      const rect = panel.getBoundingClientRect()
      return {
        inlineLeft: panel.style.left,
        inlineTop: panel.style.top,
        dragging: panel.classList.contains('dragging'),
        left: rect.left,
        top: rect.top,
      }
    })
    check(`s3-10 (${phase}) dragging sets inline left/top and shows the dragging class mid-gesture`,
      draggingInFlight === true && afterDrag.inlineLeft !== '' && afterDrag.inlineTop !== ''
      && (afterDrag.inlineLeft !== before.inlineLeft || afterDrag.inlineTop !== before.inlineTop)
      && Math.abs(afterDrag.left - before.left) > 50 && Math.abs(afterDrag.top - before.top) > 50,
      `dragging(class mid-gesture ${draggingInFlight}, cleared ${!afterDrag.dragging}); inline ${before.inlineLeft || '-'}/${before.inlineTop || '-'} → ${afterDrag.inlineLeft}/${afterDrag.inlineTop}`)
    check(`s3-10 (${phase}) dragging class is cleared on pointerup`, afterDrag.dragging === false, `dragging ${afterDrag.dragging}`)
    if (screenshots) await shot(page, `notes-dragged-${phase}`)

    const resizeHandle = await page.$('#notes-resize-handle')
    const resizeBox = await resizeHandle.boundingBox()
    const sizeBefore = await page.evaluate(() => {
      const panel = document.getElementById('notes-panel')
      return { inlineWidth: panel.style.width, inlineHeight: panel.style.height, width: panel.getBoundingClientRect().width, height: panel.getBoundingClientRect().height }
    })
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(resizeBox.x + 140, resizeBox.y + 120, { steps: 5 })
    await sleep(150)
    const resizingInFlight = await page.evaluate(() => document.getElementById('notes-panel').classList.contains('resizing'))
    await page.mouse.up()
    await sleep(300)
    const afterResize = await page.evaluate(() => {
      const panel = document.getElementById('notes-panel')
      return {
        inlineWidth: panel.style.width,
        inlineHeight: panel.style.height,
        resizing: panel.classList.contains('resizing'),
        width: Math.round(panel.getBoundingClientRect().width),
        height: Math.round(panel.getBoundingClientRect().height),
      }
    })
    check(`s3-10 (${phase}) resizing sets inline width/height and shows the resizing class mid-gesture`,
      resizingInFlight === true && afterResize.inlineWidth !== '' && afterResize.inlineHeight !== ''
      && afterResize.width > sizeBefore.width + 50 && afterResize.height > sizeBefore.height + 50,
      `resizing(class mid-gesture ${resizingInFlight}, cleared ${!afterResize.resizing}); ${Math.round(sizeBefore.width)}x${Math.round(sizeBefore.height)} → ${afterResize.width}x${afterResize.height} (inline ${afterResize.inlineWidth}/${afterResize.inlineHeight})`)
    check(`s3-10 (${phase}) resizing class is cleared on pointerup`, afterResize.resizing === false, `resizing ${afterResize.resizing}`)
    if (screenshots) await shot(page, `notes-resized-${phase}`)

    await page.click('#close-notes-panel')
    await sleep(500)
  }

  // ---- 组 s3-11：共享族未误删（T3 的「不得删」清单，走全部笔记弹窗）----
  async function runSharedFamilyChecks(phase, screenshots) {
    await page.click('button[aria-label="全部笔记"]')
    await page.waitForSelector('#all-notes-modal:not([hidden])', { timeout: 10_000 })
    await page.waitForSelector('#all-notes-editor .ProseMirror', { timeout: 15_000 })
    await sleep(500)
    const shared = await page.evaluate(() => {
      const editor = document.querySelector('#all-notes-modal .notes-editor')
      const toolbarButton = document.querySelector('#all-notes-modal .note-tool-btn')
      const editorRect = editor?.getBoundingClientRect()
      const buttonRect = toolbarButton?.getBoundingClientRect()
      const editorStyle = editor ? getComputedStyle(editor) : null
      const buttonStyle = toolbarButton ? getComputedStyle(toolbarButton) : null
      return {
        modalVisible: document.getElementById('all-notes-modal')?.hidden === false,
        editor: editorRect ? {
          width: Math.round(editorRect.width),
          height: Math.round(editorRect.height),
          overflow: editorStyle.overflow,
          paddingTop: editorStyle.paddingTop,
          paddingLeft: editorStyle.paddingLeft,
          paddingBottom: editorStyle.paddingBottom,
        } : null,
        toolbarButton: buttonRect ? {
          count: document.querySelectorAll('#all-notes-modal .note-tool-btn').length,
          width: Math.round(buttonRect.width),
          height: Math.round(buttonRect.height),
          background: buttonStyle.backgroundColor,
          borderWidth: buttonStyle.borderTopWidth,
          borderColor: buttonStyle.borderTopColor,
        } : null,
      }
    })
    check(`s3-11 (${phase}) .notes-editor keeps non-zero size and its legacy box metrics`,
      shared.editor !== null && shared.editor.width > 0 && shared.editor.height > 0
      && shared.editor.overflow === 'auto' && shared.editor.paddingTop === '18px'
      && shared.editor.paddingLeft === '20px' && shared.editor.paddingBottom === '28px',
      JSON.stringify(shared.editor))
    check(`s3-11 (${phase}) .note-tool-btn keeps non-zero size and its legacy surface (bg + border)`,
      shared.toolbarButton !== null && shared.toolbarButton.count >= 5
      && shared.toolbarButton.width > 0 && shared.toolbarButton.height > 0
      && shared.toolbarButton.background !== 'rgba(0, 0, 0, 0)'
      && shared.toolbarButton.borderWidth === '1px' && shared.toolbarButton.borderColor !== 'rgba(0, 0, 0, 0)',
      JSON.stringify(shared.toolbarButton))
    if (screenshots) await shot(page, `all-notes-shared-family-${phase}`)
    await page.keyboard.press('Escape')
    await sleep(400)
  }

  /*
   * 可视断言组整体封装：暗色与亮色各跑一遍（照 s2 的相位结构）。
   * 顺序固定为 s3-1..s3-7（抽屉）→ s3-8..s3-11（笔记浮卡 + 共享族）：
   * 抽屉的每次真实点击都会先闭合抽屉再走笔记段（头部右端的笔记钮同样会被
   * 打开态抽屉覆盖，这是 pre-S3 同款几何），s3-8 的「初始几何」也在任何
   * 拖拽之前取值。
   */
  async function runPanelVisuals(phase, { screenshots = true } = {}) {
    await runDrawerContractChecks(phase, screenshots)
    await runDrawerGeometryChecks(phase)
    await runDrawerOverlayChecks(phase)
    await runDrawerClosedChecks(phase)
    await runDrawerDismissChecks(phase, screenshots)
    await runDrawerFocusChecks(phase)
    await runRoleCardChecks(phase, screenshots)
    await runNotesCardChecks(phase, screenshots)
    await runNotesToggleChecks(phase, screenshots)
    await runNotesGeometryChecks(phase, screenshots)
    await runSharedFamilyChecks(phase, screenshots)
    await runDrawerClampChecks(phase)
  }

  const shellGeometryOf = () => page.evaluate(() => {
    const rect = document.getElementById('app').getBoundingClientRect()
    return `${Math.round(rect.width)}×${Math.round(rect.height)} @ (${Math.round(rect.left)},${Math.round(rect.top)})`
  })
  record('shell geometry at dark-phase start', await shellGeometryOf())
  await runPanelVisuals('dark')
  record('shell geometry after the dark phase (persisted by the narrow-viewport detour)', await shellGeometryOf())
  const darkBodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  // ---- 亮色段：主题切浅色后复跑 s3-1..s3-11（s3-7 另断抽屉底色 = --background）----
  // 同批清掉壳几何：暗色段的窄视口检查会把钳过的尺寸写进 openteam.shellGeometry
  // （floatingWindow 的 resize 落盘），不清则亮色段以非默认壳尺寸开机、截图失真。
  await page.evaluate(() => {
    localStorage.setItem('openteam.theme', 'light')
    localStorage.removeItem('openteam.shellGeometry')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)
  const lightThemeProbe = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }))
  check('s3-0 (light) theme light applied on <html>', lightThemeProbe.theme === 'light', JSON.stringify(lightThemeProbe))
  check('s3-0 (light) theme repaints body background', lightThemeProbe.bodyBackground !== darkBodyBackground,
    `dark ${darkBodyBackground} → light ${lightThemeProbe.bodyBackground}`)
  record('shell geometry at light-phase start (shellGeometry reset)', await shellGeometryOf())
  await runPanelVisuals('light')

  // ---- 组 s3-12：legacy 审计（剥注释口径；与主题无关，跑一次）----
  // 口径先例：ChatList.test.tsx 的 'ChatList legacy.css retirement'
  // （css.replace(/\/\*[\s\S]*?\*\//g, '') 后再 toContain/not.toContain）。
  const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')
  const countOccurrences = (text, token) => text.split(token).length - 1
  const layerBlocks = css => {
    const blocks = []
    const pattern = /@layer\s+([A-Za-z0-9_-]+)\s*\{/g
    let match
    while ((match = pattern.exec(css))) {
      const open = pattern.lastIndex - 1
      let depth = 0
      let end = open
      for (; end < css.length; end += 1) {
        if (css[end] === '{') depth += 1
        else if (css[end] === '}') {
          depth -= 1
          if (depth === 0) break
        }
      }
      blocks.push({ name: match[1], body: css.slice(open + 1, end) })
    }
    return blocks
  }

  const legacyRaw = await readFile(path.join(root, 'src/teamPage/ui/styles/legacy.css'), 'utf8')
  const globalsRaw = await readFile(path.join(root, 'src/teamPage/ui/styles/globals.css'), 'utf8')
  const distCss = await readFile(path.join(dist, 'team.css'), 'utf8')
  const legacyCss = stripComments(legacyRaw)
  const globalsCss = stripComments(globalsRaw)
  const globalsComponents = layerBlocks(globalsCss).filter(block => block.name === 'components')
    .map(block => block.body).join('\n')
  const distLayers = layerBlocks(distCss)
  const distLayer = name => distLayers.filter(block => block.name === name).map(block => block.body).join('\n')

  record('s3-12 legacy.css sanity', `raw ${legacyRaw.length} chars → comment-stripped ${legacyCss.length} chars; legacy 源里含 role-tone-/site-pill 字样的注释 ${legacyRaw.split('\n').filter(line => /role-tone|site-pill/.test(line)).length} 行（已按剥注释口径排除）`)

  // ① legacy.css 里 T2/T3 退役族的零命中
  const retiredFamilies = ['.role-panel', '.role-scroll', '.role-card', '.role-avatar', '.role-meta', '.status-pill', '.status-', '.notes-panel', '.notes-resize-handle', '.panel-header', '.note-scope-']
  const retiredHits = retiredFamilies.filter(token => legacyCss.includes(token))
  check('s3-12 legacy.css has zero residue for the T2/T3 retired families (comments stripped)',
    retiredHits.length === 0,
    retiredHits.length === 0 ? `${retiredFamilies.length} tokens all absent` : `still present: ${retiredHits.join(', ')}`)

  // ② .orchestration-stage-canvas：只断宿主基块（裸选择器）退役
  //    ——`.orchestration-stage-canvas .x6-*` 后代族 + 浅色 1 条属 S6 范围，T3 报告
  //    已声明保留，CanvasPortal.test.tsx 同口径。
  const canvasHostRule = /\.orchestration-stage-canvas\s*[,{]/
  const canvasDescendantCount = countOccurrences(legacyCss, '.orchestration-stage-canvas')
  check('s3-12 legacy.css retires the bare .orchestration-stage-canvas host block',
    canvasHostRule.test(legacyCss) === false,
    `bare selector rule ${canvasHostRule.test(legacyCss) ? 'still present' : 'absent'}; retained .x6-* descendant rules ${canvasDescendantCount}`
  )

  // ③ .role-tone- / .site-pill：legacy 零命中（剥注释）、globals components 层命中
  const paletteTokens = ['.role-tone-', '.site-pill']
  const paletteLegacyHits = paletteTokens.filter(token => legacyCss.includes(token))
  check('s3-12 legacy.css has zero residue for .role-tone-/.site-pill (comments stripped)',
    paletteLegacyHits.length === 0, paletteLegacyHits.join(', ') || 'both absent')
  const paletteGlobalsHits = paletteTokens.map(token => `${token}×${countOccurrences(globalsComponents, token)}`)
  check('s3-12 globals.css components layer carries the dynamic palettes',
    paletteTokens.every(token => countOccurrences(globalsComponents, token) > 0),
    paletteGlobalsHits.join(' '))

  // ④ T4 范围扩张的 4 簇族外规则同样落在 components 层（不搬会有可见回退）
  const movedCompanions = ['.add-person-site-option', '.role-site-badge', '#iframe-host .role-frame-site', '.orchestration-person-site']
  const companionHits = movedCompanions.map(token => `${token}×${countOccurrences(globalsComponents, token)}`)
  check('s3-12 T4 relocated companions live in the components layer',
    movedCompanions.every(token => countOccurrences(globalsComponents, token) > 0),
    companionHits.join(' '))

  // ⑤ 共享族原样存活（T3 的「不得删」清单）
  const sharedFamilies = ['.notes-editor', '.note-tool-btn', '.note-toolbar', '.all-note-', '.tiny', '.reference-box', '.mention-shortcut', '.section-title']
  const sharedHits = sharedFamilies.map(token => `${token}×${countOccurrences(legacyCss, token)}`)
  check('s3-12 shared families survive in legacy.css',
    sharedFamilies.every(token => countOccurrences(legacyCss, token) > 0),
    sharedHits.join(' '))

  // ⑥ 构建产物：按 @layer 切块复核（退役族全层零命中；色板落在 components 层）
  const distRetiredRows = retiredFamilies.map(token => ({
    token,
    rows: distLayers.map(block => [block.name, countOccurrences(block.body, token)]).filter(([, count]) => count > 0),
  }))
  const distRetiredHits = distRetiredRows.filter(row => row.rows.length > 0)
  check('s3-12 dist CSS carries no retired-family rules in any layer',
    distRetiredHits.length === 0,
    distRetiredHits.length === 0 ? `${distRetiredRows.length} tokens absent from all layers` : JSON.stringify(distRetiredHits))
  const distCanvasDescendants = countOccurrences(distCss, '.orchestration-stage-canvas .x6-')
  check('s3-12 dist CSS retires the bare canvas host block but keeps the .x6-* descendant rules',
    canvasHostRule.test(distCss) === false && distCanvasDescendants > 0,
    `bare host rule ${canvasHostRule.test(distCss) ? 'still present' : 'absent'}; .orchestration-stage-canvas .x6-* rules ${distCanvasDescendants}`)
  const distPalette = paletteTokens.map(token => ({
    token,
    components: countOccurrences(distLayer('components'), token),
    legacy: countOccurrences(distLayer('legacy'), token),
  }))
  check('s3-12 dist CSS keeps the palettes in the components layer (not legacy)',
    distPalette.every(row => row.components > 0 && row.legacy === 0),
    JSON.stringify(distPalette))

  // ⑦ 新增 utilities 真的进了产物（紧贴 ${ 被静默吞掉的复检）
  const utilityChecks = [
    ['translate-x-full', /\.translate-x-full\s*\{[^}]*--tw-translate-x:\s*100%/],
    ['grid-rows-[auto_auto_auto_minmax(0,1fr)]', /\.grid-rows-\\\[auto_auto_auto_minmax\\\(0\\,1fr\\\)\\\]\s*\{grid-template-rows:\s*auto auto auto minmax\(0,1fr\)\}/],
    ['size-full', /\.size-full\s*\{width:\s*100%;height:\s*100%\}/],
  ]
  const utilityMissing = utilityChecks.filter(([, pattern]) => !pattern.test(distCss)).map(([name]) => name)
  check('s3-12 new utilities are present in dist CSS',
    utilityMissing.length === 0,
    utilityMissing.length === 0 ? utilityChecks.map(([name]) => name).join(', ') : `missing: ${utilityMissing.join(', ')}`)

  console.log('\n==== S3 acceptance summary ====')
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
