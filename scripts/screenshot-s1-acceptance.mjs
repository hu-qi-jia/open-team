/*
 * S1 壳层验收探针（Task 9，模板：screenshot-w3-3-acceptance.mjs）：
 * AppShell v2 新壳三档位 × 双主题回归——
 * - 新壳结构：sidebar 原语 / legacy .rail 退役 / #chat-list 保留 /
 *   #app[data-app-size] 档位 / #notes-panel 与 #app 相邻兄弟 / 浮窗铬件 id 全须有；
 * - 三档位（视口宽驱动 .app-shell 宽 → data-app-size 翻转）× 明暗主题截图：
 *   wide 常驻侧栏 + 头部全平铺钮、medium 图标条 + 收纳「更多操作」菜单 + 图标 tooltip、
 *   compact 侧栏隐藏 + 头部唤出钮 + 笔记收进菜单；
 * - 拖动后 resize 手柄对齐（T7 修复证据）：seed openteam.shellGeometry → reload
 *   走 boot 恢复（#app transform 置 none）→ 右缘/底缘/右下角手柄 rect 与
 *   .app-shell rect 逐边比对（≤3px）；再做真实指针拖拽（头部拖动窗体 +
 *   三向拉伸手柄）后复测对齐，几何 300ms 防抖持久化且重载后恢复；
 * - 侧栏拖宽 200–320 钳制、双击回 240、刷新保持（openteam.sidebar）；
 * - fullscreen 手柄隐藏 / minimized 笔记面板卸载（Task 8 的 React 守卫）；
 * - compact 窗控圆点与头部按钮零重叠（R2-b：compact 头部右侧让位 78px，
 *   圆点带 right:18px + 3×11px ≈ 63px）+ 侧栏唤出真正打开抽屉（R2-a：
 *   唤出钮走 sidebar 原语官方 API，<768 视口 Sheet 分支生效）——两项均为
 *   硬断言（R2 脚本硬化：原 record 观察项升格）。
 * 断言失败置 exitCode 3；控制台/页面报错置 exitCode 2。
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
function record(label, detail) {
  console.log(`INFO  ${label}${detail ? ` — ${detail}` : ''}`)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `s1-${name}.png`) })
  console.log(`saved screenshots/s1-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const tiers = [
  { name: 'wide', width: 1500, height: 950, expect: 'wide' },
  { name: 'medium', width: 900, height: 800, expect: 'medium' },
  { name: 'compact', width: 640, height: 600, expect: 'compact' },
]

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-s1-'))
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
  const cdp = await page.createCDPSession()
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })

  // 种子：一个无人员、无消息的协作群聊（status ready，协作模式才有编排/免@ 钮）
  // + 明确 dark 主题 + 清空侧栏/几何偏好（UI 语言钉 zh-CN，断言文案确定）。
  await page.evaluate(async () => {
    const now = Date.now()
    const chat = {
      id: 'chat-empty-1',
      name: '空群聊',
      mode: 'collaborative',
      roleIds: [],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 3_600_000,
      updatedAt: now,
    }
    localStorage.setItem('openteam.theme', 'dark')
    localStorage.removeItem('openteam.shellGeometry')
    localStorage.removeItem('openteam.sidebar')
    await chrome.storage.local.set({
      'openteam.groupStore': {
        version: 7,
        currentChatId: chat.id,
        chatOrder: [chat.id],
        chatsById: { [chat.id]: chat },
        rolesById: {},
        messagesById: {},
        orchestrationFlowsById: {},
        orchestrationRunsById: {},
        activeOrchestrationRunIdByChatId: {},
        settings: { language: 'zh-CN', externalModelOrder: [], externalModelsById: {} },
      },
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  // ---- 新壳结构断言（骨架测试 DOM 契约的运行时回放）----
  check('sidebar primitive', await page.$('[data-sidebar="sidebar"]') !== null)
  check('legacy rail removed', await page.$('.rail') === null)
  check('chat-list id kept', await page.$('#chat-list') !== null)
  check('app-size attr present', await page.evaluate(() => ['compact', 'medium', 'wide'].includes(document.getElementById('app')?.dataset.appSize ?? '')))
  check('notes-panel adjacent sibling of #app', await page.evaluate(() => document.getElementById('app')?.nextElementSibling?.id === 'notes-panel'))
  check('floating chrome ids present', await page.evaluate(() =>
    ['close-window', 'toggle-window-size', 'toggle-fullscreen', 'window-resize-handle', 'window-resize-handle-right', 'window-resize-handle-bottom']
      .every(id => Boolean(document.getElementById(id)))))
  check('window-launcher initially hidden', await page.evaluate(() => document.getElementById('window-launcher')?.hidden === true))
  check('theme dark applied on <html>', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'))
  check('sidebar resize handle rendered (wide + open)', await page.$('.sidebar-resize-handle') !== null)
  const themeProbe = await page.evaluate(() => ({
    language: document.documentElement.lang,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }))
  record('dark theme body background', JSON.stringify(themeProbe))

  // ---- 手柄 vs 壳缘对齐探针（T7 修复的证据核心：三手柄 absolute 于 #app，
  //      与 transform 是否被清无关；容差 3px 覆盖 1px 壳边框）----
  const alignmentProbe = () => page.evaluate(() => {
    const app = document.getElementById('app')
    const shell = app.getBoundingClientRect()
    const deltaOf = (sel, edges) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return Object.fromEntries(Object.entries(edges).map(([edge, target]) => [edge, Math.round((rect[edge] - target) * 10) / 10]))
    }
    return {
      shell: { left: shell.left, top: shell.top, width: shell.width, height: shell.height },
      transform: app.style.transform === '' ? '(css default)' : app.style.transform,
      right: deltaOf('#window-resize-handle-right', { right: shell.right, top: shell.top, bottom: shell.bottom }),
      bottom: deltaOf('#window-resize-handle-bottom', { left: shell.left, right: shell.right, bottom: shell.bottom }),
      corner: deltaOf('#window-resize-handle', { right: shell.right, bottom: shell.bottom }),
      // 侧栏手柄贴的是侧栏 gap 右缘（left = --sidebar-width - 2px），非壳左缘
      sidebar: (() => {
        const handle = document.querySelector('.sidebar-resize-handle')
        const gap = document.querySelector('[data-slot="sidebar-gap"]')
        if (!handle || !gap) return null
        const handleRect = handle.getBoundingClientRect()
        return { centerOnGapEdge: Math.round((handleRect.left + handleRect.width / 2 - gap.getBoundingClientRect().right) * 10) / 10 }
      })(),
    }
  })
  function checkHandleAlignment(label, probe, { withSidebar = true } = {}) {
    const groups = withSidebar ? ['right', 'bottom', 'corner', 'sidebar'] : ['right', 'bottom', 'corner']
    // fail closed：任一预期探针组缺失（选择器没命中 → null）直接判负，
    // 不允许「元素缺失 ⇒ 空 delta ⇒ 误绿」。
    const missing = groups.filter(key => !probe[key])
    const worst = Math.max(0, ...groups.flatMap(key => probe[key] ? Object.values(probe[key]).map(Math.abs) : []))
    check(label, missing.length === 0 && worst <= 3,
      `${missing.length > 0 ? `missing probes [${missing.join(', ')}] — ` : ''}max edge delta ${worst}px — ${JSON.stringify(probe)}`)
  }

  // ---- 三档位场景（dark）：视口宽 → .app-shell 宽（min(1420px, 100vw-52px)）→ 档位翻转 ----
  async function assertTierShape(tier) {
    if (tier === 'wide') {
      check('wide header flat buttons', await page.evaluate(() =>
        ['restore-chat', 'open-orchestration', 'toggle-people-drawer', 'toggle-notes-panel'].every(id => Boolean(document.getElementById(id)))))
      check('wide sidebar expanded', await page.evaluate(() => {
        const sidebar = document.querySelector('[data-slot="sidebar"]')
        const gap = document.querySelector('[data-slot="sidebar-gap"]')
        return sidebar?.dataset.state === 'expanded' && gap !== null && Math.abs(gap.getBoundingClientRect().width - 240) <= 2
      }, ))
      check('wide sidebar resize handle present', await page.$('.sidebar-resize-handle') !== null)
    }
    if (tier === 'medium') {
      check('medium header flat buttons collapsed into menu', await page.evaluate(() =>
        document.getElementById('restore-chat') === null && document.getElementById('open-orchestration') === null
        && document.getElementById('toggle-people-drawer') !== null && document.getElementById('toggle-notes-panel') !== null))
      check('medium icon strip (collapsed sidebar)', await page.evaluate(() => {
        const sidebar = document.querySelector('[data-slot="sidebar"]')
        const gap = document.querySelector('[data-slot="sidebar-gap"]')
        return sidebar?.dataset.state === 'collapsed' && sidebar?.dataset.collapsible === 'icon'
          && gap !== null && gap.getBoundingClientRect().width < 100
      }))
      const iconWidth = await page.evaluate(() => document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width ?? -1)
      record('medium icon strip measured width', `${iconWidth}px (规格文字写 56px，sidebar 原语 3rem=48px)`)
      check('medium sidebar resize handle absent', await page.$('.sidebar-resize-handle') === null)
    }
    if (tier === 'compact') {
      check('compact header: summon + members, no flat notes/restore', await page.evaluate(() => {
        const headerButtons = [...document.querySelectorAll('#app header button')]
        return document.getElementById('restore-chat') === null
          && document.getElementById('toggle-notes-panel') === null
          && document.getElementById('toggle-people-drawer') !== null
          && headerButtons.some(button => (button.getAttribute('aria-label') ?? '').includes('侧栏'))
      }))
      check('compact sidebar hidden (no desktop sidebar consuming space)', await page.evaluate(() => {
        const gap = document.querySelector('[data-slot="sidebar-gap"]')
        const container = document.querySelector('[data-slot="sidebar-container"]')
        const hidden = el => el === null || el.getBoundingClientRect().width === 0
        return hidden(gap) && hidden(container)
      }))
    }
  }

  for (const { name, width, height, expect } of tiers) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await sleep(400)
    const actual = await page.evaluate(() => document.getElementById('app')?.dataset.appSize)
    check(`tier ${name} → ${expect}`, actual === expect, `got ${actual}`)
    await assertTierShape(expect)
    if (name === 'medium') {
      // medium 图标条悬停 tooltip（原人工清单项，脚本化）：悬停侧栏底部工具钮
      const footerButton = await page.$('[data-slot="sidebar-footer"] button')
      await footerButton?.hover()
      await sleep(700)
      const tooltip = await page.evaluate(() => {
        const el = document.querySelector('[role="tooltip"]')
        return el ? { text: el.textContent?.trim(), visible: el.getBoundingClientRect().width > 0 } : null
      })
      check('medium icon tooltip on hover', tooltip !== null && tooltip.visible && tooltip.text?.length > 0, JSON.stringify(tooltip))
    }
    if (name === 'compact') {
      // 窗控圆点 vs 头部按钮重叠（R2-b 修复证据，record 升格为硬断言）：
      // compact 头部右侧让位 78px 后必须零重叠（buttons 数组已过滤出
      // 发生重叠的钮，非空即负）。
      const overlap = await page.evaluate(() => {
        const toolbar = document.querySelector('#floating-toolbar')?.getBoundingClientRect()
        if (!toolbar) return null
        return {
          toolbar: { top: Math.round(toolbar.top), bottom: Math.round(toolbar.bottom), right: Math.round(toolbar.right) },
          buttons: [...document.querySelectorAll('#app header button')]
            .map(button => ({ label: button.getAttribute('aria-label'), rect: button.getBoundingClientRect() }))
            .map(({ label, rect }) => ({
              label,
              overlapX: Math.round(Math.max(0, Math.min(toolbar.right, rect.right) - Math.max(toolbar.left, rect.left))),
              overlapY: Math.round(Math.max(0, Math.min(toolbar.bottom, rect.bottom) - Math.max(toolbar.top, rect.top))),
            }))
            .filter(item => item.overlapX > 0 && item.overlapY > 0),
        }
      })
      check('compact window-dots vs header buttons: zero overlap', overlap !== null && overlap.buttons.length === 0, JSON.stringify(overlap))
      // compact 侧栏唤出（R2-a 回归守卫，观察项升格为硬断言）：sidebar 原语
      // useIsMobile 以视口 <768 切 Sheet 分支（消费 openMobile）——唤出钮
      // 走官方 toggleSidebar 后抽屉必须真正打开（R2-a 前此处恒 false）。
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('#app header button')]
          .find(button => (button.getAttribute('aria-label') ?? '').includes('侧栏'))
        button?.click()
      })
      await sleep(700)
      const summoned = await page.evaluate(() => {
        // 注意：ui/sidebar.tsx 传给 SheetContent 的 data-slot="sidebar" 会覆盖
        // sheet.tsx 内置的 data-slot="sheet-content"（props 展开在硬编码之后），
        // 移动端抽屉元素的正确选择器是 [data-sidebar="sidebar"][data-mobile="true"]。
        const sheet = document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]')
        const desktop = document.querySelector('[data-slot="sidebar-container"]')
        return {
          sheetOpened: Boolean(sheet && sheet.getBoundingClientRect().width > 0),
          desktopSidebarVisible: Boolean(desktop && desktop.getBoundingClientRect().width > 0),
        }
      })
      check('compact sidebar summon via header button', summoned.sheetOpened === true, JSON.stringify(summoned))
      await page.keyboard.press('Escape')
      await sleep(300)
    }
    await shot(page, `${name}-dark`)
  }

  // ---- fullscreen / minimized 三态（默认几何态，宽档）----
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
  await sleep(400)
  await page.click('#toggle-fullscreen')
  await sleep(500)
  const fullscreen = await page.evaluate(() => {
    const app = document.getElementById('app')
    const rect = app.getBoundingClientRect()
    return {
      isFullscreen: app.classList.contains('fullscreen'),
      insetOk: Math.abs(rect.left - 8) <= 2 && Math.abs(rect.top - 8) <= 2,
      fillsViewport: Math.abs(rect.width - (window.innerWidth - 16)) <= 2,
      handlesHidden: ['window-resize-handle', 'window-resize-handle-right', 'window-resize-handle-bottom']
        .every(id => getComputedStyle(document.getElementById(id)).display === 'none'),
      ariaPressed: document.getElementById('toggle-fullscreen')?.getAttribute('aria-pressed'),
    }
  })
  check('fullscreen state + inset 8px + handles hidden', fullscreen.isFullscreen && fullscreen.insetOk && fullscreen.fillsViewport && fullscreen.handlesHidden, JSON.stringify(fullscreen))
  await shot(page, 'wide-dark-fullscreen')
  await page.click('#toggle-fullscreen')
  await sleep(400)

  // minimized：笔记面板须随之卸载（Task 8 的 React 守卫接替 legacy 相邻兄弟规则）
  await page.click('#toggle-notes-panel')
  await sleep(600)
  check('notes panel opens inside shell tree', await page.evaluate(() =>
    document.getElementById('notes-panel') !== null && document.getElementById('app').nextElementSibling?.id === 'notes-panel'))
  await page.click('#close-window')
  await sleep(500)
  const minimized = await page.evaluate(() => ({
    minimizedClass: document.getElementById('app')?.classList.contains('minimized'),
    displayNone: getComputedStyle(document.getElementById('app')).display === 'none',
    launcherShown: document.getElementById('window-launcher')?.hidden === false,
    notesUnmounted: document.getElementById('notes-panel') === null,
    ariaExpanded: document.getElementById('toggle-window-size')?.getAttribute('aria-expanded'),
  }))
  check('minimized hides shell + unmounts notes panel', minimized.minimizedClass && minimized.displayNone && minimized.launcherShown && minimized.notesUnmounted, JSON.stringify(minimized))
  await shot(page, 'wide-dark-minimized')
  await page.click('#window-launcher')
  await sleep(600)
  const restored = await page.evaluate(() => ({
    minimizedGone: !document.getElementById('app')?.classList.contains('minimized'),
    notesBack: document.getElementById('notes-panel') !== null,
  }))
  check('launcher restores window + notes panel', restored.minimizedGone && restored.notesBack, JSON.stringify(restored))
  await page.click('#toggle-notes-panel')
  await sleep(400)

  // ---- 拖动后 resize 手柄对齐（T7 修复证据）----
  // 先 seed 持久几何再 reload：走 floatingWindow boot 恢复路径（transform 置 none），
  // 这正是 pre-T7 手柄锚到视口的触发条件。
  await page.evaluate(() => {
    localStorage.setItem('openteam.shellGeometry', JSON.stringify({ left: 120, top: 90, width: 1140, height: 760 }))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  const bootGeometry = await page.evaluate(() => {
    const rect = document.getElementById('app').getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  check('boot restores persisted geometry', Math.abs(bootGeometry.left - 120) <= 1 && Math.abs(bootGeometry.top - 90) <= 1
    && Math.abs(bootGeometry.width - 1140) <= 1 && Math.abs(bootGeometry.height - 760) <= 1, JSON.stringify(bootGeometry))
  const bootProbe = await alignmentProbe()
  check('boot restore strips #app transform', bootProbe.transform === 'none', bootProbe.transform)
  checkHandleAlignment('resize handles align after drag/restore (boot)', bootProbe)
  await shot(page, 'wide-dark-geometry-restored')

  async function centerOf(selector) {
    const box = await (await page.$(selector)).boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  async function dragBy(from, dx, dy, steps = 8) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let step = 1; step <= steps; step++) await page.mouse.move(from.x + (dx * step) / steps, from.y + (dy * step) / steps)
    await page.mouse.up()
  }
  // 真实双击序列（CDP clickCount 1→2）。实测 puppeteer 的
  // click({clickCount: 2})（单次 down/up）在 Chrome 下不派发 dblclick，
  // 必须按「单击 + 第二击」两段 clickCount 派发。
  async function dblClickAt(where) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: where.x, y: where.y })
    for (const count of [1, 2]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: where.x, y: where.y, button: 'left', clickCount: count })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: where.x, y: where.y, button: 'left', clickCount: count })
    }
  }

  // 真实指针拖动窗体（头部标题在 52px 拖拽区内）：拖后手柄须仍贴边
  await dragBy(await centerOf('#chat-title'), 90, 60)
  await sleep(400)
  const afterWindowDrag = await page.evaluate(() => {
    const rect = document.getElementById('app').getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  check('window drags via header drag zone', Math.abs(afterWindowDrag.left - 210) <= 2 && Math.abs(afterWindowDrag.top - 150) <= 2, JSON.stringify(afterWindowDrag))
  checkHandleAlignment('resize handles align after window drag', await alignmentProbe())

  // 三向拉伸：右缘 +70 宽 / 底缘 +60 高 / 右下角 +50×+40
  await dragBy(await centerOf('#window-resize-handle-right'), 70, 0)
  await sleep(250)
  await dragBy(await centerOf('#window-resize-handle-bottom'), 0, 60)
  await sleep(250)
  await dragBy(await centerOf('#window-resize-handle'), 50, 40)
  await sleep(500)
  const afterResize = await page.evaluate(() => {
    const rect = document.getElementById('app').getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  // 高度增大后 clampShellPosition 会把 top 上收以保持窗口在视口内（820/860 高时
  // maxY = 122/82），故只断言尺寸与下缘贴视口余量，不断言 top 原值。
  check('right/bottom/corner handles resize the window', Math.abs(afterResize.width - 1260) <= 3 && Math.abs(afterResize.height - 860) <= 3, JSON.stringify(afterResize))
  checkHandleAlignment('resize handles align after three-direction resize', await alignmentProbe())
  await shot(page, 'wide-dark-after-drag-resize')

  // 几何持久化（300ms 防抖）+ 重载恢复（人工清单「重开浮窗后几何恢复」的脚本替身）
  await sleep(600)
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('openteam.shellGeometry') ?? 'null'))
  check('drag-resize geometry persisted', persisted !== null
    && Math.abs(persisted.left - afterResize.left) <= 2 && Math.abs(persisted.top - afterResize.top) <= 2
    && Math.abs(persisted.width - afterResize.width) <= 2 && Math.abs(persisted.height - afterResize.height) <= 2,
  `${JSON.stringify(persisted)} vs live ${JSON.stringify(afterResize)}`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)
  const reopened = await page.evaluate(() => {
    const rect = document.getElementById('app').getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  })
  check('geometry restored after reopen (reload)', Math.abs(reopened.width - afterResize.width) <= 1 && Math.abs(reopened.height - afterResize.height) <= 1
    && Math.abs(reopened.left - afterResize.left) <= 1 && Math.abs(reopened.top - afterResize.top) <= 1, JSON.stringify(reopened))
  checkHandleAlignment('resize handles align after reopen', await alignmentProbe())

  // ---- 侧栏拖宽 200–320 钳制 / 刷新保持 / 双击回 240 ----
  await dragBy(await centerOf('.sidebar-resize-handle'), 150, 0)
  await sleep(400)
  const draggedWidth = await page.evaluate(() => ({
    gap: document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width,
    pref: JSON.parse(localStorage.getItem('openteam.sidebar') ?? 'null'),
  }))
  check('sidebar drag clamps to 320px', draggedWidth.gap !== undefined && Math.abs(draggedWidth.gap - 320) <= 2, JSON.stringify(draggedWidth))
  await shot(page, 'wide-dark-sidebar-resized')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)
  const keptWidth = await page.evaluate(() => document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width)
  check('sidebar width persists after reload', Math.abs(keptWidth - 320) <= 2, `got ${keptWidth}px`)
  await dblClickAt(await centerOf('.sidebar-resize-handle'))
  await sleep(400)
  const resetWidth = await page.evaluate(() => ({
    gap: document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width,
    pref: JSON.parse(localStorage.getItem('openteam.sidebar') ?? 'null'),
  }))
  check('sidebar double-click resets to 240px', Math.abs(resetWidth.gap - 240) <= 2 && resetWidth.pref?.width === 240, JSON.stringify(resetWidth))

  // ---- 浅色主题：写 localStorage['openteam.theme']='light' 后 reload，重复三档位 ----
  await page.evaluate(() => {
    localStorage.setItem('openteam.theme', 'light')
    localStorage.removeItem('openteam.shellGeometry')
    localStorage.removeItem('openteam.sidebar')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)
  check('theme light applied on <html>', await page.evaluate(() => document.documentElement.dataset.theme === 'light'))
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('light theme repaints body background', lightBackground !== themeProbe.bodyBackground, `dark ${themeProbe.bodyBackground} → light ${lightBackground}`)
  for (const { name, width, height, expect } of tiers) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await sleep(400)
    const actual = await page.evaluate(() => document.getElementById('app')?.dataset.appSize)
    check(`tier ${name} (light) → ${expect}`, actual === expect, `got ${actual}`)
    await assertTierShape(expect)
    await shot(page, `${name}-light`)
  }

  console.log('\n==== S1 acceptance summary ====')
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
