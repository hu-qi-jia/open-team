/*
 * S4 弹窗统一验收探针（AppModal 公共壳 + 人员库 5 弹窗 + 外部模型 + 提示词详情）。
 *
 * 断言组：
 *   s4-1  六个弹窗（+提示词详情）的宽度令牌 / 视口居中 / 圆角 / 背景 token / 沟槽
 *   s4-1b 正文内边距不塌（jsdom 抓不到，只有真布局能测）
 *   s4-2  高度策略（人员库 fixed 定高、外部模型 auto 封顶 + 内部可滚）
 *   s4-3  关闭钮（恰好一个 svg / 无 × 文本节点 / aria-label 译文 / 点击即关）
 *   s4-4  打开聚焦 + F1「打开瞬间不得被聚焦带滚」（N=12 才抓得到）
 *   s4-5  叠层语义：Escape 与背板点击逐层关闭
 *   s4-6  添加人员行几何回归（与 bugfix 探针同口径）
 *   s4-7  人员库卡片对齐回归（同口径）
 *   s4-8  亮/暗双主题对比度（含新增表面）
 *   s4-9  legacy 审计：(a) 规则零命中 / (b) 共享族存活 / (c) 钩子类仍在 TSX
 *         / (d) dist 里新写 utilities 存在（含 ${ 复检与变体形式）
 *   s4-10 uiBus 消费者审计（emit 必有对应 on）
 *
 * 判据纪律：与 bugfix 探针一致——断言失败 exitCode 3，控制台/页面报错 exitCode 2。
 * 加载 dist/ 扩展 → 注入种子 → 交互 + 截图 + 断言。
 *
 * 种子纪律（踩过的坑）：同一 profile 里跑第二趟起，必须先
 * chrome.storage.local.clear() 再写 openteam.groupStore ——
 * src/group/store.ts 的 loadStore() 一旦发现 openteam.meta.v2 就直接返回，
 * 根本不读 groupStore（症状：无论种几个外部模型都只有 2 张卡）。
 */
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'screenshots')
await mkdir(outDir, { recursive: true })

const failures = []
const groupStats = new Map()
function groupOf(label) {
  const match = label.match(/^(s4-\d+b?)/)
  return match ? match[1] : 'other'
}
function check(label, ok, detail = '') {
  const group = groupOf(label)
  const stats = groupStats.get(group) ?? { pass: 0, fail: 0 }
  stats[ok ? 'pass' : 'fail'] += 1
  groupStats.set(group, stats)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
function info(label, detail) {
  console.log(`INFO  ${label} — ${detail}`)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `s4-${name}.png`) })
  console.log(`saved screenshots/s4-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// 静态工具（s4-9 / s4-10）：读 src 与 dist，不依赖浏览器
// ---------------------------------------------------------------------------
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}
function countOccurrences(haystack, needle) {
  let count = 0
  let from = 0
  while (true) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    count += 1
    from = at + needle.length
  }
  return count
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
/** 选择器口径：类名必须是独立 token（前导 . 之后不得紧跟单词字符），
 *  允许 `.template-card.active`（后跟 `.`）与 `.role-row, .template-actions {`
 *  （前有空格）——brief 明确警告「不要锚定行首 ^」。 */
function hasSelectorToken(css, classNameWithoutDot) {
  const re = new RegExp(`(^|[,\\s>+~({\\[])${escapeRegExp(`.${classNameWithoutDot}`)}($|[,\\s>+~){\\[:.])`, 'm')
  return re.test(css)
}
/** className 属性值（含 `{...}` 表达式，支持模板串）——用于「类名有消费者」的精确搜索。 */
function classNameContexts(source) {
  const out = []
  let from = 0
  while (true) {
    const at = source.indexOf('className=', from)
    if (at === -1) break
    let i = at + 'className='.length
    const ch = source[i]
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1)
      out.push(source.slice(i + 1, end === -1 ? source.length : end))
      from = end === -1 ? source.length : end + 1
      continue
    }
    if (ch === '{') {
      let depth = 0
      let j = i
      while (j < source.length) {
        const c = source[j]
        if (c === '"' || c === "'" || c === '`') {
          const quote = c
          j += 1
          while (j < source.length) {
            if (source[j] === '\\') { j += 2; continue }
            if (source[j] === quote) break
            j += 1
          }
          j += 1
          continue
        }
        if (c === '{') depth += 1
        else if (c === '}') {
          depth -= 1
          if (depth === 0) break
        }
        j += 1
      }
      out.push(source.slice(i, j + 1))
      from = j + 1
      continue
    }
    out.push(source.slice(i, i + 120))
    from = i + 1
  }
  return out
}
function hasClassToken(text, className) {
  const re = new RegExp(`(^|[\\s"'\`{}])${escapeRegExp(className)}($|[\\s"'\`{}$])`)
  return re.test(text)
}
function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walkFiles(full, out)
    else out.push(full)
  }
  return out
}

// ---- s4-9 (a)(b)：legacy.css 规则审计 --------------------------------------
const legacyCss = stripCssComments(readFileSync(path.join(root, 'src/teamPage/ui/styles/legacy.css'), 'utf8'))

// (a) 本阶段迁移的弹窗族：规则必须零命中。
//     注意用「带点的精确选择器」：`template-category-` 裸串会命中 9 处
//     `.group-template-category-filter`（S5 族，必须存活）+ 1 注释 = 假红。
// 值形如 `.name`（带前导点）——对 `-*` 家族即等价的「带点精确选择器」：
// `.template-category-filter` 不会命中 `.group-template-category-filter`（S5 族，必须存活）。
const RETIRED_SELECTORS = [
  'template-editor-modal', 'modal-card', 'modal-grid', 'modal-header-actions',
  'add-person-toolbar', 'add-person-site-control', 'select-list', 'select-row',
  'select-row-content', 'template-description', 'template-detail-modal',
  'template-prompt-preview', 'pagination-', 'people-library-', 'template-type-',
  'template-category-filter', 'template-category-chip', 'site-segment',
  'ai-persona-panel', 'template-ai-actions', 'role-form',
]
for (const name of RETIRED_SELECTORS) {
  const hits = countOccurrences(legacyCss, `.${name}`)
  check(`s4-9 (a) legacy.css has no .${name} rule`, hits === 0, `hits=${hits}`)
}
// 简报 (a) 清单里的同一族（裸串形态，注释里出现过、规则里必须没有）
{
  const hits = countOccurrences(legacyCss, '#d4d4d8-role-form')
  check('s4-9 (a) legacy.css has no #d4d4d8-role-form rule', hits === 0, `hits=${hits}`)
}

// (b) 共享族：S7/T5 起全部 utilities 化，断言从「仍在」翻转为「归零」
//     （原「T5 还要用」的前提已失效——本轮就是最后一批共享族）。
//     S7/T4 已把 .template-card / .template-list 移出本清单（归零断言在
//     s5-9 (b) 的 RETIRED_S7_T4）。
const RETIRED_S7_T5_SHARED = ['field', 'template-actions', 'tiny', 'section-title', 'reference-box', 'modal-form', 'muted', 'two-col', 'role-name', 'role-row', 'role-site-control', 'message-name-text', 'message-tools', 'orchestration-review-summary', 'orchestration-review-line']
for (const name of RETIRED_S7_T5_SHARED) {
  const present = hasSelectorToken(legacyCss, name)
  check(`s4-9 (b) legacy.css no longer owns .${name} after S7/T5`, !present, `selector-token=${present}`)
}
// S7/T3 补账：.note-* 九族退役后全前缀归零（原「S5/S6 还要用」前提失效，
// T3 漏同步本探针，T4 一并修正）。
{
  const note = countOccurrences(legacyCss, '.note-')
  check('s4-9 (b) legacy.css has zero .note-* occurrences after S7/T3 (comments stripped)', note === 0, `hits=${note}`)
}
for (const prefix of ['orchestration-']) {
  // S7/T5：.orchestration-review-summary / -review-line 最后两条随 MessageItem
  // utilities 化退役，legacy 里的 .orchestration-* 规则清零（类名保留作钩子）。
  const hits = countOccurrences(legacyCss, `.${prefix}`)
  check(`s4-9 (b) legacy.css has zero .${prefix}* rules after S7/T5`, hits === 0, `hits=${hits}`)
}

// (c) 保留类名的钩子仍出现在 TSX 里（剥注释后按 className 值精确搜）。
const srcFiles = walkFiles(path.join(root, 'src'))
const tsxFiles = srcFiles.filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
const tsxWithCommentsStripped = new Map()
for (const file of tsxFiles) {
  tsxWithCommentsStripped.set(file, stripCssComments(readFileSync(file, 'utf8')))
}
function classNameConsumers(className) {
  const hits = []
  for (const [file, text] of tsxWithCommentsStripped) {
    if (classNameContexts(text).some(context => hasClassToken(context, className))) {
      hits.push(path.relative(root, file).replace(/\\/g, '/'))
    }
  }
  return hits
}
const HOOK_CLASSES = ['select-row', 'template-prompt-preview', 'template-description', 'template-type-tab', 'template-category-chip', 'add-person-site-option', 'pagination-label', 'pagination-btn']
for (const name of HOOK_CLASSES) {
  const hits = classNameConsumers(name)
  check(`s4-9 (c) className consumer still present for .${name}`, hits.length > 0, `files=${hits.join(' | ') || 'none'}`)
}
// F3 口径：.template-editor-modal 只断「legacy.css 零命中 + 无 className= 消费者」，
// 不断「src 里搜不到裸串」——契约用例必须写出该名字，裸串必然有命中。
const editorModalConsumers = classNameConsumers('template-editor-modal')
check('s4-9 (c) no className= consumer for .template-editor-modal', editorModalConsumers.length === 0,
  `files=${editorModalConsumers.join(' | ') || 'none'}`)

// (d) dist 里新写的 utilities 存在（紧贴 ${ 复检）。
const distCss = readFileSync(path.join(dist, 'team.css'), 'utf8')
// 形状类（不是钩子类名）：钩子类名无规则时本来就不会出现在产物里。
for (const needle of ['min-h-\\[34px\\]', 'min-h-7', 'rounded-full', 'text-\\[11px\\]', 'font-\\[760\\]']) {
  const hits = countOccurrences(distCss, needle)
  check(`s4-9 (d) dist/team.css contains utility ${needle}`, hits > 0, `hits=${hits}`)
}
// add-person-site-option 是钩子类（规则在手写 globals.css，不走扫描器）——
// 查钩子规则存在，不断言它的 utility 被生成。
for (const needle of ['.add-person-site-option{', '.add-person-site-option.active', '.add-person-site-option.disabled']) {
  const hits = countOccurrences(distCss, needle)
  check(`s4-9 (d) dist/team.css keeps hook rule ${needle}`, hits > 0, `hits=${hits}`)
}
// 变体形式：裸 `.inset-ring-1 {` 独立出现 0 次（只有 has-checked: 变体被生成）。
const insetRingVariant = countOccurrences(distCss, 'has-checked\\:inset-ring-1')
const insetRingBare = countOccurrences(distCss, '.inset-ring-1{') + countOccurrences(distCss, '.inset-ring-1 {')
check('s4-9 (d) inset ring survives in variant form (has-checked:)', insetRingVariant > 0, `variant=${insetRingVariant} bare=${insetRingBare}`)

// ---- s4-10 uiBus 消费者审计 ------------------------------------------------
const UI_BUS_EXPECTED = [
  'close-create-chat-popover', 'open-add-person', 'open-all-notes', 'open-builtin-template-detail',
  'open-external-models', 'open-group-template-create', 'open-orchestration', 'open-people-library',
  'open-person-template-edit', 'open-temporary-person',
]
const productionFiles = srcFiles.filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file))
const emits = new Map()
const ons = new Map()
for (const file of productionFiles) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/uiBus\.emit\(\s*'([^']+)'/g)) {
    emits.set(match[1], (emits.get(match[1]) ?? 0) + 1)
  }
  for (const match of text.matchAll(/uiBus\.on\(\s*'([^']+)'/g)) {
    ons.set(match[1], (ons.get(match[1]) ?? 0) + 1)
  }
}
const emitNames = [...emits.keys()].sort()
const onNames = [...ons.keys()].sort()
info('s4-10 emits', JSON.stringify(emitNames))
info('s4-10 ons', JSON.stringify(onNames))
const orphans = emitNames.filter(name => !ons.has(name))
check('s4-10 every uiBus.emit has a matching uiBus.on consumer', orphans.length === 0, `orphans=${JSON.stringify(orphans)}`)
const deadSubscriptions = onNames.filter(name => !emits.has(name))
check('s4-10 no uiBus.on without a producer', deadSubscriptions.length === 0, `dead=${JSON.stringify(deadSubscriptions)}`)
check('s4-10 command set is exactly the 10 documented names',
  JSON.stringify(emitNames) === JSON.stringify([...UI_BUS_EXPECTED].sort()) && JSON.stringify(onNames) === JSON.stringify([...UI_BUS_EXPECTED].sort()),
  `emits=${JSON.stringify(emitNames)} ons=${JSON.stringify(onNames)}`)
// 联合类型 UiCommand 与 emit 集合一致（文档纪律）
const uiBusSource = readFileSync(path.join(root, 'src/teamPage/ui/lib/uiBus.ts'), 'utf8')
// 行尾是 CRLF（Windows 检出），别用 '\n\n' 找块尾
const unionStart = uiBusSource.indexOf('export type UiCommand =')
const unionEnd = unionStart === -1 ? -1 : uiBusSource.slice(unionStart).search(/\r?\n\r?\n/)
const unionBlock = unionStart === -1 ? '' : uiBusSource.slice(unionStart, unionEnd === -1 ? undefined : unionStart + unionEnd)
const unionNames = [...unionBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
check('s4-10 UiCommand union matches emit set', JSON.stringify(unionNames) === JSON.stringify(emitNames), `union=${JSON.stringify(unionNames)}`)

// ---------------------------------------------------------------------------
// 对比度探针（与 bugfix 探针同一份实现）
// ---------------------------------------------------------------------------
async function contrastProbe(page, selectors) {
  return page.evaluate(sels => {
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
    function over(fg, bg) {
      const a = fg.a
      return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }
    }
    function backdrop(el) {
      let node = el.parentElement
      let acc = null
      while (node) {
        const bg = parseColor(getComputedStyle(node).backgroundColor)
        if (bg && bg.a > 0) {
          acc = acc === null ? bg : over(acc, bg)
          if (acc.a >= 0.999) return acc
        }
        node = node.parentElement
      }
      const pageBg = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }
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
      const raw = parseColor(style.color)
      if (!raw) return { sel, missing: true, reason: `unparsed color ${style.color}` }
      const back = backdrop(el)
      const ownBg = parseColor(style.backgroundColor)
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
        text: (el.textContent ?? '').trim().slice(0, 12),
      }
    })
  }, selectors)
}
async function assertContrast(page, group, theme, selectors, min) {
  const rows = await contrastProbe(page, selectors)
  for (const row of rows) {
    check(`${group} ${theme} contrast ≥${min} for ${row.sel}`, row.missing !== true && row.ratio >= min, JSON.stringify(row))
  }
  return rows
}

// ---------------------------------------------------------------------------
// 浏览器
// ---------------------------------------------------------------------------
const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-s4-'))
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
const seenLoadBearingIds = new Set()
const LOAD_BEARING_IDS = [
  'people-library-title', 'person-template-modal', 'temporary-person-modal', 'add-person-modal',
  'external-models-modal', 'builtin-template-detail-modal', 'builtin-template-detail-title',
  'builtin-template-detail-meta', 'builtin-template-detail-prompt', 'role-prompt-detail-title',
]
// 七个关闭钮的 id 与译文（六个既有 + T4 新增的 #close-role-prompt-detail）
const CLOSE_BUTTONS = {
  'people-library-modal': { id: 'close-people-library', label: '关闭人员库' },
  'person-template-modal': { id: 'close-person-template', label: '关闭人员编辑' },
  'temporary-person-modal': { id: 'close-temporary-person', label: '关闭临时添加' },
  'add-person-modal': { id: 'close-add-person', label: '关闭添加人员' },
  'builtin-template-detail-modal': { id: 'close-builtin-template-detail', label: '关闭内置人员详情' },
  'external-models-modal': { id: 'close-external-models', label: '关闭外部模型' },
}
const ROLE_CLOSE = { id: 'close-role-prompt-detail', label: '关闭提示词详情' }

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

  // 种子：1 个群聊 + 2 名成员 + 1 条消息 + N 个自定义人员 + M 个外部模型。
  // **必须先 clear()**：同一 profile 第二趟起 meta.v2 会把 groupStore 完全遮住
  // （loadStore 见到 openteam.meta.v2 就直接返回），症状是「种几个都只有 2 张卡」。
  const seed = async ({ templateCount, modelCount }) => {
    await page.evaluate(async ({ templateCount, modelCount }) => {
      await chrome.storage.local.clear()
      localStorage.setItem('openteam.theme', 'dark')
      const now = Date.now()
      const template = index => ({
        id: `tpl-${index}`,
        type: 'custom',
        name: `自定义人员${index}`,
        description: `第 ${index} 号自定义人员描述，用于卡片几何与对比度检查。`,
        systemPrompt: `你是自定义人员${index}，负责第 ${index} 类任务。`,
        defaultChatSite: 'deepseek',
        category: index % 2 === 0 ? '技术研发' : '内容创作',
        createdAt: now - index * 1000,
        updatedAt: now - index * 1000,
      })
      const model = index => ({
        id: `model-${index}`,
        name: `外部模型${index}`,
        format: index % 2 === 0 ? 'openai' : 'anthropic',
        baseUrl: `https://api-${index}.example.test/v1`,
        apiKey: `sk-test-${index}`,
        modelName: `chat-model-${index}`,
        createdAt: now,
        updatedAt: now,
      })
      const templateIndexes = Array.from({ length: templateCount }, (_, index) => index + 1)
      const modelIndexes = Array.from({ length: modelCount }, (_, index) => index + 1)
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
          'role-a': { id: 'role-a', chatId: 'chat-seed-1', name: '产品经理', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'deepseek', prompt: '你是一名资深产品经理，负责需求梳理与排期。' },
          'role-b': { id: 'role-b', chatId: 'chat-seed-1', name: '工程师', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'chatgpt', prompt: '你是一名前端工程师，负责实现与联调。' },
        },
        messagesById: {
          'msg-1': { id: 'msg-1', chatId: 'chat-seed-1', seq: 1, type: 'user', content: '各位好，今天对齐一下 v2 的排期。', createdAt: now - 3_600_000, status: 'received' },
        },
        settings: {
          language: 'zh-CN',
          externalModelOrder: modelIndexes.map(index => `model-${index}`),
          externalModelsById: Object.fromEntries(modelIndexes.map(index => [`model-${index}`, model(index)])),
        },
          roleTemplateOrder: templateIndexes.map(index => `tpl-${index}`),
          roleTemplatesById: Object.fromEntries(templateIndexes.map(index => [`tpl-${index}`, template(index)])),
      }
      await chrome.storage.local.set({ 'openteam.groupStore': store })
    }, { templateCount, modelCount })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })
    await sleep(2500)
  }

  await seed({ templateCount: 12, modelCount: 12 })

  const clickByLabel = async label => {
    const clicked = await page.evaluate(text => {
      const button = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === text)
      button?.click()
      return Boolean(button)
    }, label)
    if (!clicked) throw new Error(`button not found: ${label}`)
    await sleep(500)
  }
  const openPeopleLibrary = async () => {
    await clickByLabel('人员库')
    await page.waitForSelector('#people-library-modal', { timeout: 5000 })
    await sleep(600)
  }
  // 打开即重置类型为 custom（uiBus handler 里 setType('custom')），
  // 所以每次都要显式切到「内置」页签才有 .template-detail。
  const openBuiltinDetail = async () => {
    await page.evaluate(() => document.getElementById('people-library-tab-builtin')?.click())
    await sleep(400)
    await page.evaluate(() => document.querySelector('#people-library-list .template-detail')?.click())
    await page.waitForSelector('#builtin-template-detail-modal', { timeout: 5000 })
    await sleep(700)
  }
  const openExternalModels = async () => {
    await clickByLabel('添加大模型')
    await page.waitForSelector('#external-models-modal', { timeout: 5000 })
    await sleep(700)
  }
  const exists = id => page.evaluate(modalId => document.getElementById(modalId) !== null, id)

  /* 弹窗测量：contentId 不存在时退回「由 titleId 反查 dialog-content」
     （提示词详情弹窗没有 contentId）。 */
  const measureModal = (contentId, titleId) => page.evaluate(({ contentId: cid, titleId: tid }) => {
    const el = (cid ? document.getElementById(cid) : null) ?? document.getElementById(tid)?.closest('[data-slot="dialog-content"]')
    if (!el) return { found: false }
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--popover)'
    document.body.appendChild(probe)
    const popoverResolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    const header = el.querySelector('[data-slot="dialog-header"]')
    const body = header?.nextElementSibling ?? null
    const firstBody = body?.firstElementChild ?? null
    const rectOf = node => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }
    }
    const closeButtons = [...el.querySelectorAll('button[aria-label]')]
      .filter(button => (button.getAttribute('aria-label') ?? '').startsWith('关闭'))
      .map(button => ({
        id: button.id,
        label: button.getAttribute('aria-label'),
        svgs: button.querySelectorAll('svg').length,
        visibleSvgs: [...button.querySelectorAll('svg')].filter(svg => svg.getClientRects().length > 0).length,
        text: (button.textContent ?? '').trim(),
      }))
    return {
      found: true,
      selfId: el.id,
      rect: rectOf(el),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      maxWidth: style.maxWidth,
      width: style.width,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      popoverResolved,
      overflowY: style.overflowY,
      overflowX: style.overflowX,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      header: rectOf(header),
      firstBody: rectOf(firstBody),
      closeButtons,
      ids: [...el.querySelectorAll('[id]')].map(node => node.id),
    }
  }, { contentId, titleId })

  const round = value => Math.round(value * 100) / 100

  /* s4-6：添加人员行的控件几何（bugfix 探针同口径 + 每条 pill 线内部的居中）。 */
  const measureAddPersonRow = () => page.evaluate(() => {
    const row = document.querySelector('#add-library-people-list .select-row')
    if (!row) return { missing: true }
    const rect = node => node.getBoundingClientRect()
    const rowRect = rect(row)
    const rowCenter = rowRect.top + rowRect.height / 2
    const centerOf = node => {
      const box = rect(node)
      return box.top + box.height / 2
    }
    const checkbox = row.querySelector('input[type="checkbox"]')
    const entries = [...row.querySelectorAll('.add-person-site-option')].map(pill => {
      const box = rect(pill)
      return { top: Math.round(box.top), bottom: Math.round(box.bottom), center: box.top + box.height / 2 }
    })
    const lines = new Map()
    for (const entry of entries) {
      const bucket = lines.get(entry.top) ?? []
      bucket.push(entry)
      lines.set(entry.top, bucket)
    }
    const lineChecks = [...lines.entries()].map(([top, bucket]) => {
      const lineTop = Math.min(...bucket.map(entry => entry.top))
      const lineBottom = Math.max(...bucket.map(entry => entry.bottom))
      const lineCenter = (lineTop + lineBottom) / 2
      return {
        top,
        count: bucket.length,
        maxOffset: Math.round(Math.max(...bucket.map(entry => Math.abs(entry.center - lineCenter)))),
      }
    })
    return {
      missing: false,
      rowHeight: Math.round(rowRect.height),
      checkboxHeight: Math.round(rect(checkbox).height),
      checkboxWidth: Math.round(rect(checkbox).width),
      checkboxOffset: Math.round(centerOf(checkbox) - rowCenter),
      pillCount: entries.length,
      pillOffsets: entries.map(entry => Math.round(entry.center - rowCenter)),
      lineCount: lineChecks.length,
      lineChecks,
    }
  })

  /* s4-1：宽度令牌 / 居中 / 圆角 / 背景 token / 沟槽；s4-1b：正文内边距不塌。 */
  async function assertModalFrame(group, name, contentId, titleId, expectedWidth, bodySelector) {
    const metrics = await measureModal(contentId, titleId)
    if (!metrics.found) {
      check(`${group} ${name} dialog mounted`, false, JSON.stringify({ contentId, titleId }))
      return null
    }
    const { rect, viewport } = metrics
    check(`${group} ${name} content width = ${expectedWidth}px`, Math.abs(rect.width - expectedWidth) <= 1,
      `width=${round(rect.width)} maxWidth=${metrics.maxWidth}`)
    const gutterLeft = rect.left
    const gutterRight = viewport.width - rect.right
    check(`${group} ${name} horizontally centred (±1px)`,
      Math.abs(gutterLeft - gutterRight) <= 1, `left=${round(gutterLeft)} right=${round(gutterRight)}`)
    check(`${group} ${name} gutters sum = viewport − width (both ≥0)`,
      Math.abs((gutterLeft + gutterRight) - (viewport.width - rect.width)) <= 1 && gutterLeft >= 0 && gutterRight >= 0,
      `sum=${round(gutterLeft + gutterRight)} expected=${round(viewport.width - rect.width)}`)
    check(`${group} ${name} vertically centred (±1px)`,
      Math.abs(rect.top - (viewport.height - rect.height) / 2) <= 1,
      `top=${round(rect.top)} bottom=${round(viewport.height - rect.bottom)} height=${round(rect.height)}`)
    check(`${group} ${name} max-width is not the retired 512px clamp`, metrics.maxWidth !== '512px', `maxWidth=${metrics.maxWidth}`)
    check(`${group} ${name} border-radius is the 10px token`, metrics.borderRadius === '10px', `border-radius=${metrics.borderRadius}`)
    check(`${group} ${name} background resolves to --popover`, metrics.backgroundColor === metrics.popoverResolved,
      `bg=${metrics.backgroundColor} popover=${metrics.popoverResolved}`)

    if (bodySelector) {
      const padding = await page.evaluate(({ contentId: cid, titleId: tid, selector }) => {
        const dialog = (cid ? document.getElementById(cid) : null) ?? document.getElementById(tid)?.closest('[data-slot="dialog-content"]')
        const header = dialog?.querySelector('[data-slot="dialog-header"]')
        const body = header?.nextElementSibling ?? null
        const firstBody = body?.firstElementChild ?? null
        const target = dialog?.querySelector(selector) ?? null
        if (!dialog || !target || !header) return { found: false }
        const dialogRect = dialog.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        return {
          found: true,
          left: Math.round(targetRect.left - dialogRect.left),
          firstBodyTop: firstBody ? Math.round(firstBody.getBoundingClientRect().top - header.getBoundingClientRect().bottom) : null,
          targetTop: Math.round(targetRect.top - header.getBoundingClientRect().bottom),
        }
      }, { contentId, titleId, selector: bodySelector })
      if (!padding.found) {
        check(`${group} ${name} sampling element ${bodySelector} present`, false, JSON.stringify(padding))
      } else {
        check(`${group} ${name} body padding kept (${bodySelector} left ≥ 20px)`, padding.left >= 20, `left=${padding.left}`)
        check(`${group} ${name} body padding kept (first body element ≥ 20px below header)`,
          padding.firstBodyTop !== null && padding.firstBodyTop >= 20,
          `firstBodyTop=${padding.firstBodyTop} ${bodySelector}Top=${padding.targetTop}`)
      }
    }
    for (const id of [metrics.selfId, ...metrics.ids]) if (LOAD_BEARING_IDS.includes(id)) seenLoadBearingIds.add(id)
    return metrics
  }

  /* s4-3：恰好一个可见 svg 关闭钮（无 × 文本节点）、aria-label 一致、点击后弹窗消失。 */
  async function assertCloseButton(group, name, contentId, titleId, expected) {
    const metrics = await measureModal(contentId, titleId)
    const buttons = metrics.found ? metrics.closeButtons : []
    check(`${group} ${name} has exactly one close button`, buttons.length === 1, JSON.stringify(metrics.closeButtons))
    const button = buttons[0]
    check(`${group} ${name} close button is ${expected.id}`, button?.id === expected.id, JSON.stringify(button))
    check(`${group} ${name} close button aria-label is 「${expected.label}」`, button?.label === expected.label, `label=${button?.label}`)
    check(`${group} ${name} close button renders one visible svg and no × text`,
      button?.visibleSvgs === 1 && button?.svgs === 1 && button?.text === '', JSON.stringify(button))
    const before = await page.evaluate(id => document.getElementById(id) !== null, expected.id)
    check(`${group} ${name} close button is mounted before click`, before === true)
    await page.evaluate(id => document.getElementById(id)?.click(), expected.id)
    await sleep(600)
    if (contentId) {
      const gone = !(await exists(contentId))
      check(`${group} ${name} closes when the close button is clicked`, gone, `#${contentId} still mounted=${!gone}`)
    } else {
      // 提示词详情弹窗没有 contentId：用标题 id 反查所在的 dialog-content
      // （注意 ?. 会返回 undefined 而不是 null——必须显式判空）
      const gone = await page.evaluate(tid => {
        const title = document.getElementById(tid)
        return title === null || title.closest('[data-slot="dialog-content"]') === null
      }, titleId)
      check(`${group} ${name} closes when the close button is clicked`, gone === true, `#${expected.id} still mounted=${!gone}`)
    }
  }

  // ======================= s4-1 / s4-1b / s4-2 / s4-7 / s4-3：人员库 ==========
  await openPeopleLibrary()
  await shot(page, '01-people-library-dark')
  const libraryFrame = await assertModalFrame('s4-1', 'people library', 'people-library-modal', 'people-library-title', 640, '#people-library-list')
  if (libraryFrame) {
    const expectedHeight = Math.min(760, libraryFrame.viewport.height - 48)
    check('s4-2 people library keeps the fixed height strategy (min(760, 100vh−48))',
      Math.abs(libraryFrame.rect.height - expectedHeight) <= 1,
      `height=${round(libraryFrame.rect.height)} expected=${expectedHeight}`)
    // 整壳唯一滚动容器必须是列表（bodyClassName 的 overflow-hidden 抵掉了
    // height="fixed" 给内容行加的 overflow-auto）
    check('s4-2 people library shell is not itself a scroll container',
      libraryFrame.overflowY === 'hidden' && libraryFrame.scrollHeight <= libraryFrame.clientHeight + 1,
      `overflow-y=${libraryFrame.overflowY} scrollHeight=${libraryFrame.scrollHeight} clientHeight=${libraryFrame.clientHeight}`)
    const listScroll = await page.evaluate(() => {
      const list = document.getElementById('people-library-list')
      if (!list) return { found: false }
      const style = getComputedStyle(list)
      return { found: true, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, overflowY: style.overflowY, cards: list.querySelectorAll('.template-card').length }
    })
    check('s4-2 people library list region is scrollable',
      listScroll.found && (listScroll.scrollHeight > listScroll.clientHeight || listScroll.overflowY === 'auto' || listScroll.overflowY === 'scroll'),
      JSON.stringify(listScroll))
    info('s4-2 people library list', JSON.stringify(listScroll))
  }

  // s4-7 人员库卡片对齐（与 bugfix 探针同口径）
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
      actionHeights: actions.map(action => Math.round(action.height)),
      actionPadding: actions[0] ? getComputedStyle(card.querySelector('[data-slot="card-action"] button')).padding : '',
      gaps,
      actionCenters: actions.map(action => Math.round(action.top + action.height / 2)),
      titleCenter: Math.round(titleRect.top + titleRect.height / 2),
    }
  })
  check('s4-7 card title and meta text share a left edge (≤1px)',
    Math.abs(cardAlignment.titleLeft - cardAlignment.metaLeft) <= 1,
    `title=${cardAlignment.titleLeft} meta=${cardAlignment.metaLeft} card=${cardAlignment.cardLeft}`)
  check('s4-7 card action buttons do not overlap (gap ≥4px)',
    cardAlignment.actionCount > 0 && cardAlignment.gaps.every(gap => gap >= 4), JSON.stringify(cardAlignment.gaps))
  check('s4-7 card action row is vertically centred on the title (≤12px)',
    cardAlignment.actionCenters.every(center => Math.abs(center - cardAlignment.titleCenter) <= 12),
    `actions=${cardAlignment.actionCenters} title=${cardAlignment.titleCenter}`)
  info('s4-7 card action button size', `heights=${cardAlignment.actionHeights} padding=${cardAlignment.actionPadding}`)

  // s4-8 暗色：人员库卡片标题
  await assertContrast(page, 's4-8', 'dark', ['#people-library-list .template-card .role-name'], 4.5)

  // s4-3 人员库关闭钮（放最后：点完即关）
  await assertCloseButton('s4-3', 'people library', 'people-library-modal', 'people-library-title', CLOSE_BUTTONS['people-library-modal'])
  check('s4-3 people library gone after close', !(await exists('people-library-modal')))

  // ======================= 内置详情（含 s4-5 叠层） ==========================
  await openPeopleLibrary()
  await openBuiltinDetail()
  await shot(page, '02-builtin-detail-dark')
  const detailFrame = await assertModalFrame('s4-1', 'builtin detail', 'builtin-template-detail-modal', 'builtin-template-detail-title', 720, '#builtin-template-detail-prompt')
  if (detailFrame) {
    check('s4-1 builtin detail keeps #builtin-template-detail-meta wired as describedby',
      await page.evaluate(() => {
        const content = document.getElementById('builtin-template-detail-modal')
        const meta = document.getElementById('builtin-template-detail-meta')
        return Boolean(content && meta && content.getAttribute('aria-describedby') === 'builtin-template-detail-meta' && content.getAttribute('aria-labelledby') === 'builtin-template-detail-title')
      }), JSON.stringify({ describedby: await page.evaluate(() => document.getElementById('builtin-template-detail-modal')?.getAttribute('aria-describedby')) }))
  }
  await assertContrast(page, 's4-8', 'dark', ['#builtin-template-detail-prompt'], 4.5)
  await assertCloseButton('s4-3', 'builtin detail', 'builtin-template-detail-modal', 'builtin-template-detail-title', CLOSE_BUTTONS['builtin-template-detail-modal'])
  check('s4-5 people library survives closing the detail layer', await exists('people-library-modal'))

  // ---- s4-5 叠层：Escape 逐层 ----
  await openBuiltinDetail()
  await page.keyboard.press('Escape')
  await sleep(600)
  const afterFirstEscape = { detail: await exists('builtin-template-detail-modal'), library: await exists('people-library-modal') }
  check('s4-5 first Escape closes only the top layer (detail)', afterFirstEscape.detail === false && afterFirstEscape.library === true, JSON.stringify(afterFirstEscape))
  await page.keyboard.press('Escape')
  await sleep(600)
  check('s4-5 second Escape closes the people library', !(await exists('people-library-modal')))

  // ---- s4-5 叠层：背板点击逐层 ----
  await openPeopleLibrary()
  await openBuiltinDetail()
  const backdropHit = await page.evaluate(() => {
    const hit = document.elementFromPoint(20, 20)
    return { slot: hit?.getAttribute('data-slot') ?? hit?.closest('[data-slot]')?.getAttribute('data-slot') ?? '', tag: hit?.tagName ?? '' }
  })
  check('s4-5 backdrop is the topmost element outside the dialog', backdropHit.slot === 'dialog-overlay', JSON.stringify(backdropHit))
  await page.mouse.click(20, 20)
  await sleep(700)
  const afterBackdrop = { detail: await exists('builtin-template-detail-modal'), library: await exists('people-library-modal') }
  check('s4-5 backdrop click closes only the top layer (detail)', afterBackdrop.detail === false && afterBackdrop.library === true, JSON.stringify(afterBackdrop))
  await page.mouse.click(20, 20)
  await sleep(700)
  check('s4-5 second backdrop click closes the people library', !(await exists('people-library-modal')))

  // ======================= 人员编辑 =========================================
  await openPeopleLibrary()
  await page.evaluate(() => document.getElementById('people-library-tab-custom')?.click())
  await sleep(400)
  await page.evaluate(() => document.querySelector('#people-library-list .template-edit')?.click())
  await page.waitForSelector('#person-template-modal', { timeout: 5000 })
  await sleep(700)
  await shot(page, '03-person-template-dark')
  const templateFrame = await assertModalFrame('s4-1', 'person template', 'person-template-modal', 'template-form-title', 520, '#template-name')
  if (templateFrame) {
    check('s4-2 person template stays within the auto height cap (≤760px)',
      templateFrame.rect.height <= 760 && (templateFrame.overflowY === 'auto' || templateFrame.overflowY === 'scroll'),
      `height=${round(templateFrame.rect.height)} overflow-y=${templateFrame.overflowY}`)
    check('s4-4 person template focuses #template-name on open',
      await page.evaluate(() => document.activeElement?.id === 'template-name'),
      `activeElement=${await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName)}`)
  }
  await assertCloseButton('s4-3', 'person template', 'person-template-modal', 'template-form-title', CLOSE_BUTTONS['person-template-modal'])
  check('s4-3 person template gone after close', !(await exists('person-template-modal')))
  check('s4-3 people library survives the nested editor close', await exists('people-library-modal'))
  await page.keyboard.press('Escape')
  await sleep(500)

  // ======================= 外部模型（s4-4 F1） ==============================
  await openExternalModels()
  await shot(page, '04-external-models-dark')
  const externalFrame = await assertModalFrame('s4-1', 'external models', 'external-models-modal', 'external-models-title', 520, '#external-model-form')
  if (externalFrame) {
    check('s4-2 external models height is capped at 760px', externalFrame.rect.height <= 760,
      `height=${round(externalFrame.rect.height)}`)
    check('s4-2 external models scrolls internally when the content overflows',
      externalFrame.overflowY === 'auto' || externalFrame.overflowY === 'scroll',
      `overflow-y=${externalFrame.overflowY} scrollHeight=${externalFrame.scrollHeight} clientHeight=${externalFrame.clientHeight}`)
    const models = await page.evaluate(() => document.querySelectorAll('#external-models-list .template-card').length)
    check('s4-4 seed produced 12 external models', models === 12, `cards=${models}`)
    const f1 = await page.evaluate(() => {
      const content = document.getElementById('external-models-modal')
      const header = content?.querySelector('[data-slot="dialog-header"]')
      const list = document.getElementById('external-models-list')
      if (!content || !header) return { found: false }
      const contentRect = content.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      const listRect = list?.getBoundingClientRect()
      return {
        found: true,
        scrollTop: content.scrollTop,
        scrollHeight: content.scrollHeight,
        clientHeight: content.clientHeight,
        headerTop: Math.round(headerRect.top),
        contentTop: Math.round(contentRect.top),
        headerVisible: headerRect.top >= contentRect.top - 1 && headerRect.bottom <= contentRect.bottom + 1,
        listVisible: listRect ? listRect.top >= contentRect.top - 1 : null,
      }
    })
    check('s4-4 opening the external models dialog does not scroll the shell (scrollTop === 0)',
      f1.found && f1.scrollTop === 0, JSON.stringify(f1))
    check('s4-4 dialog header stays visible after the open-focus (not scrolled out)',
      f1.found && f1.headerVisible === true, JSON.stringify(f1))
    check('s4-4 external models list stays inside the visible area', f1.listVisible === true, JSON.stringify(f1))
    check('s4-4 external models focuses #external-model-name on open',
      await page.evaluate(() => document.activeElement?.id === 'external-model-name'),
      `activeElement=${await page.evaluate(() => document.activeElement?.id ?? '')}`)
    // 反「恒真」护栏：被聚焦的输入框必须落在可视带之外——若它在可视带内，
    // 上面那条 scrollTop === 0 就算没有 preventScroll 也照样成立（N≤6 时的假绿）。
    const focusGeometry = await page.evaluate(() => {
      const content = document.getElementById('external-models-modal')
      const input = document.getElementById('external-model-name')
      if (!content || !input) return { found: false }
      const contentRect = content.getBoundingClientRect()
      const inputRect = input.getBoundingClientRect()
      return {
        found: true,
        inputTopRelativeToContent: Math.round(inputRect.top - contentRect.top),
        clientHeight: content.clientHeight,
        needsScrollToReveal: inputRect.top > contentRect.bottom || inputRect.bottom < contentRect.top,
      }
    })
    check('s4-4 the focused input sits outside the visible band (guards against a vacuous pass)',
      focusGeometry.found === true && focusGeometry.needsScrollToReveal === true, JSON.stringify(focusGeometry))
  }
  await assertContrast(page, 's4-8', 'dark', ['#external-model-form label'], 4.5)
  await assertCloseButton('s4-3', 'external models', 'external-models-modal', 'external-models-title', CLOSE_BUTTONS['external-models-modal'])
  check('s4-3 external models gone after close', !(await exists('external-models-modal')))

  // ======================= 添加人员 / 临时添加 / 提示词详情 ===================
  await page.evaluate(() => document.getElementById('toggle-people-drawer')?.click())
  await sleep(800)
  await page.evaluate(() => document.getElementById('add-role-form')?.requestSubmit())
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(800)
  await shot(page, '05-add-person-dark')
  const addPersonFrame = await assertModalFrame('s4-1', 'add person', 'add-person-modal', 'add-person-title', 820, '#add-library-people-list')
  if (addPersonFrame) {
    // 12 个外部模型会让站点 pill 列换成多行——多行布局下「逐 pill 居中于整行」
    // 不成立（那是单行契约，见下面同口径的 s4-6 专段）。这里记录实测值，
    // 并单独断「每行内部的 pill 互相居中」（多行情形下更强的口径）。
    const wrappedRow = await measureAddPersonRow()
    info('s4-6 add-person row geometry with 12 external models', JSON.stringify(wrappedRow))
    check('s4-6 add-person checkbox is a 16px square (12 external models)',
      wrappedRow.missing === false && wrappedRow.checkboxHeight === 16 && wrappedRow.checkboxWidth === 16, JSON.stringify(wrappedRow))
    check('s4-6 every site pill is centred inside its own pill line (≤2px)',
      wrappedRow.missing === false && wrappedRow.lineChecks.every(line => line.maxOffset <= 2), JSON.stringify(wrappedRow.lineChecks))
    await assertContrast(page, 's4-8', 'dark', ['#add-person-modal .select-row .template-description'], 3)
  }
  await assertCloseButton('s4-3', 'add person', 'add-person-modal', 'add-person-title', CLOSE_BUTTONS['add-person-modal'])
  check('s4-3 add person gone after close', !(await exists('add-person-modal')))

  // ---- 临时添加 ----
  await page.evaluate(() => document.getElementById('add-role-form')?.requestSubmit())
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(700)
  await page.evaluate(() => document.getElementById('open-temporary-person')?.click())
  await page.waitForSelector('#temporary-person-modal', { timeout: 5000 })
  await sleep(700)
  await shot(page, '06-temporary-person-dark')
  const temporaryFrame = await assertModalFrame('s4-1', 'temporary person', 'temporary-person-modal', 'temporary-person-title', 520, '#temporary-person-name')
  if (temporaryFrame) {
    check('s4-4 temporary person focuses #temporary-person-name on open',
      await page.evaluate(() => document.activeElement?.id === 'temporary-person-name'),
      `activeElement=${await page.evaluate(() => document.activeElement?.id ?? '')}`)
  }
  await assertContrast(page, 's4-8', 'dark', ['#temporary-person-modal label'], 4.5)
  await assertCloseButton('s4-3', 'temporary person', 'temporary-person-modal', 'temporary-person-title', CLOSE_BUTTONS['temporary-person-modal'])
  check('s4-3 add person survives closing the temporary layer', await exists('add-person-modal'))
  await page.keyboard.press('Escape')
  await sleep(500)

  // ---- 角色提示词详情（无 contentId，靠 title 反查） ----
  await page.evaluate(() => document.querySelector('.role-prompt-detail')?.click())
  await page.waitForSelector('#role-prompt-detail-title', { timeout: 5000 })
  await sleep(700)
  await shot(page, '07-role-prompt-detail-dark')
  const roleDetailFrame = await assertModalFrame('s4-1', 'role prompt detail', null, 'role-prompt-detail-title', 720, '.template-prompt-preview')
  if (roleDetailFrame) {
    check('s4-1 role prompt detail is no longer clamped to 512px',
      round(roleDetailFrame.rect.width) === 720, `width=${round(roleDetailFrame.rect.width)} maxWidth=${roleDetailFrame.maxWidth}`)
    const described = await page.evaluate(() => document.getElementById('role-prompt-detail-title')?.closest('[data-slot="dialog-content"]')?.getAttribute('aria-describedby'))
    info('s4-1 role prompt detail aria-describedby', String(described))
  }
  await assertCloseButton('s4-3', 'role prompt detail', null, 'role-prompt-detail-title', ROLE_CLOSE)

  // 承重 id 汇总
  for (const id of LOAD_BEARING_IDS) {
    check(`s4-1 load-bearing id #${id} observed`, seenLoadBearingIds.has(id), `seen=${[...seenLoadBearingIds].join(',')}`)
  }

  // ======================= s4-6（bugfix 探针同口径的种子） ==================
  // 12 个外部模型会凭空多出 12 个站点 pill，把 pill 列撑成 3 行；「控件居中于
  // 整行 ≤2px」是 bugfix 探针按单行布局立的契约（其种子不含外部模型）。
  // 按同一口径重种一次再断——这里正是「必须先 clear()」的场景：不 clear 的
  // 话上一轮的 openteam.meta.v2 会把 groupStore 完全遮住。
  await page.keyboard.press('Escape')
  await sleep(500)
  await seed({ templateCount: 12, modelCount: 0 })
  await page.evaluate(() => document.getElementById('toggle-people-drawer')?.click())
  await sleep(800)
  await page.evaluate(() => document.getElementById('add-role-form')?.requestSubmit())
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(800)
  await shot(page, '14-add-person-single-line-dark')
  const parityRow = await measureAddPersonRow()
  info('s4-6 add-person row geometry with the bugfix-parity seed', JSON.stringify(parityRow))
  check('s4-6 add-person checkbox is a 16px square',
    parityRow.missing === false && parityRow.checkboxHeight === 16 && parityRow.checkboxWidth === 16, JSON.stringify(parityRow))
  check('s4-6 add-person checkbox and site pills centre on the row (≤2px)',
    parityRow.missing === false && parityRow.pillCount > 0 && Math.abs(parityRow.checkboxOffset) <= 2 &&
      parityRow.pillOffsets.every(offset => Math.abs(offset) <= 2),
    JSON.stringify(parityRow))
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
  check('s4-6 add-person row keeps the per-site identity colour',
    siteIdentity.actual === siteIdentity.expected, JSON.stringify(siteIdentity))
  await page.keyboard.press('Escape')
  await sleep(500)

  // ======================= 浅色主题复拍 ======================================
  await page.evaluate(() => localStorage.setItem('openteam.theme', 'light'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2500)
  check('s4-8 light theme applied', await page.evaluate(() => document.documentElement.dataset.theme === 'light'))

  await openPeopleLibrary()
  await shot(page, '08-people-library-light')
  await assertContrast(page, 's4-8', 'light', ['#people-library-list .template-card .role-name'], 4.5)
  await openBuiltinDetail()
  await shot(page, '09-builtin-detail-light')
  await assertContrast(page, 's4-8', 'light', ['#builtin-template-detail-prompt'], 4.5)
  await page.keyboard.press('Escape')
  await sleep(500)
  await page.keyboard.press('Escape')
  await sleep(500)

  await openExternalModels()
  await shot(page, '10-external-models-light')
  await assertContrast(page, 's4-8', 'light', ['#external-model-form label'], 4.5)
  await page.keyboard.press('Escape')
  await sleep(500)

  await page.evaluate(() => document.getElementById('toggle-people-drawer')?.click())
  await sleep(700)
  await page.evaluate(() => document.getElementById('add-role-form')?.requestSubmit())
  await page.waitForSelector('#add-person-modal', { timeout: 5000 })
  await sleep(800)
  await shot(page, '11-add-person-light')
  await assertContrast(page, 's4-8', 'light', ['#add-person-modal .select-row .template-description'], 3)
  await page.evaluate(() => document.getElementById('open-temporary-person')?.click())
  await page.waitForSelector('#temporary-person-modal', { timeout: 5000 })
  await sleep(700)
  await shot(page, '12-temporary-person-light')
  await assertContrast(page, 's4-8', 'light', ['#temporary-person-modal label'], 4.5)
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.evaluate(() => document.querySelector('.role-prompt-detail')?.click())
  await page.waitForSelector('#role-prompt-detail-title', { timeout: 5000 })
  await sleep(700)
  await shot(page, '13-role-prompt-detail-light')
  await assertContrast(page, 's4-8', 'light', ['.template-prompt-preview'], 4.5)

  console.log('\n==== s4 acceptance summary ====')
  for (const [group, stats] of [...groupStats].sort()) {
    console.log(`${group}: ${stats.pass} passed, ${stats.fail} failed`)
  }
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
