# S2 工作区换血 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作区（消息流 / 输入区 / 提及·划选·图片附件面板 / 群列表）重塑为 shadcn 官网样式，并清偿 S1 终审挂账的 PARK-S2 项。

**Architecture:** 继续绞杀式迁移：在既有 React 组件内做「样式换血 + 结构对齐规格」，行为、id 契约、memo 签名机制、命令/桥接链路逐条保留；每个表面迁移的同一 commit 内删除 legacy.css 中对应规则族；S1 挂账的小项作为独立前置任务清账。

**Tech Stack:** React 19 + Tailwind v4 + shadcn/ui（new-york / zinc，本地 `src/teamPage/ui/components/ui/` 原语）+ vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-09-28-shadcn-ui-rebuild-design.md`（§4.2 搜索框、§4.4 消息流、§4.5 输入区、§5 响应式、§7.4 阶段表、§9 行为不变、§11 豁免）。计划与规格冲突时以规格为准。

## Global Constraints

- **样式基准**：shadcn 官网（new-york / zinc）为准；类名直接使用官网文档出现的 Tailwind 词。圆角只用 `rounded-md`(8px) / `rounded-lg`(10px) / `rounded-xl`(14px)；`xl` 仅浮窗外壳允许。
- **零新依赖**：不新增任何 npm 包；只用已有 ui 原语（avatar / scroll-area / spinner / empty / textarea / button / input / badge / tooltip）。
- **行为不变（§9）**：id 契约逐字保留——`#messages`、`#composer`、`#target-preview`、`#busy-preview`、`#message-input`、`#send-message`、`#reference-draft`、`#mention-panel`、`data-message-id`。键盘行为（Enter 发送 / Shift+Enter 换行 / ↑↓·Enter·Escape 的 @ 选择器 / IME 组合态不确认）、`composerBridge`、`runCommandWithReconnect`、clear-then-restore 草稿流、`MessageItem` 的 signature memo 与 innerHTML 重放 effect、thinking 超时定时器、`useAutoScroll`/`useMarkMenu` 链路全部不动。
- **文案与 aria**：所有用户可见文案与 `aria-label`/`title` 走 `useT()`（`src/teamPage/ui/hooks/useT.ts`）；新增键必须写入翻译表且中英双语言可解析。
- **定位铁律**：`#app` 内一律 `position:absolute`，禁止 `position:fixed`（floatingWindow 会在启动恢复/拖拽/缩放/取消最小化时剥离 transform）；MarkMenu portal 到 `body`（`#app` 之外）可用 fixed。
- **legacy 清偿**：每个表面迁移的同一 commit 内删除 legacy.css 中该表面的规则族；本计划结束时 `.messages`/`.message-*`/`.composer`/`.mention-panel`/`.mark-menu`/`.message-image-*`/`.chat-list` 工作区家族不得残留（`.orchestration-*` 家族归 S6，保留）。
- **门禁**：每任务 `npm run typecheck` + 触及的测试文件 + `npm run build` 全绿才算完成。已知既有失败豁免：openteamcli 相关 ×2（模块导入 SyntaxError）、extensionConfig 路径分隔符 ×1。
- **禁令**：禁止 git worktrees、禁止 junction `node_modules`（S1 T3 事故）；禁止并行派发多个实现子代理。
- **runtime 不动**：`iframeHost`/`sendWithReconnect`/编排 runtime 一律不改（唯一例外：Task 2 中 globals.css 的纯 CSS 规则）。

## 已裁决的规格偏差（执行时按此为准，不得再议）

1. **附件按钮省略**。§4.5「附件（现有能力）」前提不成立：`MessageImageAttachment` 只有展示链路（ImageGrid/imageObjectUrls），全库无发送 UI 或命令路径。行为不变原则下不得新发明上传流程 → 左侧 ghost 图标钮只有 @提及 一个。
2. **@提及面板保持内联光标锚定**，不用 Radix `Popover`/`cmdk`：焦点必须留在 textarea（Composer.tsx 头部注释已论证），Popover 会抢焦点破坏键盘模型。仅按 popover 的**视觉**重塑（`bg-popover border rounded-md shadow-md`）。
3. **autosize 为新增而非沿用**：现状无 JS autosize（只有 CSS max-h）。按规格意图补最小 scrollHeight 自增高（Task 5 给出完整代码）。
4. **ChatList 精修 + 搜索框归入本计划**（S1 终审挂账 + §4.2 搜索规格）。
5. **OrchestrationStatusCard / ReviewSummary 样式归 S6**，本计划只保证不破坏。

---

### Task 1: S1 清账 A — 浮窗生命周期（pagehide 冲刷 + 退出全屏几何恢复）

**Files:**
- Modify: `src/teamPage/ui/shell/floatingWindow.ts`（若路径不同以 `grep -n "persistShellGeometry\|geometry" src/teamPage/ui/shell/floatingWindow.ts` 实际为准）
- Modify: `src/teamPage/ui/styles/globals.css`（拖拽区 cursor）
- Test: 触及的 floatingWindow 测试文件（`grep -rl "floatingWindow" src --include="*.test.*"`）

**Interfaces:**
- Consumes: S1 已落地的 `persistShellGeometry` debounce 持久化、`openteam.shellGeometry` 存储键。
- Produces: ①`pagehide` 事件时 debounce 立即冲刷（无 pending 时零写入）；②退出全屏时从持久化几何恢复 left/top（S1 现状只恢复宽高）；③拖拽热区在非全屏/非最小化时显示 `cursor: grab`、按下为 `grabbing`。

背景（S1 终审挂账原文）：persistTimer debounce 意味着关闭页面/切走时最后一次几何可能未落盘；退出全屏 restore 分支遗漏 left/top，窗口跳回 (0,0)。

- [ ] **Step 1: 写失败测试（pagehide 冲刷）**

```ts
// 现有 floatingWindow 测试文件内追加（沿用该文件既有的 DOM 装配方式）
it('flushes pending geometry persist on pagehide', () => {
  vi.useFakeTimers()
  // …用该文件既有的方式装配 #app + 触发一次 resize/drag 使 persist 进入 debounce…
  window.dispatchEvent(new Event('pagehide'))
  expect(localStorage.setItem).toHaveBeenCalledWith(
    'openteam.shellGeometry',
    expect.any(String),
  )
  vi.useRealTimers()
})

it('pagehide with no pending persist does not write', () => {
  localStorage.setItem.mockClear()
  window.dispatchEvent(new Event('pagehide'))
  expect(localStorage.setItem).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 写失败测试（退出全屏恢复 left/top）**——按测试文件既有全屏用例的模式复制一份：进入全屏 → 改动几何并等待 debounce 落盘 → 退出全屏 → 断言 `#app` 内联 `left`/`top` 等于落盘值（S1 现状只恢复 width/height，此测试对 left/top 断言即失败）。
- [ ] **Step 3: 运行确认失败**：`npx vitest run <该测试文件>` → 两条新用例 FAIL。
- [ ] **Step 4: 实现**。在 floatingWindow.ts 内（沿用文件既有风格）：

```ts
// debounce 持久化处已有 persistTimer；新增：
function flushPendingGeometryPersist(): void {
  if (persistTimer === undefined) return
  window.clearTimeout(persistTimer)
  persistTimer = undefined
  writeShellGeometry() // 换成文件里 debounce 回调实际调用的落盘函数名
}
window.addEventListener('pagehide', flushPendingGeometryPersist)
// 主协调器的 dispose/disconnect 清理路径里同步移除该监听（grep 现有
// removeEventListener 的位置，跟随其模式；若 dispose 用 AbortController
// signal 则传入同一 signal）
```

退出全屏 restore 分支：在该分支恢复 width/height 的同一处，从同一持久化对象补 `left`/`top` 恢复（沿用 `moveShellTo` 的写内联样式方式）。
- [ ] **Step 5: 拖拽区 cursor（纯 CSS，globals.css 追加到既有 @layer utilities 块）**

```css
/* 拖拽热区（顶部 52px 判定在 floatingWindow.isTopChromeDragEvent）：
   非全屏/非最小化时 header 空白处显示抓取光标；按钮保持 pointer */
.app-shell:not(.fullscreen):not(.minimized) header { cursor: grab; }
.app-shell:not(.fullscreen):not(.minimized) header:active { cursor: grabbing; }
.app-shell header button, .app-shell header [role='button'] { cursor: pointer; }
```

（`.app-shell`/`.fullscreen`/`.minimized` 类名先 `grep -n "classList" src/teamPage/ui/shell/floatingWindow.ts` 核对实际值，不一致则以实际为准。）
- [ ] **Step 6: 门禁 + 提交**：`npm run typecheck`、`npx vitest run <触及测试>`、`npm run build` → 全绿后：

```bash
git add -A && git commit -m "fix(shell): flush geometry on pagehide, restore left/top on unfullscreen, grab cursor"
```

---

### Task 2: S1 清账 B — hooks/store 小项 + aria 文案 i18n

**Files:**
- Modify: `src/teamPage/ui/hooks/useSidebarPrefs.ts`（模块单例，约 :41-42）
- Modify: `src/teamPage/ui/hooks/useAppShellChrome.ts`
- Modify: `src/teamPage/ui/components/shell/FloatingWindowChrome.tsx`（:10-16 硬编码中文 aria-label/title）
- Modify: `src/teamPage/ui/lib/i18n.ts`（翻译表；文件名不符则 `grep -rn "UI_TRANSLATIONS" src --include="*.ts"` 定位）
- Modify: `src/teamPage/ui/styles/globals.css`（iframe-host 标题隐藏）
- Test: `useSidebarPrefs.test.ts`、`useAppShellChrome.test.tsx` 新增用例；FloatingWindowChrome 无测试文件则不新建，由 Task 8 截图脚本覆盖 aria 值。

**Interfaces:**
- Consumes: `useT()`、`translateUi`（既有）。
- Produces: ①`resetSidebarPrefsForTests()` 具名导出（重置模块单例）；②`useAppShellChrome` 对 chrome 对象做函数式更新（消除「无关字段变化不重渲」）；③窗口铬件 6 按钮 aria-label/title 全部走翻译表；④最小化时 `body:has(#app.minimized)` 隐藏 `.chat-frame-group-title`（iframeHost 空群聊残影）。

- [ ] **Step 1: useSidebarPrefs 测试先行**

```ts
import { resetSidebarPrefsForTests } from './useSidebarPrefs' // 文件顶部既有 import 区

it('resetSidebarPrefsForTests resets the module singleton', () => {
  // 先用既有测试助手改变一次偏好（如 toggleCollapsed），再重置
  resetSidebarPrefsForTests()
  // 断言回到默认值（对齐文件内既有默认值断言的写法）
})
```

实现：在 useSidebarPrefs.ts 模块单例旁导出 `resetSidebarPrefsForTests(): void`，把单例恢复为初始字面量并通知订阅者。
- [ ] **Step 2: useAppShellChrome 函数式更新。** 找到 `setChrome(prev => ({ ...prev, … }))` 或直接 `chrome.x = y` 类的更新点，统一改为能触发重渲的函数式更新形式；补一条回归测试：改变与渲染无关的字段后，hook 消费组件仍重渲（用 `renderHook` + render 计数，模式照抄该测试文件既有用例）。
- [ ] **Step 3: aria i18n。** FloatingWindowChrome.tsx 的 6 处 `aria-label`/`title` 硬编码中文改为 `useT()` 产出；翻译键名语义化（如 `window.close` / `window.minimize` / `window.fullscreen` / `window.resize` / `window.resizeWidth` / `window.resizeHeight`），中英文分别落库（英文如 "Close window" / "Minimize window" / "Fullscreen" / "Resize window" / "Resize width" / "Resize height"）。 Composer.tsx 的 `aria-label="取消引用"` 本任务一并改 `t('取消引用')` 并确认键已存在（S1 7611461 已加过「主题」，同表补「取消引用」缺则新增）。
- [ ] **Step 4: iframe-host 残影 CSS（globals.css @layer utilities 块追加）**

```css
/* 最小化时 #iframe-host 的编排窗口组标题悬空残影（S1 T9 发现，runtime
   不动，纯 CSS 规避） */
body:has('#app.minimized') .chat-frame-group-title { display: none; }
```

（`.minimized` 类名按 Task 1 Step 5 的核对结果保持一致。）
- [ ] **Step 5: 门禁 + 提交**：typecheck + 触及测试 + build 全绿 →

```bash
git add -A && git commit -m "fix(ui): S1 ledger sweep — singleton reset, chrome re-render, aria i18n, minimized title"
```

---

### Task 3: Messages 容器 v2 — ScrollArea + 720px 居中列

**Files:**
- Modify: `src/teamPage/ui/components/chat/Messages.tsx`
- Possibly Modify: `src/teamPage/ui/components/ui/scroll-area.tsx`（仅当 Viewport 未导出时加 3 行 viewportRef 透传，见 Step 1）
- Modify: `src/teamPage/ui/styles/legacy.css`（删 `.messages` 容器族、`.message-time-divider`、`.message-system-pill`；**不得**删 `.message-row/.message-inner/.message-stack/.message-name/.message-avatar/.message-bubble` 等条目级族——Task 4 还在用）
- Test: `src/teamPage/ui/components/chat/Messages.test.tsx`

**Interfaces:**
- Consumes: `useAutoScroll(scrollRef, version, shouldPreserve)`（ref 必须指向真实滚动元素）、`useMarkMenu({ containerRef: scrollRef, … })`。
- Produces: `#messages` 仍是 `<section>` 且带 `aria-live="polite"`；滚动容器换成 ScrollArea Viewport；内容列 `mx-auto max-w-[720px]`；MessageItem/ReplyControlBubble 的外边距从行内 `px-6` 移交列容器（Task 4 依赖此事实：行内不再有水平 padding）。

- [ ] **Step 1: 核对 scroll-area 原语**。读 `src/teamPage/ui/components/ui/scroll-area.tsx`：若导出了 `ScrollAreaViewport`，直接组合使用；若未导出，给 `ScrollArea` 加一个透传 prop（保持其余与官网一致）：

```tsx
// scroll-area.tsx 内，仅当需要时：
function ScrollArea({ className, children, viewportRef, …props }: {
  viewportRef?: React.Ref<HTMLDivElement>
} & React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative', className)} {...props}>
      <ScrollAreaPrimitive.Viewport ref={viewportRef} className='size-full rounded-[inherit] […]'>{children}</ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
```

- [ ] **Step 2: 写失败测试**（Messages.test.tsx 追加，沿用该文件既有装配助手）：

```tsx
it('renders a ScrollArea viewport whose content column is capped at 720px', () => {
  // …既有方式渲染带消息的会话…
  const section = document.querySelector('#messages')!
  const viewport = section.querySelector('[data-slot="scroll-area-viewport"]') // 或 Radix 默认 data-radix-scroll-area-viewport
  expect(viewport).not.toBeNull()
  const column = viewport!.querySelector(':scope > div')
  expect(column?.className).toContain('max-w-[720px]')
  expect(section.querySelector('.message-row')?.className).not.toContain('px-6') // padding 已移交列容器
})

it('auto-scrolls the viewport to bottom on mount', async () => {
  // 渲染多条消息后，断言 viewport.scrollTop === scrollHeight - clientHeight
  // （jsdom 不做布局，scrollHeight 恒 0 时改为断言 useAutoScroll 的贴底赋值
  // 语句被触达——照抄 useAutoScroll.test.ts 的 mock 方式；若该文件无此
  // mock 模式，则跳过本条并以 Task 8 截图脚本覆盖）
})
```

- [ ] **Step 3: 运行确认失败** → `npx vitest run src/teamPage/ui/components/chat/Messages.test.tsx`。
- [ ] **Step 4: 实现**。Messages.tsx 两处 `return` 的结构改为：

```tsx
<section id="messages" aria-live="polite" className="flex h-full min-h-0 flex-col">
  <ScrollArea className="min-h-0 flex-1" viewportRef={scrollRef}>
    <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pb-4">
      {/* 空态 / entries / thinkingRoles / stoppedRoles 全部移入列内；
          MessageItem/ReplyControlBubble 仍按 Task 4 前的现状渲染 */}
    </div>
  </ScrollArea>
  <MarkMenu controller={markMenuController} />
</section>
```

要点：①`scrollRef` 类型改为能接到 Viewport 的 `RefObject<HTMLElement | null>`，`useAutoScroll` 与 `useMarkMenu.containerRef` 不改签名；②`OrchestrationStatusCard` 留在列容器外（S6 表面，仅保位）；③时间分隔行与系统 pill 类名保留但样式已由行内 utilities 承担，删除 legacy 中 `.messages` 容器族 + `.message-time-divider` + `.message-system-pill` 规则（Task 3 的 commit 一并删除）。
- [ ] **Step 5: 门禁 + 提交**（同前格式）：

```bash
git add -A && git commit -m "feat(workspace): messages container on ScrollArea with 720px centered column"
```

---

### Task 4: MessageItem / ReplyControlBubble v2 — 气泡与状态行

**Files:**
- Modify: `src/teamPage/ui/components/chat/MessageItem.tsx`
- Modify: `src/teamPage/ui/components/chat/ReplyControlBubble.tsx`
- Modify: `src/teamPage/ui/styles/legacy.css`（删 `.message-row/.message-inner/.message-stack/.message-name/.message-avatar/.message-bubble/.message-mentions/.message-body/.thinking-dots/.orchestration-message-label` 族；`.markdown-body` 族**剪切**到 globals.css `@layer components`（内容样式原样搬迁，不改规则）；`.orchestration-review-*` 保留归 S6）
- Test: `src/teamPage/ui/components/chat/Messages.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 720px 列（行内无水平 padding）、`Avatar/AvatarFallback`、`Spinner` 原语。
- Produces: 导出面不变（`MessageItem/SiteBadge/SiteJumpButton/handleResyncMessage/MessageToolButton`、`ReplyControlBubble` props 不变）；signature memo 与 innerHTML 重放 effect 原样保留。

规格目标（§4.4 逐条）：成员消息 `Avatar`（首字 size-7）+ 名称行 `text-xs text-muted-foreground`（含模型标签）+ 气泡 `bg-muted rounded-lg px-3 py-2 text-sm`；自己消息右对齐气泡 `bg-primary text-primary-foreground rounded-lg`；系统消息居中 `text-xs text-muted-foreground`；回复中状态 `Spinner` + "×× 正在回复…"。

- [ ] **Step 1: 写失败测试**（Messages.test.tsx 追加）：

```tsx
it('member messages use size-7 avatar and bg-muted rounded-lg bubble', () => {
  // 既有装配渲染一条 assistant 消息
  const row = document.querySelector('[data-message-id]')!
  const bubble = row.querySelector('.message-bubble')!
  expect(bubble.className).toContain('bg-muted')
  expect(bubble.className).toContain('rounded-lg')
  expect(bubble.className).toContain('px-3')
  expect(bubble.className).toContain('py-2')
  const avatar = row.querySelector('.message-avatar')!
  expect(avatar.className).toContain('size-7')
})

it('user messages are right-aligned with primary bubble', () => {
  // 渲染一条 user 消息
  const row = /* user 消息行 */
  expect(row.className).toContain('flex-row-reverse')
  const bubble = row.querySelector('.message-bubble')!
  expect(bubble.className).toContain('bg-primary')
  expect(bubble.className).toContain('rounded-lg')
})

it('reply status row renders spinner + name text', () => {
  // 既有 thinking 角色装配（该文件已有 thinking 用例，仿写）
  const row = /* ReplyControlBubble 行 */
  // Spinner 原语 = Loader2Icon（svg[role="status"][aria-label="Loading"]，无 data-slot）
  expect(row.querySelector('svg[role="status"]')).not.toBeNull()
  expect(row.textContent).toContain('正在回复')
})
```

（选择器钩子类名 `.message-bubble/.message-avatar/.message-row` 保留为 class 名使用，仅样式来源换成行内 utilities——与 S1 的做法一致。）
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: MessageItem 实现**。关键行替换：

```tsx
// 头像：size-8 → size-7。计划裁决：改用 Avatar 原语 + AvatarFallback
// （tone 色落在 Fallback 的 className）
<Avatar className="message-avatar size-7 shrink-0">
  <AvatarFallback className={`${message.type === 'user' ? 'role-tone-5' : roleToneClass(message.roleName)} text-xs font-medium text-secondary-foreground`}>
    {message.type === 'user' ? '你' : roleAvatarLabel(message.roleName)}
  </AvatarFallback>
</Avatar>

// 名称行：text-[13px] → text-xs
// 气泡：
// user:    'rounded-lg bg-primary px-3 py-2 text-primary-foreground'
// member:  'rounded-lg bg-muted px-3 py-2 text-sm'
//（删除现有 rounded-2xl / bg-transparent 差异；before:hidden、shadow-none
// 一并移除——legacy 尾巴规则删除后无 ::before 可言）

// 流式占位（emptyPendingBody）：
<div className="message-body flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
  <Spinner className="size-3.5" />
  <span>正在回复中…</span>
</div>
// 删除 'thinking-dots' 类引用
```

行容器：`px-6 py-1.5` → `py-1.5`（水平 padding 已由 Task 3 列容器接管，`flex-row-reverse` 保留）。
- [ ] **Step 4: ReplyControlBubble 实现**。状态行按规格重排（名称行保留 SiteBadge/SiteJumpButton），气泡体改为状态行：

```tsx
<div className={`message-body flex items-center gap-2 text-sm${stopped ? ' text-muted-foreground' : ' text-muted-foreground'}`}>
  {!stopped && <Spinner className="size-3.5" />}
  <span>{stopped ? '已停止回复' : `${role.name} 正在回复…`}</span>
</div>
// 工具行（停止/重发 MessageToolButton）保留在状态行右侧：
// 外层改 justify-between，或状态行 + 工具行同行 flex —— 实现取「一行内
// 左文右钮」： <div className="…flex items-center justify-between gap-2">
```

头像/名称行结构照抄 Step 3 的 Avatar size-7 + `text-xs` 名称行。
- [ ] **Step 5: markdown-body 搬迁**。`grep -n "markdown-body" src/teamPage/ui/styles/legacy.css` 找出全部规则，**剪切**到 `src/teamPage/ui/styles/globals.css` 的 `@layer components` 块（规则内容逐字保留）；legacy.css 中不再残留。
- [ ] **Step 6: @高亮重塑（§4.4「@高亮…样式随本次规范重塑，行为不变」）**。`src/teamPage/ui/lib/messageHighlightsDom.ts` :51 现以 `mark.className = 'message-highlight'` 挂 legacy 样式；改为 utilities + 内联（CSS 变量机制保留）：

```ts
mark.className = 'message-highlight rounded-[2px]'
mark.style.setProperty('--message-highlight-rgb', messageHighlightColorRgb(color))
mark.style.background = 'rgba(var(--message-highlight-rgb), 0.32)'
mark.style.boxShadow = 'inset 0 -1px 0 rgba(var(--message-highlight-rgb), 0.72)'
```

- [ ] **Step 7: 删除 legacy 族**（本 commit）：`.message-row`、`.message-inner`、`.message-stack`、`.message-name`、`.message-avatar`、`.message-bubble`（含其 `::before` 尾巴）、`.message-mentions`、`.message-body`、`.thinking-dots`、`.orchestration-message-label`、`.message-highlight`（legacy :2226-2232）。删除前 `grep -n` 每个选择器确认影响面只在已迁移组件。
- [ ] **Step 8: 门禁 + 提交**：

```bash
git add -A && git commit -m "feat(workspace): message bubbles and reply status row per spec, retire message legacy css"
```

---

### Task 5: Composer v2 — Card 视觉 + autosize + 底行图标钮

**Files:**
- Modify: `src/teamPage/ui/components/composer/Composer.tsx`
- Modify: `src/teamPage/ui/styles/legacy.css`（删 `.composer`、`.composer-actions`、`.reference-draft` 族；`.mention-panel` 族留给 Task 6）
- Test: `src/teamPage/ui/components/composer/Composer.test.tsx`

**Interfaces:**
- Consumes: Task 2 已把 `aria-label="取消引用"` 换成 `t('取消引用')`。
- Produces: `#composer/#target-preview/#busy-preview/#message-input/#send-message/#reference-draft` id 与全部键盘/草稿/桥接行为不变；新增 `@提及` ghost 图标钮（无人员时禁用）；textarea 获得最小 scrollHeight autosize。

- [ ] **Step 1: 写失败测试**（Composer.test.tsx 追加）：

```tsx
it('composer container gains focus ring and small radius', () => {
  // 既有装配渲染 Composer
  const form = document.querySelector('#composer')!
  expect(form.className).toContain('rounded-lg')
  expect(form.className).toContain('focus-within:ring-1')
  expect(form.className).toContain('ring-ring')
  expect(form.className).not.toContain('rounded-2xl')
})

it('mention button inserts @ and focuses textarea', async () => {
  // 既有装配（有人员的会话）；fireEvent.click(document.querySelector('#composer-mention')!)
  const input = document.querySelector('#message-input') as HTMLTextAreaElement
  expect(input.value).toContain('@')
  expect(document.activeElement).toBe(input)
})

it('mention button is disabled without roles', () => {
  // 空会话装配
  expect((document.querySelector('#composer-mention') as HTMLButtonElement).disabled).toBe(true)
})

it('textarea grows with content up to max-h', () => {
  // 设置超长 value 触发 change 后断言 style.height 被赋值且 <= 160px（max-h-40）
  // jsdom 无布局：scrollHeight 恒 0 —— 用 Object.defineProperty(input, 'scrollHeight', { value: 300 }) mock 后断言 height === '160px'
})
```

- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。

```tsx
// ① 容器（保留 id="composer" 与 onSubmit）：
<form id="composer" className="composer mx-6 mb-4 rounded-lg border border-border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring" onSubmit={handleFormSubmit}>

// ② autosize（组件内新增，边缘 effect）：
const autosize = useRef<() => void>(() => undefined)
autosize.current = () => {
  const el = textareaRef.current
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px` // max-h-40
}
useEffect(() => { autosize.current() }, [draft])
// textarea 上： rows={1} className="… min-h-9 max-h-40 …"（替换 min-h-[54px]，
// 保留 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed
// outline-none placeholder:text-muted-foreground；placeholder 文案逐字不变）

// ③ 底行（composer-actions 结构保留两个 id 预览行，左侧加图标钮）：
<div className="composer-actions flex items-center justify-between gap-2 px-1 pb-1">
  <div className="flex min-w-0 items-center gap-1">
    <Button id="composer-mention" type="button" variant="ghost" size="icon-sm"
      disabled={view.roles.length === 0}
      aria-label={t('提及成员')} title={t('提及成员')}
      onClick={() => {
        const el = textareaRef.current
        if (!el) return
        const pos = el.selectionStart ?? draftRef.current.length
        const next = `${draftRef.current.slice(0, pos)}@${draftRef.current.slice(pos)}`
        pendingSelectionRef.current = pos + 1
        updateDraft(next)
        setMentionDismissed(false)
        el.focus()
      }}
    ><AtSign className="size-4" /></Button>
    <div className="min-w-0">
      <div id="target-preview" …>{preview.targetText}</div>
      <div id="busy-preview" …>{preview.busyText}</div>
    </div>
  </div>
  <Button id="send-message" type="submit" size="sm" disabled={preview.sendDisabled}>
    <span>{t('发送')}</span>
    <ArrowUp className="size-3.5" />
  </Button>
</div>
```

注意：`Button size="icon-sm"` 若原语无此 size，用 `size="icon"` + `className="size-7"`；`t` 来自 `useT()`；`@插入` 复用既有 `pendingSelectionRef` 恢复光标机制（`mentionDismissed` 置 false 让面板随即弹出——光标前有未闭合 @ 会自然满足 `shouldShowMentionPanel`）。
- [ ] **Step 4: 删 legacy**：`.composer`、`.composer-actions`（含 :607 联合选择器里的成员——把该行拆开只删 composer 成员）、`.reference-draft` 族。
- [ ] **Step 5: 门禁 + 提交**：

```bash
git add -A && git commit -m "feat(workspace): composer card visual with autosize and mention button"
```

---

### Task 6: MentionPicker / MarkMenu / ImageGrid 视觉重塑

**Files:**
- Modify: `src/teamPage/ui/components/composer/MentionPicker.tsx`
- Modify: `src/teamPage/ui/components/chat/MarkMenu.tsx`
- Modify: `src/teamPage/ui/components/chat/ImageGrid.tsx`
- Modify: `src/teamPage/ui/styles/legacy.css`（删 `.mention-panel`、`.mark-menu`、`.message-image-*` 族）
- Test: `MentionPicker.test.tsx`（类名断言同步）；MarkMenu/ImageGrid 无组件测试则逻辑测试（useMarkMenu/imageObjectUrls）必须保持全绿。

**Interfaces:**
- Consumes: MentionPicker 的 props/键盘契约（宿主 Composer 驱动）不变；MarkMenu 的 `useLayoutEffect` 几何定位逻辑不变（portal→body，允许 fixed）；ImageGrid 的 `imageCache` 单例导出不变。
- Produces: 三者纯视觉换肤，DOM 结构键（`#mention-panel`、`.mention-option`、`.mark-menu`、`.message-image-grid`）保留为 class/id 钩子。

- [ ] **Step 1: MentionPicker**。面板容器与选项行换官方 popover/command 视觉（不用 Radix，理由见偏差 2）：

```tsx
<div id="mention-panel" className="mention-panel overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
  <button className={index === activeIndex
    ? 'mention-option active flex w-full items-center gap-2 rounded-sm bg-accent px-2 py-1.5 text-sm text-accent-foreground outline-none'
    : 'mention-option flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground'}>
```

内部 `mention-avatar`（首字小圆标，`flex size-6 items-center justify-center rounded-full bg-muted text-xs`+既有 tone 色）、`mention-name`（`flex-1 truncate text-left`）、站点徽标复用 `SiteBadge` 同款 utilities（`rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground`）。同步更新 MentionPicker.test.tsx 中对类名的断言（`.active` 钩子必须保留）。
- [ ] **Step 2: MarkMenu**。容器 `.mark-menu` 换 `rounded-md border border-border bg-popover p-1 shadow-md`；动作项 `rounded-sm px-2 py-1.5 text-sm hover:bg-accent`；色板行保留 `mark-color-row/mark-color-btn` 钩子，色钮改 `size-5 rounded-full ring-offset-2`，选中态 `ring-2 ring-ring`。`useLayoutEffect` 几何代码逐字不动。
- [ ] **Step 3: ImageGrid**。`.message-image-grid` → `grid gap-1`（列数逻辑按既有 image-count-* 分支保留，如 `grid-cols-2`/单图 `w-48`）；`.message-image-tile` → `relative overflow-hidden rounded-md border border-border`；预览按钮/下载浮层既有行为类名保留，视觉词换官网 ghost 样式（`bg-background/80 backdrop-blur-sm`）。加载/错误/重试态文案与行为不动。
- [ ] **Step 4: 删 legacy 三族**（本 commit）：`.mention-panel`（1802 起）、`.mark-menu`（2234 起）、`.message-image-*`（1517–1650 区段），删前 grep 确认无其余引用。
- [ ] **Step 5: 门禁 + 提交**：

```bash
git add -A && git commit -m "feat(workspace): shadcn visuals for mention panel, mark menu, image grid"
```

---

### Task 7: ChatList 精修 — 搜索框 + 图标条形态

**Files:**
- Modify: 侧栏组合文件（`grep -rn "新建群聊" src/teamPage/ui/components --include="*.tsx" -l` 定位，S1 为 shell/ 下 AppShellFrame 一族）
- Modify: `src/teamPage/ui/components/chat/ChatList.tsx`
- Modify: `src/teamPage/ui/lib/chatListItems.ts`（仅当过滤函数缺失时补纯函数）
- Modify: `src/teamPage/ui/styles/legacy.css`（删 `.chat-list`/`.chat-item` 族 542–683 中已被本任务迁移覆盖的部分）
- Test: `ChatList.test.tsx`、`chatListItems.test.ts`

**Interfaces:**
- Consumes: §4.2：搜索 `Input`（h-9）+ Search 图标，**复用现有过滤逻辑**；`SidebarMenu/SidebarMenuButton` 既有列表（S1 已迁移）。
- Produces: 搜索框受控过滤群列表（状态为组件本地，不入持久化）；图标条档（medium/compact 唤出形态）下每项只显示 Avatar + 未读角标，Tooltip 显示群名；列表项在 56px 图标条内不溢出。

- [ ] **Step 1: 盘点现状**。读 chatListItems.ts 与 ChatList.tsx：确认既有过滤函数（S1 前的 vanilla 搜索逻辑若已入 lib 则复用；若无，则在 lib 补纯函数 `filterChatListItems(items, query)`：大小写不敏感的群名 substring 匹配）。
- [ ] **Step 2: 写失败测试**（ChatList.test.tsx / chatListItems.test.ts）：

```ts
it('filterChatListItems matches name case-insensitively', () => {
  expect(filterChatListItems([{ id: 'a', name: '设计组' }, { id: 'b', name: 'Dev' }], 'dev'))
    .toEqual([{ id: 'b', name: 'Dev' }])
})

it('search input filters the visible chat list', () => {
  // 渲染侧栏（既有装配），typeInto 搜索框 '设计'，断言列表只剩目标项
})

it('icon-mode items show avatar-only with tooltip', () => {
  // 以 compact/medium 档装配（照抄 S1 T6 测试的 data-app-size 装配方式）
  // 断言项内群名文本容器带 hidden（或 not rendered），且触发元素带 aria-label=群名
})
```

- [ ] **Step 3: 实现**。侧栏组合处、「＋ 新建群聊」按钮之后插入：

```tsx
<div className="relative">
  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
  <Input
    value={query} onChange={e => setQuery(e.target.value)}
    className="h-9 pl-8" placeholder={t('搜索群聊')}
    aria-label={t('搜索群聊')}
  />
</div>
```

列表项：`SidebarMenuButton` 内群名容器加图标条档隐藏（用 `data-app-size` 驱动的工具类或组件内 tier 判断——跟随 S1 既有档位判定机制，grep `data-app-size` 在组件层的读法）；`isActive` 保留；溢出 `DropdownMenu` 动作（置顶/重命名/导出/删除等）不动。图标条形态：`size-8` Avatar 居中 + 未读 `Badge`（`absolute -right-0.5 -top-0.5 size-4 rounded-full px-1 text-[10px]`）。
- [ ] **Step 4: 门禁 + 提交**：

```bash
git add -A && git commit -m "feat(sidebar): chat list search input and icon-mode variants"
```

---

### Task 8: s2-* 截图验收 + legacy 清零审计

**Files:**
- Create: `scripts/screenshot-s2-acceptance.mjs`（复制 `scripts/screenshot-s1-acceptance.mjs` 的装配/启动模板改造）
- Modify: `src/teamPage/ui/styles/legacy.css`（若审计发现漏网族，回到对应任务口径删除）

**Interfaces:**
- Consumes: S1 验收脚本的浮窗装配、档位切换、截图与断言模板（55 项通过的那套）。
- Produces: `screenshots/s2-*.png` 组 + 全部断言通过的控制台报告；legacy 工作区族清零的 grep 审计记录。

- [ ] **Step 1: 编写脚本**。以 s1 脚本为模板，断言组（编号 `s2-*`）：
  1. 消息流：`#messages` 内存在 `[data-radix-scroll-area-viewport]`（或 `[data-slot="scroll-area-viewport"]`，以实际 DOM 为准）；内容列 `computed(max-width) === '720px'` 且水平居中；
  2. 气泡：成员消息 bubble `computed(background-color)` = muted 变量值、`border-radius` = 10px；user 消息右对齐（`flex-direction: row-reverse`）且背景 = primary 变量值；
  3. thinking 占位行含 spinner（`svg[role="status"]`，Spinner 原语无 data-slot）与「正在回复」文案；stopped 行含「已停止回复」；
  4. Composer：`#composer` `border-radius` = 10px；focus 后 `box-shadow` 含 ring 色（focus-within:ring-1）；`#message-input` 输入长文本后 `style.height` 增大且 ≤160px；`#composer-mention` 点击后 `#mention-panel` 可见且选项含「所有人」；
  5. 划选消息出现 `.mark-menu`，`computed(border-radius)` = 8px、背景 = popover 变量值；色板行 5 色；
  6. 带图消息的 `.message-image-grid` 瓦片圆角 = 8px；
  7. 侧栏搜索：输入过滤后 `.chat-item`/列表项数量变化；medium 档（768–1023）图标条内列表项不溢出（`scrollWidth <= clientWidth`）；
  8. aria：`#close-window` 等铬件按钮 `aria-label` 为当前语言对应值（切英文再断言一次）；
  9. 最小化状态截图：`#iframe-host` 内无 `.chat-frame-group-title` 可见元素。
- [ ] **Step 2: 运行**：`node scripts/screenshot-s2-acceptance.mjs` → 全部断言 PASS，`screenshots/s2-*.png` 落盘。
- [ ] **Step 3: legacy 清零审计**（结果写进报告）：

```bash
grep -n "\.messages\b\|\.message-row\|\.message-bubble\|\.message-avatar\|\.message-mentions\|\.message-body\|\.thinking-dots\|\.composer\b\|\.mention-panel\|\.mark-menu\|\.message-image\|\.chat-list\|\.chat-item\|\.reference-draft\|\.message-time-divider\|\.message-system-pill" src/teamPage/ui/styles/legacy.css
```

预期：零命中（`.orchestration-*` 豁免，归 S6）。有命中 → 判明属于哪个任务口径，回补删除后再跑一遍门禁。
- [ ] **Step 4: 全量门禁**：`npm run typecheck` + `npm test`（豁免清单照旧）+ `npm run build`。
- [ ] **Step 5: 提交**：

```bash
git add -A && git commit -m "test(acceptance): s2-* screenshot suite and legacy workspace css audit"
```

---

## 完成定义（DoD）

1. 全部 8 个任务 commit 落在特性分支；每任务 typecheck+触及测试+build 全绿。
2. Task 8 的 s2-* 断言全 PASS；legacy 工作区族 grep 清零。
3. 行为面无回归：Composer.test / Messages.test / MentionPicker.test / ChatList.test / chatListItems.test 全绿，S1 的 55 项 s1-* 验收脚本仍 PASS（防侧栏回归）。
4. 挂账清偿：S1 终审 PARK-S2 全部条目在本计划 Task 1/2/7 内有对应落点（pagehide 冲刷、退出全屏几何、grab 光标、单例重置、chrome 重渲、最小化残影、ChatList 精修+搜索、aria 运行时翻译）。
