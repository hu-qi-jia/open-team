# S6 计划：编排 3 弹窗 → `AppModal` + X6 画布规则搬家 + 状态卡定位修正

> 分支 `feature/react-ui-s6`（自 `main` = `bdc8d90` 起）。执行沿用 S4/S5 惯例：
> 每任务一次 commit（复审驱动的修补另起 commit）、门禁 = typecheck + 触及测试 + build、阶段末全量。
> 设计权威：`docs/superpowers/specs/2026-09-28-shadcn-ui-rebuild-design.md` §7.4（S6 = 编排 3 弹窗 + 画布样式微调）。

## 阶段目标

1. 编排 3 弹窗（`OrchestrationModal` / `OrchestrationAutoModal` / `OrchestrationTemplatePickerModal`）
   全部收进 `common/AppModal.tsx` —— 完成后 spec 10 弹窗**全部**由 `AppModal` 承载（消费者 9 → 12）。
2. 给壳补第三种关闭语义 `closeOn: 'button-only'`（S5 移交：三弹窗现状 = Escape + 背板双 preventDefault）。
3. `.orchestration-stage-canvas .x6-*` 后代族 11 条**搬家**（X6 库内部 DOM 无法加 className，
   视觉必须保留 → 迁至 `styles/orchestration-canvas.css`，unlayered），s3-12 断言同步 11 → 0
   （S3 交接 §B.4 原文要求）。
4. `.orchestration-status-floating` `position: fixed → absolute`（S2 挂账 §B.5：`#app` 内禁 fixed
   铁律的既存违例）。⚠️ 锚点随之改变，偏移值必须真机重测，不是只改一个属性。

## 现状实测基线（2026-09-29 编排者实测）

### 三弹窗现状

| 弹窗 | 宽 | 高 | 关闭语义 | 首焦 | 关闭钮 |
| --- | --- | --- | --- | --- | --- |
| OrchestrationModal | `min(1160px, 100vw-42px)` + `.orchestration-modal`（height `min(760px,100vh-42px)`，四行 grid `auto auto minmax(0,1fr) auto`，gap 14px） | fixed | 仅按钮可关 | `#orchestration-task` | 裸 `×` 文本 |
| OrchestrationAutoModal | `min(860px, 100vw-42px)` + `.orchestration-auto-modal`（height `min(760px,100vh-70px)`，两行 grid） | fixed | 仅按钮可关 | `.orchestration-auto-input`（querySelector，**非 id**） | 裸 `×` 文本 |
| OrchestrationTemplatePickerModal | `min(760px, 100vw-42px)` | auto（内容驱动） | 仅按钮可关 | 第一张 `.orchestration-template-card`（querySelector） | 裸 `×` 文本 |

三者共同点：`onEscapeKeyDown` + `onInteractOutside` 双 preventDefault + **Dialog 无 onOpenChange**
（不受控）。⚠️ AppModal 的 Dialog 是受控的（`handleOpenChange(false) → onClose()`）——直接迁移时
Escape/背板会**意外变可关**，这就是 T1 必须给壳扩 `button-only` 的机制原因。

### 宽度档收敛（壳令牌 6 档 + 统一 48px 沟槽）

| 弹窗 | 现值 | 目标档 | 差 |
| --- | --- | --- | --- |
| 主弹窗 | 1160 | `2xl`（1160） | 沟槽 42→48 |
| 自动编排 | 860 | `xl`（820） | −40（聊天界面，两档中 xl 最近） |
| 模板选择 | 760 | `lg`（720） | −40 |

### 规则归属（legacy.css 2422 行；`grep -c orchestration` = 210 处命中）

- **主弹窗独占族**：`.orchestration-modal`、`.orchestration-task-strip`（+`.field`/`-input-row`）、
  `#orchestration-task`、`.orchestration-auto`（触发钮，注意与 `.orchestration-auto-modal` 系前缀碰撞——
  按裸串搜时 `\.orchestration-auto[ ,{:]` 锚定）、`.orchestration-template-trigger`、
  `.orchestration-layout`（+`.settings-hidden`）、`.orchestration-sidebar/settings`（+heading/people-list/
  person 系）、`.orchestration-workspace`、`.orchestration-arrange`、`.orchestration-empty-hint`、
  `.orchestration-stage-settings`、`.orchestration-node-editor-header`、`.orchestration-review-settings`、
  `.orchestration-note`、`.orchestration-json-preview`、`.orchestration-footer`、`.orchestration-actions`、
  `.orchestration-rounds-field`。
- **自动弹窗独占族**：`.orchestration-auto-modal`、`.orchestration-auto-content/chat/messages/empty/`
  `message(-content)`、`.orchestration-auto-composer/-input-shell/-input/-submit`、
  `.orchestration-auto-role-sites/-role-site-row/-role-prompt-row/-role-prompt`。
- **模板选择独占族**：`.orchestration-template-modal/-content/-panel/-heading/-group(-title)/-list/`
  `-card(-top)/-tags/-summary/-structure`。
- **状态卡族（S6 顺带）**：`.orchestration-status*`（floating/collapsed/count/node-index/current-*/
  review-meta/waiting 等）——**本阶段只改 `.orchestration-status-floating` 的 position，
  其余视觉不动**（状态卡不是弹窗，迁移成本高、收益低，整体重塑留给 S7 后的后续阶段）。
- **X6 族（搬家非删除）**：`.orchestration-stage-canvas .x6-*` 暗色 10 条（1786–1830）+ 浅色 1 条（2358）
  = **11 条**，s3-12 钉死 `=== 11`（`scripts/screenshot-s3-acceptance.mjs:955`）。CanvasPortal 渲染
  `<div id="orchestration-stage-canvas" className="orchestration-stage-canvas size-full min-h-0">`，
  X6 在其内部生成库 DOM → 规则必须保留，目标文件 `styles/orchestration-canvas.css`。
  ⚠️ s3-12 有三条联动断言（:955 计数、:965 逐处形态、:1012 dist 计数）——前两条随搬家改数/删除，
  dist 断言查的是 dist CSS（新文件经 globals.css `@import` 进同一 dist 输出，计数不变，应仍绿）。
- **共享族（不许删）**：`.template-actions`（`legacy.css:362` 藏在分组 `.chat-row, .role-row, .template-actions {`
  里；活消费者 4 处：ExternalModelsModal ×1、OrchestrationModal ×1、PersonTemplateModal ×2）、
  `.field`、`.site-pill`、`.tiny`、`.section-title`、`.stage-role-chip(s)`（节点设置面板在用）。
  主弹窗迁移后 `orchestration-actions` 若 utilities 化，`template-actions` 钩子**保留**（其余 3 处消费者）。

### 浅色块逐条（`grep -n 'light.*orchestration'` = 2102/2103/2104/2114/2118/2126/2132/2138/2358 起始）

迁移对应任务里逐条摘成员或整删，纪律同 S4/S5：先读原文 → 重新 grep 活消费者 → 判定 → 删 → build 后复拍。
`legacy.css` 里 S4/S5 留下的注释已标明本组剩余成员归 S6。

## 任务分解

### T1：壳扩 `closeOn: 'button-only'`（契约测试先行）

- 交付：`common/AppModal.tsx` + `AppModal.test.tsx`。
- 行为：`onEscapeKeyDown` preventDefault + `onInteractOutside` preventDefault（**两个都要**——
  受控 Dialog 下只挡背板不解 Escape）。× 与 Escape **都不**关；唯一出口 = `closeId` 钮 / 调用方动作钮。
- 契约用例（先红）：button-only 下 Escape 不关、背板 pointerdown 不关、点 closeId 关。
- 注释更新：closeOn 的 doc 注释补第三档与机制说明（受控 Dialog 的差异）。

### T2：`OrchestrationTemplatePickerModal` → AppModal

- `size="lg"`、`height="auto"`、`closeOn="button-only"`、`initialFocusId` —— ⚠️ 现状首焦是
  querySelector 类名，壳只认 id：给首张模板卡前的容器/首个可聚焦卡加 id？**决定**：模板卡保持
  类名钩子（测试用），首焦改为壳的 `initialFocusId` 指向列表容器不可行（div 不可聚焦）→
  **保留组件内 onOpenAutoFocus 逻辑**（焦点目标不变），壳不传 initialFocusId（与 S5 全部笔记同款先例）。
- `contentId="orchestration-template-modal"`、`titleId` / `closeId="close-orchestration-template"` 逐字保留。
- 裸 `×` → 壳 svg；类名钩子（`.orchestration-template-*`）逐字保留；对应独占 legacy 规则退役 + 浅色块摘成员。

### T3：`OrchestrationAutoModal` → AppModal

- `size="xl"`、`height="fixed"`、`closeOn="button-only"`、footer = 聊天输入行（现状 composer 在
  两行 grid 的第二行 → AppModal footer 槽正合适；正文行 = messages 滚动区，抵 overflow-hidden 双滚）。
- 首焦：textarea 加 `id="orchestration-auto-input"`（新 id，querySelector 兜底逻辑保留）→ 可用壳的 initialFocusId。
- `contentId="orchestration-auto-modal"`、`closeId="close-auto-orchestration"` 逐字保留。
- 独占 legacy 族退役（含浅色 2120/2126/2132/2138 + 2103/2104 摘成员）。

### T4：主弹窗 `OrchestrationModal` → AppModal

- `size="2xl"`、`height="fixed"`、`closeOn="button-only"`、footer = `.orchestration-footer` 的内容
  （最大节点执行数 + 说明 + 保存/运行），footerClassName 保持 flex 布局。
- task-strip 进 body 第一行；layout 三栏网格进 body（bodyClassName 抵 overflow-hidden）。
- AlertDialog（替换草稿确认）**保持不动**（Radix AlertDialog 语义本就是确认框，非迁移对象）。
- id/类名契约逐字保留（测试 869 行钉住的全集）；首焦 `#orchestration-task` → 壳 initialFocusId。
- 独占 legacy 族退役；`.template-actions` 从**消费者侧**去钩（本弹窗改 utilities），规则本身留给 S7；
  浅色 2114 摘 `.orchestration-footer` 等成员。

### T5：X6 搬家 + 状态卡定位 + 收尾

- 新建 `styles/orchestration-canvas.css`（11 条 .x6-* 规则原文迁移 + 注释说明为何 unlayered），
  `globals.css` 顶部 `@import "./orchestration-canvas.css";`；legacy.css 删对应 11 条。
- `screenshot-s3-acceptance.mjs` s3-12 三条断言同步：:955 `=== 11 → === 0`（文案改「retired in S6」）、
  :965 逐处形态断言随计数归零改为跳过/删除、:1012 dist 断言预期仍绿（实测确认）。
- `.orchestration-status-floating` fixed → absolute：**先实测锚点**——StatusCard 渲染于
  `#messages`（section，flex 列），最近 positioned 祖先待查；目标锚点 = workspace 容器
  （含 composer），保证 right:70/bottom:128 语义近似不变；偏移值真机重测后定稿。
- 剩余独占族复核退役（`.orchestration-status*` 仅 position 一条，其余不动）。

### T6：`s6-*` 验收 + 全量回归

- 新建 `scripts/screenshot-s6-acceptance.mjs`（照抄 s4/s5 骨架；断言组：三弹窗壳契约/宽度令牌/
  关闭语义（Escape+背板**均不关**，与 s5-5 相反）/footer 钉底/画布在场/X6 视觉抽验/状态卡锚点/legacy 计数）。
- 复跑：s1/s2/s3（改数后）/s4/s5/bugfix；`npm run verify` 与基线比对。

## 已知豁免（沿用 S5）

`extensionConfig` ×1、`packages/openteamcli` ×2、`QuickCreateChat` 4 条 minify 警告。
**不要 `git add -A`**（S5 教训）。
