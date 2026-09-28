/*
 * S2 工作区验收探针（Task 8，模板：screenshot-s1-acceptance.mjs）：
 * 消息流/气泡/Composer/提及面板/划选菜单/图片网格/侧栏搜索的 shadcn
 * new-york + zinc 迁移回归——
 * - 消息流容器（T3）：#messages 内 ScrollArea viewport（data-slot 钩子）、
 *   内容列 data-slot="messages-column" computed max-width 720px 且以
 *   viewport 内容盒（clientWidth，扣除滚动条）几何居中；
 * - 气泡（T4）：成员消息 bubble 背景 = --muted、圆角 10px（rounded-lg =
 *   --radius 0.625rem）；user 行 flex-direction: row-reverse 且 bubble
 *   背景 = --primary；长英文 token 在 break-words 下原位折行（record）；
 * - 回复状态行（T4）：thinking 行含 Spinner 原语（svg[role="status"]，无
 *   data-slot）与「正在回复」文案；stopped 行含「已停止回复」且无 spinner；
 * - Composer（T5）：#composer 圆角 10px；focus-within:ring-1 的 box-shadow
 *   含 --ring 色；#message-input 长文本自动增高且钳到 ≤160px；
 *   #composer-mention 点击插入 @ 并弹出 #mention-panel（含「所有人」，
 *   锚在 relative form 上方）；
 * - 划选菜单（T6）：页内 Range 选整段消息文本（addRange 触发原生
 *   selectionchange 结算，p3 验收已验证的写法；合成指针拖拽在 headless
 *   下 selection 恒 collapsed）后 .mark-menu 弹出（portal 到 body、fixed），
 *   圆角 8px（rounded-md）、背景 = --popover、色板 5 色、选中色钮的
 *   --tw-ring-offset-color 解析值 == popover 色（终审 I2 回归）——本组
 *   同时锁死 Task 8 验收发现的回归：空态与群聊态必须共用同一 ScrollArea
 *   元素，否则 store 异步到达重建 Viewport 后划选菜单整场失效；
 * - 图片网格（T6）：IndexedDB 预置真实 PNG 附件，.message-image-tile
 *   圆角 8px，blob objectURL 真实加载且全部 complete/naturalWidth>0；
 *   另种一张 400×2400 高长图（单图瓦片）断言渲染高度被 max-h-[520px]
 *   钳到 ≤520（终审 I1 的回归测试）；
 * - 侧栏搜索（T7）：搜索词过滤 [data-slot="sidebar-menu-item"] 数量，
 *   medium 档（768–1023 视口 → collapsible="icon"）图标条内 #chat-list
 *   不溢出（scrollWidth <= clientWidth）且条目齐全；
 * - 铬件 aria（S1 挂账）：#close-window 等六件 aria-label 为当前语言值，
 *   切英文（store settings.language + reload，与 s1 主题切换同机制）再断言；
 * - 最小化（S1 挂账）：#iframe-host 注入探针组标题（runtime 只在真实角色
 *   iframe 建立时生成组标题；被断言的是 globals.css 的
 *   body:has(#app.minimized) .chat-frame-group-title{display:none} 规则），
 *   最小化后无可见 .chat-frame-group-title。
 * s2-1..s2-7 的可视断言组在暗色与亮色各跑一遍（终审 I4①：I2 这类缺陷
 * 暗色可见、亮色不可见，脚本必须对两个主题都有灵敏度），断言标签带
 * (dark)/(light) 相位后缀；s2-0 为亮色主题生效 sanity。
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
  await page.screenshot({ path: path.join(outDir, `s2-${name}.png`) })
  console.log(`saved screenshots/s2-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-s2-'))
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

  // 种子：协作群聊（3 个 external 人员——external 不创建站点 iframe，探针免网）+
  // 五条消息（user / assistant 长文本+长 token / system / 带双图 / 停止前的提问）+
  // thinking 与 stopped 状态行 + IndexedDB 真实 PNG 附件 + dark 主题 + zh-CN。
  await page.evaluate(async () => {
    const now = Date.now()
    const chatId = 'chat-s2-1'
    const role = (id, name, status, extra = {}) => ({
      id,
      chatId,
      name,
      modelSource: 'external',
      status,
      contextCursor: 0,
      createdAt: now - 7_200_000,
      updatedAt: now - 60_000,
      ...extra,
    })
    const roles = {
      'role-s2-translator': role('role-s2-translator', '译员小王', 'ready'),
      'role-s2-researcher': role('role-s2-researcher', '研究员小李', 'thinking', { updatedAt: now }),
      'role-s2-reviewer': role('role-s2-reviewer', '评审老张', 'stopped', {
        lastPromptMessageId: 'msg-s2-5',
        updatedAt: now - 30_000,
      }),
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
    const longToken = 'WorkspaceAcceptanceRegressionToken'.repeat(6)
    const messages = {
      'msg-s2-1': message('msg-s2-1', {
        seq: 1,
        content: '大家好，今天我们过一遍新版工作台的视觉验收清单，请各位对照截图逐项确认。',
        createdAt: now - 32 * 60_000,
      }),
      'msg-s2-2': message('msg-s2-2', {
        seq: 2,
        type: 'assistant',
        roleId: 'role-s2-translator',
        roleName: '译员小王',
        content: [
          '这一版整体完成度不错，消息流居中、气泡配色与划选菜单都符合规范。',
          '',
          `再补一条长 token 的换行验证：${longToken} 后面的文字应当正常折行，而不是把气泡撑破。`,
        ].join('\n'),
        status: 'received',
        createdAt: now - 31 * 60_000,
      }),
      'msg-s2-3': message('msg-s2-3', {
        seq: 3,
        type: 'system',
        content: '已开启协作模式，人员共享群聊上下文。',
        createdAt: now - 30 * 60_000,
      }),
      'msg-s2-4': message('msg-s2-4', {
        seq: 4,
        content: '请大家看这两张截图，界面整体换成深色 zinc 风格。',
        mentionsAll: true,
        attachments: [
          { id: 'img-s2-1', type: 'image', status: 'ready', alt: '验收截图一', width: 320, height: 240, mimeType: 'image/png', fileName: 'acceptance-1.png' },
          { id: 'img-s2-2', type: 'image', status: 'ready', alt: '验收截图二', width: 320, height: 240, mimeType: 'image/png', fileName: 'acceptance-2.png' },
        ],
        createdAt: now - 12 * 60_000,
      }),
      'msg-s2-5': message('msg-s2-5', {
        seq: 5,
        content: '请评审上面的方案并给出结论。',
        createdAt: now - 11 * 60_000,
      }),
      // 单图高长图（400×2400）：终审 I1 的回归种子——max-h-[520px] 未生成时
      // 该瓦片会按原始比例渲染出上千像素高，撑爆消息流
      'msg-s2-6': message('msg-s2-6', {
        seq: 6,
        content: '这是单张高长图，用于验证高度上限。',
        attachments: [
          { id: 'img-s2-3', type: 'image', status: 'ready', alt: '高长图', width: 400, height: 2400, mimeType: 'image/png', fileName: 'tall.png' },
        ],
        createdAt: now - 10 * 60_000,
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
        chatOrder: [chatId, 'chat-s2-2', 'chat-s2-3'],
        chatsById: {
          [chatId]: chat(chatId, '产品方案讨论', {
            roleIds: Object.keys(roles),
            messageIds: Object.keys(messages),
            nextMessageSeq: 6,
          }),
          'chat-s2-2': chat('chat-s2-2', '翻译工作台', { mode: 'independent', updatedAt: now - 9 * 60_000 }),
          'chat-s2-3': chat('chat-s2-3', '闲聊小组', { updatedAt: now - 90 * 60_000 }),
        },
        rolesById: roles,
        messagesById: messages,
        orchestrationFlowsById: {},
        orchestrationRunsById: {},
        activeOrchestrationRunIdByChatId: {},
        settings: { language: 'zh-CN', externalModelOrder: [], externalModelsById: {} },
      },
    })

    // IndexedDB 预置两张真实 PNG（canvas 生成 → Blob → images store），
    // ImageGrid 的 imageCache 在挂载时按附件 id 取 objectURL。
    const openImageDb = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('openteam.imageAttachments', 1)
      request.addEventListener('upgradeneeded', () => {
        const database = request.result
        const store = database.objectStoreNames.contains('images')
          ? request.transaction.objectStore('images')
          : database.createObjectStore('images', { keyPath: 'id' })
        if (!store.indexNames.contains('chatId')) store.createIndex('chatId', 'chatId')
        if (!store.indexNames.contains('messageId')) store.createIndex('messageId', 'messageId')
      })
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => reject(request.error))
    })
    const canvasBlob = (width, height, paint) => new Promise(resolve => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      paint(canvas.getContext('2d'))
      canvas.toBlob(resolve, 'image/png')
    })
    const putRecord = (database, record) => new Promise((resolve, reject) => {
      const transaction = database.transaction('images', 'readwrite')
      transaction.objectStore('images').put(record)
      transaction.addEventListener('complete', () => resolve())
      transaction.addEventListener('abort', () => reject(transaction.error))
    })
    const database = await openImageDb()
    const blobs = [
      { messageId: 'msg-s2-4', width: 320, height: 240, fileName: 'acceptance-1.png', blob: await canvasBlob(320, 240, context => {
        const gradient = context.createLinearGradient(0, 0, 320, 240)
        gradient.addColorStop(0, '#18181b')
        gradient.addColorStop(1, '#3f3f46')
        context.fillStyle = gradient
        context.fillRect(0, 0, 320, 240)
        context.fillStyle = '#e4e4e7'
        context.font = '28px sans-serif'
        context.fillText('验收截图 1', 96, 128)
      }) },
      { messageId: 'msg-s2-4', width: 320, height: 240, fileName: 'acceptance-2.png', blob: await canvasBlob(320, 240, context => {
        context.fillStyle = '#27272a'
        context.fillRect(0, 0, 320, 240)
        context.fillStyle = '#a1a1aa'
        context.font = '28px sans-serif'
        context.fillText('验收截图 2', 96, 128)
      }) },
      // 高长图：真实 400×2400 PNG，单图瓦片（w-48）按原比例应 1152px 高，
      // 由 max-h-[520px] 钳到 520
      { messageId: 'msg-s2-6', width: 400, height: 2400, fileName: 'tall.png', blob: await canvasBlob(400, 2400, context => {
        const gradient = context.createLinearGradient(0, 0, 400, 2400)
        gradient.addColorStop(0, '#0f172a')
        gradient.addColorStop(1, '#475569')
        context.fillStyle = gradient
        context.fillRect(0, 0, 400, 2400)
        context.fillStyle = '#e2e8f0'
        context.font = '48px sans-serif'
        context.fillText('高长图', 130, 200)
      }) },
    ]
    for (const [index, entry] of blobs.entries()) {
      await putRecord(database, {
        id: `img-s2-${index + 1}`,
        chatId,
        messageId: entry.messageId,
        blob: entry.blob,
        mimeType: 'image/png',
        size: entry.blob.size,
        fileName: entry.fileName,
        createdAt: now,
      })
    }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  // 页内取色探针：直接比对 computed 值会撞上 oklch/rgba 序列化差异，
  // 用「同一元素里挂一个 var() 引用探针」让浏览器自己解析变量再比对。
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

  // ---- 组 s2-1：消息流容器（T3）----
  async function runFlowChecks(phase, screenshots) {
    const flow = await page.evaluate(() => {
      const section = document.getElementById('messages')
      const viewport = section?.querySelector('[data-slot="scroll-area-viewport"]')
      const column = section?.querySelector('[data-slot="messages-column"]')
      if (!section || !viewport || !column) return null
      const viewportRect = viewport.getBoundingClientRect()
      const columnRect = column.getBoundingClientRect()
      return {
        maxWidth: getComputedStyle(column).maxWidth,
        // 居中基准用内容盒（clientWidth 扣除经典滚动条），避免滚动条把
        // 几何中心挤偏造成假阴性
        viewportContentCenter: viewportRect.left + viewport.clientWidth / 2,
        columnCenter: columnRect.left + columnRect.width / 2,
        columnWidth: Math.round(columnRect.width),
      }
    })
    check(`s2-1 (${phase}) messages ScrollArea viewport + messages-column present`, flow !== null, JSON.stringify(flow))
    check(`s2-1 (${phase}) messages column max-width is 720px`, flow?.maxWidth === '720px', `computed max-width ${flow?.maxWidth}`)
    check(`s2-1 (${phase}) messages column horizontally centered in viewport`, flow !== null
      && Math.abs(flow.columnCenter - flow.viewportContentCenter) <= 2,
    `column center ${flow?.columnCenter?.toFixed(1)} vs viewport content center ${flow?.viewportContentCenter?.toFixed(1)}`)
    record(`s2-1 (${phase}) messages column measured width`, `${flow?.columnWidth}px`)
  }

  // ---- 组 s2-2：气泡（T4）----
  async function runBubbleChecks(phase) {
    const bubbles = await page.evaluate(`(() => {
      ${WITH_COLOR_HELPERS}
      const assistantBubble = document.querySelector('.message-row[data-message-id="msg-s2-2"] .message-bubble')
      const userRow = document.querySelector('.message-row.user[data-message-id="msg-s2-1"]')
      const userBubble = userRow?.querySelector('.message-bubble')
      return {
        assistantRadius: assistantBubble ? getComputedStyle(assistantBubble).borderRadius : null,
        assistantMuted: colorMatchesVar(assistantBubble, '--muted'),
        userDirection: userRow ? getComputedStyle(userRow).flexDirection : null,
        userRadius: userBubble ? getComputedStyle(userBubble).borderRadius : null,
        userPrimary: colorMatchesVar(userBubble, '--primary'),
      }
    })()`)
    check(`s2-2 (${phase}) member bubble bg muted + radius 10px`, bubbles?.assistantMuted === true && bubbles.assistantRadius === '10px',
      `radius ${bubbles?.assistantRadius} muted-match ${bubbles?.assistantMuted}`)
    check(`s2-2 (${phase}) user bubble bg primary + radius 10px`, bubbles?.userPrimary === true && bubbles.userRadius === '10px',
      `radius ${bubbles?.userRadius} primary-match ${bubbles?.userPrimary}`)
    check(`s2-2 (${phase}) user row right-aligned (flex-direction row-reverse)`, bubbles?.userDirection === 'row-reverse', bubbles?.userDirection)

    // T4 挂账确认（观察项，不作为门禁）：长英文 token 在 break-words 下应原位折行
    const longTokenProbe = await page.evaluate(() => {
      const body = document.querySelector('.message-row[data-message-id="msg-s2-2"] .message-body')
      if (!body) return null
      return {
        hasToken: body.textContent.includes('WorkspaceAcceptanceRegressionToken'),
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
      }
    })
    record(`T4 leftover (${phase}): long english token wrap under break-words`, longTokenProbe?.hasToken
      && longTokenProbe.scrollWidth <= longTokenProbe.clientWidth + 1
      ? `wrapped in place (scrollWidth ${longTokenProbe.scrollWidth} <= clientWidth ${longTokenProbe.clientWidth}；目检 screenshots/s2-workspace-wide-${phase}.png)`
      : `needs visual check — ${JSON.stringify(longTokenProbe)}`)
  }

  // ---- 组 s2-3：回复状态行（T4）----
  async function runStatusRowChecks(phase) {
    const statusRows = await page.evaluate(() => {
      const thinking = document.querySelector('.message-row.thinking')
      const stopped = document.querySelector('.message-row.stopped')
      return {
        thinkingPresent: Boolean(thinking),
        thinkingSpinner: Boolean(thinking?.querySelector('svg[role="status"]')),
        thinkingText: thinking?.textContent ?? '',
        stoppedPresent: Boolean(stopped),
        stoppedSpinner: Boolean(stopped?.querySelector('svg[role="status"]')),
        stoppedText: stopped?.textContent ?? '',
      }
    })
    check(`s2-3 (${phase}) thinking row has spinner primitive + replying text`,
      statusRows.thinkingPresent && statusRows.thinkingSpinner && statusRows.thinkingText.includes('正在回复'),
      JSON.stringify({ spinner: statusRows.thinkingSpinner, text: statusRows.thinkingText.slice(0, 40) }))
    check(`s2-3 (${phase}) stopped row has stopped text and no spinner`,
      statusRows.stoppedPresent && statusRows.stoppedText.includes('已停止回复') && !statusRows.stoppedSpinner,
      JSON.stringify({ spinner: statusRows.stoppedSpinner, text: statusRows.stoppedText.slice(0, 40) }))
  }

  // ---- 组 s2-6：带图消息图片网格（T6）+ 高长图高度上限（终审 I1 回归）----
  async function runImageChecks(phase, screenshots) {
    await page.waitForSelector('.message-row[data-message-id="msg-s2-4"] .message-image-tile img[src^="blob:"]', { timeout: 15_000 }).catch(() => {})
    await page.waitForSelector('.message-row[data-message-id="msg-s2-6"] .message-image-tile img[src^="blob:"]', { timeout: 15_000 }).catch(() => {})
    const imageGrid = await page.evaluate(() => {
      const grid = document.querySelector('.message-row[data-message-id="msg-s2-4"] .message-image-grid')
      const tiles = [...(grid?.querySelectorAll('.message-image-tile') ?? [])]
      const tallTile = document.querySelector('.message-row[data-message-id="msg-s2-6"] .message-image-tile')
      const tallImage = tallTile?.querySelector('img')
      const tallRect = tallImage?.getBoundingClientRect()
      return {
        gridPresent: Boolean(grid),
        tileCount: tiles.length,
        tileRadii: tiles.map(tile => getComputedStyle(tile).borderRadius),
        loaded: tiles.map(tile => {
          const image = tile.querySelector('img')
          return Boolean(image?.complete && image.naturalWidth > 0)
        }),
        tall: tallImage && tallRect ? {
          radius: getComputedStyle(tallTile).borderRadius,
          loaded: Boolean(tallImage.complete && tallImage.naturalWidth > 0),
          naturalWidth: tallImage.naturalWidth,
          naturalHeight: tallImage.naturalHeight,
          renderedWidth: Math.round(tallRect.width),
          renderedHeight: Math.round(tallRect.height),
          maxHeight: getComputedStyle(tallImage).maxHeight,
        } : null,
      }
    })
    check(`s2-6 (${phase}) message image grid renders both tiles`, imageGrid.gridPresent && imageGrid.tileCount === 2,
      JSON.stringify({ tiles: imageGrid.tileCount, loaded: imageGrid.loaded }))
    check(`s2-6 (${phase}) image tiles rounded to 8px`, imageGrid.tileRadii.length === 2 && imageGrid.tileRadii.every(radius => radius === '8px'),
      JSON.stringify(imageGrid.tileRadii))
    check(`s2-6 (${phase}) image objectURLs actually loaded`, imageGrid.loaded.length === 2 && imageGrid.loaded.every(Boolean),
      JSON.stringify(imageGrid.loaded))
    check(`s2-6 (${phase}) tall image (400x2400) clamped to max-height 520px`,
      imageGrid.tall?.loaded === true && imageGrid.tall.naturalHeight === 2400
      && imageGrid.tall.maxHeight === '520px' && imageGrid.tall.renderedHeight <= 520,
    JSON.stringify(imageGrid.tall))
    record(`s2-6 (${phase}) tall image measurements`, JSON.stringify(imageGrid.tall))
    if (screenshots) await shot(page, `workspace-wide-${phase}`)
  }

  // ---- 组 s2-7：侧栏搜索过滤 + medium 图标条（T7）----
  const countListItems = () => page.evaluate(() => document.querySelectorAll('#chat-list [data-slot="sidebar-menu-item"]').length)

  async function runSidebarChecks(phase, screenshots) {
    const unfilteredCount = await countListItems()
    check(`s2-7 (${phase}) chat list renders all seeded chats`, unfilteredCount === 3, `items ${unfilteredCount}`)
    await page.type('input[aria-label="搜索群聊"]', '产品')
    await sleep(300)
    const filtered = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#chat-list [data-slot="sidebar-menu-item"]')]
      return { count: items.length, firstText: items[0]?.textContent ?? '' }
    })
    check(`s2-7 (${phase}) search query filters chat list`, filtered.count === 1 && filtered.firstText.includes('产品方案讨论'),
      JSON.stringify(filtered))
    if (screenshots) await shot(page, `sidebar-search-filter-${phase}`)
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="搜索群聊"]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(300)
    const restoredCount = await countListItems()
    check(`s2-7 (${phase}) clearing query restores full list`, restoredCount === 3, `items ${restoredCount}`)

    await page.setViewport({ width: 900, height: 800, deviceScaleFactor: 1 })
    await sleep(600)
    const mediumStrip = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-slot="sidebar"]')
      const list = document.getElementById('chat-list')
      return {
        tier: document.getElementById('app')?.dataset.appSize,
        collapsedIcon: sidebar?.dataset.state === 'collapsed' && sidebar?.dataset.collapsible === 'icon',
        scrollWidth: list?.scrollWidth,
        clientWidth: list?.clientWidth,
        items: document.querySelectorAll('#chat-list [data-slot="sidebar-menu-item"]').length,
      }
    })
    check(`s2-7 (${phase}) medium tier icon strip list does not overflow`, mediumStrip.tier === 'medium' && mediumStrip.collapsedIcon
      && mediumStrip.scrollWidth <= mediumStrip.clientWidth,
    JSON.stringify(mediumStrip))
    check(`s2-7 (${phase}) medium tier keeps all list items`, mediumStrip.items === 3, `items ${mediumStrip.items}`)
    if (screenshots) await shot(page, `sidebar-medium-icon-strip-${phase}`)
    await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
    await sleep(600)
  }

  // ---- 组 s2-5：划选菜单（T6，页内 Range 选区）----
  // 不用 CDP 合成拖拽（mouseMoved 不带 buttons:1 时浏览器不会真扩选，
  // selection 恒 collapsed → useMarkMenu 直接 hide），也不派发合成
  // mousedown/pointerdown（真实 PointerEvent 语义缺失：clientY=0 会命中
  // floatingWindow 顶部拖拽热区并把 #app 卡在 dragging/user-select:none）。
  // 按 p3 验收已验证的写法：createRange + selectNodeContents 选整段文本
  // 节点——addRange 会触发浏览器原生 selectionchange，useMarkMenu 的
  // onSelectionChange 在非拖拽态据此 80ms 后结算出菜单。选中的文本必须
  // 能在 message.content 里 indexOf 到（useMarkMenu.ts 硬条件），整段
  // 文本节点即原文片段，最稳。
  async function runMarkMenuChecks(phase, screenshots) {
    const selectionProbe = await page.evaluate(() => {
      const body = document.querySelector('#messages .message-row[data-message-id="msg-s2-2"] .message-body')
      const target = body?.querySelector('p') ?? body
      // React 的 dangerouslySetInnerHTML 块之间可能有注释/空白文本节点，
      // firstChild 不一定是正文——遍历取第一个非空白文本节点
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
      let textNode
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.trim().length > 4) { textNode = node; break }
      }
      if (!textNode) throw new Error('no message text node for selection')
      const range = document.createRange()
      range.selectNodeContents(textNode)
      const selection = window.getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      return {
        selectedText: selection.toString().trim(),
        collapsed: selection.isCollapsed,
        chosenText: textNode.textContent.slice(0, 24),
      }
    })
    try {
      await page.waitForSelector('.mark-menu', { timeout: 5000 })
    } catch {
      // 断言在下方报出，这里吞掉超时以保留完整报告
    }
    const markMenu = await page.evaluate(`(() => {
      ${WITH_COLOR_HELPERS}
      const menu = document.querySelector('.mark-menu')
      if (!menu) return null
      const cs = getComputedStyle(menu)
      // 选中色钮的 ring-offset 解析色 vs 菜单 popover 底：ring-offset-popover
      // 未进 dist 时 @property 初值 #fff 兜底（暗色下露白圈）——终审 I2 回归。
      // 注意 v4 的 --tw-ring-* 是 @property { inherits: false }：不能挂子元素
      // 探针读（子元素永远见初值），必须读按钮自身的 computed 自定义属性；
      // 两侧颜色都过一遍 normalizeColor 消除 oklch/rgb 序列化差异。
      const normalizeColor = value => {
        if (!value) return null
        const probe = document.createElement('span')
        probe.style.display = 'none'
        probe.style.color = value
        document.body.append(probe)
        const normalized = getComputedStyle(probe).color
        probe.remove()
        return normalized
      }
      const selectedButton = menu.querySelector('.mark-color-btn[aria-pressed="true"]') ?? menu.querySelector('.mark-color-btn')
      const menuBackground = getComputedStyle(menu).backgroundColor
      const ringOffsetColor = selectedButton
        ? normalizeColor(getComputedStyle(selectedButton).getPropertyValue('--tw-ring-offset-color').trim())
        : null
      const popoverColor = normalizeColor(menuBackground)
      return {
        portalToBody: menu.parentElement === document.body,
        position: cs.position,
        radius: cs.borderRadius,
        popoverBg: colorMatchesVar(menu, '--popover'),
        menuBackground,
        colorCount: menu.querySelectorAll('.mark-color-btn').length,
        visible: menu.getBoundingClientRect().width > 0 && menu.getBoundingClientRect().height > 0,
        ringOffsetColor,
        popoverColor,
        ringOffsetMatchesPopover: ringOffsetColor !== null && ringOffsetColor === popoverColor,
        text: menu.textContent,
      }
    })()`)
    record(`s2-5 (${phase}) selected text for mark menu`, JSON.stringify(selectionProbe))
    check(`s2-5 (${phase}) mark menu appears on message text selection`, markMenu !== null && markMenu.visible === true,
      markMenu ? JSON.stringify(markMenu) : `selection produced no menu (selection ${JSON.stringify(selectionProbe)})`)
    check(`s2-5 (${phase}) mark menu popover visuals (portal body, fixed, radius 8px, bg popover)`,
      markMenu?.portalToBody === true && markMenu.position === 'fixed' && markMenu.radius === '8px' && markMenu.popoverBg === true,
      markMenu ? `position ${markMenu.position}, radius ${markMenu.radius}, popover-match ${markMenu.popoverBg}` : 'no menu')
    check(`s2-5 (${phase}) mark menu palette has five colors`, markMenu?.colorCount === 5, `colors ${markMenu?.colorCount}`)
    check(`s2-5 (${phase}) selected swatch ring-offset resolves to popover color`,
      markMenu?.ringOffsetMatchesPopover === true,
      markMenu ? `ring-offset ${markMenu.ringOffsetColor} vs popover ${markMenu.popoverColor} (raw ${markMenu.menuBackground})` : 'no menu')
    if (screenshots) await shot(page, `mark-menu-${phase}`)
    await page.keyboard.press('Escape')
    // 连同选区一起清掉：残留选区会在后续 selectionchange（如 focus textarea）时
    // 再次触发 80ms 结算，把菜单弹回来干扰 Composer 组与截图
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await sleep(200)
  }

  // ---- 组 s2-4：Composer（T5）----
  async function runComposerChecks(phase, screenshots) {
    const composerRadius = await page.evaluate(() => {
      const form = document.getElementById('composer')
      return form ? getComputedStyle(form).borderRadius : null
    })
    check(`s2-4 (${phase}) composer card radius 10px`, composerRadius === '10px', `computed ${composerRadius}`)

    await page.focus('#message-input')
    await sleep(200)
    const focusRing = await page.evaluate(() => {
      const form = document.getElementById('composer')
      const cs = getComputedStyle(form)
      const shadowHasColor = (shadow, color) => {
        if (!shadow || shadow === 'none' || !color) return false
        if (shadow.includes(color)) return true
        // 兜底：让浏览器把同一颜色规范化（oklch/rgba 序列化差异）后比对
        const probe = document.createElement('span')
        probe.style.display = 'none'
        probe.style.boxShadow = `0px 0px 0px 1px ${color}`
        document.body.append(probe)
        const normalized = getComputedStyle(probe).boxShadow
        probe.remove()
        const probeColor = normalized.replace(/-?[\d.]+px/g, '').trim()
        return probeColor.length > 0 && shadow.includes(probeColor)
      }
      return {
        focusWithin: form.matches(':focus-within'),
        shadow: cs.boxShadow,
        ringColorHit: shadowHasColor(cs.boxShadow, cs.getPropertyValue('--ring').trim()),
      }
    })
    check(`s2-4 (${phase}) composer focus ring uses ring color`, focusRing.focusWithin && focusRing.shadow !== 'none' && focusRing.ringColorHit,
      `focus-within ${focusRing.focusWithin}, shadow ${focusRing.shadow}`)

    const heightBefore = await page.evaluate(() => document.getElementById('message-input').style.height)
    await page.evaluate(() => {
      const input = document.getElementById('message-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '这是一段用于验证输入区自动增高的长文本。\n'.repeat(12))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(300)
    const autosize = await page.evaluate(() => {
      const input = document.getElementById('message-input')
      return { height: input.style.height, scrollHeight: input.scrollHeight }
    })
    const parsedBefore = parseFloat(heightBefore)
    const parsedAfter = parseFloat(autosize.height)
    check(`s2-4 (${phase}) composer autosize grows and clamps at 160px`,
      Number.isFinite(parsedAfter) && parsedAfter > parsedBefore && parsedAfter <= 160 && autosize.scrollHeight >= parsedAfter,
      `style.height ${heightBefore} → ${autosize.height} (scrollHeight ${autosize.scrollHeight})`)
    if (screenshots) await shot(page, `composer-autosize-${phase}`)

    await page.evaluate(() => {
      const input = document.getElementById('message-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(200)
    await page.click('#composer-mention')
    await sleep(300)
    const mentionPanel = await page.evaluate(() => {
      const panel = document.getElementById('mention-panel')
      const form = document.getElementById('composer')
      if (!panel || !form) return null
      const panelRect = panel.getBoundingClientRect()
      const formRect = form.getBoundingClientRect()
      return {
        visible: panelRect.width > 0 && panelRect.height > 0 && getComputedStyle(panel).visibility === 'visible',
        hasAllMembers: panel.textContent.includes('所有人'),
        optionCount: panel.querySelectorAll('.mention-option').length,
        aboveForm: panelRect.bottom <= formRect.top + 1,
      }
    })
    check(`s2-4 (${phase}) mention button opens panel with all-members option`,
      mentionPanel?.visible === true && mentionPanel.hasAllMembers === true && mentionPanel.optionCount >= 1,
      JSON.stringify(mentionPanel))
    check(`s2-4 (${phase}) mention panel anchors above composer form`, mentionPanel?.aboveForm === true,
      `panel bottom ${mentionPanel ? 'above' : 'missing'} form top`)
    if (screenshots) await shot(page, `composer-mention-panel-${phase}`)
    await page.keyboard.press('Escape')
    await page.evaluate(() => {
      const input = document.getElementById('message-input')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  /*
   * 可视断言组（s2-1..s2-7）整体封装：暗色与亮色各跑一遍。
   * 亮色段是终审 I4① 的灵敏度补丁——I2 这类「暗色露白圈」的缺陷在亮色
   * 下不可见，脚本必须对两个主题都有断言覆盖（对照 s1 脚本的浅色 × 三档）。
   */
  async function runWorkspaceVisuals(phase, { screenshots = true } = {}) {
    await runFlowChecks(phase, screenshots)
    await runBubbleChecks(phase)
    await runStatusRowChecks(phase)
    await runImageChecks(phase, screenshots)
    await runSidebarChecks(phase, screenshots)
    await runMarkMenuChecks(phase, screenshots)
    await runComposerChecks(phase, screenshots)
  }

  await runWorkspaceVisuals('dark')
  const darkBodyBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  // ---- 组 s2-8：铬件 aria 双语言（S1 挂账：aria 运行时翻译）----
  const chromeButtonIds = ['close-window', 'toggle-window-size', 'toggle-fullscreen', 'window-resize-handle', 'window-resize-handle-right', 'window-resize-handle-bottom']
  const readAriaLabels = () => page.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.getAttribute('aria-label')])), chromeButtonIds)
  const zhLabels = await readAriaLabels()
  check('s2-8 (zh-CN) chrome aria labels', JSON.stringify(zhLabels) === JSON.stringify({
    'close-window': '关闭窗口',
    'toggle-window-size': '缩小窗口',
    'toggle-fullscreen': '全屏窗口',
    'window-resize-handle': '调整窗口大小',
    'window-resize-handle-right': '调整窗口宽度',
    'window-resize-handle-bottom': '调整窗口高度',
  }), JSON.stringify(zhLabels))

  // ---- 亮色段（终审 I4①）：主题切浅色后复跑 s2-1..s2-7 的可视断言 ----
  // I2 这类「暗色露白圈 / 亮色看不出」的缺陷必须让脚本对两个主题都有灵敏度
  // （对照 s1 脚本的「浅色 × 三档」结构；语言仍为 zh-CN，断言文案不变）。
  await page.evaluate(() => localStorage.setItem('openteam.theme', 'light'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)
  const lightThemeProbe = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  }))
  check('s2-0 (light) theme light applied on <html>', lightThemeProbe.theme === 'light', JSON.stringify(lightThemeProbe))
  check('s2-0 (light) theme repaints body background', lightThemeProbe.bodyBackground !== darkBodyBackground,
    `dark ${darkBodyBackground} → light ${lightThemeProbe.bodyBackground}`)
  await runWorkspaceVisuals('light')

  // 语言切换与 s1 主题切换同机制：读回原 store 只改 settings.language 后
  // reload（useT 从 store 读语言，FloatingWindowChrome 的 aria-label 随重渲
  // 翻译）。首次 boot 后 saveStore 已把种子从 legacy 'openteam.groupStore' 迁到分片
  // 'openteam.meta.v2'（settings 在 meta 里），两处都改以覆盖两种布局，绝不
  // 整份重写覆盖运行期数据。同批把主题切回 dark（s2-9 截图沿用暗色壳）。
  const languageStorageProbe = await page.evaluate(async () => {
    localStorage.setItem('openteam.theme', 'dark')
    const LEGACY_KEY = 'openteam.groupStore'
    const META_KEY = 'openteam.meta.v2'
    const stored = await chrome.storage.local.get([LEGACY_KEY, META_KEY])
    const updated = {}
    for (const key of [LEGACY_KEY, META_KEY]) {
      const payload = stored[key]
      if (!payload) continue
      payload.settings = { ...payload.settings, language: 'en' }
      updated[key] = payload
    }
    if (Object.keys(updated).length > 0) await chrome.storage.local.set(updated)
    return { keys: Object.keys(updated), legacyPresent: Boolean(stored[LEGACY_KEY]), metaPresent: Boolean(stored[META_KEY]) }
  })
  record('s2-8 language switch storage keys', JSON.stringify(languageStorageProbe))
  check('s2-8 language persisted to storage before reload', Object.keys(languageStorageProbe.keys).length > 0,
    JSON.stringify(languageStorageProbe))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)
  const enLabels = await readAriaLabels()
  check('s2-8 (en) chrome aria labels', JSON.stringify(enLabels) === JSON.stringify({
    'close-window': 'Close window',
    'toggle-window-size': 'Minimize window',
    'toggle-fullscreen': 'Fullscreen window',
    'window-resize-handle': 'Resize window',
    'window-resize-handle-right': 'Resize width',
    'window-resize-handle-bottom': 'Resize height',
  }), JSON.stringify(enLabels))
  await shot(page, 'chrome-english')

  // ---- 组 s2-9：最小化无组标题残影（S1 挂账）----
  // runtime 只在真实角色 iframe 建立时生成组标题（external 人员不建 iframe），
  // 这里注入探针组标题以驱动被断言的 globals.css 规则：
  // body:has(#app.minimized) .chat-frame-group-title { display: none }
  await page.evaluate(() => {
    const host = document.getElementById('iframe-host')
    const group = document.createElement('section')
    group.className = 'chat-frame-group'
    group.dataset.chatFrameGroup = 'true'
    group.dataset.chatId = 'chat-s2-1'
    const title = document.createElement('div')
    title.className = 'chat-frame-group-title'
    title.textContent = '产品方案讨论'
    group.append(title)
    host.append(group)
  })
  const titleBefore = await page.evaluate(() => {
    const title = document.querySelector('#iframe-host .chat-frame-group-title')
    if (!title) return null
    const rect = title.getBoundingClientRect()
    return { display: getComputedStyle(title).display, visible: rect.width > 0 && rect.height > 0 }
  })
  check('s2-9 group title visible before minimize (probe sanity)', titleBefore?.display !== 'none' && titleBefore?.visible === true,
    JSON.stringify(titleBefore))
  await page.click('#close-window')
  await sleep(500)
  const minimized = await page.evaluate(() => {
    const app = document.getElementById('app')
    const titles = [...document.querySelectorAll('#iframe-host .chat-frame-group-title')]
    return {
      minimizedClass: app?.classList.contains('minimized'),
      titleCount: titles.length,
      hiddenTitles: titles.filter(title => getComputedStyle(title).display === 'none').length,
    }
  })
  check('s2-9 minimized hides #iframe-host group titles',
    minimized.minimizedClass === true && minimized.titleCount > 0 && minimized.hiddenTitles === minimized.titleCount,
    JSON.stringify(minimized))
  await shot(page, 'minimized-dark')
  await page.click('#window-launcher')
  await sleep(600)

  console.log('\n==== S2 acceptance summary ====')
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
