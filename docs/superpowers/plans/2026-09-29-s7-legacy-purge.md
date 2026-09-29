# S7 计划：legacy.css 清零 + 全量回归复拍（UI 重塑收官阶段）

日期：2026-09-29　前置：S6 已合并 main（`45922bf`）并推送 github。
规格：docs/superpowers/specs/2026-09-28-shadcn-ui-rebuild-design.md（绞杀者模式终点站）。

## 目标

`src/teamPage/ui/styles/legacy.css`（现 1724 行 / 192 个顶层块）**整文件删除**：
所有规则迁入 utilities / 专题 css / globals 各层，或确认 dead 后直接退役；
globals.css 摘掉 `@import "./legacy.css" layer(legacy)` 与 `@layer` 声明里的
legacy 槽位；全部探针的 legacy 计数断言改为「文件不存在」语义。

## 现状构成（S6 收官后侦查，剥注释 1519 行）

| 族 | 规模 | 主要消费方 | 去向 |
|---|---|---|---|
| `.orchestration-status-*`（状态卡本体） | ~70 行含暗色 | OrchestrationStatusCard.tsx | T2 utilities 化 |
| `.orchestration-mini-*`（迷你流程图 SVG） | ~30 行 | 同上（svg 节点） | T2 utilities 化 |
| `.notes-editor` / `.note-tool-btn` / `.note-toolbar` / `.all-note-*` | ~30 行 | notes/ 组件 | T3 utilities 化 |
| `.mention-*`（avatar/shortcut） | ~15 行 | MentionPicker / 消息 | T3 utilities 化 |
| `.message-tool-btn` / `.message-site-jump-btn` 等 | ~20 行 | chat/Messages | T3 utilities 化 |
| `.manual-mention-toggle` | ~15 行 | composer/消息 | T3 utilities 化 |
| 壳层/列表（.workspace/.chat-header/.sidebar/.settings-menu/.launcher/brand/.chat-row/.chat-title/.chat-avatar/.chat-create-*/.mode-*） | ~80 行 | shell/ + chat/ | T4 utilities 化 |
| `.theme-switch` / `.theme-option` | ~15 行 | SettingsMenu / themeController | T4 |
| `.template-list` / `.template-card` / `.chat-create-template-*` | ~10 行 | 群模板 / 建群表单 | T4 |
| `#iframe-host`（16 块） | ~35 行 | vanilla iframeHost 注入 DOM（非 React） | T5 专题文件 `styles/iframe-host.css` |
| 表单/文案通用（.field/.two-col/.modal-form/.section-title/.tiny/.muted/.reference-box） | ~25 行 | 多组件共享 | T5 评估：`@apply` 进 globals components 层或逐组件 utilities |
| base 元素（select/textarea/label/button/p/h1-h3/body/*） | ~50 行 | 全局 | T5 → globals.css base 层 |
| `:root[data-theme]` 变量块 ×2 | ~30 行 | 全局 token | T5 → globals theme 层核对（大部分已在 shadcn token 内，防重复定义） |
| `@media (max-width: 1120px / 720px)` ×2 | ~40 行 | 全局响应式 | T5 → 各组件 `max-[720px]:` 变体（s5-11 已有先例） |
| `.orchestration-review-*` / 隐藏钩子（#settings-button[hidden] 等） | ~25 行 | 编排 / 壳 | T5 考证消费方后定 |

## 任务分解

- **T1 侦察定案**（本文件即产出粗表）：逐块核对消费方，标注「活/dead/搬/改」；
  特别考证隐藏钩子（React hidden 属性 vs legacy `display:none`）与 `:root` 变量
  是否与 shadcn token 重复。
- **T2 状态卡全量 utilities 化**：`.orchestration-status-*` + `.orchestration-mini-*`
  迁 OrchestrationStatusCard.tsx 的 className（S6 已有 floating 定位先例）；
  探针 s6-7 锚点断言不动，mini 图断言补进 s6。
- **T3 笔记 + 提及 + 消息工具族**：notes/mention/message-tool 三族迁 utilities；
  同步 s3-12 ⑤「shared families survive」断言改数。
- **T4 壳层/列表/主题/模式/模板卡族**：最大批（~80 行 + 暗色浅色对），涉及
  AppShellFrame/ChatList/ChatHeader/SettingsMenu/QuickCreateChat；
  s1/s2 探针的 legacy 断言逐条同步。
- **T5 iframe-host 专题 + 通用/base/:root/media 收尾**：`styles/iframe-host.css`
  （unlayered，同 canvas 先例）；base 元素进 globals base 层；media query 改
  utilities 变体；隐藏钩子考证后删或留。
- **T6 文件删除 + 探针大改数 + 全量回归**：
  - 删 legacy.css 与 globals.css 的 @import / @layer 槽位；
  - 探针改数：s3-12（shared families → 专题文件断言）、s5-9（legacy 行数 → 0/文件不存在）、
    s6-8（status-floating absolute 断言改读 dist）、s1/s2/s4 各 legacy 审计组；
  - `npm run verify` + 全部探针复跑 + 明暗双主题全量复拍。

## 退役总账（legacy.css 585 行注释的浓缩存档）

legacy.css 删文件后，其 585 行「为什么删/迁到哪」的 rationale 从源码里消失。
这里留一份按族归类的总账，供后续回归时对照（逐条细节仍在 git 历史里）。

### 判死直删的三类（不迁、无视觉变化）
1. **零消费死族**：主题分段控件（`.theme-switch`/`.theme-option`）、设置菜单
   （`.settings-menu`）、旧壳挂名族（`.sidebar` 全家 / `.brand-mark` /
   `.logo-dot` / `.workspace` / `.chat-header` / `.chat-title*` /
   `.chat-subtitle` / `#chat-status`）、`.manual-mention-toggle`、
   `.template-card.active`、`.icon-btn` / `.floating-toolbar` / `.window-dot`
   （窗控三钮 React 化后废弃）、`#d4d4d8-role-form`。
2. **被 utilities 恒压的死覆盖**：`.mode-options` / `.mode-name` /
   `.chat-create-template-btn` / `.two-col` / `.role-name` / `.all-note-toolbar`
   底色 / `.reference-box` 的 border-bg-color 等——调用点已有同值或更强的
   utilities，规则从不生效。
3. **`[hidden]` 归 preflight**：`#settings-button[hidden]` /
   `#open-orchestration[hidden]` / `.launcher[hidden]` / `.field[hidden]` /
   `.site-segment[hidden]`——Tailwind v4 preflight 的
   `[hidden]:where(:not([hidden=until-found])){display:none!important}` 带
   `!important`，压得住 utilities 层的 display。

### 搬往 globals.css components 层（选择器穿透 / 动态 DOM 例外）
- `.role-tone-*` / `.site-pill*` 动态色板（S3 Task 4）+ 四位「靠源序压过基类」
  的冲突伴侣：`.add-person-site-option` / `.role-site-badge` /
  `#iframe-host .role-frame-site` / `.orchestration-person-site`。
- `.notes-editor .ProseMirror` 后代 ×4（ProseMirror 动态 DOM）、
  `.message-tool-btn::after` tooltip ×2（伪元素声明集过大）。
- `.markdown-body` 排版规则（S2 Task 4 原文搬迁）。
- `.app-shell` 几何 / `.sidebar-resize-handle`（S1 Task 7）。

### 搬往 unlayered 专题文件（库/非 React DOM 无法加 className）
- `styles/orchestration-canvas.css`：X6 画布 11 条（S6/T5）。
- `styles/iframe-host.css`：`#iframe-host` 全族（S7/T5-a）。unlayered 理由同
  画布；搬迁时逐属性对照 globals V5 iframe 规则，被覆盖的死声明就地丢弃。

### 搬往 globals.css base 层（S7/T5-c）
- body 的 min-height/overflow/CJK 字体栈、h1/h2/h3、label、
  input·textarea·select 本体 + `:focus` + 浅色覆盖、`:root` 的
  `color-scheme` 两条。
- ⚠️ `input` 系的 `color` 必须显式迁：preflight 给表单元素是
  `color:inherit`，删了会取到 label 的 muted-foreground。
- 判死未迁（preflight 同值）：`*` 的 box-sizing、body 的 `margin:0`、
  button 的 `border:0`、h1-h3+p 的 `margin:0`、表单 `font:inherit`、
  textarea 的 `resize:vertical`。

### 翻成行内 utilities（亮色默认 + `dark:` 覆盖单份表达）
- T2 状态卡族、T3 笔记/提及/消息工具九族、T4 壳层/列表/主题/模式/模板卡族、
  T5 通用族（`.muted`/`.tiny`/`.field`/`.modal-form`/`.section-title`/
  `.reference-box`/`.role-*`/`.message-*`/.orchestration-review-*）。
- **语义类名一律保留在 TSX 上**作测试与探针钩子——「删规则」不等于「删类名」。
- 浅色专属声明（暗色侧本就没有对应规则）用新增的 `light:` 变体承载
  （globals.css 的 `@custom-variant light`，`dark:` 的反面）。

### ⚠️ 前序纠正：死变量误判（T5-b 补账）
T2–T5-a 曾按「变量零定义」判死 `--text/--subtle/--shadow/--glow`。
**这是误判**：四者由 globals.css components 层的 V5 remap 块真定义
（167/177/184-185 暗色，206-207/214-215 浅色）。已补回两处可见回归：
launcher 的 `box-shadow: var(--shadow), var(--glow)` 与浅色
`.chat-frame-group-title` 的 `color: var(--text)`。第三处 `.mode-name` 的
`color: var(--text)` 经查无回归（继承链同值 + `.mode-help` 自带
`text-muted-foreground`），不补。**教训：判「变量零定义」前必须全库 grep
定义点，不能只看 legacy.css。**

### Tailwind v4 陷阱（T4）
`background` 简写里「渐变 + 纯色」合成一条 `bg-[...]` 会被整体推断为
`background-image`，纯色层非法 → **整条声明被静默丢弃**（launcher 暗色变白
圆）。修复：拆 `bg-[rgba(...)]` + `bg-[radial-gradient(...)]` 两条。

## 纪律（沿用）

- 每任务「先红后绿」：改数前探针必红，迁完必绿；不许跳过红灯直接改数。
- 计数口径一律「剥注释后出现次数」；改数注释须附原因（S6 先例）。
- 禁止 `git add -A`；每任务一提交；门禁 = typecheck + vitest + build + 相关探针。
- 分支 `feature/react-ui-s7`；完成后合并 main 并推送（网络已恢复）。

## 已知风险

1. **暗色/浅色规则对**：legacy 里大量 `:root[data-theme="light"]` 补丁与暗色
   基线成对，utilities 化时用 `dark:` 变体合并（S6/T4 模式），漏配会出主题
   回归——每族迁完必须明暗双拍。
2. **媒体查询语义漂移**：1120px/720px 断点改为组件变体后，断点归属从「全局
   布局」变「组件自查」，需在 s1/s2 探针里保留等价断言。
3. **:root 变量重复定义**：legacy `:root[data-theme="dark"]` 与 globals `@theme`
   可能定义同名变量，合并时以后者为准，删除前逐一比对值。
4. **iframe-host 是 vanilla 消费**：样式选择器被 index.tsx 的 requireElement
   链依赖，只能整块搬家不能重写。
