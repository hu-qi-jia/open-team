/*
 * S5 验收探针（全部笔记弹窗 + 群模板弹窗 → AppModal 公共壳）。
 *
 * 断言组：
 *   s5-1  两个弹窗逐个打开：宽度令牌（全部笔记 2xl=1160 / 群模板 full=1500）、
 *         沟槽合计 = 视口 − 宽度、max-w 不是 512px、圆角 10px、
 *         background-color == --popover、水平垂直居中（±1px）
 *   s5-1b 正文内边距不塌（jsdom 抓不到）：正文行 padding token + 正文内已知元素
 *         左缘 − content 左缘 ≥ 20 / 头部下边界 → 首个正文元素 top 的差
 *   s5-2  高度策略与「不出现双滚动条」：height = min(760, 100vh−48)；
 *         整壳不可滚（scrollHeight ≤ clientHeight + 1 且 overflow-y:hidden）；
 *         列表内部可滚（#all-notes-list / #group-template-list）
 *   s5-3  关闭钮：各恰好一个可见 svg、无 × 文本节点、aria-label 与译文一致、
 *         点击后弹窗消失
 *   s5-4  首焦与「打开瞬间不得被滚走」：群模板聚焦 #group-template-search、
 *         content.scrollTop === 0、头部可见；全部笔记 content.scrollTop === 0
 *   s5-5  关闭语义对照：全部笔记 Escape 关 + 背板点击关；
 *         群模板 Escape 关 + 背板点击**不**关（完整指针序列，非裸 click()）
 *   s5-6  footer 钉底：滚动 #group-template-list 前后 footer 与头部几何不变，
 *         #confirm-group-template-create 始终可见
 *   s5-7  两栏 / 网格结构：全部笔记工作区左栏 240px + 右栏 1fr；
 *         群模板列表为多列网格（1500 宽下 ≥2 列）
 *   s5-8  亮/暗双主题对比度（主文本 ≥4.5，次级文本 ≥3）
 *   s5-9  退役审计：(a) 退役族零命中 / (b) 共享族归零 / (c) TSX 钩子类仍在
 *         / (d) dist 里新写 utilities 存在 / (e) 按族精确计数（销 S3 终审 M-2）
 *         ⚠️ S7/T6：审计对象由 legacy.css（已删除）改为**退役后的样式表面**，
 *         (e) 的 legacy.css 行数断言改为「文件已退役」。
 *   s5-10 uiBus 消费者审计（emit 必有对应 on）
 *   s5-11 响应式回归：700px（<760）单栏 + 列表横向可滚；1024px 两栏 240px + 1fr
 *
 * 口径纪律（本阶段已因混淆「行数 vs 规则数」栽过两次）：
 *   - 所有样式表面计数都是**剥掉 CSS 注释后的**「出现次数」（occurrence），
 *     不是行数、不是规则条数；断言文案里逐条注明。
 *   - 不写「负面存在性」断言（「某裸类在 dist 出现 0 次」这类会随 Tailwind
 *     合并同值规则而变）；只断**存在**与**精确计数**。
 *
 * ⚠️ 过渡陷阱（T3 复审实测：开窗后立刻量 content 高得 724.69，稳后才是 760）：
 *   dialog content 带 `transition: all .2s`，改状态后立刻读几何会拿到**中间值**。
 *   本探针：① 每次状态变化后注入 `*{transition:none!important;animation:none!important}`
 *   并 sleep ≥1500；② 对「注入前 / 注入后」做**合成对照**，对「打开后立刻读 / 稳后读」
 *   做**真 DOM 对照**，把两条自证读数打进日志（见 jitter self-proof 段）。
 *
 * 判据纪律：与 bugfix / s4 探针一致——断言失败 exitCode 3，控制台/页面报错 exitCode 2。
 * 加载 dist/ 扩展 → 注入种子 → 交互 + 截图 + 断言。
 * 种子前先 chrome.storage.local.clear()（见 Global Constraints：meta.v2 会遮住 groupStore）。
 */
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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
  const match = label.match(/^(s5-\d+b?)/)
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
  await page.screenshot({ path: path.join(outDir, `s5-${name}.png`) })
  console.log(`saved screenshots/s5-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const round = value => Math.round(value * 100) / 100

// ---------------------------------------------------------------------------
// 静态工具（s5-9 / s5-10）：读 src 与 dist，不依赖浏览器
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
/** 选择器口径：类名必须是独立 token（前有分隔符、后不接单词字符）。 */
function hasSelectorToken(css, classNameWithoutDot) {
  const re = new RegExp(`(^|[,\\s>+~({\\[])${escapeRegExp(`.${classNameWithoutDot}`)}($|[,\\s>+~){\\[:.])`, 'm')
  return re.test(css)
}
/** className 系列 prop 的值（含 `{...}` 表达式与模板串）。
 *  ⚠️ 与 s4 探针的差别：这里按 /[A-Za-z]*[Cc]lassName=/ 搜，因此
 *  contentClassName / bodyClassName / footerClassName 这些 prop 也看得见——
 *  `.all-notes-modal` / `.group-template-modal` 这两个钩子类**只**出现在
 *  contentClassName 上（s4 的 `className=`（小写 c）版本搜不到它们）。 */
const CLASS_NAME_PROP = /[A-Za-z]*[Cc]lassName=/g
function classNameContexts(source) {
  const out = []
  let from = 0
  CLASS_NAME_PROP.lastIndex = 0
  let match
  while ((match = CLASS_NAME_PROP.exec(source)) !== null) {
    let i = match.index + match[0].length
    if (i < from) continue
    const ch = source[i]
    if (ch === '"' || ch === "'") {
      const end = source.indexOf(ch, i + 1)
      out.push(source.slice(i + 1, end === -1 ? source.length : end))
      from = end === -1 ? source.length : end + 1
      CLASS_NAME_PROP.lastIndex = from
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
      CLASS_NAME_PROP.lastIndex = from
      continue
    }
    out.push(source.slice(i, i + 120))
    from = i + 1
    CLASS_NAME_PROP.lastIndex = from
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
/** 顶层空格切分（括号内的空格不切）——解析 grid-template-columns。 */
function splitTracks(value) {
  const out = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ' ' && depth === 0) {
      if (current) out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

const COUNT_NOTE = 'post-comment-strip occurrence count'

// ---- s5-9 (a)：本阶段独占族（A 组全部笔记族 + B 组群模板族 + .btn + 760px 媒体块）----
// ⚠️ S7/T6 改判：legacy.css 已整文件删除，审计对象改为**退役后的样式表面**
// （styles/ 下现存 CSS 的剥注释拼接）。直接换成空串会让下面上百条零残留断言
// 全部变成永真空转；改成表面后语义升级为「任何现存样式表里都不许复现」。
const styleDir = path.join(root, 'src/teamPage/ui/styles')
const styleFiles = readdirSync(styleDir).filter(name => name.endsWith('.css')).sort()
const legacyPath = path.join(styleDir, 'legacy.css')
const legacyCss = styleFiles
  .map(name => stripCssComments(readFileSync(path.join(styleDir, name), 'utf8')))
  .join('\n')

check('s5-9 (a) legacy.css is retired (file deleted after the S7 purge)',
  existsSync(legacyPath) === false, existsSync(legacyPath) ? 'file still present' : 'file absent')
check('s5-9 (a) the stylesheet surface is globals + iframe-host + orchestration-canvas',
  styleFiles.join(',') === 'globals.css,iframe-host.css,orchestration-canvas.css',
  `files=${styleFiles.join(',')}`)

const RETIRED_A_SELECTORS = [
  'all-notes-modal', 'all-notes-workspace', 'all-notes-list', 'all-notes-empty',
  'all-note-target', 'all-note-target-title', 'all-note-target-meta',
  'all-notes-editor-shell', 'all-notes-editor-header', 'all-notes-editor',
]
for (const name of RETIRED_A_SELECTORS) {
  const hits = countOccurrences(legacyCss, `.${name}`)
  check(`s5-9 (a) stylesheet surface has no .${name} rule`, hits === 0, `hits=${hits} (${COUNT_NOTE})`)
}
for (const name of ['group-template', 'group-template-modal', 'group-template-option', 'group-template-risk-professional']) {
  const hits = countOccurrences(legacyCss, `.${name}`)
  check(`s5-9 (a) stylesheet surface has no .${name} rule`, hits === 0, `hits=${hits} (${COUNT_NOTE})`)
}
{
  const hits = countOccurrences(legacyCss, '.btn')
  check('s5-9 (a) stylesheet surface has no .btn rule (retired in T4)', hits === 0, `hits=${hits} (${COUNT_NOTE})`)
  // ⚠️ 口径：只断「@media (max-width: 760px)」这条**媒体查询**零命中。
  // 不断「760px 字面量零命中」——legacy 里还有两条别的族的
  // `height: min(760px, …)` 声明（1197/1367 行），那会是一条假红。
  const media = countOccurrences(legacyCss, '@media (max-width: 760px)')
  check('s5-9 (a) stylesheet surface has no @media (max-width: 760px) block (notes responsive moved to utilities)',
    media === 0, `hits=${media} (${COUNT_NOTE})`)
}

// ---- s5-9 (b)：守卫族口径（S7/T3 起：notes/mention/message-tool 九族随
// 组件 utilities 化退役，断言从「still owns exactly N×」翻转为「gone」；
// 承担方断言由 s3-12 ⑤（globals 例外块）与 NotesPanel 守卫测试（TSX 钩子）覆盖）----
// 口径：全为「剥注释后的子串出现次数」。
// ⚠️ S7/T6：`.notes-editor` 移出本清单——它是**承接方**：`.notes-editor
// .ProseMirror` 四条后代规则（ProseMirror 动态 DOM，无法加 className）住在
// globals.css components 层。改由下方「承接方只在 globals」断言覆盖。
const RETIRED_S7_T3 = [
  'note-tool-btn', 'note-toolbar',
  'note-toolbar-spacer', 'all-note-toolbar',
]
for (const needle of RETIRED_S7_T3) {
  const hits = countOccurrences(legacyCss, `.${needle}`)
  check(`s5-9 (b) stylesheet surface has zero .${needle} occurrences after S7/T3 (comments stripped)`, hits === 0, `hits=${hits} (${COUNT_NOTE})`)
}
{
  // 承接方双向断言：规则在 globals，且不在两个 unlayered 专题文件里。
  const globalsStripped = stripCssComments(readFileSync(path.join(styleDir, 'globals.css'), 'utf8'))
  const nonGlobalSurface = styleFiles.filter(name => name !== 'globals.css')
    .map(name => stripCssComments(readFileSync(path.join(styleDir, name), 'utf8'))).join('\n')
  check('s5-9 (b) .notes-editor ProseMirror carrier lives in globals.css (S7/T3)',
    globalsStripped.includes('.notes-editor .ProseMirror'),
    `globals=${globalsStripped.includes('.notes-editor .ProseMirror')}`)
  check('s5-9 (b) .notes-editor carrier is absent from the unlayered special files',
    countOccurrences(nonGlobalSurface, '.notes-editor') === 0,
    `hits=${countOccurrences(nonGlobalSurface, '.notes-editor')}`)
}
{
  // 原「规则本体」钉串（`.note-toolbar {`，带空格+花括号）随族归零
  const hits = countOccurrences(legacyCss, '.note-toolbar {')
  check('s5-9 (b) stylesheet surface has zero .note-toolbar rule bodies after S7/T3', hits === 0, `hits=${hits} (${COUNT_NOTE})`)
}
// S7/T4：壳层/列表/主题/模式/模板卡族随 utilities 化或零消费退役（暗浅双份 +
// media 1120 成员一并清零）。注意 .launcher 类名仍在 App.tsx（视觉已迁行内
// utilities），故用规则本体 `.launcher {` 钉串而非裸 token。
// ⚠️ S7/T6：`sidebar` 移出本清单——globals.css 有**合法存活**的
// `.sidebar-resize-handle`（S1 Task 7 搬迁的壳层拖拽手柄，不是 T4 退役的旧
// `.sidebar` 全家）。裸子串 `.sidebar` 会命中它造成假红，故改用
// hasSelectorToken（要求 `.sidebar` 后紧跟分隔符，`-resize-handle` 不算）。
const RETIRED_S7_T4 = [
  'theme-switch', 'theme-option', 'settings-menu', 'chat-header',
  'chat-title-block', 'chat-subtitle', 'chat-status', 'workspace',
  'logo-dot', 'brand-mark', 'template-card', 'template-list', 'mode-options',
  'mode-name', 'mode-help', 'chat-create-template-row', 'chat-create-template-btn',
]
for (const needle of RETIRED_S7_T4) {
  const hits = countOccurrences(legacyCss, `.${needle}`)
  check(`s5-9 (b) stylesheet surface has zero .${needle} occurrences after S7/T4 (comments stripped)`, hits === 0, `hits=${hits} (${COUNT_NOTE})`)
}
{
  // 旧 `.sidebar` 全家（本体/品牌行/分区标签…）已随新壳退役；存活的只有
  // `.sidebar-resize-handle`，用 selector-token 口径把两者区分开。
  const oldSidebar = hasSelectorToken(legacyCss, 'sidebar')
  check('s5-9 (b) stylesheet surface has no bare .sidebar selector after S7/T4 (.sidebar-resize-handle survives)',
    oldSidebar === false, `selector-token=${oldSidebar}`)
  const handleKept = countOccurrences(legacyCss, '.sidebar-resize-handle')
  check('s5-9 (b) .sidebar-resize-handle is still carried by globals.css',
    handleKept > 0, `hits=${handleKept} (${COUNT_NOTE})`)
}
{
  const launcherRule = countOccurrences(legacyCss, '.launcher {')
  check('s5-9 (b) stylesheet surface has zero .launcher rule bodies after S7/T4 (class stays in App.tsx as hook)',
    launcherRule === 0, `hits=${launcherRule} (${COUNT_NOTE})`)
  const rowSelectors = countOccurrences(legacyCss, '.chat-row')
  check('s5-9 (b) stylesheet surface has zero .chat-row selectors after S7/T4',
    rowSelectors === 0, `hits=${rowSelectors} (${COUNT_NOTE})`)
}
// S7/T5：最后一批共享族（通用族）随 utilities 化退役，断言翻转为「归零」——
// 类名一律保留在 TSX 上作测试/探针钩子，本探针只审样式表侧规则。
const RETIRED_S7_T5_SHARED = [
  'tiny', 'muted', 'modal-form', 'field', 'template-actions', 'section-title',
  'reference-box', 'two-col', 'role-row', 'role-name', 'role-site-control',
  'message-name-text', 'message-tools', 'orchestration-review-summary',
  'orchestration-review-line',
]
for (const name of RETIRED_S7_T5_SHARED) {
  const present = hasSelectorToken(legacyCss, name)
  check(`s5-9 (b) stylesheet surface no longer owns .${name} after S7/T5`, !present, `selector-token=${present}`)
}
{
  const persona = countOccurrences(legacyCss, '#template-persona-generation-status')
  check('s5-9 (b) stylesheet surface no longer owns #template-persona-generation-status after S7/T5',
    persona === 0, `hits=${persona}`)
}
{
  // S7/T3：.note-* 前缀全族退役归零。
  // S7/T5：.orchestration-review-*（T5 最后两条）同批归零。
  // ⚠️ S7/T6：`.orchestration-` 全前缀不能断零——现存样式表里有两位**合法
  // 承接方**：`.orchestration-person-site`（globals components 层）与
  // `.orchestration-stage-canvas`（unlayered 画布专题文件 11 条）。故收窄为
  // `.orchestration-review-`，并补一条承接方在位断言。
  const note = countOccurrences(legacyCss, '.note-')
  check('s5-9 (b) stylesheet surface has zero .note-* occurrences after S7/T3 (comments stripped)', note === 0, `hits=${note}`)
  const orch = countOccurrences(legacyCss, '.orchestration-review-')
  check('s5-9 (b) stylesheet surface has zero .orchestration-review-* rules after S7/T5 (comments stripped)', orch === 0, `hits=${orch}`)
  const carriers = ['.orchestration-person-site', '.orchestration-stage-canvas']
  const missingCarriers = carriers.filter(token => !legacyCss.includes(token))
  check('s5-9 (b) the two .orchestration-* carriers are intact (person-site in globals, canvas in the special file)',
    missingCarriers.length === 0, missingCarriers.length === 0 ? 'both present' : `missing: ${missingCarriers.join(', ')}`)
}

// ---- s5-9 (c)：钩子类仍出现在 TSX（剥注释后按 className 系列 prop 精确搜）----
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
const HOOK_CLASSES = [
  'all-notes-modal', 'group-template-modal', 'all-notes-workspace', 'all-notes-list',
  'all-note-target', 'all-note-target-title', 'all-note-target-meta',
  'all-notes-editor-shell', 'all-notes-editor-header', 'all-notes-editor', 'all-note-toolbar',
  'note-tool-btn', 'note-toolbar-spacer', 'notes-editor',
  'group-template-option', 'group-template-option-top', 'group-template-role-count',
  'group-template-summary', 'group-template-category', 'group-template-category-filter',
  'group-template-empty', 'group-template-empty-actions', 'group-template-risk', 'has-long-summary',
]
for (const name of HOOK_CLASSES) {
  const hits = classNameConsumers(name)
  check(`s5-9 (c) className consumer still present for .${name}`, hits.length > 0, `files=${hits.join(' | ') || 'none'}`)
}
// 动态拼名：`group-template-risk-${template.riskLevel}` 静态扫描看不到
// `-professional` 字面量，所以 (c) **不**对该字面量写「存在」断言（会假红）；
// 改为断言模板串本身在场——那才是这个钩子的真实来源。
{
  const gtm = stripCssComments(readFileSync(path.join(root, 'src/teamPage/ui/components/shell/GroupTemplateModal.tsx'), 'utf8'))
  const dynamic = countOccurrences(gtm, 'group-template-risk-${template.riskLevel}')
  check('s5-9 (c) dynamic hook template `group-template-risk-${riskLevel}` is intact', dynamic === 1,
    `hits=${dynamic} (dynamic class name — a literal "-professional" assertion would be a false red)`)
}

// ---- s5-9 (d)：dist 里新写的 utilities 存在（含紧贴 ${ 的复检）----
const distCss = readFileSync(path.join(dist, 'team.css'), 'utf8')
const DIST_UTILITIES = [
  '.grid-cols-\\[240px_minmax\\(0\\,1fr\\)\\]',
  '.grid-rows-\\[auto_auto_minmax\\(0\\,1fr\\)\\]',
  '.grid-rows-\\[auto_minmax\\(0\\,1fr\\)\\]',
  '.grid-rows-\\[minmax\\(0\\,1fr\\)\\]',
  '.grid-cols-\\[repeat\\(auto-fit\\,minmax\\(520px\\,1fr\\)\\)\\]',
  '.max-\\[760px\\]\\:grid-cols-1',
  '.max-\\[760px\\]\\:grid-rows-\\[auto_minmax\\(0\\,1fr\\)\\]',
  '.max-\\[760px\\]\\:flex',
  '.max-\\[760px\\]\\:overflow-x-auto',
  '.max-\\[760px\\]\\:border-r-0',
  '.max-\\[760px\\]\\:min-w-\\[160px\\]',
  '.min-w-\\[160px\\]',
  '.w-\\[min\\(1160px\\,calc\\(100vw-48px\\)\\)\\]',
  '.w-\\[min\\(1500px\\,calc\\(100vw-48px\\)\\)\\]',
  '.h-\\[min\\(760px\\,calc\\(100vh-48px\\)\\)\\]',
]
for (const needle of DIST_UTILITIES) {
  const hits = countOccurrences(distCss, needle)
  check(`s5-9 (d) dist/team.css contains utility ${needle} exactly once`, hits === 1, `hits=${hits}`)
}
// 响应式变体确实编译成了媒体查询（宽 < 760 —— Tailwind v4 的 max-[760px]: 语义）
{
  const media = countOccurrences(distCss, '@media not all and (min-width:760px)')
  check('s5-9 (d) the max-[760px]: variants compiled into a media query', media > 0, `hits=${media}`)
}

// ---- s5-9 (e)：⭐ 按族精确计数（销 S3 终审 M-2）----
// S6 更新（09-29）：编排三弹窗迁 AppModal 后 T4/T5 删掉了主弹窗专属的
// .tiny / .section-title 命中（empty-hint / stage-settings 等编排族），
// 快照 3→1、2→1；共享族剩余命中由 s3-12 ⑤ 的「>0」断言兜底。
// S7/T3 更新：.all-note- / .mention-shortcut 随九族退役归零（2→0）。
// ⚠️ S7/T6 改数（附原因链）：计数目标从 legacy.css 换成**退役后的样式表面**，
// 而 .tiny / .reference-box / .section-title 这三族的最后命中本来就在 legacy
// 里（通用族），T5-d 已随 utilities 化全部退役 —— 表面侧实测 0、0、0，
// 故期望值 1→0、2→0、1→0。
const FAMILY_COUNTS = [
  ['.all-note-', 0], ['.tiny', 0], ['.reference-box', 0], ['.section-title', 0], ['.mention-shortcut', 0],
]
for (const [needle, expected] of FAMILY_COUNTS) {
  const hits = countOccurrences(legacyCss, needle)
  check(`s5-9 (e) family count ${needle}* is exactly ${expected}`, hits === expected, `hits=${hits} expected=${expected} (${COUNT_NOTE})`)
}
{
  // S7/T3：.all-note- 前缀全族退役归零（原「2 处均为共享族 toolbar」检查随之失效）
  const total = countOccurrences(legacyCss, '.all-note-')
  check('s5-9 (e) .all-note-* is fully gone from the stylesheet surface after S7/T3',
    total === 0, `total=${total}`)
}
{
  // legacy.css 行数递减史（口径：换行符个数 = `wc -l`）：
  //   2769（起点）→ 2422（T4）→ 1724（S6 编排族）→ 1361（S7/T2 状态卡族）
  //   → 1155（T3 笔记/提及/消息工具九族）→ 875（T4 壳层/列表/主题/模式/模板卡族，
  //   约七成是零消费死码）→ 752（T5-a #iframe-host 全族迁 styles/iframe-host.css）
  //   → 647（T5-c base 元素 + color-scheme + 1120/720 media 迁 globals/utilities）
  //   → 585（T5-d 通用族全批 utilities 化，只剩退役注释）
  //   → **0**（T6：文件删除，绞杀者模式终点）。
  // 行数断言随文件下线作废，改为「文件已退役 + 表面仍非空」的自证：
  // 后者防止「样式目录被清空却没人发现」这类静默事故。
  check('s5-9 (e) legacy.css is retired — 0 lines because the file is gone',
    existsSync(legacyPath) === false, existsSync(legacyPath) ? 'file still present' : 'file absent')
  check('s5-9 (e) the surviving stylesheet surface is non-empty',
    legacyCss.trim().length > 0, `comment-stripped chars=${legacyCss.trim().length}`)
}

// ---- s5-10 uiBus 消费者审计（沿用 s4-10）-----------------------------------
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
info('s5-10 emits', JSON.stringify(emitNames))
info('s5-10 ons', JSON.stringify(onNames))
const orphans = emitNames.filter(name => !ons.has(name))
check('s5-10 every uiBus.emit has a matching uiBus.on consumer', orphans.length === 0, `orphans=${JSON.stringify(orphans)}`)
const deadSubscriptions = onNames.filter(name => !emits.has(name))
check('s5-10 no uiBus.on without a producer', deadSubscriptions.length === 0, `dead=${JSON.stringify(deadSubscriptions)}`)
check('s5-10 command set is exactly the 10 documented names',
  JSON.stringify(emitNames) === JSON.stringify([...UI_BUS_EXPECTED].sort()) && JSON.stringify(onNames) === JSON.stringify([...UI_BUS_EXPECTED].sort()),
  `emits=${JSON.stringify(emitNames)} ons=${JSON.stringify(onNames)}`)
{
  const uiBusSource = readFileSync(path.join(root, 'src/teamPage/ui/lib/uiBus.ts'), 'utf8')
  // 行尾是 CRLF（Windows 检出），别用 '\n\n' 找块尾
  const unionStart = uiBusSource.indexOf('export type UiCommand =')
  const unionEnd = unionStart === -1 ? -1 : uiBusSource.slice(unionStart).search(/\r?\n\r?\n/)
  const unionBlock = unionStart === -1 ? '' : uiBusSource.slice(unionStart, unionEnd === -1 ? undefined : unionStart + unionEnd)
  const unionNames = [...unionBlock.matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
  check('s5-10 UiCommand union matches emit set', JSON.stringify(unionNames) === JSON.stringify(emitNames), `union=${JSON.stringify(unionNames)}`)
}

// ---------------------------------------------------------------------------
// 对比度探针（与 bugfix / s4 探针同一份实现）
// ---------------------------------------------------------------------------
async function contrastProbe(page, selectors) {
  return page.evaluate(sels => {
    function oklabToRgb(lightness, a, b) {
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
    function oklchToRgb(chroma, hue, lightness) {
      const h = (hue * Math.PI) / 180
      return oklabToRgb(lightness, chroma * Math.cos(h), chroma * Math.sin(h))
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
      // oklab(L a b / alpha)：`text-foreground/85` 这类透明前景色在 Chrome 的
      // computed color 里就是这个形态（oklch 的正则匹配不到它，会落成「无法解析」）。
      const oklab = value.match(/oklab\(([^)]+)\)/)
      if (oklab) {
        const parts = oklab[1].split(/[\s/]+/).filter(Boolean)
        if (parts.length < 3) return null
        const lightness = parts[0].includes('%') ? Number.parseFloat(parts[0]) / 100 : Number.parseFloat(parts[0])
        const a = Number.parseFloat(parts[1])
        const b = Number.parseFloat(parts[2])
        const alpha = parts[3] !== undefined ? (parts[3].includes('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])) : 1
        if ([lightness, a, b].some(Number.isNaN)) return null
        return { ...oklabToRgb(lightness, a, b), a: alpha }
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
async function assertContrast(page, group, theme, selectors, min, kind) {
  const rows = await contrastProbe(page, selectors)
  for (const row of rows) {
    check(`${group} ${theme} contrast ≥${min} for ${row.sel}${kind ? ` (${kind})` : ''}`,
      row.missing !== true && row.ratio >= min, JSON.stringify(row))
  }
  info(`${group} ${theme} contrast (${kind ?? ''})`, JSON.stringify(rows.map(row => ({ sel: row.sel, ratio: row.ratio, bg: row.bg }))))
  return rows
}

// ---------------------------------------------------------------------------
// 浏览器
// ---------------------------------------------------------------------------
const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-s5-'))
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
const LOAD_BEARING_IDS = [
  'all-notes-modal', 'all-notes-title', 'all-notes-list', 'all-notes-editor',
  'all-notes-active-title', 'all-notes-active-meta', 'close-all-notes',
  'group-template-modal', 'group-template-title', 'group-template-search',
  'group-template-categories', 'group-template-list', 'confirm-group-template-create',
  'close-group-template-modal',
]
const seenLoadBearingIds = new Set()

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

  /* 种子：18 个群聊 + 群聊笔记 + 全局笔记 + 1 条「已删除群聊」笔记。
   * 列表必须有足量条目才能滚（s5-2 的「列表内部可滚」）。
   * ⚠️ 先 clear()：同一 profile 第二趟起 meta.v2 会把 groupStore 完全遮住。 */
  const seed = async theme => {
    await page.evaluate(async ({ theme: nextTheme }) => {
      await chrome.storage.local.clear()
      localStorage.setItem('openteam.theme', nextTheme)
      const now = Date.now()
      const doc = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
      const chatIds = Array.from({ length: 18 }, (_, index) => `chat-s5-${index + 1}`)
      await chrome.storage.local.set({
        'openteam.groupStore': {
          version: 7,
          currentChatId: 'chat-s5-4',
          chatOrder: chatIds,
          chatsById: Object.fromEntries(chatIds.map((id, index) => [id, {
            id,
            name: `S5 群聊 ${index + 1}`,
            mode: index % 2 === 0 ? 'collaborative' : 'independent',
            roleIds: [],
            messageIds: [],
            nextMessageSeq: 1,
            status: 'ready',
            createdAt: now - index * 1000,
            updatedAt: now,
          }])),
          rolesById: {},
          messagesById: {},
          globalNote: doc('S5 全局笔记内容，用于探针。'),
          chatNotesById: {
            ...Object.fromEntries(chatIds.map((id, index) => [id, doc(`第 ${index + 1} 条群聊笔记，用于探针的列表滚动与对比度。`)])),
            // 不在 chatOrder / chatsById 里 → 产出「已删除群聊」条目
            'ghost-chat-1': doc('已删除群聊的笔记内容。'),
          },
          settings: { language: 'zh-CN' },
        },
      })
    }, { theme })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })
    await sleep(2500)
  }

  await seed('dark')
  check('s5-0 dark theme applied after seeding', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'),
    `dataset.theme=${await page.evaluate(() => document.documentElement.dataset.theme)}`)

  /* ---------------- 过渡防线（简报第 1 节的头号坑） ---------------- */
  const installKillSwitch = () => page.evaluate(css => {
    const previous = document.getElementById('s5-kill-switch')
    if (previous) previous.remove()
    const style = document.createElement('style')
    style.id = 's5-kill-switch'
    style.textContent = css
    document.head.appendChild(style)
  }, KILL_CSS)
  const killSwitchInstalled = () => page.evaluate(() => document.getElementById('s5-kill-switch') !== null)
  const removeKillSwitch = () => page.evaluate(() => document.getElementById('s5-kill-switch')?.remove())
  /** 每次改变页面状态后读几何之前都要过这一关。 */
  const settle = async (ms = SETTLE) => {
    await installKillSwitch()
    await sleep(ms)
  }
  /* 合成对照：同一个「设宽 100 → 400、立刻读」的实验做两遍。
   * 未注入 kill 时读到**中间值**（transition 在飞），注入后立刻读到**终值**
   * → 证明这枚 kill switch 真的能把过渡按死（否则「读数取自终值」不可信）。 */
  const syntheticTransitionProbe = () => page.evaluate(() => {
    const el = document.createElement('div')
    el.style.cssText = 'position:absolute;left:-5000px;top:0;height:10px;width:100px;'
    document.body.appendChild(el)
    el.style.transition = 'width 1000ms linear'
    void el.offsetWidth
    el.style.width = '400px'
    const immediate = getComputedStyle(el).width
    el.remove()
    return immediate
  })
  await removeKillSwitch()
  const rawSynthetic = await syntheticTransitionProbe()
  await installKillSwitch()
  const killedSynthetic = await syntheticTransitionProbe()
  info('s5 jitter self-proof (synthetic)', `control(killed off)=${rawSynthetic} killed(on)=${killedSynthetic} transitionDuration=${await page.evaluate(() => getComputedStyle(document.body).transitionDuration ?? '')}`)
  check('s5-jitter self-proof: the transition kill switch really works (synthetic control reads 100px without it, 400px with it)',
    rawSynthetic === '100px' && killedSynthetic === '400px',
    `without-kill=${rawSynthetic} with-kill=${killedSynthetic}`)

  /* ---------------- 打开 / 关闭 helper ---------------- */
  const exists = id => page.evaluate(modalId => document.getElementById(modalId) !== null, id)
  const waitGone = async (id, timeout = 6000) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (!(await exists(id))) return true
      await sleep(150)
    }
    return false
  }
  /** 打开「全部笔记」；raw=true 时先摘掉 kill switch，在**挂载后的前三帧**采高
   *  （过渡自证用），再 settle 后复读。 */
  const openNotes = async ({ raw = false } = {}) => {
    if (raw) await removeKillSwitch()
    await page.evaluate(() => document.querySelector('button[aria-label="全部笔记"]')?.click())
    await page.waitForSelector('#all-notes-modal', { timeout: 8000 })
    let jitter = null
    if (raw) {
      // 从挂载那一帧起连采 3 帧：每帧一次 rAF，200ms 的入场动画绝对跑不完，
      // 首帧必然落在中间值上（比「waitForSelector 返回后再 evaluate」稳）。
      jitter = await page.evaluate(() => new Promise(resolve => {
        const started = performance.now()
        const samples = []
        const tick = () => {
          const el = document.getElementById('all-notes-modal')
          if (el) {
            samples.push(Math.round(el.getBoundingClientRect().height * 100) / 100)
            if (samples.length >= 3) {
              resolve({ samples, transition: getComputedStyle(el).transition })
              return
            }
          } else if (performance.now() - started > 8000) {
            resolve(null)
            return
          }
          requestAnimationFrame(tick)
        }
        tick()
      }))
    }
    await settle()
    if (raw) {
      const settled = await page.evaluate(() => {
        const el = document.getElementById('all-notes-modal')
        return el ? { height: el.getBoundingClientRect().height, transitionDuration: getComputedStyle(el).transitionDuration } : null
      })
      const samples = jitter?.samples ?? []
      // 判据：**只要有一帧**与终值差 > 0.5px 就说明过渡真的在飞（实测
      // frames=[743.89, 748.83, 760]：第三帧已经落定，所以不能拿 max 比）。
      const jittered = settled !== null && samples.some(sample => Math.abs(sample - settled.height) > 0.5)
      info('s5 jitter self-proof (real DOM, notes)',
        `frames=${JSON.stringify(samples)} settled=${round(settled?.height ?? -1)} `
        + `transition(before kill)=${jitter?.transition} transitionDuration(after kill)=${settled?.transitionDuration}`)
      check('s5-jitter self-proof (real DOM): the notes dialog really jitters before it settles (mount frames ≠ 760)',
        jitter !== null && settled !== null && samples.length === 3 && jittered,
        `frames=${JSON.stringify(samples)} settled=${round(settled?.height ?? -1)}`)
      check('s5-jitter self-proof (real DOM): the kill switch zeroes the transition on the actual dialog content',
        settled?.transitionDuration === '0s', `transitionDuration=${settled?.transitionDuration}`)
    }
    return jitter
  }
  const closeNotesByEscape = async () => {
    await page.keyboard.press('Escape')
    const gone = await waitGone('all-notes-modal')
    await sleep(400)
    return gone
  }
  const openGtm = async () => {
    await page.evaluate(() => document.getElementById('quick-create-chat')?.click())
    await sleep(400)
    await page.evaluate(() => document.getElementById('open-group-template-create')?.click())
    await page.waitForSelector('#group-template-modal', { timeout: 8000 })
    await settle()
  }
  const closeGtm = async () => {
    await page.keyboard.press('Escape')
    await waitGone('group-template-modal')
    await sleep(400)
    // 快速建群表单是**原位展开**（非浮层），关掉它回到干净状态
    await page.evaluate(() => document.getElementById('cancel-create-chat')?.click())
    await sleep(400)
    await settle(600)
  }

  /* ---------------- 弹窗测量 ---------------- */
  const measureDialog = contentId => page.evaluate(id => {
    const el = document.getElementById(id)
    if (!el) return { found: false }
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--popover)'
    document.body.appendChild(probe)
    const popoverResolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    const rectOf = node => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return {
        top: Math.round(box.top), bottom: Math.round(box.bottom),
        left: Math.round(box.left), right: Math.round(box.right),
        width: Math.round(box.width), height: Math.round(box.height),
      }
    }
    const header = el.querySelector(':scope > [data-slot="dialog-header"]')
    const body = el.querySelector(':scope > [data-slot="modal-body"]')
    const footer = el.querySelector(':scope > [data-slot="modal-footer"]')
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
      className: typeof el.className === 'string' ? el.className : '',
      rect: rectOf(el),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      width: style.width,
      maxWidth: style.maxWidth,
      borderRadius: style.borderRadius,
      backgroundColor: style.backgroundColor,
      popoverResolved,
      overflowY: style.overflowY,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      header: rectOf(header),
      body: rectOf(body),
      bodyPadding: body ? {
        top: getComputedStyle(body).paddingTop, right: getComputedStyle(body).paddingRight,
        bottom: getComputedStyle(body).paddingBottom, left: getComputedStyle(body).paddingLeft,
      } : null,
      bodyFirstChild: rectOf(body?.firstElementChild ?? null),
      footer: rectOf(footer),
      documentScrollTop: document.scrollingElement?.scrollTop ?? -1,
      activeElement: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null,
      closeButtons,
      ids: [...el.querySelectorAll('[id]')].map(node => node.id),
    }
  }, contentId)

  /* ---------------- s5-1 / s5-1b：框架与内边距 ---------------- */
  async function assertFrame(group, theme, name, metrics, tokenPx, token) {
    if (!metrics.found) {
      check(`${group} ${theme} ${name} dialog mounted`, false, `content missing`)
      return false
    }
    const { rect, viewport } = metrics
    // 令牌本体是 `w-[min(Npx,calc(100vw-48px))]`：视口 1500 时 full 解析成 1452
    // （min(1500, 1452)），所以断言分两半——① class 里真的挂着这条令牌；
    // ② 实测宽度 == min(N, 视口−48)。只断「宽度 == 1500」会是一条假红。
    const tokenClass = `w-[min(${tokenPx}px,calc(100vw-48px))]`
    check(`${group} ${theme} ${name} content carries the ${token} width token class`,
      metrics.className.includes(tokenClass), `looking for ${tokenClass}`)
    const expectedWidth = Math.min(tokenPx, viewport.width - 48)
    check(`${group} ${theme} ${name} width == min(${tokenPx}px, 100vw−48px) = ${expectedWidth}px`,
      Math.abs(rect.width - expectedWidth) <= 1 && metrics.width === `${expectedWidth}px`,
      `width=${metrics.width} rect=${round(rect.width)} expected=${expectedWidth}`)
    const gutterLeft = rect.left
    const gutterRight = viewport.width - rect.right
    check(`${group} ${theme} ${name} gutters sum = viewport − width (both ≥ 0)`,
      Math.abs((gutterLeft + gutterRight) - (viewport.width - rect.width)) <= 1 && gutterLeft >= 0 && gutterRight >= 0,
      `sum=${round(gutterLeft + gutterRight)} expected=${round(viewport.width - rect.width)}`)
    check(`${group} ${theme} ${name} horizontally centred (±1px)`,
      Math.abs(gutterLeft - gutterRight) <= 1, `left=${round(gutterLeft)} right=${round(gutterRight)}`)
    check(`${group} ${theme} ${name} vertically centred (±1px)`,
      Math.abs(rect.top - (viewport.height - rect.height) / 2) <= 1,
      `top=${round(rect.top)} bottom=${round(viewport.height - rect.bottom)} height=${round(rect.height)}`)
    check(`${group} ${theme} ${name} max-width is not the retired 512px clamp`, metrics.maxWidth !== '512px', `max-width=${metrics.maxWidth}`)
    check(`${group} ${theme} ${name} border-radius is the 10px token`, metrics.borderRadius === '10px', `border-radius=${metrics.borderRadius}`)
    check(`${group} ${theme} ${name} background resolves to --popover`, metrics.backgroundColor === metrics.popoverResolved,
      `bg=${metrics.backgroundColor} popover=${metrics.popoverResolved}`)
    for (const id of [metrics.selfId, ...metrics.ids]) if (LOAD_BEARING_IDS.includes(id)) seenLoadBearingIds.add(id)
    return true
  }

  /** s5-1b：正文行 padding token + 「正文内已知元素」的实际几何（jsdom 抓不到）。 */
  async function assertBodyPadding(group, theme, name, contentId, innerSelector, bodyPadding) {
    const probe = await page.evaluate(({ id, selector }) => {
      const dialog = document.getElementById(id)
      const header = dialog?.querySelector(':scope > [data-slot="dialog-header"]')
      const body = dialog?.querySelector(':scope > [data-slot="modal-body"]')
      const target = dialog?.querySelector(selector) ?? null
      const first = body?.firstElementChild ?? null
      if (!dialog || !header || !body || !target || !first) return { found: false }
      const dialogRect = dialog.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      const firstRect = first.getBoundingClientRect()
      const style = getComputedStyle(body)
      return {
        found: true,
        paddingTop: style.paddingTop,
        paddingLeft: style.paddingLeft,
        targetLeft: Math.round(targetRect.left - dialogRect.left),
        targetTop: Math.round(targetRect.top - headerRect.bottom),
        firstBodyTop: Math.round(firstRect.top - headerRect.bottom),
      }
    }, { id: contentId, selector: innerSelector })
    if (!probe.found) {
      check(`${group} ${theme} ${name} body padding sampling present`, false, JSON.stringify(probe))
      return
    }
    check(`${group} ${theme} ${name} body row keeps its padding token (${bodyPadding.top} / ${bodyPadding.left})`,
      probe.paddingTop === bodyPadding.top && probe.paddingLeft === bodyPadding.left,
      `padding=${probe.paddingTop} ${probe.paddingLeft}`)
    check(`${group} ${theme} ${name} body padding kept (${innerSelector} left ≥ 20px)`,
      probe.targetLeft >= 20, `left=${probe.targetLeft}`)
    check(`${group} ${theme} ${name} body padding kept (header bottom → first body element ≥ 12px)`,
      probe.firstBodyTop >= 12, `firstBodyTop=${probe.firstBodyTop} ${innerSelector}Top=${probe.targetTop}`)
  }

  /** s5-2：高度策略 + 整壳不可滚 + 列表内部可滚。 */
  async function assertHeightAndScroll(group, theme, name, metrics, listId) {
    const expected = Math.min(760, metrics.viewport.height - 48)
    check(`${group} ${theme} ${name} keeps the fixed height strategy (min(760, 100vh−48) = ${expected}px)`,
      Math.abs(metrics.rect.height - expected) <= 1, `height=${round(metrics.rect.height)} expected=${expected}`)
    check(`${group} ${theme} ${name} shell is not itself a scroll container (no second scrollbar)`,
      metrics.overflowY === 'hidden' && metrics.scrollHeight <= metrics.clientHeight + 1,
      `overflow-y=${metrics.overflowY} scrollHeight=${metrics.scrollHeight} clientHeight=${metrics.clientHeight}`)
    const list = await page.evaluate(id => {
      const el = document.getElementById(id)
      if (!el) return { found: false }
      const style = getComputedStyle(el)
      return {
        found: true, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
        overflowY: style.overflowY, overflowX: style.overflowX, items: el.children.length,
      }
    }, listId)
    check(`${group} ${theme} ${name} list region scrolls internally (${listId})`,
      list.found === true && list.scrollHeight > list.clientHeight, JSON.stringify(list))
    return list
  }

  /** s5-4：首焦 + 打开瞬间没被滚走。 */
  async function assertFocusNotScrolled(group, theme, name, metrics, expectedFocusId) {
    if (expectedFocusId) {
      check(`${group} ${theme} ${name} focuses #${expectedFocusId} on open`,
        metrics.activeElement === expectedFocusId, `activeElement=${metrics.activeElement}`)
    } else {
      info(`${group} ${theme} ${name} activeElement on open`, String(metrics.activeElement))
    }
    check(`${group} ${theme} ${name} does not scroll the shell on open (content.scrollTop === 0)`,
      metrics.scrollTop === 0, `scrollTop=${metrics.scrollTop}`)
    check(`${group} ${theme} ${name} does not scroll the page on open (document.scrollTop === 0)`,
      metrics.documentScrollTop === 0, `document.scrollTop=${metrics.documentScrollTop}`)
    check(`${group} ${theme} ${name} header stays inside the shell after the open-focus`,
      metrics.header !== null && metrics.header.top >= metrics.rect.top - 1 && metrics.header.bottom <= metrics.rect.bottom + 1,
      `header=${JSON.stringify(metrics.header)} content=${metrics.rect.top}..${metrics.rect.bottom}`)
  }

  /** s5-3：关闭钮契约 + 点击即关。 */
  async function assertCloseButton(group, theme, name, contentId, expected) {
    const metrics = await measureDialog(contentId)
    const buttons = metrics.found ? metrics.closeButtons : []
    check(`${group} ${theme} ${name} has exactly one close button`, buttons.length === 1, JSON.stringify(buttons))
    const button = buttons[0]
    check(`${group} ${theme} ${name} close button is #${expected.id}`, button?.id === expected.id, JSON.stringify(button))
    check(`${group} ${theme} ${name} close button aria-label is 「${expected.label}」`, button?.label === expected.label, `label=${button?.label}`)
    check(`${group} ${theme} ${name} close button renders one visible svg and no × text`,
      button?.visibleSvgs === 1 && button?.svgs === 1 && button?.text === '', JSON.stringify(button))
    await page.evaluate(id => document.getElementById(id)?.click(), expected.id)
    const gone = await waitGone(contentId)
    check(`${group} ${theme} ${name} closes when the close button is clicked`, gone === true, `#${contentId} still mounted=${!gone}`)
  }

  /** s5-6：footer 钉底（滚动列表前后几何不变 + 确认钮始终可见 + 滚动真的发生）。 */
  async function assertFooterPinned(group, theme) {
    const snapshot = () => page.evaluate(() => {
      const content = document.getElementById('group-template-modal')
      const list = document.getElementById('group-template-list')
      const confirm = document.getElementById('confirm-group-template-create')
      const header = content?.querySelector(':scope > [data-slot="dialog-header"]')
      const footer = content?.querySelector(':scope > [data-slot="modal-footer"]')
      if (!content || !list || !confirm || !header || !footer) return { found: false }
      const box = node => {
        const rect = node.getBoundingClientRect()
        return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), height: Math.round(rect.height) }
      }
      const contentRect = content.getBoundingClientRect()
      const confirmRect = confirm.getBoundingClientRect()
      return {
        found: true,
        header: box(header),
        footer: box(footer),
        confirm: box(confirm),
        listScrollTop: list.scrollTop,
        listScrollHeight: list.scrollHeight,
        listClientHeight: list.clientHeight,
        confirmVisible: confirmRect.top >= contentRect.top - 1 && confirmRect.bottom <= contentRect.bottom + 1
          && confirmRect.left >= contentRect.left - 1 && confirmRect.right <= contentRect.right + 1,
      }
    })
    const before = await snapshot()
    await page.evaluate(() => {
      const list = document.getElementById('group-template-list')
      if (list) list.scrollTop = list.scrollHeight
    })
    await settle(800)
    const after = await snapshot()
    if (!before.found || !after.found) {
      check(`${group} ${theme} group template footer sampling present`, false, JSON.stringify({ before, after }))
      return
    }
    check(`${group} ${theme} the template list really scrolled (guards against a vacuous pass)`,
      after.listScrollTop > 0 && after.listScrollTop > before.listScrollTop,
      `scrollTop ${before.listScrollTop} → ${after.listScrollTop} (scrollHeight=${after.listScrollHeight} clientHeight=${after.listClientHeight})`)
    check(`${group} ${theme} modal header geometry is unchanged by scrolling the list`,
      JSON.stringify(before.header) === JSON.stringify(after.header), `${JSON.stringify(before.header)} vs ${JSON.stringify(after.header)}`)
    check(`${group} ${theme} [data-slot="modal-footer"] geometry is unchanged by scrolling the list (pinned)`,
      JSON.stringify(before.footer) === JSON.stringify(after.footer), `${JSON.stringify(before.footer)} vs ${JSON.stringify(after.footer)}`)
    check(`${group} ${theme} #confirm-group-template-create stays visible inside the shell after scrolling`,
      before.confirmVisible === true && after.confirmVisible === true, `before=${before.confirmVisible} after=${after.confirmVisible}`)
  }

  /* ---------------- s5-5：关闭语义（两个弹窗相反） ---------------- */
  async function assertNotesCloseSemantics(group, theme) {
    // Escape 关
    await page.keyboard.press('Escape')
    const escapeGone = await waitGone('all-notes-modal')
    check(`${group} ${theme} all-notes closes on Escape`, escapeGone === true, `still mounted=${!escapeGone}`)
    await sleep(400)
    // 背板点击关（完整指针序列：mouse.click 会走 pointerdown/mousedown/mouseup/click）
    await settle(200)
    await openNotes()
    const hit = await page.evaluate(() => {
      const node = document.elementFromPoint(20, 20)
      return { slot: node?.getAttribute('data-slot') ?? node?.closest('[data-slot]')?.getAttribute('data-slot') ?? '', tag: node?.tagName ?? '' }
    })
    check(`${group} ${theme} the click target for the backdrop check is the overlay`, hit.slot === 'dialog-overlay', JSON.stringify(hit))
    await page.mouse.click(20, 20)
    const backdropGone = await waitGone('all-notes-modal')
    check(`${group} ${theme} all-notes closes when the backdrop is clicked (pointer sequence, not a bare click())`,
      backdropGone === true, `still mounted=${!backdropGone}`)
    await sleep(400)
  }

  async function assertGtmCloseSemantics(group, theme) {
    // Escape 关
    await page.keyboard.press('Escape')
    const escapeGone = await waitGone('group-template-modal')
    check(`${group} ${theme} group template closes on Escape`, escapeGone === true, `still mounted=${!escapeGone}`)
    await sleep(400)
    // 背板点击**不**关
    await settle(200)
    await openGtm()
    const hit = await page.evaluate(() => {
      const node = document.elementFromPoint(20, 20)
      return { slot: node?.getAttribute('data-slot') ?? node?.closest('[data-slot]')?.getAttribute('data-slot') ?? '', tag: node?.tagName ?? '' }
    })
    check(`${group} ${theme} the click target for the backdrop check is the overlay`, hit.slot === 'dialog-overlay', JSON.stringify(hit))
    await page.mouse.click(20, 20)
    await sleep(1200)
    const stillThere = await exists('group-template-modal')
    check(`${group} ${theme} group template survives a backdrop click (closeOn="escape-only")`,
      stillThere === true, `#group-template-modal mounted=${stillThere}`)
    // 反「恒真」护栏：同一次会话里 × 与 Escape 仍必须能关（否则上面那条可能是「弹窗根本没打开」）
    await page.keyboard.press('Escape')
    const escapeStillWorks = await waitGone('group-template-modal')
    check(`${group} ${theme} group template still closes on Escape after the ignored backdrop click`,
      escapeStillWorks === true, `still mounted=${!escapeStillWorks}`)
    await page.evaluate(() => document.getElementById('cancel-create-chat')?.click())
    await sleep(400)
  }

  /* ======================= 单个主题的完整 pass ======================= */
  async function runPass(theme, { first = false } = {}) {
    // ---------------- 全部笔记 ----------------
    await openNotes({ raw: first })
    await shot(page, `01-all-notes-${theme}`)
    const notes = await measureDialog('all-notes-modal')
    await assertFrame('s5-1', theme, 'all-notes', notes, 1160, '2xl')
    await assertBodyPadding('s5-1b', theme, 'all-notes', 'all-notes-modal', '#all-notes-list', { top: '24px', left: '24px' })
    await assertHeightAndScroll('s5-2', theme, 'all-notes', notes, 'all-notes-list')
    await assertFocusNotScrolled('s5-4', theme, 'all-notes', notes, null)
    // s5-7：两栏工作区
    const notesColumns = await page.evaluate(() => {
      const workspace = document.querySelector('.all-notes-workspace')
      const list = document.getElementById('all-notes-list')
      const editor = document.querySelector('.all-notes-editor-shell')
      if (!workspace || !list || !editor) return { found: false }
      return {
        found: true,
        template: getComputedStyle(workspace).gridTemplateColumns,
        listWidth: Math.round(list.getBoundingClientRect().width),
        editorLeft: Math.round(editor.getBoundingClientRect().left),
        listLeft: Math.round(list.getBoundingClientRect().left),
      }
    })
    {
      const tracks = notesColumns.found ? splitTracks(notesColumns.template) : []
      check(`s5-7 ${theme} all-notes workspace is a 240px + 1fr two-column grid`,
        notesColumns.found === true && tracks.length === 2 && Math.abs(Number.parseFloat(tracks[0]) - 240) <= 0.5,
        `tracks=${JSON.stringify(tracks)} raw=${notesColumns.template}`)
      check(`s5-7 ${theme} all-notes left column measures 240px`,
        notesColumns.found === true && Math.abs(notesColumns.listWidth - 240) <= 1, `listWidth=${notesColumns.listWidth}`)
      check(`s5-7 ${theme} all-notes editor starts right of the list`,
        notesColumns.found === true && notesColumns.editorLeft >= notesColumns.listLeft + 240, JSON.stringify(notesColumns))
    }
    // s5-8：对比度（主文本 ≥4.5 / 次级文本 ≥3）
    await assertContrast(page, 's5-8', theme, ['#all-notes-list .all-note-target-title'], 4.5, 'primary')
    await assertContrast(page, 's5-8', theme, ['#all-notes-list [aria-pressed="true"] .all-note-target-title'], 4.5, 'primary (selected)')
    await assertContrast(page, 's5-8', theme, ['#all-notes-list .all-note-target-meta'], 3, 'secondary')
    await assertContrast(page, 's5-8', theme, ['#all-notes-list [aria-pressed="true"] .all-note-target-meta'], 3, 'secondary (selected item, on --accent)')
    // s5-5：Escape 关 + 背板点击关
    await assertNotesCloseSemantics('s5-5', theme)
    // s5-3：关闭钮（放在最后——点完即关）
    await openNotes()
    await assertCloseButton('s5-3', theme, 'all-notes', 'all-notes-modal', { id: 'close-all-notes', label: '关闭全部笔记' })
    check(`s5-3 ${theme} all-notes gone after close`, !(await exists('all-notes-modal')))
    await sleep(400)

    // ---------------- 群模板 ----------------
    await openGtm()
    await shot(page, `02-group-template-${theme}`)
    const gtm = await measureDialog('group-template-modal')
    await assertFrame('s5-1', theme, 'group template', gtm, 1500, 'full')
    await assertBodyPadding('s5-1b', theme, 'group template', 'group-template-modal', '#group-template-list', { top: '16px', left: '24px' })
    await assertHeightAndScroll('s5-2', theme, 'group template', gtm, 'group-template-list')
    await assertFocusNotScrolled('s5-4', theme, 'group template', gtm, 'group-template-search')
    // s5-7：多列网格
    const gtmGrid = await page.evaluate(() => {
      const list = document.getElementById('group-template-list')
      if (!list) return { found: false }
      const options = [...list.querySelectorAll('.group-template-option')].slice(0, 2).map(option => {
        const rect = option.getBoundingClientRect()
        return { left: Math.round(rect.left), top: Math.round(rect.top) }
      })
      return { found: true, template: getComputedStyle(list).gridTemplateColumns, options }
    })
    {
      const tracks = gtmGrid.found ? splitTracks(gtmGrid.template) : []
      check(`s5-7 ${theme} group template list is a multi-column grid (≥2 columns at 1500px)`,
        gtmGrid.found === true && tracks.length >= 2, `tracks=${tracks.length} raw=${gtmGrid.template}`)
      check(`s5-7 ${theme} the first two template cards really flow into different columns`,
        gtmGrid.found === true && gtmGrid.options.length === 2
        && gtmGrid.options[0].top === gtmGrid.options[1].top && gtmGrid.options[1].left > gtmGrid.options[0].left,
        JSON.stringify(gtmGrid.options))
    }
    // s5-8：对比度
    await assertContrast(page, 's5-8', theme, ['#group-template-list .group-template-summary'], 3, 'secondary')
    await assertContrast(page, 's5-8', theme, ['#group-template-list .group-template-meta'], 3, 'secondary')
    await assertContrast(page, 's5-8', theme, ['#group-template-list .group-template-role-count'], 3, 'secondary')
    await assertContrast(page, 's5-8', theme, ['#group-template-list .group-template-category'], 4.5, 'primary')
    // s5-6：footer 钉底
    await assertFooterPinned('s5-6', theme)
    // s5-5：Escape 关 + 背板点击不关
    await assertGtmCloseSemantics('s5-5', theme)
    // s5-3：关闭钮
    await openGtm()
    await assertCloseButton('s5-3', theme, 'group template', 'group-template-modal', { id: 'close-group-template-modal', label: '关闭群聊模板' })
    check(`s5-3 ${theme} group template gone after close`, !(await exists('group-template-modal')))
    await page.evaluate(() => document.getElementById('cancel-create-chat')?.click())
    await sleep(400)
  }

  // ---------------- 暗色 pass ----------------
  await runPass('dark', { first: true })

  // ---------------- s5-11：响应式（只用暗色一遍） ----------------
  await openNotes()
  await page.setViewport({ width: 700, height: 900, deviceScaleFactor: 1 })
  await settle()
  const narrow = await page.evaluate(() => {
    const workspace = document.querySelector('.all-notes-workspace')
    const list = document.getElementById('all-notes-list')
    const editor = document.querySelector('.all-notes-editor-shell')
    if (!workspace || !list || !editor) return { found: false }
    const listRect = list.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    return {
      found: true,
      template: getComputedStyle(workspace).gridTemplateColumns,
      listDisplay: getComputedStyle(list).display,
      listOverflowX: getComputedStyle(list).overflowX,
      listBorderRight: getComputedStyle(list).borderRightWidth,
      listScrollWidth: list.scrollWidth,
      listClientWidth: list.clientWidth,
      listTop: Math.round(listRect.top),
      listLeft: Math.round(listRect.left),
      editorTop: Math.round(editorRect.top),
      editorLeft: Math.round(editorRect.left),
      targetMinWidth: getComputedStyle(list.querySelector('.all-note-target')).minWidth,
    }
  })
  await shot(page, '04-all-notes-narrow-700')
  {
    const tracks = narrow.found ? splitTracks(narrow.template) : []
    // ⚠️ 视口用 700（<760）：Tailwind v4 的 max-[760px]: 编译成 `width < 760`，
    // legacy 的 (max-width: 760px) 含 760 —— 拿 760 当视口会拿到两栏而误红。
    // 这个 1px 边界差已决：接受，不做 hack。
    check('s5-11 narrow (700px < 760) all-notes workspace collapses to a single column',
      narrow.found === true && tracks.length === 1, `tracks=${JSON.stringify(tracks)} raw=${narrow.template}`)
    check('s5-11 narrow the list stacks above the editor (same left, different top)',
      narrow.found === true && narrow.listTop < narrow.editorTop && Math.abs(narrow.listLeft - narrow.editorLeft) <= 1,
      JSON.stringify({ listTop: narrow.listTop, editorTop: narrow.editorTop, listLeft: narrow.listLeft, editorLeft: narrow.editorLeft }))
    check('s5-11 narrow the list turns into a horizontally scrollable band',
      narrow.found === true && narrow.listDisplay === 'flex' && narrow.listOverflowX === 'auto' && narrow.listBorderRight === '0px'
      && narrow.listScrollWidth > narrow.listClientWidth,
      JSON.stringify(narrow))
    check('s5-11 narrow the note targets keep the 160px min width',
      narrow.found === true && narrow.targetMinWidth === '160px', `minWidth=${narrow.targetMinWidth}`)
  }
  await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 })
  await settle()
  const wide = await page.evaluate(() => {
    const workspace = document.querySelector('.all-notes-workspace')
    const list = document.getElementById('all-notes-list')
    if (!workspace || !list) return { found: false }
    return { found: true, template: getComputedStyle(workspace).gridTemplateColumns, listWidth: Math.round(list.getBoundingClientRect().width) }
  })
  {
    const tracks = wide.found ? splitTracks(wide.template) : []
    check('s5-11 ≥1024px restores the two-column workspace (240px + 1fr)',
      wide.found === true && tracks.length === 2 && Math.abs(Number.parseFloat(tracks[0]) - 240) <= 0.5,
      `tracks=${JSON.stringify(tracks)} raw=${wide.template}`)
    check('s5-11 ≥1024px the left column measures 240px again',
      wide.found === true && Math.abs(wide.listWidth - 240) <= 1, `listWidth=${wide.listWidth}`)
  }
  await page.keyboard.press('Escape')
  await waitGone('all-notes-modal')
  await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
  await sleep(600)

  // ---------------- 浅色 pass ----------------
  await seed('light')
  check('s5-0 light theme applied after re-seeding', await page.evaluate(() => document.documentElement.dataset.theme === 'light'))
  await installKillSwitch()
  await runPass('light')

  // 承重 id 汇总
  for (const id of LOAD_BEARING_IDS) {
    check(`s5-3 load-bearing id #${id} observed`, seenLoadBearingIds.has(id), `seen=${[...seenLoadBearingIds].join(',')}`)
  }

  console.log('\n==== s5 acceptance summary ====')
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
