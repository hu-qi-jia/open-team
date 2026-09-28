# S5 计划：全部笔记弹窗 + 群模板弹窗 → `AppModal`

> 分支 `feature/react-ui-s5`（自 `main` = `271c81a` 起）。执行方式沿用**子代理驱动**：
> 每任务一份简报 → **一个**实现者（禁止并行派发多个实现子代理）→ 报告 → **独立只读复审** → 修复轮 → 下一任务；
> 阶段末全分支终审 → **本地 `--no-ff` 合并回 main**（不 push）。
> 设计权威：`docs/superpowers/specs/2026-09-28-shadcn-ui-rebuild-design.md`（§206 把 S5 记为「全部笔记 + 外部模型 + 群模板」，
> **外部模型已由 S4 交付**，故本阶段实际是**两个**弹窗）。

## 阶段目标

把最后两个未迁移的弹窗收进 S4 建立的公共壳 `common/AppModal.tsx`，并**为此给壳补两个 S4 没做的能力**：

1. `notes/AllNotesModal.tsx`（全部笔记）→ `AppModal`
2. `shell/GroupTemplateModal.tsx`（群模板）→ `AppModal`

完成后，spec 里 10 个弹窗**全部**由 `AppModal` 承载，S6 只剩编排 3 弹窗（它们直接复用本阶段补齐的 `footer` 槽）。

---

## Global Constraints（沿用 S4，全部仍然有效）

- **runtime 不许动**：`iframeHost` / `sendWithReconnect` / 编排 runtime / `notesBridge` / `useFloatingPanelGeometry`。
- **零新增 npm 依赖**；**禁止** git worktree、**禁止** junction `node_modules`；**禁止** `position: fixed`；**禁止** push。
- **评审者只读**（除自己的 review 文件）；**禁止**并行派发多个实现子代理。
- **复审期间冻结分支**：独立复审在跑时，编排者**不许再推 commit**（只能改 `.superpowers/` 下已 gitignore 的文件）。
  T1 复审期间推了 6 个 docs-only 提交，导致**被审 commit 的 HEAD 在复审途中漂移**——复审者只能逐 blob 核对
  才敢下结论。这是自找的不确定性，后续任务一律避免。
- **门禁**：每任务 `npm run typecheck` + 触及的测试文件 + `npm run build` 全绿才算完成；阶段末跑全量。
  已知既有失败豁免：`packages/openteamcli` ×2、`extensionConfig` ×1、`QuickCreateChat` 4 条 `css-syntax-error` minify 警告。
- **正文内边距必须显式接管**：`AppModal` 用 `p-0` 收掉原语 `DialogContent` 的 `p-6`，正文内边距**没有别的来源**。
  本阶段两个弹窗都是**自定义布局**（两栏工作区 / 网格），按各自结构决定内边距落点，但**必须有**，
  且 jsdom 抓不到——只有 T5 的几何断言能看见。
- **写进简报/断言的实测值，落笔前自己重测一次**（S4 教训：简报里出现过被实测推翻的旧值）。
  **不许写「负面存在性」断言**（「X 在 dist 里出现 0 次」这类值会随 Tailwind 合并同值规则而变）。
  计数必须说明是**行数**还是**出现次数**（`grep -c` vs `grep -o | wc -l`）。
- **Tailwind 变体先探针后落笔**：本阶段要用到 `max-[760px]:` 断点变体与多值 `grid-rows-[...]`。
  ✅ **编排者已用 `@tailwindcss/node` 探针实测 13/13 全部存在**（2026-09-29，脚本
  `.superpowers/s5-notes-templates/_scratch/probe-candidates.mjs`）：`max-[760px]:grid-cols-1`、
  `max-[760px]:max-h-none`、`max-[760px]:overflow-x-auto`、`max-[760px]:border-r-0`、
  `grid-rows-[auto_minmax(0,1fr)_auto]`、`grid-rows-[auto_minmax(0,1fr)]`、`grid-cols-[240px_minmax(0,1fr)]`、
  `grid-cols-[repeat(auto-fit,minmax(520px,1fr))]`、`min-w-[160px]`、`content-start`、
  `max-h-[min(620px,calc(100vh-150px))]` + 两个控制组。
  ⚠️ 探针只证「Tailwind 认识这个类」，**不证「扫描器没吞掉它」**——每个任务仍须在 `npm run build` 后
  回 `dist/team.css` 复核一次（紧贴 `${` 的类名会被静默丢弃）。
- ⚠️ **探针种子陷阱**：`src/group/store.ts:96` 的 `loadStore()` 一旦发现 `openteam.meta.v2` 就直接返回、
  根本不读 `openteam.groupStore`。**任何要扫多个种子值、或中途关开弹窗再重种的脚本，必须先
  `chrome.storage.local.clear()` 再写种子**（否则第二趟起种子被完全遮住，症状是「无论种几个都只有上一次那几个」）。
- **删 legacy 规则前必须重新 grep 活消费者**（见 [[legacy-rule-retirement-check-live-consumers]]）：
  「使用者已迁完」不可信，结构属性（grid/gap/padding）最易漏迁，且门禁抓不到。
  ⚠️ 必须按**裸串**搜（锚定 `^\.类名` 会漏掉分组选择器里的成员），并注意**前缀碰撞**。

---

## 现状实测基线（2026-09-29 编排者实测，供各任务写期望值）

### A. `notes/AllNotesModal.tsx`（178 行）

| 量 | 现状 |
| --- | --- |
| 宽度 | `min(980px, calc(100vw - 48px))`——**TSX 与 legacy 两边都写了，数值完全相同**（纯重复，不是打架） |
| 高度 | `max-height: min(760px, calc(100vh - 48px))` + `overflow: hidden`；**内容驱动、非定高** |
| 工作区 | `.all-notes-workspace`：`grid-template-columns: 240px minmax(0, 1fr)`，`min-height: min(620px, calc(100vh - 150px))`，`border-top` |
| 左栏 | `.all-notes-list`：`max-height: min(620px, calc(100vh - 150px))` + `overflow: auto` + `padding: 14px` + `border-right` + 底色 `rgba(4,12,18,.2)` |
| 右栏 | `.all-notes-editor-shell`：`grid-template-rows: auto auto minmax(0,1fr)`；`.all-notes-editor { min-height: 360px }` |
| 响应式 | `@media (max-width: 760px)`：工作区变**单栏**，列表变 `display:flex` + 横向滚动 + `max-height:none`，`.all-note-target` 加 `min-width:160px` |
| 头部 | `DialogHeader` 手写 `flex-row items-start justify-between gap-4 text-left`（**无 border-b**）+ 手写关闭钮（**裸 `×` 文本**） |
| 关闭语义 | **Escape 关 + 背板点击关**（`AllNotesModal.test.tsx:183` 断言背板点击后弹窗消失） |
| 首焦 | **无** `onOpenAutoFocus`；靠 `engine.focusWhenReady()` 聚焦编辑器 |

### B. `shell/GroupTemplateModal.tsx`（262 行）

| 量 | 现状 |
| --- | --- |
| 宽度 | `min(1500px, calc(100vw - 32px))`——**唯一来源是 TSX**，legacy 无 width 声明 |
| 高度 | `.group-template-modal`：`min-height: min(820px, calc(100vh - 24px))` + `max-height: calc(100vh - 24px)` + `overflow: hidden`；**四行网格** `grid-template-rows: auto auto minmax(0,1fr) auto`（头 / 工具行 / 列表 / 页脚） |
| 列表 | `.group-template-list`：`grid-template-columns: repeat(auto-fit, minmax(520px, 1fr))` + `gap:16px` + `max-height: min(720px, calc(100vh - 240px))` + `overflow: auto` |
| 页脚 | `.group-template-footer`：`display:flex; justify-content:flex-end; padding-top:14px` |
| 头部 | 与 A 同款手写头部 + **裸 `×`** 关闭钮 |
| 关闭语义 | **Escape 关 + 背板点击不关**（`GroupTemplateModal.test.tsx:235-237` 断言外点后弹窗仍在）；实现是 `onInteractOutside={e => e.preventDefault()}` |
| 首焦 | 自有 `onOpenAutoFocus` → `document.getElementById('group-template-search')?.focus()`——**裸 `.focus()`** |
| 空态 | `Empty` 原语 + `group-template-empty col-span-full min-h-60 p-6 md:p-8` |

### C. 规则归属（`legacy.css` 2769 行；`globals.css` 对这两组类名**零命中**）

**A 组独占、可退役**：`.all-notes-modal`(1077)、`.all-notes-workspace`(1083)、`.all-notes-list`(1090)、
`.all-notes-empty`(1101)、`.all-note-target` 族(1109–1156)、`.all-notes-editor-shell`(1158)、
`.all-notes-editor-header`(1165, 1174)、`.all-notes-editor`(1184)，媒体查询 1188–1203，
及下面**逐条判过**的浅色对应。

**浅色块逐条判（⚠️ 2026-09-29 订正：原写「2509–2511」会误导 T4——2509 是共享族）**：

| 行 | 形态 | 处置 |
| --- | --- | --- |
| 2321–2327 | **分组**：`.chat-header, .note-toolbar, .all-notes-workspace, .all-notes-editor-header, #iframe-host .chat-frame-group-title, #iframe-host .role-frame-label { border-color }` | **只摘成员** 2323/2324，其余 4 个成员**原样保留**（`note-toolbar` 是共享族） |
| 2459–2462 | **分组**：`.template-card.active, .all-note-target.active { … }` | 只摘 2461（`.all-note-target.active`），**`.template-card.active` 留给 S6/S7** |
| 2498 | 独立：`.all-note-toolbar { background:#fff }` | **保留**——`all-note-toolbar` 是共享族，被守卫测试钉住（规则在、视觉由 utilities 接管） |
| 2509–2523 | **分组 13 个成员**（`.notes-editor` + `.all-note-target` + `.all-note-target-title` + 10 个 `.orchestration-*`） | 只摘 **2510/2511**；**2509 `.notes-editor` 是共享族必须留**，orchestration 10 个全留 |
| 2525 / 2529 / 2533 | 三条独立：`.all-notes-list` / `.all-notes-editor-header` / `.all-notes-editor-header h3` | 整条删 |
| 2537–2538 | 独立组：`.all-note-target:hover, :focus-visible` | 整条删 |

**除上表外，浅色块里其余提到 note 的行都属于共享族，一律不动**：`2322 .note-toolbar`、`2474/2502/2503 .note-tool-btn`、
`2509 .notes-editor`。

**B 组独占、可退役**：`.group-template-*`，`^\.group-template` 实测 **28 个行首命中 = 24 条规则**
（⚠️ 别把命中行数当规则数：1359–1361 与 1396–1398 是两组**多行选择器**，续行 4 行）。
规则起始行：1309/1317/1323/1328/1335/1339/1347/1359/1368/1378/1396/1405/1412/1418/1425/1436/1443/1453/1464/1472/1480/1490/1499/1505。
**无 `@media` 块**（与 A 组不同，B 组没有响应式规则）。及下面逐条判过的浅色对应。

⚠️ **2026-09-29 订正：原写的浅色行号漏了 2475**——它与共享族 `.note-tool-btn` 同组，属「只摘成员」。

| 行 | 形态 | 处置 |
| --- | --- | --- |
| 2348–2351 | **分组 4 成员**：`.theme-option[aria-pressed="true"], .mode-option:has(input:checked), .group-template-option.active, .group-template-category-filter.active` | 只摘 2350/2351；前两个成员**保留** |
| 2370–2373 | 独立组（4 条全是 group-template） | 整条删 |
| 2409–2422 | **分组 14 成员**：`.chat-time, .summary-line, .group-template-summary, .group-template-meta, .group-template-role-count,` + 9 个 `.orchestration-*` | 只摘 **2411/2412/2413**；其余全留 |
| 2428–2432 | **分组 5 成员**：`.group-template-option, .orchestration-sidebar, .orchestration-settings, .orchestration-footer, .orchestration-json-preview` | 只摘 2428 |
| 2474–2475 | **分组**：`.note-tool-btn, .group-template-category-filter` | 只摘 **2475**；`.note-tool-btn` 是共享族（守卫测试钉住） |
| 2570–2571 | **分组**：`.chat-create-template-btn, .group-template-category` | 只摘 2571 |
| 2575 / 2581 / 2587 | 三条独立：`.group-template-risk` / `.group-template-risk-professional` / `.group-template-roles span` | 整条删 |

**结论（A/B 两组共用）**：浅色块里**绝大多数 group-template / all-note 成员都藏在分组选择器里**，
「整条删」的只有 **A 组 4 条 + B 组 4 条 = 8 条**，其余全是**摘成员**。T4 必须按这张表逐行改，不许按行号区间粗删。

⚠️ **2026-09-29 订正**：此处原写「A 组 3 条 + B 组 5 条」——**总数 8 是对的，拆分是错的**。
逐行读原文确认应为 **A 4 + B 4**：A 组 `2525`/`2529`/`2533`/`2537–2538`，
B 组 `2370–2373`/`2575`/`2581`/`2587`。错的拆分会让 T4 去 B 组找**第五条不存在**的整删规则。
⚠️ 注意 `2370–2373` 是**一条规则的 4 行选择器**、`2537–2538` 是**一条规则的 2 行选择器**——
**「行数 ≠ 规则数」本阶段已踩过两次**（另一次见上文本组 28 行首命中 = 24 条规则）。

**必须保留（共享族 / 全局）**：

| 类 | 为什么不能删 |
| --- | --- |
| `notes-editor`(1048–1075)、`note-toolbar`(1015)、`note-tool-btn`(1027,1041)、`note-toolbar-spacer`(1023)、`all-note-toolbar`(1180) | `NotesPanel.tsx` 仍在用，**且 `NotesPanel.test.tsx:372-391` 是一条 CSS 守卫测试**，硬断言 legacy.css 必须仍含这 5 个串 |
| `tiny`(196) | 全局 15+ 文件在用，**`AppModal.tsx:159` 自己也在用** |

### D. 无规则、纯钩子的类（别去「退役」它们）

`.group-template-empty`、`.group-template-empty-actions`、`has-long-summary`：**legacy.css 里根本没有规则**
（W3-3 已把视觉改成 TSX 里的 utility）。
⚠️ `GroupTemplateModal.tsx:160-162` 的注释写「空态网格铺满/最小高原由 legacy 规则承担」——**该注释是过时的**，
本阶段顺手订正，**不要**据它去 legacy 里找规则。
`.all-note-target.deleted-chat` / `.active` 是**复合选择器**，`deleted-chat` 无独立规则。

### E. `.btn` 的实测判定（2026-09-29 编排者实测；T3 的「按实测决定去留」到此结案）

计划原本把 `.btn` 留给 T3「按实测决定」，现已测清——**它是个封闭系统**：

| 出处 | 内容 |
| --- | --- |
| `legacy.css:2358-2362` | **全仓唯一一条 `.btn` 规则**，且**只有浅色**：`border-color: rgba(113,113,122,.2); background:#ffffff; color: var(--text)` |
| `GroupTemplateModal.tsx:170,171` | **全仓唯一的 2 个消费者**（空态两个动作钮，`variant="ghost" size="sm"`） |
| `GroupTemplateModal.test.tsx:143,153` | 用 `.group-template-empty-actions .btn` 定位并点击 |

**判定：这条规则两个主题下都不可见（惰性），可删。** 逐条理由：
- `background: #ffffff` —— 亮色 `--popover` = `oklch(1 0 0)` = **纯白**（`globals.css:26`），
  即**白底压白底**；暗色下这条规则根本不匹配，且 `ghost` 变体不写底座 `bg-*`（只有 `hover:bg-accent`）。
- `color: var(--text)` —— `--text` 在 `globals.css:159/198` 被重映射为 `var(--foreground)`，
  与它本来就会继承到的颜色**同值**。
- `border-color` —— 无 `border` 宽度工具类，单独声明 `border-color` 不产生任何可见效果。

→ **T4 删 `2358-2362`**，删前删后各拍一次浅色截图留证（T5 的 `s5-8` 已覆盖亮/暗对比度）。
→ **T3 顺手摘掉 `className="btn"`**，把 `GroupTemplateModal.test.tsx:143/153` 的选择器改成
`.group-template-empty-actions button`（**纯选择器改写，断言语义不动**）——让「`.btn` 只是个 legacy 残影」
这件事不再挂在 TSX 上。容器钩子 `.group-template-empty-actions` 保留（它是纯钩子，见 D 节）。

---

## ⚠️ 本阶段特有的三条硬耦合（会直接挂测试，先看这里）

1. **`NotesPanel.test.tsx:372-391` 守卫测试**：它断言 `legacy.css`（去注释后）仍包含
   `'.notes-editor'`、`'.note-tool-btn'`、`'.note-toolbar {'`、`'.note-toolbar-spacer'`、`'.all-note-toolbar'`
   五个串。**删这五族任何一条规则都会直接挂测试**。它们是共享族，本阶段**只迁 AllNotesModal 的用法、不删规则**。
2. **`.btn` 被测试钉住**：`GroupTemplateModal.test.tsx:143,153` 用 `.group-template-empty-actions .btn`
   选空态两个按钮。`.btn` 在 legacy.css **只有一条浅色规则**(2358)，没有暗色基础规则。
   → T3 必须**实测**该浅色规则对 shadcn `Button variant="ghost"` 的实际作用，再二选一：
   （i）保留 `.btn` 钩子（零风险，测试不动，挂 S7 处置）；（ii）退役它并**同步改测试选择器**为
   `.group-template-empty-actions button`（不得放松判别力）。**不许**只改类名不改测试。
3. **两个弹窗的关闭语义相反**：AllNotes **背板点击关**（测试 `:183` 断言），GroupTemplate **背板点击不关**
   （测试 `:235-237` 断言）。这就是 T1 必须给壳加 `closeOn` 的原因——**不是过度设计**。

---

## 可见变化（前两项与最后一项 = 用户 2026-09-29 答过的三个问题，均取推荐值；**第 3 行是壳约定的推论，未单独拍板**——下表的理由是留存记录）

| 弹窗 | 变化 | 理由 |
| --- | --- | --- |
| 全部笔记 | 宽 **980 → 1160**（`2xl`） | 980 不是 6 档令牌之一。「就近档」算术上 `xl`(820) 更近（差 160 vs 180），但它是**左 240px 列表 + 右编辑器**的两栏工作区，收窄 160px 会直接伤编辑器可用宽度，故取 `2xl`。 |
| 全部笔记 | 高 **内容驱动（地板 620）→ 恒定 760** | 现状 `min-height: min(620, 100vh-150)` 已经让它**几乎**是定高（≈680），改 `fixed` 只增约 80px；且只有 `fixed` 能让「编辑器吸收剩余高度、左列表内部滚动」成立。用 `auto` 会多出整壳滚动容器，与左列表的内部滚动**叠成双滚动条**。 |
| 群模板 | 宽 **1500 保持**，沟槽 **32 → 48** ⚠️ **未经单独拍板** | 这不是用户答过的问题——是 S4 壳既有约定的**必然结果**：`AppModal.tsx:83` 注释明写「沟槽统一 48px（现状 32/42/48 三套并存）」，`full` 令牌即 `w-[min(1500px,calc(100vw-48px))]`。S4 已按此统一了 6 个弹窗。**后果**：视口 <1548px 时群模板每边缩 8px（1440 屏上 1408 → 1392）。不额外加 `contentClassName` 抵回 32px——那会打破壳的统一约定。**已向用户明示**（2026-09-29）。 |
| 群模板 | 高 **820–926（近满视口）→ 760** | 统一高度上限。列表可用高度约 710 → 575。**这是本阶段最明显的一处视觉变化**，请确认可接受。 |

**另有一处「顺带修正的亮暗不一致」**（编排者 2026-09-29 实测发现，**未单列进上表**）：
`.all-note-target.active` 的选中态**两个主题下结构不同**——暗色是 `inset 3px 0 0` 左竖条（`legacy.css:1128`），
浅色被同组的 `.template-card.active` 批量补丁换成了 `var(--glow)` 四边环（`legacy.css:2460-2465`）。
T2 以**暗色为正典**、用 token 表达使两主题一致 → **浅色下观感会变**（选中项从「白底灰边」变回带竖条的强调态）。
这是**修正**而非新设计，由 `s5-8` 的双主题断言兜住。

---

## 任务分解

### T1：给 `AppModal` 补 `footer` 槽 + `closeOn`（先写契约测试看红）

**交付物**：`common/AppModal.tsx`、`common/AppModal.test.tsx`。

**要加的两个 prop**：

1. `footer?: React.ReactNode`
   - ⚠️ **必须条件渲染**：`footer ? <div data-slot="modal-footer">…</div> : null`。
     **绝不许**渲染一个空的 footer 节点——现有测试用 `modal.lastElementChild` 定位内容行，
     空节点会让它们**同时误红**。
     ⚠️ **计数已两次订正，以此表为准**：S4 计划写「三条」，编排者写简报时按一次**范围写窄的 grep**
     （只搜了 `people/*.test.tsx` + `common/AppModal.test.tsx`，**漏掉 `models/` 与 `panel/`**）
     写成「5 处 / 4 文件」，T1 实现者实测为 **7 处 / 6 文件**。前 5 处已随 T1 加固；**剩下 2 处**
     （`models/ExternalModelsModal.test.tsx:328`、`panel/RolePanel.test.tsx:148`）由 **T2 顺手加固**：

     | 文件 | 行 | 状态 |
     | --- | --- | --- |
     | `people/AddPersonModal.test.tsx` | 298 | ✅ T1 已改 |
     | `people/PeopleLibraryModal.test.tsx` | 219、310 | ✅ T1 已改 |
     | `people/PersonTemplateModal.test.tsx` | 280 | ✅ T1 已改 |
     | `people/TemporaryPersonModal.test.tsx` | 79 | ✅ T1 已改 |
     | `models/ExternalModelsModal.test.tsx` | 328 | ⏳ T2 顺手改 |
     | `panel/RolePanel.test.tsx` | 148 | ⏳ T2 顺手改 |

     **教训（第二次同款）**：发「实测值」前必须确认 grep 的**范围**覆盖了全部目录——
     范围写窄了比不测更危险，因为它带着「已复核」的权威感。
   - `height="fixed"` 且有 footer 时，grid 行从 `grid-rows-[auto_minmax(0,1fr)]`
     扩成 `grid-rows-[auto_minmax(0,1fr)_auto]`；**无 footer 时保持两行**（别无条件写三行）。
   - `auto` 高度下 footer 就是 flex 列的最后一行（不参与 grid 行）。
2. `closeOn?: 'default' | 'escape-only'`（默认 `'default'`）
   - `'escape-only'` → 在 `DialogContent` 上传 `onInteractOutside={event => event.preventDefault()}`。
     ⚠️ **订正（T1 复审 §5.2）**：本行原写「既覆盖背板 pointerdown，也覆盖焦点外移」是**过度声称**——
     焦点外移在本壳里**早已被 Radix 挡掉**（`DialogContentModal` 内置 `onFocusOutside: e => e.preventDefault()`，
     `@radix-ui/react-dialog@1.1.23` dist:163-166），所以这个 prop 的**唯一行为增量是背板 pointerdown**。
     机制描述已按此改在 `AppModal.tsx:186-190` 的注释里。
   - `'default'` → 不传，维持 Radix 默认（背板关）。
   - 两种模式下 **× 与 Escape 都必须仍能关**。

**顺带加固（销 S4 挂账）**：给正文行与 footer 行加 `data-slot="modal-body"` / `data-slot="modal-footer"`，
把上述**三条**测试的 `modal.lastElementChild` 改成按 `data-slot` / class 定位。
（条件渲染已经让它们不会误红，但加固能永久拆掉这颗雷，S6/S7 加 footer 时不再受影响。）

**Step 1（先红）**：在 `AppModal.test.tsx` 写契约用例并**先跑一次看它红**，把红的输出贴进报告：
- 传 `footer` → 该节点存在且是 content 的最后一个元素；**不传** → content 的**子元素数量与加 footer 之前一致**（这是防空节点的关键断言）。
- `closeOn='escape-only'` → 背板 pointerdown/click 后 **`onClose` 未被调用**；Escape 后**被调用**；点 `closeId` 后**被调用**。
- `closeOn` 缺省 → 背板点击后 `onClose` **被调用**。
- ⚠️ jsdom 验不了「grid 三行」这类布局，别在单测里假装验它——那条归 T5 的真浏览器断言。

**Step 3**：`npm run typecheck`、`npx vitest run src/teamPage/ui/components/common/AppModal.test.tsx`、
**三条用 `lastElementChild` 的测试**（people 三个文件）、`npm run build`。

**Step 4**：一次 commit。

### T1 执行与复审记录（2026-09-29）

- **实现**：commit **`e075801`**（父 `a5ac3c6`），恰好 6 个文件，+184/−9，无夹带、无调试残留。
- **独立只读复审**：`.superpowers/s5-notes-templates/task-1-review.md`，**VERDICT: APPROVE WITH NITS，必需修复项 = 无**。
  复审者独立复跑了全部门禁（`typecheck` / AppModal **18/18** / people 四文件 **37/37** / `src/teamPage/ui` **404/404** /
  `build` exit 0 / bugfix 探针 **42 PASS 0 FAIL** 两次），并自证了 `dist/team.css` 的两条 grid 规则。
- ⭐ **最有价值的一条：`escape-only` 用例不是假绿。** 复审者读了**实际安装的**
  `radix-ui@1.6.7 → @radix-ui/react-dialog@1.1.23 → @radix-ui/react-dismissable-layer@1.1.19` 源码，证明
  `deferPointerDownOutside` 的 click 路径是**同步**的（不是 setTimeout，故 `await user.click()` 后立即断言不构成竞态）；
  且它核查了一个报告没提的坑——DismissableLayer 的「outside 交互被拦截即吞掉」机制会吃掉外点事件，
  **遮罩之所以逃得掉，是因为 `DialogOverlay` 调了 `useDismissableLayerSurface()` 登记为 dismissable surface**
  （`react-dialog` dist:111）。**没核这条，#5 就有可能是假绿。**
  另有**配对在场证明**：同文件缺省分支的「背板点击**会**关」用**同一套** `user.click(overlay)` 序列且为绿——
  两条互为反证，不可能同时为假。
- **加固经机械证明语义未放松**：把父提交与 `e075801` 的 4 个 people 测试文件的**所有 `expect(` 行**抽出逐行 diff，
  **结果为空**（53/69/39/26 行全等）；改动只有 1 行选择器 + 2 行注释。`lastElementChild` 全仓 **7 处 / 6 文件**，
  逐文件行号与订正表**完全吻合**。
- **订正一处事实**：壳的消费者是 **7 个不是 6 个**——`people/BuiltinTemplateDetailModal.tsx:51` 也在用
  （另 6 个：`ExternalModelsModal`、`RolePanel`、`AddPersonModal`、`PeopleLibraryModal`、`PersonTemplateModal`、
  `TemporaryPersonModal`）。七者**均未**传 `footer` / `footerClassName` / `closeOn`，两个新 prop 目前确实零消费者。
- **编排者事后补的两处修订（在 `e075801` 之后，非实现者所为）**：
  1. `AppModal.tsx:186-190` 的注释去掉「也覆盖焦点外移」的过度声称（复审 §5.2）；
  2. 本计划 T1 第 2 条同步订正（见上）。
  → 终审（T6 档）需覆盖这两个 commit。
- **留给 T2 的两件事**（复审 §7，均非 T1 缺陷）：加固 `models/ExternalModelsModal.test.tsx:328` 与
  `panel/RolePanel.test.tsx:148`；订正注释表述（已由编排者做掉）。
- ⚠️ **流程教训**：复审期间编排者连推了 6 个 docs-only 提交，导致**被审 commit 的 HEAD 在复审中漂移**
  （复审者逐 blob 核对确认 `src/` 与 `e075801` 相同，结论不受影响）。**后续任务复审期间一律冻结分支**，
  只能改 `.superpowers/` 下的文件（已 gitignore）。

---

### T2：`AllNotesModal` → `AppModal`

**交付物**：`notes/AllNotesModal.tsx`、`notes/AllNotesModal.test.tsx`。

**目标形态**：
- `size="2xl"`、`height="fixed"`、**无 footer**、`closeOn` 缺省（背板关，保持现状）。
- `contentId="all-notes-modal"`、`titleId="all-notes-title"`、`closeId="close-all-notes"`、
  `closeLabel={t('关闭全部笔记')}`、`description={t('全局、群聊、已删除群聊')}`（**无** `descriptionId`）。
- **不传 `initialFocusId`**：现状就没有 `onOpenAutoFocus`，聚焦由 `engine.focusWhenReady()` 负责，保持不动。
- 裸 `×` 文本 → 由壳渲染的 `<X className="size-4" aria-hidden="true"/>`（与 2026-09-28 修复批次③一致）。

**逐字保留的契约**（E2E 钩子，`AllNotesModal.test.tsx` 与既有探针都在用）：
`#all-notes-modal`、`#close-all-notes`、`#all-notes-title`、`#all-notes-list`、`#all-notes-editor`、
`#all-notes-active-title`、`#all-notes-active-meta`、`#all-note-bold|italic|strike|bullet-list|ordered-list|undo|redo`、
`data-note-target-id`、`aria-pressed`、`.all-note-target` + `.deleted-chat` + `.active`。

**布局迁移要点**：
- 壳的 `fixed` 会给正文行 `overflow-auto`——**必须用 `bodyClassName` 抵成 `overflow-hidden`**
  （同组后者胜，`cn` = twMerge），否则与左列表的内部滚动**叠成双滚动条**。
- 正文行内是工作区：`grid grid-cols-[240px_minmax(0,1fr)]` + `min-h-0`（撑满），
  左列表 `overflow-auto`，右栏 `grid grid-rows-[auto_auto_minmax(0,1fr)] min-h-0`。
- **`@media (max-width: 760px)` 的单栏行为必须保留**：用 Tailwind 断点变体表达（**先跑探针确认变体存在**），
  列表转横向滚动 + `max-height:none` + `.all-note-target` 的 `min-width:160px`。
- `.note-toolbar` / `.note-tool-btn` / `.note-toolbar-spacer` / `notes-editor` **保留类名**（共享族 + 守卫测试），
  视觉 utilities 参照**已经迁完的 `NotesPanel.tsx`**（这是本任务最好的参照实现）：
  `note-toolbar flex items-center gap-0.5 px-6 py-2`、`note-tool-btn size-7 rounded-md text-muted-foreground`、
  `notes-editor min-h-0 …`。⚠️ 参照时注意两者内边距语境不同（NotesPanel 是浮窗、本弹窗有两栏），
  **别照抄 `px-6` 压到左列表上**。

**Step 1（先红）**：先改/加 `AllNotesModal.test.tsx` 的契约用例并看红。至少覆盖：
- 壳契约：content 命中 `2xl` 宽度令牌、`#close-all-notes` 是 `svg`（**无 `×` 文本节点**）、`aria-label` 为「关闭全部笔记」；
- 回归：现有 7 条用例**语义不得改变**（默认目标、切目标先存后切、已删除群聊可编辑、关闭保存、Escape/背板关闭、点弹窗本体不关）。
  ⚠️ 允许改的是**选择器写法**（如 `.all-notes-modal` 类名若不再存在），**不允许**改断言的语义或放松。

**Step 3**：`npm run typecheck`、`npx vitest run src/teamPage/ui/components/notes/AllNotesModal.test.tsx`、
**`NotesPanel.test.tsx`**（守卫测试 + 共享族）、`npm run build`、`node scripts/screenshot-bugfix-acceptance.mjs`（须仍 42/0）。

---

### T2 执行、复审与修补记录（2026-09-29）

- **实现**：commit **`89fd094`**（父 `e075801`），4 个文件。
- **独立只读复审**：`.superpowers/s5-notes-templates/task-2-review.md`，**APPROVE WITH NITS**，必需修复项 = 无。
- ⭐ **最有价值的一条：它没有用读代码的方式验本阶段的头号风险（legacy 属性漏译）。**
  复审者在**真浏览器**里用 CSSOM 把 A 组 legacy 选择器逐个摘掉（**23 条整删 + 3 条裁剪 + 31 段**），
  摘前摘后比 **52 个 computed 属性 + 几何**：暗色仅 2 处非渲染差异、浅色仅 1 处
  （都是 `max-height`→none 但元素已有确定高度 / `border-top-color` 而该边宽已是 0）。
  → 「没有属性漏译」是**实证结论**，不是推断。**T5 的 `s5-9` 复用此手法**（见 `_scratch/t5-reminders-from-reviews.md`）。
  复审者还把实现者新加的窄档行模板**现场移除**复现出「列表 440px / 编辑器 81px」，证明该偏离是必需的。
- ❌ **复审抓到一处报告未提的真实回归 → 已修**：未选中的**已删除群聊**条目，悬停时琥珀边被灰边顶掉。
  legacy 里 `.all-note-target:hover` 与 `.all-note-target.deleted-chat` **特异性同为 (0,2,0)**、后者源码更靠后 → 悬停琥珀胜；
  而 Tailwind 把 **hover 变体排在基础工具类之后**，`hover:border-muted-foreground/20` 反压基础的琥珀边。
  **jsdom 算不出 `:hover`**——typecheck / 单测 / build 全绿也看不见它。
  修法：未选中分支按 `deletedChat` 把 hover/focus-visible 的**边框**分流（底色仍 `hover:bg-accent`，因 legacy 无 `.deleted-chat:hover` 底色规则）。
- **修补 commit `1bf22d0`**（父 `89fd094`）：2 文件 +45/−1，只有 `notes/AllNotesModal.tsx` + `notes/AllNotesModal.test.tsx`。
  含 6 条新断言（其中一条明写「**不得**带 `hover:border-muted-foreground/20`」）与复审指出的第二条缺口
  （新加的 `max-[760px]:grid-rows-[auto_minmax(0,1fr)]` 此前无断言钉住）。
- **编排者独立复核（未再派第二轮复审，理由见下）**：
  1. 通读 `git show 1bf22d0 -- <两个文件>` 全量 diff；
  2. `dist/team.css` 里四条琥珀规则**逐条在场**：`.all-note-target.deleted-chat` / `.border-[rgba(248,184,78,0.22)]` /
     `.hover\:…:hover` / `.focus-visible\:…:focus-visible`（证明 hover 变体没被 `${` 扫描器吞掉）；
  3. **自跑** T2 私有布局探针 → **23 PASS / 0 FAIL**，悬停中的已删除群聊条目实测
     `borderTopColor = rgba(248, 184, 78, 0.22)`（琥珀）+ `backgroundColor = oklch(0.274 0.006 286.033)`（accent），与 legacy 语义一致。
- **不再追加第二轮复审的判定**：修补仅 11 行源码、位于单个三元分支内，不碰共享代码；实现者给出了红→绿的实际输出；
  上述 2、3 两条是对**渲染结果**的直接实测（正是该 bug 唯一可见的层面）。**终审（T6 档）需覆盖 `1bf22d0`。**
- ⚠️ **两条只记录未修的偏离，终审与 T5 必须带着**：
  1. `max-[760px]:` 编译为 `@media (width < 760px)`，legacy 是 `(max-width: 760px)`（含 760）→ **视口正好 760px 时单栏变两栏**的 1px 差。
     **已决：接受，不做 `max-[760.01px]:` 此类 hack**；`s5-11` 的响应式断言**不许拿 760 当视口**（用 700）。
  2. `border-border` 取代 `rgba(113,113,122,.08)` 是**值变化**（暗色下约亮一倍）。首轮报告漏标，复审后已补记。
- **未验证项**（复审自陈，转 T5 / 终审）：只跑了 Chromium；`Empty` 空态分支不可达故无覆盖；
  T4 模拟是**按 A 组选择器清单**的近似（非 T4 真实删除清单）；全仓测试未跑（只跑 `src/teamPage/ui`）。

---

### T3：`GroupTemplateModal` → `AppModal`

**交付物**：`shell/GroupTemplateModal.tsx`、`shell/GroupTemplateModal.test.tsx`。

**目标形态**：
- `size="full"`、`height="fixed"`、**`footer={确认创建钮}`**、`closeOn="escape-only"`、
  **`initialFocusId="group-template-search"`**。
- `contentId="group-template-modal"`、`titleId="group-template-title"`、
  `closeId="close-group-template-modal"`、`closeLabel={ui('关闭群聊模板')}`、
  `description={ui('选择一个现成小组，创建后会自动加入模板人员。')}`。
- **删掉本地的 `onOpenAutoFocus`（裸 `.focus()`）与 `onInteractOutside`**——两者都改由壳承担。

> ⚠️ **这条迁移顺手闭合一个潜伏缺陷，要在报告里显式写清**：现状 `document.getElementById('group-template-search')?.focus()`
> 是**裸 `.focus()`**（与 S4 的 F1 同款写法）。它当前**无害**，只因为群模板弹窗还没有滚动容器；
> 一旦迁到 `AppModal` 的 `height="auto"`（带 `max-h + overflow-auto`）就会长出 F1（打开即滚到底）。
> 走 `height="fixed"` + 壳的 `initialFocusId`（自带 `preventScroll: true`）则**从一开始就不会有这个问题**。
> **不得**把它写成「修好了某个已存在缺陷」——它是**迁移过程中被避开**的，不是被修的。

**逐字保留的契约**：`#group-template-modal`、`#close-group-template-modal`、`#group-template-title`、
`#group-template-search`、`#group-template-categories`、`#group-template-list`、
`#confirm-group-template-create`、`data-template-id`、`aria-pressed`、以及 `.group-template-*` 的**类名钩子**
（测试用 `.group-template-option` / `-option-top` / `-risk` / `-role-count` / `-summary` / `-category-filter` /
`-empty` / `-empty-actions` / `.has-long-summary` 定位）。

**布局迁移要点**：
- 现状是**四行网格**（头/工具行/列表/页脚）。迁到 `AppModal` 后：头部由壳承担（第 1 行），
  footer 由壳的新槽承担（第 3 行），**正文行自身要再做一个两行网格** `grid grid-rows-[auto_minmax(0,1fr)]`
  容纳「工具行 + 列表」，并把 `overflow-auto` 抵成 `overflow-hidden`（理由同 T2）。
- 列表 `repeat(auto-fit, minmax(520px, 1fr))` 的卡片网格与内部滚动要在新的确定高度下重新成立
  （`minmax(0,1fr)` 那一行**依赖确定高度**才可滚——这正是选 `fixed` 的原因）。
- 空态：`Empty` 原语保持，`col-span-full min-h-60 p-6 md:p-8` 已是 utilities，**别去 legacy 找规则**（见基线 D）。
- ⚠️ `.btn` 的处理见上文「硬耦合 2」，**先实测再决定**。

**Step 1（先红）**：改/加 `GroupTemplateModal.test.tsx` 契约用例并看红，至少覆盖：
- 壳契约：`2xl`/`full` 宽度令牌命中、`#close-group-template-modal` 是 `svg`、`aria-label` 为「关闭群聊模板」；
- **footer 契约**：`#confirm-group-template-create` 位于 footer 槽内（`[data-slot="modal-footer"]`），
  且**不在**正文滚动区内；
- 回归：现有 9 条用例语义不变——打开即聚焦搜索框、确认建群 + 收回快速建群表单、分类/搜索过滤、
  空态两条恢复路径（**选择器按「硬耦合 2」的实测决定同步调整**）、风险徽标位置、长摘要截断、选中随过滤失效、
  关闭按钮 + Escape 关闭、**外点不关闭**。

**Step 3**：`npm run typecheck`、`npx vitest run src/teamPage/ui/components/shell/GroupTemplateModal.test.tsx`、
`npm run build`、`node scripts/screenshot-bugfix-acceptance.mjs`。

---

### T3 执行、复审与修补记录（2026-09-29）

- **实现**：commit **`84981df`**（父 `c53a40d`），2 个文件 +265/−101。
- **独立只读复审**：`.superpowers/s5-notes-templates/task-3-review.md`，**APPROVE WITH NITS，必需修复项 = 无（0 blocker）**。
- ⭐ **核心声明被独立复现**：复审者在真浏览器里用 CSSOM 剥离了 **43 个选择器成员**
  （24 条 B 组规则 + 9 条浅色块），在**约 100 属性 × 6 状态 × 两主题**下比对，剥离前后只剩 **3 类残差**
  （`maxHeight` 不渲染 / `outlineColor` 不渲染 / **暗色渐变**），且**几何逐项相同** → 「无属性漏译」再次是实证。
  另证：`aria-pressed` ⟺ `.active` **同源同开关**（57 个元素 / 2 个选中 / 0 个不符，两主题）；
  契约 7 个 id + 全部钩子在位；`.btn` 计数 0。
- ⭐⭐ **本任务最值钱的方法论发现——过渡陷阱**：dialog content 带 **`transition: all .2s`**。
  复审者现场摘掉类名后**立刻**读 `getComputedStyle` 得到的是**中间值**，据此一度把 `min-h-0` 误判为「可摘」，
  **等 1.5s 后真实的 820px 才现身**。→ **对 T4 的后果是双向的**：过渡途中的快照既可能**吞掉真差异**、
  也可能**造出假差异**，而 T4 的全部证据就是「删前/删后快照 diff」。**已把强制防抖写进 T4 简报**
  （注入 `*{transition:none!important}` 或 `sleep≥1500`，且**要求在报告里自证防抖真的生效**）。
- ❌ **复审抓到 6 件报告未提的事，其中 1 件是真回归 → 已修**：
  1. **间距回归（真回归）**：分类条 → 首行卡片，legacy **16px** → 迁移后 **0px**（复审用 chip 口径读到 2px）。
     根因是**结构属性漏迁**：旧路径组件直接渲染原语 `DialogContent`（`ui/dialog.tsx:62` 自带 `gap-4`，4 个子元素间各 16px），
     壳用 `gap-0` 收掉后正文行网格没有补 → 一行间距凭空归零。
  2. **暗色渐变今天仍在渲染**：报告与代码注释原写「已收敛成实底」——**时态错了**。
     实现者只接管了 `background-color`；`background-image`（`linear-gradient`，`legacy.css:1388–1390`）**无人接管、至今生效**，
     **将在 T4 删规则那天才消失** → 这是**T4 时点的一处可见变化**，必须写进 T4 偏差清单。
  3. 头部新增 1px 下边框、4. 脚部新增 1px 上边框（来自壳既有约定，S4 的 7 个消费者同款，非本任务缺陷）；
  5. 静止态分类片整体换装（底→`--popover`、描边→`--border`、文字→`muted-foreground`，原报告只列了 hover/active）；
  6. `shadow-none` 无任何测试钉住。
- **修补 commit `1d6e0df`**（父 `84981df`）：2 文件 +27/−6。正文行补 `gap-4`（恢复 legacy 16px）；
  补 2 条类名断言（`gap-4` 与 `shadow-none`），且**实现者自证断言会咬**（临时去掉两类别 → `2 failed | 12 passed`）；
  渐变注释与报告订正为事实陈述。**间距实测（真浏览器）**：legacy 16px → 修前 0px → 修后 16px（chip 口径 18px = legacy 18px）。
- **编排者独立复核（未再派第二轮复审，理由同 T2）**：commit 范围 = 2 文件、工作树干净；
  **expect 行逐行 diff 只有新增、无改动无删除**；对着 legacy 原文确认两处修补的必要性
  （`legacy.css:1311` 的 `min-height: min(820px,calc(100vh - 24px))` 壳的 `height` 覆盖不掉 → 不修则弹窗实渲染 820 而非 760；
  `legacy.css:2355` 的浅色 `box-shadow: inset 0 0 0 1px` 无 B 组对应 → 不修则浅色 active≠hover 且 T4 时静默消失）；
  `aria-pressed:` 在 dist 里编译为 **`[aria-pressed=true]`**（若编成判存在，**全部卡片**都会被选中样式命中）；
  三个 `ring-border` 变体均已产出 `--tw-ring-color: var(--border)`。
- ⚠️ **合并前必须向用户报备的可见变化**（编排者已备好清单，**均未经用户单独拍板**）：
  ① 沟槽 32→48（壳统一沟槽的推论）；② 弹窗高 926→760（**用户已拍板**）；
  ③ 分类片 48×32→46×30（简报指定 padding 的推论）；④ 暗色/浅色 hover 底统一到 `--accent`；
  ⑤ 浅色**选中**片失去 14% inset 内描边（与「暗色为正典」既有裁定一致）；⑥ 头部/脚部新增 1px 分隔线（壳既有约定）；
  ⑦ 静止态分类片整体换装；⑧ **暗色渐变将在 T4 删规则时消失**（本条发生在 T4 而非本任务）。
- **未验证项**（复审自陈）：键盘 Tab 聚焦未实测（`outline-none` 提升到基础态只有推理依据）；只跑了 Chromium。
- 📌 **流程观察（连续三个任务）**：T1 复审订正了编排者一处过度声称的注释与「消费者 7 个不是 6 个」；
  T2 复审抓到一处报告未提的真实回归；T3 复审抓到一处真实回归 + 5 处漏报。
  **独立复审每次都找到了实现者报告里没有的东西**——这是结构性偏差（实现者只报告自己想到要查的），
  不是偶然。**S6/S7 应继续保留独立复审，不要因为「连续通过」而削减。**

---

### T4：legacy 退役 + 按族计数断言（销 S3 终审 M-2）

**交付物**：`src/teamPage/ui/styles/legacy.css`（只删本阶段确认独占的族）。

**纪律（每一步都要做，不许跳）**：
1. **先读规则原文**（别只看类名）→ 2. **重新 grep 活消费者**（裸串、全 `src/`，含分组选择器成员）
→ 3. 判定独占/共享 → 4. 独占的删 → 5. `npm run build` 后**复拍**。

**应删（本阶段独占族，逐条 grep 复核后）**：基线 C 里 A 组与 B 组列出的全部选择器及其浅色对应，包含
媒体查询 `@media (max-width: 760px)` 里那三条（若已全部翻成响应式 utilities），外加
**基线 E 的 `2358-2362`（`.btn` 的浅色规则，已实测两主题皆惰性）**。

⚠️ **浅色块「整条删」只有 8 条**（A 组 2525/2529/2533/2537-2538，B 组 2370-2373/2575/2581/2587），
**其余全是「从分组选择器里摘掉成员」**——按基线 C 的两张逐行表做，**不许按行号区间粗删**。
T3 在本任务之前已摘掉 `.btn` 的 TSX 消费者，所以这条可以整条删。

**不许删**：`notes-editor` / `note-toolbar` / `note-tool-btn` / `note-toolbar-spacer` / `all-note-toolbar`
（`NotesPanel` 在用 **且被守卫测试钉住**）、`tiny`、`.modal-form`（S6/S7 的账，本阶段不动）。

⚠️ **删错会静默塌样式且门禁看不见**——S4 已经吃过一次（`.modal-form` 有 4 处活消费者、其中一处零 utility 兜底）。
本次删任何一条前，把「消费者清单」写进报告。

**销 M-2 的账**：S3 终审 M-2 实测指出——把 legacy 里唯一一条 `.notes-editor` 规则整块改名后，
`screenshot-s3-acceptance.mjs` **仍然 75/0**（只算子串命中，共享族的局部删除不会红），
`.tiny`/`.reference-box`/`.section-title`/`.mention-shortcut`/`.all-note-*` 都**没有运行时断言**。
→ 本任务要给这些族补**按族计数**的静态断言，T5 的 `s5-9` 落地（本任务只需保证「删完之后计数是预期的那个数」并写进报告）。

---

### T5：`s5-*` 验收探针 + 全量回归

**交付物**：`scripts/screenshot-s5-acceptance.mjs`（**新**）、阶段验收报告。

结构照抄 `scripts/screenshot-s4-acceptance.mjs`（同款 `check()` / `groupOf()` / PASS-FAIL 计数 / 暗+亮双段）。
**断言组见下表**。⚠️ 探针纪律：种子前先 `chrome.storage.local.clear()`（见 Global Constraints）。

**Step 2**：既有脚本复跑——`s1`/`s2`/`s3`/`bugfix` 四条必须与基线一致（55/59/75/42 全 0 FAIL）；
`p3`/`p4*`/`w1*`/`w2*`/`w3*` 的历史红项按 S3 交接 §E.5 归类（**前置既存**，非本阶段引入），若仍红需单独说明。

**Step 3**：`npm run typecheck` + `npm test` + `npm run build`，与基线比对（预期 874 passed / 1 failed）。
**Step 4**：一次 commit。

| 组 | 断言 |
| --- | --- |
| s5-1 | 两个弹窗逐个打开：content 命中 `2xl`（全部笔记）/ `full`（群模板）宽度令牌、左右沟槽合计 = 视口 − 宽度、`max-w` 不为 512、`border-radius` = 10px、`background-color` == `--popover`、水平垂直居中（±1px） |
| s5-1b | **正文内边距不塌**（jsdom 抓不到）：取正文内已知元素（全部笔记 `#all-notes-list`、群模板 `#group-template-list`），断言其左缘 − content 左缘 ≥ 20（实测约 25，**别写成 `=== 24`**）；纵向用「头部下边界 → 首个正文元素 top」之差，**不要**用「元素 top − 弹窗 top」（会含头部高度而恒真） |
| s5-2 | **高度策略与「不出现双滚动条」**：两者 `height` = `min(760, 100vh−48)`；**整壳不可滚**（`content.scrollHeight <= content.clientHeight + 1`）；**列表内部可滚**（`#all-notes-list` / `#group-template-list` 的 `scrollHeight > clientHeight`，需种入足量数据） |
| s5-3 | 关闭钮：两个弹窗各**恰好一个**可见 svg 关闭钮、**无 `×` 文本节点**、`aria-label` 与译文一致、点击后弹窗消失 |
| s5-4 | **首焦与「打开瞬间不得被滚走」**：群模板打开后 `document.activeElement.id === 'group-template-search'` 且 **`content.scrollTop === 0`** + 头部可见（与 S4 的 s4-4 同口径，`preventScroll` 的防线）；全部笔记打开后同样断言 `content.scrollTop === 0` |
| s5-5 | **关闭语义对照**（两者相反，必须都测）：全部笔记 → Escape 关、**背板点击关**；群模板 → Escape 关、**背板点击不关**（点后仍存在） |
| s5-6 | **footer 钉底**：群模板滚动 `#group-template-list` 前后，`[data-slot="modal-footer"]` 与头部的 `getBoundingClientRect()` **不变**，且 `#confirm-group-template-create` 始终在壳内可见 |
| s5-7 | **两栏/网格结构**：全部笔记工作区左栏实测 240px、右栏 `1fr`；群模板列表为多列网格（`gridTemplateColumns` 解析出 ≥2 列，1500 宽下） |
| s5-8 | 亮/暗双主题对比度：全部笔记 `.all-note-target-title`/`-meta`、群模板 `.group-template-summary`/`-meta`/`-role-count`/`-category` 均 ≥4.5（次级文本 ≥3） |
| s5-9 | legacy 审计，**两半分开断言**：**(a) 本阶段独占族零命中**（基线 C 的 A/B 两组全部选择器，**按带点的精确选择器搜**）；**(b) 共享族仍在**（`notes-editor`、`note-toolbar`、`note-tool-btn`、`note-toolbar-spacer`、`all-note-toolbar`、`tiny`、`.modal-form`、`.field`、`.template-card`、`.template-list`、`.template-actions`、`.section-title`、`.reference-box`、`.orchestration-*`、`.note-*`）；**(c) 钩子类仍出现在 TSX**；**(d) dist 里新写的 utilities 存在**（紧贴 `${` 复检）；**(e) ⭐ 按族计数**（销 M-2）：给 `.all-note-*`（删前 16 处）、`.tiny`、`.reference-box`、`.section-title`、`.mention-shortcut` 各钉一个**计数上界/精确值**断言，使「共享族被整体误删」也能红 |
| s5-10 | uiBus 消费者审计（沿用 S4 s4-10，10 个命令） |
| s5-11 | **响应式回归**：视口 ≤760px 时，全部笔记工作区为**单栏**（左列表与编辑器 `top` 不同但 `left` 相同 / 列为 1），列表横向可滚；≥1024 时为两栏 240px + 1fr |

⚠️ 写断言的一条纪律：**别写「负面存在性」断言**（如「裸 `x` 类在 dist 出现 0 次」）——S4 有旧值被实测推翻过，
只因探针恰好没断 `=== 0` 才没假红。要断就断**存在**与**精确计数**（计数要说明是行数还是出现次数）。

---

## 完成定义（DoD）

1. `AllNotesModal` 与 `GroupTemplateModal` 均由 `AppModal` 承载；spec 里 10 个弹窗**全部**收口完毕。
2. `AppModal` 具备 `footer` 槽（**条件渲染、无 footer 时不产生空节点**）与 `closeOn`（`default` / `escape-only`），均有契约测试。
3. 上表全部 `id` / `class` / `data-*` / `aria-*` 契约逐字保留；两个 `#close-*` id 仍在，且关闭钮是 svg 而非 `×` 文本。
4. 全部笔记的响应式（≤760px 单栏）行为保留。
5. `s5-1..s5-11` 全 PASS（暗 + 亮双段）；`bugfix` 探针仍 42/0；`s1`/`s2`/`s3` 复跑无回归。
6. legacy.css 中本阶段独占族零残留；共享族原样存活（含守卫测试钉住的 5 个串）。
7. `npm run typecheck` + `npm test` + `npm run build` 与基线一致（仅既有豁免项失败）。
8. 每个任务一次 commit；报告写清「读到的 legacy 原值 → 翻成的 utilities → 删掉的行号」与「哪些族因共享而保留、留给哪个阶段」。

## 后续阶段移交（S6/S7）

- **S6 可直接复用本阶段的 `footer` 槽与 `closeOn`**：编排 3 弹窗需要 `footer` 与 `closeOn: 'button-only'`
  （规格要求**不响应 Escape 与背板**）——注意 `'button-only'` 是**第三种**语义，本阶段只实现 `default` / `escape-only`
  两档，S6 若需要再扩（**别在本阶段提前实现**，没有消费者就是死代码）。
- **`=== 11`**：`.orchestration-stage-canvas .x6-*` 族计数**只归 S6**（S3 移交 §B.4 原文即如此；
  S4 计划的「两阶段都需」已订正）。本阶段**不动**它。
- **S6 的 `.template-actions`**：它藏在分组选择器 `.chat-row, .role-row, .template-actions {` 里，
  锚定 `^\.template-actions` **搜不到**，必须按裸串搜。
- **S7**：`.modal-form` 退役（4 处活消费者，1 处零 utility 兜底）、`AddPersonModal` 一类名紧贴 `${` 的空格、
  s4-6 的 12 模型分支「换行居中」未被覆盖。**均不在本阶段**。
