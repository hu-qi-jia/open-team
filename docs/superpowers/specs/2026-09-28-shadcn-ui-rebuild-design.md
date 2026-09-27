# OpenTeam UI 全量重塑设计文档（shadcn 官网基准）

- 日期：2026-09-28
- 状态：已与需求方逐节确认（视觉基准、信息架构、布局方向、响应式、迁移策略）
- 范围：`src/teamPage/ui` 视图层全量重塑 + legacy.css 退役；业务/数据层不动

## 1. 背景与目标

OpenTeam 此前完成了 V1–V5 / W1–W3 的渐进式 shadcn 化：组件大量替换为官方原语、配色统一 zinc，但**布局骨架仍是原设计**（浮窗壳 + Rail 图标栏 + Sidebar 群列表 + 工作区 + RolePanel 抽屉），且 `legacy.css`（约 4700 行）仍在底层承担结构样式。结果是企业务功能正常、观感"还是原来的样子"。

本次目标：

1. 布局按**方案 A（统一侧栏，shadcn Dashboard 形态）**重新规划；
2. 所有表面（壳层、工作区、面板、弹窗）的样式**严格对齐 shadcn 官网组件默认形态**；
3. 圆角、间距、字号只用官方 token，不放大、不自造；
4. 支持**响应式三档自适应**与**窗口/侧栏两级拖拽**；
5. 迁移结束后删除 legacy.css。

参考物：shadcn 官网（ui.shadcn.com）组件默认样式与 sidebar 区块形态。需求方提供的 Shadcnblocks Figma Kit 仅作氛围参考，不作逐像素基准（双方已确认）。

## 2. 需求决议记录

| # | 决策点 | 结论 |
| --- | --- | --- |
| D1 | 视觉基准 | shadcn 官网组件默认样式为唯一基准；Figma frame 不作为还原目标 |
| D2 | 信息架构 | 保持"单工作台 + 弹窗"，**不做**多视图导航；弹窗只保留确认/表单/库类 |
| D3 | 布局方向 | 方案 A：移除 Rail，统一左侧栏（品牌区/新建/搜索/群列表/底部工具行） |
| D4 | 圆角 | 严格使用官方 token（见 §3），不放大 |
| D5 | 主题切换 | 从顶栏移入「设置」菜单 |
| D6 | 顶栏按钮 | 全部改为「图标 + Tooltip」ghost 钮；低频项进「更多」DropdownMenu |
| D7 | 消息列 | 限宽 720px 居中 |
| D8 | 响应式 | 三档自适应，断点基于**浮窗内容宽度**而非视口（见 §5） |
| D9 | 拖拽 | 窗口级（右缘/底缘/右下角）+ 侧栏级（ResizableHandle 200–320px） |
| D10 | 迁移策略 | 方案一：新壳整体替换 + 表面逐块迁移（见 §7） |

## 3. 设计令牌与主题

沿用 `globals.css` 现有 zinc 主题（已是官方默认值），本次**不引入新色板**：

- `--radius: 0.625rem`（10px）保持；
- 组件圆角对应关系（官方 new-york 默认）：
  - `rounded-md`（8px）：Button、Input、Badge、SidebarMenuButton、DropdownMenuItem、Tab；
  - `rounded-lg`（10px）：Card、消息气泡、DialogContent、Composer 容器、笔记浮动卡；
  - `rounded-xl`（14px）：仅浮窗外壳（app-shell）整体；
  - `rounded-full`：仅 Avatar、浮窗铬件圆钮、Spinner 无关项；
- 字号：正文 `text-sm`，次级 `text-xs`，标题 `text-sm font-semibold tracking-tight`；
- 明暗主题：保留 `data-theme` 机制与 `themeController`（id 契约不动），入口移至设置菜单（D5）；
- 动效：`tw-animate-css` 保持。

## 4. 布局规格

### 4.1 总览

```text
┌───────────────────────────────────────────────────────────────┐
│ ⛶ 浮窗铬件（右上 ghost 圆钮：关闭/最小化/全屏；右下/右缘/底缘拖拽）│
│ ┌───────────┬─────────────────────────────────────────────────┐ │
│ │ Sidebar   │ ChatHeader（标题+Badge│图标钮组│ Separator│更多）│ │
│ │  w-60     ├─────────────────────────────────────────────────┤ │
│ │ 品牌      │                                                 │ │
│ │ ＋新建群聊 │              消息流（ScrollArea）                │ │
│ │ 搜索      │         内容列 max-w-[720px] 居中                │ │
│ │ 群列表    │                                                 │ │
│ │ (Resiza-  ├─────────────────────────────────────────────────┤ │
│ │  bleHandle)│        Composer（rounded-lg 容器）              │ │
│ │ 工具行×4  │                                                 │ │
│ └───────────┴─────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
   RolePanel → 右侧 Sheet（覆盖层）；NotesPanel → 右下浮动 Card
```

### 4.2 统一侧栏（`ui/sidebar.tsx` 官方原语，受控模式）

- `SidebarProvider` + `Sidebar`（**受控折叠**，见 §5 档位派生；不使用官方 `useIsMobile` viewport 钩子做档位）；
- Header：品牌行——logo 方块（`size-7 rounded-md bg-primary`）+ "OpenTeam" + 折叠按钮（`SidebarTrigger`）；
- `＋ 新建群聊`：`Button` variant="default" size="sm"（h-8，全宽，Plus 图标）——触发现有 QuickCreateChat / 群模板流程，行为不变；
- 搜索：`Input`（默认 h-9）+ Search 图标，过滤群列表（复用现有过滤逻辑）；
- 群列表：`SidebarMenu` + `SidebarMenuButton`（`isActive`）；
  - 每项：Avatar（首字）、群名（`truncate`）、未读/消息数（`text-xs text-muted-foreground`）；
  - 溢出动作：`DropdownMenu`（项以现有 `chatListActions` 为准逐项保留：置顶/重命名/导出/删除等）；
- Footer 工具行：`Tooltip` + `Button variant="ghost" size="icon"` ×4：
  1. 人员库（→ PeopleLibraryModal）
  2. 全部笔记（→ AllNotesModal）
  3. 添加大模型（→ ExternalModelsModal）
  4. 设置（→ `DropdownMenu`：**主题切换（D5）**、界面语言、智能体控制、导入导出——items 以现有 SettingsMenu 内容为准逐项保留）；
- 侧栏右缘：`ResizableHandle`，拖拽范围 200–320px，双击重置 240px，宽度持久化（appState 本地存储）。

### 4.3 工作区头部（ChatHeader 重写）

- 左：群名（`text-sm font-semibold`）+ 状态 `Badge variant="outline"`（草稿/初始化中/进行中/运行中/异常）；副标题（模式 · 成员数 · 消息数，`text-xs text-muted-foreground`）；
- 右（全部 ghost icon 钮 + Tooltip，D6）：
  - 恢复会话（RotateCcw）、编排（仅协作模式）、免@（AtSign，`aria-pressed` 开= `bg-accent`，保留 switch 语义）、成员（Users，开合 RolePanel Sheet）、笔记（StickyNote，开合 NotesPanel）；
  - `Separator`（竖向）+「更多」`DropdownMenu`：窄档收纳位（§5）+ 低频项；
- 移除项：浅色/深色分段控件（→设置菜单）、`恢复会话/编排/免@/成员/笔记` 的文字按钮形态（→图标钮）。

### 4.4 消息流（Messages / MessageItem 重写）

- `ScrollArea`，内容列 `max-w-[720px] mx-auto`（D7）；
- 成员消息：`Avatar`（首字，`size-7`）+ 名称行（`text-xs text-muted-foreground`，含模型标签）+ 气泡 `bg-muted rounded-lg px-3 py-2 text-sm`；markdown 渲染保持 markdown-it 现状；
- 自己的消息：右对齐，气泡 `bg-primary text-primary-foreground rounded-lg`；
- 系统/状态消息：居中 `text-xs text-muted-foreground`；
- 回复中状态行：`Spinner` + "×× 正在回复…"；
- 引用/回复气泡（ReplyControlBubble）、@高亮、MarkMenu、图片九宫格（ImageGrid）：样式随本次规范重塑，行为不变；
- 空态：`Empty` 原语（沿用 W3-3 迁移成果，按新规格微调）。

### 4.5 输入区（Composer 重写）

- 容器：`rounded-lg border bg-card p-2`，`focus-within:ring-1 ring-ring`（Card 视觉，不放大圆角）；
- 内部：无边框 `Textarea` 自动增高（沿用现有 autosize 逻辑），placeholder 文案不变；
- 底行：左 ghost 图标钮——@提及（Popover + MentionPicker）、附件（现有能力）；右侧 `Button` variant="default" size="sm"（h-8）：发送 + ArrowUp；
- 键盘行为不变（Enter 发送 / Shift+Enter 换行 / @ 唤起选择器）。

### 4.6 浮窗铬件（FloatingWindowChrome）

- 功能与 id 契约完全保留（`#floating-toolbar`、`#close-window`、`#toggle-window-size`、`#toggle-fullscreen`、`#window-resize-handle`，`floatingWindow.ts` 按 id 绑定）；
- 样式：右上三枚 `size-6 rounded-full border bg-background/80` ghost 圆钮；拖拽手柄扩展为**右缘 / 底缘 / 右下角**三处（`floatingWindow.ts` 几何逻辑扩展，见 §5）。

### 4.7 成员抽屉 / 笔记面板

- RolePanel → `Sheet`（右侧，`w-[340px]`，`smSizes` 档）：成员卡（Avatar + 名称 + 连接状态 + 受控 Switch 语义与现状一致）＋"添加成员"入口（→人员库）；编排入口按现状保留；
- NotesPanel → 右下浮动 `Card`（`rounded-lg border shadow-md`）：现有拖拽/缩放/范围切换行为保留，仅重塑视觉；
- 两者都是覆盖层，仍在 `#app` 之外渲染（§7.2）。

## 5. 响应式与拖拽

### 5.1 三档自适应（D8）

断点依据**浮窗内容宽度**（`#app` 宽度），不依赖视口：

| 档位 | `#app` 内容宽 | 侧栏 | 顶栏 | 消息列 |
| --- | --- | --- | --- | --- |
| wide | ≥ 1024px | 常驻 240px，可拖 200–320px | 全量图标钮 | 720px 居中 |
| medium | 768–1023px | 折叠为 56px 图标条（`collapsible="icon"` 行为，点击/悬停展开） | 次级钮收进「更多」 | 自适应限宽 |
| compact | < 768px | offcanvas 隐藏（`collapsible="offcanvas"`，左上按钮唤出 Sheet） | 仅 成员 + 更多 | 全宽留内边距 |

实现要点：

- **档位派生用 `data-app-size` 属性方案**：`floatingWindow.ts` 在写窗口内联尺寸时顺带计算档位，写 `#app[data-app-size="wide|medium|compact"]`；CSS/Tailwind 用该属性变体驱动断点。
  - 原因：Tailwind v4 容器查询要求 `container-type: inline-size`，会在 `#app` 上创建 containment，与浮窗 transform 定位/包含块语义存在冲突风险；属性方案零风险且确定性更强。
- `Sidebar` 使用**受控模式**：折叠状态由档位派生 + 用户手动切换覆盖（持久化），不使用官方 `useIsMobile`（其基于 viewport 媒体查询，与浮窗语义不符）。

### 5.2 拖拽（D9）

- 窗口级：拖拽手柄从单一右下角扩展为右缘 / 底缘 / 右下角；钳制 min 520×480（现值为 760×520，按本规格下调以触达 compact 档），max 为屏幕可用区；宽高与位置持久化（新增 localStorage 键 `openteam.shellGeometry`——floatingWindow 原无持久化，此为补充而非沿用）；
- 侧栏级：自绘 `SidebarResizeHandle`（约 40 行 pointer-events 手柄，像素钳制 200–320px，双击重置 240px，宽度持久化到 localStorage 键 `openteam.sidebar`）。**修订**：原定 `react-resizable-panels`（官方 Resizable）只支持百分比约束，无法保证像素钳制，且引入依赖不划算；视觉与交互仍与官方 Resizable 一致；
- 其他面板：笔记浮窗保留现有拖拽缩放；成员 Sheet 为覆盖层不参与拖宽。

## 6. 组件映射总表

| 现有 | 处理 | 使用的 shadcn 原语 |
| --- | --- | --- |
| `App.tsx` 壳结构 | 重写为 AppShell v2 | SidebarProvider/Sidebar/…、Sheet、DropdownMenu |
| `Rail.tsx` | **删除**（功能并入侧栏 Footer/列表） | — |
| `Sidebar.tsx`（群列表） | 重写进统一侧栏 | SidebarMenu(Button)、Input、DropdownMenu、Avatar、Tooltip |
| `ChatHeader.tsx` | 重写 | Badge、Tooltip、Button(ghost icon)、Separator、DropdownMenu |
| `Messages/MessageItem` | 重写 | ScrollArea、Avatar、Spinner、Empty |
| `Composer/MentionPicker` | 重写 | Textarea、Button、Popover、Kbd |
| `RolePanel` | 重写为 Sheet | Sheet、Switch、Avatar、Badge |
| `NotesPanel` | 重塑为浮动 Card | Card、Tabs(范围)、Tooltip |
| 人员库 5 弹窗 | 重塑 | Dialog、Command/Input、Card、Badge、Empty |
| AllNotes / ExternalModels / GroupTemplate | 重塑 | Dialog、ScrollArea、Card |
| 编排 3 弹窗 + X6 画布 | 弹窗重塑；画布节点配色已 token 化，微调 | Dialog、Card |
| `ui/` 29 个原语 | 已就绪 | 无新增组件、无新增依赖（侧栏拖宽用自绘手柄，见 §5.2） |
| `FloatingWindowChrome` | 保留 + 样式 ghost 化 | 自绘（圆钮） |

## 7. 架构与迁移策略（方案一，D10）

### 7.1 新壳结构

`App.tsx` fragment 子元素顺序保持四段，但内部结构全部换新：

```text
#root (display:contents)
├─ #app.app-shell（floatingWindow 几何契约目标；内部 = 新壳 Tailwind 布局）
│   ├─ FloatingWindowChrome（id 不变）
│   ├─ AppShell v2：Sidebar + workspace（ChatHeader/Messages/Composer）
│   └─ （Rail 删除）
├─ NotesPanel（#app 外，避免 transform 包含块劫持）
├─ 隐藏位（template-summary/list、window-launcher 保留）
├─ 弹窗群（Portal 到 body）
├─ IframeLayer（#iframe-host 契约不动）
└─ LanguageSync / Toaster
```

### 7.2 floatingWindow 契约与 minimized 约束解除

- `floatingWindow.ts` 继续按 id/class 操作 `#app`（minimized/fullscreen/内联几何）——React 侧永不重渲这些属性；
- 现行 legacy 的 `.app-shell.minimized + .notes-panel` **相邻兄弟约束解除**：NotesPanel 显隐改为由 appState 驱动（它已是 React 组件，监听同一状态），不再依赖 CSS 兄弟选择器；
- `#app` 上不引入 `container-type`（见 §5.1）。

### 7.3 legacy.css 处置

- 壳层结构规则（grid 三列、fixed 定位、Rail/panel 几何）随 S1 **直接删除**，由新壳 Tailwind 接管；
- V1 阶段的 legacy 变量重映射层（`--bg/--panel/…`）随对应表面迁移逐段删除，S7 清零；
- 弹窗/面板类规则在各表面重塑时同 commit 删除（延续 W 系列做法，但每步删除后不允许"死规则"残留）；
- 终态：`styles/` 仅剩 `globals.css`（token 层）。

### 7.4 阶段划分（每阶段：`npm run verify` + 截图验收）

| 阶段 | 内容 | 验收截图组 |
| --- | --- | --- |
| S1 | AppShell v2 壳：侧栏三态 + 头部骨架 + 空工作区 + 浮窗铬件 ghost 化；删壳层 legacy；`data-app-size` 档位 | `s1-*`（三档 × 明暗） |
| S2 | 工作区：Messages/MessageItem/Composer/MentionPicker/MarkMenu/ReplyControlBubble/ImageGrid | `s2-*` |
| S3 | RolePanel→Sheet、NotesPanel→浮动 Card、CanvasPortal | `s3-*` |
| S4 | 人员库 5 弹窗 | `s4-*` |
| S5 | 全部笔记 + 外部模型 + 群模板弹窗 | `s5-*` |
| S6 | 编排 3 弹窗 + 画布样式微调 | `s6-*` |
| S7 | 收尾：legacy.css 清零、变量重映射层删除、全量回归截图 | `s7-*` + 全组复拍 |

## 8. 明确不动的部分

- `src/group`（数据模型/存储/@解析/prompt）、`src/background`、`src/content`；
- runtime 编排：`runtimeClient`、`iframeHost`、`sendWithReconnect`、`roleRecoveryController`；
- 全部 GROUP_* 命令流与业务行为；
- `themeController` / `data-theme` 机制、i18n（`translateUi`）；
- `#iframe-host` / `#window-launcher` / `#template-*` 等 id 契约；
- appState 现有字段（只**新增**侧栏宽度/折叠态持久化字段）。

## 9. 边界与错误处理

- minimized/fullscreen 状态：新壳在两类状态下的显隐由 `#app` 类名驱动（CSS），React 结构不重渲；
- 拖拽钳制：窗口 min 520×480；侧栏 200–320px；笔记浮窗沿用现有 min 尺寸；
- compact 档长文本：群名/消息/徽标一律 `truncate`/`min-w-0`；
- 弹窗叠层：保持现有"逐层关闭"语义（W1 已实现），重塑不得改 Radix 层级参数以外的行为；
- 空数据/无成员/无笔记：全部 `Empty` 原语，不再自绘空态；
- 错误提示：统一 `sonner`（现状），新增表面禁止 `alert`。

## 10. 测试与验收

- **单元/组件测试**：现有 vitest + testing-library 断言随 DOM 同步更新；新增：
  - 档位派生（`data-app-size` 计算函数）单测；
  - 侧栏宽度持久化测试；
  - floatingWindow 新增拖拽缘的几何钳制测试；
- **每阶段门禁**：`npm run verify`（typecheck + test + build）全绿；
- **截图验收**：延续 `scripts/screenshot-*.mjs` 模式，每阶段新拍验收组（puppeteer 驱动），S7 复拍全组与设计稿对照；
- **人工核对清单**：三档宽度 × 明暗主题 × minimized/fullscreen/常规 三状态的矩阵走查。

## 11. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 官方 Sidebar 原语的折叠逻辑基于 viewport | 受控模式接管（§5.1），`useIsMobile` 不用于档位 |
| `container-type` 与浮窗 transform 冲突 | 改用 `data-app-size` 属性断点（已定案） |
| 壳切换 diff 大 | S1 单阶段聚焦壳层，旧工作区组件暂以原样嵌入新壳工作区插槽，S2 再逐个换血——壳与内容不同 commit 混改 |
| legacy 规则残留导致视觉打架 | 每次迁移同 commit 删除对应规则；S7 以 `grep` 清点残留选择器 |
| 8+ 弹窗域行为回归 | 弹窗重塑只动排版/样式，Radix 行为参数（叠层关闭、焦点）逐项保留并靠既有测试兜底 |
