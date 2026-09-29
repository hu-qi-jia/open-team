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
