/*
 * 2026-09-28 UI 缺陷批次验收探针（用户报 6 条；④「弹窗公共化」归 S4，不在此）。
 * 覆盖：① 新建群聊点得开、② 恢复会话只有一个图标、③ 窗控三钮同族图标在
 * 右上角（顺序/尺寸/零重叠/全屏翻转/最小化恢复/z 序命中）、⑤ 成员与人员
 * 弹窗卡片文字与按钮 icon 对齐、⑥ 亮暗两主题文字对比度（含 dist 静态扫描：
 * 文字色不得再引用背景 token --muted）。
 * 加载 dist/ 扩展 → 注入种子 → 交互 + 截图 + 断言；断言失败 exitCode 3，
 * 控制台/页面报错 exitCode 2（与既有探针约定一致）。
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
  await page.screenshot({ path: path.join(outDir, `bugfix-${name}.png`) })
  console.log(`saved screenshots/bugfix-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/*
 * 对比度探针：把「元素自身不透明度 × 祖先累积不透明度」也计入——被测元素里
 * 有 opacity:0.48 的站点 pill，不折算会得到虚高的比值。
 * 文本色 over(自身背景 over 背后背景)，按 WCAG 相对亮度算比值。
 */
async function contrastProbe(page, selectors) {
  return page.evaluate(sels => {
    // shadcn token 取 oklch，Chrome 的 computed color 原样回 oklch()——
    // 只认 rgb 会把「token 取色」的元素全判成 missing（探针自身的坑）。
    function oklchToRgb(chroma, hue, lightness) {
      const h = (hue * Math.PI) / 180
      const a = chroma * Math.cos(h)
      const b = chroma * Math.sin(h)
      const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
      const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
      const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
      const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
      const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
      const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
      const encode = value => {
        const c = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055
        return Math.min(255, Math.max(0, Math.round(c * 255)))
      }
      return { r: encode(lr), g: encode(lg), b: encode(lb), a: 1 }
    }
    function parseColor(value) {
      if (!value) return null
      const rgb = value.match(/rgba?\(([^)]+)\)/)
      if (rgb) {
        const parts = rgb[1].split(/[,\s/]+/).filter(Boolean)
        const nums = parts.map(part => Number.parseFloat(part))
        if (nums.length < 3 || nums.slice(0, 3).some(Number.isNaN)) return null
        return { r: nums[0], g: nums[1], b: nums[2], a: nums.length > 3 && !Number.isNaN(nums[3]) ? nums[3] : 1 }
      }
      const oklch = value.match(/oklch\(([^)]+)\)/)
      if (oklch) {
        const parts = oklch[1].split(/[\s/]+/).filter(Boolean)
        if (parts.length < 3) return null
        const lightness = parts[0].includes('%') ? Number.parseFloat(parts[0]) / 100 : Number.parseFloat(parts[0])
        const chroma = Number.parseFloat(parts[1]) * (parts[1].includes('%') ? 0.004 : 1)
        const hue = Number.parseFloat(parts[2])
        const alpha = parts[3] !== undefined ? (parts[3].includes('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])) : 1
        if ([lightness, chroma, hue].some(Number.isNaN)) return null
        return { ...oklchToRgb(chroma, hue, lightness), a: alpha }
      }
      const srgb = value.match(/color\(srgb ([^)]+)\)/)
      if (srgb) {
        const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number)
        if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null
        return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts.length > 3 ? parts[3] : 1 }
      }
      return null
    }
    const parseRgb = parseColor
    function over(fg, bg) {
      const a = fg.a
      return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
    }
    function backdrop(el) {
      let node = el.parentElement
      let acc = null
      while (node) {
        const bg = parseRgb(getComputedStyle(node).backgroundColor)
        if (bg && bg.a > 0) {
          acc = acc === null ? bg : over(acc, bg)
          if (acc.a >= 0.999) return acc
        }
        node = node.parentElement
      }
      const pageBg = parseRgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }
      return acc === null ? pageBg : over(acc, pageBg)
    }
    function cumulativeOpacity(el) {
      let opacity = 1
      let node = el
      while (node && node !== document.documentElement) {
        opacity *= Number(getComputedStyle(node).opacity || 1)
        node = node.parentElement
      }
      return opacity
    }
    function luminance(c) {
      const channel = value => {
        const v = value / 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }
    return sels.map(sel => {
      const el = document.querySelector(sel)
      if (!el) return { sel, missing: true, reason: 'no element' }
      const style = getComputedStyle(el)
      const raw = parseRgb(style.color)
      if (!raw) return { sel, missing: true, reason: `unparsed color ${style.color}` }
      const back = backdrop(el)
      const ownBg = parseRgb(style.backgroundColor)
      const surface = ownBg && ownBg.a > 0 ? over(ownBg, back) : back
      const opacity = cumulativeOpacity(el)
      const text = over({ ...raw, a: raw.a * opacity }, surface)
      const l1 = luminance(text)
      const l2 = luminance(surface)
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      return {
        sel,
        ratio: Math.round(ratio * 100) / 100,
        color: style.color,
        bg: `rgb(${Math.round(surface.r)}, ${Math.round(surface.g)}, ${Math.round(surface.b)})`,
        opacity: Math.round(opacity * 100) / 100,
        text: (el.textContent ?? '').trim().slice(0, 10),
      }
    })
  }, selectors)
}

async function assertContrast(page, theme, selectors, min = 3) {
  const rows = await contrastProbe(page, selectors)
  for (const row of rows) {
    check(`⑥ ${theme} contrast ≥${min} for ${row.sel}`, row.missing !== true && row.ratio >= min, JSON.stringify(row))
  }
  return rows
}

// ---- 静态扫描：dist CSS 里不得再有「文字色 = 背景 token --muted」 ----------
const distCss = await readFile(path.join(dist, 'team.css'), 'utf8')
const textMutedHits = distCss.match(/(^|[^-])color:var\(--muted\)/g) ?? []
check('dist CSS: no text color references the --muted background token', textMutedHits.length === 0, `hits=${textMutedHits.length}`)
check('dist CSS: muted text now uses --muted-foreground', (distCss.match(/color:var\(--muted-foreground\)/g) ?? []).length >= 20,
  `count=${(distCss.match(/color:var\(--muted-foreground\)/g) ?? []).length}`)
const fullscreenVariant = distCss.match(/\.fullscreen \.\\\[\\\.fullscreen_\\&\\\]\\:block\{display:block\}/)
check('dist CSS: .fullscreen icon-swap variant generated', Boolean(fullscreenVariant))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-bugfix-'))
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
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
  page.on('console', message => {
    if (message.type() !== 'error') return
    const location = message.location()
    const url = location.url ?? ''
    // 只计本扩展自己的报错：种子群聊的站点 iframe 会拉各站点页面，第三方
    // 脚本（如 Cloudflare Turnstile）自身的 console.error 不算本仓回归
    if (url !== '' && !url.startsWith('chrome-extension://')) return
    consoleErrors.push(`${message.text()}  @${url}:${location.lineNumber ?? ''}`)
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })

  // 种子：1 个群聊 + 2 名成员 + 1 条消息 + 6 个自定义人员（人员库出分页）
  await page.evaluate(async () => {
    localStorage.setItem('openteam.theme', 'dark')
    const now = Date.now()
    const custom = index => ({
      id: `tpl-${index}`,
      type: 'custom',
      name: `自定义人员${index}`,
      description: `第 ${index} 号自定义人员描述`,
      systemPrompt: `你是自定义人员${index}。`,
      defaultChatSite: 'deepseek',
      category: index % 2 === 0 ? '技术研发' : '内容创作',
      createdAt: now - index * 1000,
      updatedAt: now - index * 1000,
    })
    const store = {
      version: 7,
      currentChatId: 'chat-seed-1',
      chatOrder: ['chat-seed-1'],
      chatsById: {
        'chat-seed-1': {
          id: 'chat-seed-1',
          name: '产品需求评审',
          mode: 'collaborative',
          roleIds: ['role-a', 'role-b'],
          messageIds: ['msg-1'],
          nextMessageSeq: 2,
          status: 'ready',
          createdAt: now - 86_400_000,
          updatedAt: now,
        },
      },
      rolesById: {
        'role-a': { id: 'role-a', chatId: 'chat-seed-1', name: '产品经理', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'deepseek', prompt: '你是一名资深产品经理。' },
        'role-b': { id: 'role-b', chatId: 'chat-seed-1', name: '工程师', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'chatgpt', prompt: '你是一名前端工程师。' },
      },
      messagesById: {
        'msg-1': { id: 'msg-1', chatId: 'chat-seed-1', seq: 1, type: 'user', content: '各位好，今天对齐一下 v2 的排期。', createdAt: now - 3_600_000, status: 'received' },
      },
      roleTemplateOrder: ['tpl-1', 'tpl-2', 'tpl-3', 'tpl-4', 'tpl-5', 'tpl-6'],
      roleTemplatesById: Object.fromEntries([1, 2, 3, 4, 5, 6].map(index => [`tpl-${index}`, custom(index)])),
    }
    await chrome.storage.local.set({ 'openteam.groupStore': store })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2500)

  const clickByLabel = async label => {
    const clicked = await page.evaluate(text => {
      const button = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === text)
      button?.click()
      return Boolean(button)
    }, label)
    if (!clicked) throw new Error(`button not found: ${label}`)
    await sleep(500)
  }

  // ---- ① 新建群聊：wide 档点开表单；图标条档先展开侧栏 ----
  const beforeCreate = await page.evaluate(() => document.getElementById('create-chat-form') !== null)
  check('① create-chat form starts unmounted', beforeCreate === false)
  await clickByLabel('新建群聊')
  const created = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === '新建群聊')
    return {
      form: document.getElementById('create-chat-form') !== null,
      expanded: trigger?.getAttribute('aria-expanded'),
      inputVisible: (() => {
        const input = document.querySelector('#create-chat-form input')
        return Boolean(input && input.getBoundingClientRect().width > 0)
      })(),
    }
  })
  check('① create-chat form mounts and is visible after click', created.form && created.inputVisible, JSON.stringify(created))
  check('① trigger reports aria-expanded=true', created.expanded === 'true', String(created.expanded))
  await shot(page, '01-quick-create-open')

  await clickByLabel('Toggle Sidebar')
  await clickByLabel('新建群聊')
  const railCreate = await page.evaluate(() => {
    const state = [...document.querySelectorAll('[data-state]')].map(node => node.getAttribute('data-state'))
    return { expanded: state.includes('expanded'), form: document.getElementById('create-chat-form') !== null }
  })
  check('① collapsed icon rail expands before opening the form', railCreate.expanded && railCreate.form, JSON.stringify(railCreate))

  // ---- ② 恢复会话：只应有一个 svg，无残留字形 ----
  const restore = await page.evaluate(() => {
    const button = document.getElementById('restore-chat')
    if (!button) return { missing: true }
    return {
      svgs: button.querySelectorAll('svg').length,
      text: (button.textContent ?? '').trim(),
      iconClass: button.querySelector('svg')?.getAttribute('class') ?? '',
    }
  })
  check('② restore-chat renders exactly one icon', restore.svgs === 1 && restore.text === '', JSON.stringify(restore))
  check('② restore-chat icon is a lucide glyph', (restore.iconClass ?? '').includes('lucide-'), restore.iconClass)

  // ---- ③ 窗控三钮：同族图标 / 右上角 / 顺序 / 尺寸 / 零重叠 ----
  const chrome = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#floating-toolbar > button')]
    const headerButtons = [...document.querySelectorAll('#app header button')].map(node => node.getBoundingClientRect())
    const rows = buttons.map(button => {
      const rect = button.getBoundingClientRect()
      const svgs = [...button.querySelectorAll('svg')]
      const visible = svgs.filter(svg => svg.getClientRects().length > 0)
      const icon = visible[0]?.getBoundingClientRect()
      return {
        id: button.id,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerY: Math.round(rect.top + rect.height / 2),
        iconCount: svgs.length,
        visibleIcons: visible.length,
        iconClass: visible[0]?.getAttribute('class') ?? '',
        iconWidth: icon ? Math.round(icon.width) : 0,
        offsetX: icon ? Math.round((icon.left + icon.width / 2) - (rect.left + rect.width / 2)) : null,
        offsetY: icon ? Math.round((icon.top + icon.height / 2) - (rect.top + rect.height / 2)) : null,
        overlapsHeader: headerButtons.some(other => {
          const overlapX = Math.min(rect.right, other.right) - Math.max(rect.left, other.left)
          const overlapY = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top)
          return overlapX > 0 && overlapY > 0
        }),
        inTopRight: rect.right > window.innerWidth - 140 && rect.top < 80,
      }
    })
    return rows
  })
  check('③ three window buttons in DOM order minimize → fullscreen → close',
    chrome.map(row => row.id).join(',') === 'toggle-window-size,toggle-fullscreen,close-window', chrome.map(row => row.id).join(','))
  check('③ all three are 24×24 ghost icon buttons', chrome.every(row => row.width === 24 && row.height === 24), JSON.stringify(chrome.map(row => `${row.width}×${row.height}`)))
  // 全屏钮常挂两枚 svg（maximize/minimize），靠 .fullscreen 祖先 variant 二选一
  // 显示——「恰好一枚可见且是 lucide」才是契约
  check('③ exactly one visible svg per button, all lucide family',
    chrome.every(row => row.visibleIcons === 1 && row.iconClass.includes('lucide-')), JSON.stringify(chrome.map(row => `${row.iconCount}/${row.visibleIcons}`)))
  check('③ icons are optically centred in their buttons (≤1px)',
    chrome.every(row => Math.abs(row.offsetX) <= 1 && Math.abs(row.offsetY) <= 1), JSON.stringify(chrome.map(row => `${row.offsetX},${row.offsetY}`)))
  check('③ icons share one size and one row', new Set(chrome.map(row => row.iconWidth)).size === 1 && new Set(chrome.map(row => row.centerY)).size === 1,
    `widths=${chrome.map(row => row.iconWidth)} centerY=${chrome.map(row => row.centerY)}`)
  check('③ chrome sits in the shell top-right corner', chrome.every(row => row.inTopRight), JSON.stringify(chrome.map(row => row.inTopRight)))
  check('③ zero overlap with header buttons (wide)', chrome.every(row => row.overlapsHeader === false))
  check('③ fullscreen button shows maximize-2 when windowed', chrome[1].iconClass.includes('lucide-maximize-2'), chrome[1].iconClass)
  await shot(page, '02-window-controls-dark')

  // ---- ③ 全屏：图标翻转为 minimize-2；退出后仍命中 ----
  await page.click('#toggle-fullscreen')
  await sleep(600)
  const fullscreen = await page.evaluate(() => {
    const button = document.getElementById('toggle-fullscreen')
    const visible = [...(button?.querySelectorAll('svg') ?? [])].filter(svg => svg.getClientRects().length > 0)
    return {
      isFullscreen: document.getElementById('app')?.classList.contains('fullscreen'),
      iconClass: visible[0]?.getAttribute('class') ?? '',
      ariaPressed: button?.getAttribute('aria-pressed'),
    }
  })
  check('③ fullscreen swaps the icon to minimize-2', fullscreen.isFullscreen && fullscreen.iconClass.includes('lucide-minimize-2') && fullscreen.ariaPressed === 'true', JSON.stringify(fullscreen))
  await shot(page, '03-window-controls-fullscreen-dark')
  await page.click('#toggle-fullscreen')
  await sleep(500)

  const closeHit = await page.evaluate(() => {
    const button = document.getElementById('close-window')
    if (!button) return { missing: true }
    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { hitsButton: Boolean(hit?.closest('#close-window')), tag: hit?.tagName ?? '' }
  })
  check('③ close button is the topmost element at its centre', closeHit.hitsButton === true, JSON.stringify(closeHit))

  // ---- ③ 最小化 → 启动器恢复 ----
  await page.click('#toggle-window-size')
  await sleep(600)
  const minimized = await page.evaluate(() => ({
    minimized: document.getElementById('app')?.classList.contains('minimized'),
    launcherShown: document.getElementById('window-launcher')?.hidden === false,
    ariaExpanded: document.getElementById('toggle-window-size')?.getAttribute('aria-expanded'),
  }))
  check('③ minimize hides the shell and shows the launcher', minimized.minimized && minimized.launcherShown && minimized.ariaExpanded === 'false', JSON.stringify(minimized))
  await page.click('#window-launcher')
  await sleep(800)
  check('③ launcher restores the window', await page.evaluate(() => document.getElementById('app')?.classList.contains('minimized') === false))

  // ---- ⑤ 人员库卡片：标题/元信息左缘对齐、动作按钮不叠 ----
  await clickByLabel('人员库')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(600)
  const cardAlignment = await page.evaluate(() => {
    const card = document.querySelector('#people-library-list .template-card')
    if (!card) return { missing: true }
    const rect = node => node?.getBoundingClientRect()
    const title = card.querySelector('.role-name')
    const meta = card.querySelector('[data-slot="card-content"] > div')
    const actions = [...card.querySelectorAll('[data-slot="card-action"] button')].map(rect)
    const titleRect = rect(title)
    const metaRect = rect(meta)
    const gaps = actions.slice(1).map((action, index) => Math.round(action.left - actions[index].right))
    return {
      titleLeft: Math.round(titleRect.left),
      metaLeft: Math.round(metaRect.left),
      cardLeft: Math.round(rect(card).left),
      actionCount: actions.length,
      gaps,
      actionCenters: actions.map(action => Math.round(action.top + action.height / 2)),
      titleCenter: Math.round(titleRect.top + titleRect.height / 2),
    }
  })
  check('⑤ card title and meta text share a left edge', Math.abs(cardAlignment.titleLeft - cardAlignment.metaLeft) <= 1,
    `title=${cardAlignment.titleLeft} meta=${cardAlignment.metaLeft} card=${cardAlignment.cardLeft}`)
  check('⑤ card action buttons do not overlap', cardAlignment.actionCount > 0 && cardAlignment.gaps.every(gap => gap >= 4), JSON.stringify(cardAlignment.gaps))
  check('⑤ card action row is vertically centred on the title', cardAlignment.actionCenters.every(center => Math.abs(center - cardAlignment.titleCenter) <= 12),
    `actions=${cardAlignment.actionCenters} title=${cardAlignment.titleCenter}`)
  await shot(page, '04-people-library-dark')
  await page.click('#close-people-library')
  await sleep(400)

  // ---- ⑤ 成员抽屉：动作按钮里的 svg 与按钮同心 ----
  await page.click('#toggle-people-drawer')
  await sleep(700)
  const roleIcons = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#role-panel .role-card-actions button, .role-card-actions button')]
    return buttons.map(button => {
      const rect = button.getBoundingClientRect()
      const svg = button.querySelector('svg')
      const icon = svg?.getBoundingClientRect()
      return {
        label: button.getAttribute('aria-label') ?? button.id,
        hasSvg: Boolean(svg),
        offsetX: icon ? Math.round((icon.left + icon.width / 2) - (rect.left + rect.width / 2)) : null,
        offsetY: icon ? Math.round((icon.top + icon.height / 2) - (rect.top + rect.height / 2)) : null,
      }
    })
  })
  check('⑤ role-card action buttons carry svg icons', roleIcons.length > 0 && roleIcons.every(row => row.hasSvg), `buttons=${roleIcons.length}`)
  check('⑤ role-card icons are centred in their buttons (≤1px)', roleIcons.every(row => Math.abs(row.offsetX) <= 1 && Math.abs(row.offsetY) <= 1),
    JSON.stringify(roleIcons.map(row => `${row.offsetX},${row.offsetY}`)))
  await shot(page, '05-role-drawer-dark')

  // ---- ⑤ 添加人员弹窗：checkbox 与站点 pill 垂直居中 ----
  await page.evaluate(() => document.getElementById('add-role-form')?.requestSubmit())
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(700)
  const rowAlignment = await page.evaluate(() => {
    const row = document.querySelector('#add-library-people-list .select-row')
    if (!row) return { missing: true }
    const rect = node => node.getBoundingClientRect()
    const rowRect = rect(row)
    const rowCenter = rowRect.top + rowRect.height / 2
    const centerOf = node => {
      const box = rect(node)
      return box.top + box.height / 2
    }
    const checkbox = rect(row.querySelector('input[type="checkbox"]'))
    const pills = [...row.querySelectorAll('.add-person-site-option')]
    return {
      checkboxHeight: Math.round(checkbox.height),
      checkboxWidth: Math.round(checkbox.width),
      // 行是 legacy .select-row 的 grid + align-items:center（三行文案 + 控件同排），
      // 契约是「控件居中于整行」而不是「居中于标题行」
      checkboxOffset: Math.round(centerOf(row.querySelector('input[type="checkbox"]')) - rowCenter),
      pillOffsets: pills.map(pill => Math.round(centerOf(pill) - rowCenter)),
    }
  })
  check('⑤ add-person checkbox is a 16px square (not stretched by legacy input rule)',
    rowAlignment.checkboxHeight === 16 && rowAlignment.checkboxWidth === 16, JSON.stringify(rowAlignment))
  check('⑤ add-person checkbox and site pills centre on the row (≤2px)',
    Math.abs(rowAlignment.checkboxOffset) <= 2 && rowAlignment.pillOffsets.every(offset => Math.abs(offset) <= 2), JSON.stringify(rowAlignment))
  // 暗色缺陷原状：.add-person-site-option 的 color 压掉 .site-pill-<站点> 的站别色，
  // 全部 pill 取到 --muted（背景 token）→ 深灰不可读。契约：带 add-person 类的
  // pill 与裸 .site-pill-<站点> 同色。
  const siteIdentity = await page.evaluate(() => {
    const pill = document.querySelector('#add-library-people-list .select-row .site-pill-chatgpt')
    if (!pill) return { missing: true }
    const probe = document.createElement('span')
    probe.className = 'site-pill site-pill-chatgpt'
    document.body.appendChild(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    return { actual: getComputedStyle(pill).color, expected }
  })
  check('⑤ add-person row keeps the per-site identity colour in dark mode',
    siteIdentity.actual === siteIdentity.expected, JSON.stringify(siteIdentity))
  await shot(page, '06-add-person-dark')

  // ---- ⑥ 文字对比度：暗色 ----
  await assertContrast(page, 'dark', ['#add-person-modal .select-row .template-description'])
  // 未选中 pill 是刻意的 opacity:.48 压暗态（选中态见下），阈值单列
  await assertContrast(page, 'dark (dimmed pill)', ['#add-person-modal .select-row .add-person-site-option'], 2)
  await page.keyboard.press('Escape')
  await sleep(400)

  await clickByLabel('添加大模型')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(500)
  // 裸 label 元素规则（legacy `label { color: … }`）——原先是死 token，表单标签两主题都不可读
  await assertContrast(page, 'dark', ['#external-model-form label'])
  await shot(page, '07-external-models-dark')
  await page.keyboard.press('Escape')
  await sleep(400)

  await clickByLabel('人员库')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(600)
  await assertContrast(page, 'dark', [
    '#people-library-list .template-card .role-name',
    '#people-library-list .template-card [data-slot="card-description"]',
    '#people-library-list .template-card [data-slot="card-content"] > div',
    '#people-library-pagination .pagination-label',
  ])
  await page.keyboard.press('Escape')

  // ---- ③⑤⑥ 浅色主题复拍 ----
  await page.evaluate(() => localStorage.setItem('openteam.theme', 'light'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2500)
  check('⑥ light theme applied', await page.evaluate(() => document.documentElement.dataset.theme === 'light'))
  await shot(page, '08-window-controls-light')

  await clickByLabel('人员库')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(600)
  await assertContrast(page, 'light', [
    '#people-library-list .template-card [data-slot="card-description"]',
    '#people-library-list .template-card [data-slot="card-content"] > div',
    '#people-library-pagination .pagination-label',
  ])
  await shot(page, '09-people-library-light')
  await page.keyboard.press('Escape')
  await sleep(400)

  await page.evaluate(() => document.getElementById('toggle-people-drawer')?.click())
  await sleep(600)
  await page.evaluate(() => document.getElementById('add-role-form')?.requestSubmit())
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(700)
  await assertContrast(page, 'light (selected pill)', ['#add-person-modal .select-row .add-person-site-option.active'])
  await assertContrast(page, 'light (dimmed pill)', ['#add-person-modal .select-row .add-person-site-option'], 2)
  await shot(page, '10-add-person-light')

  console.log('\n==== bugfix acceptance summary ====')
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
