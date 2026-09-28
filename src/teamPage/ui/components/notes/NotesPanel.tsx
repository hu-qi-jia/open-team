import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'cn'
import { useServices } from '../../context/ServicesContext'
import { useAppShellChromeState } from '../../hooks/useAppShellChrome'
import { useFloatingPanelGeometry } from '../../hooks/useFloatingPanelGeometry'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import type { NoteEditorFactory, NoteScope, NoteToolbarCommand } from '../../lib/noteEditor'
import { readNoteContent } from '../../lib/noteItems'
import { showError } from '../../lib/toast'
import { Button } from '../ui/button'
import { Card, CardAction, CardHeader } from '../ui/card'
import { useNoteEditorEngine } from './useNoteEditorEngine'

const FLOATING_PANEL_MARGIN = 12
const MIN_NOTES_PANEL_WIDTH = 320
const MIN_NOTES_PANEL_HEIGHT = 360

/*
 * 范围页签的外观 = ui/tabs.tsx 的 TabsList/TabsTrigger 类名字面量（裁决 6：
 * 不用 Radix Tabs——编辑器不是 TabsContent，Radix 会改变既有键盘/焦点行为）。
 * 与官方文件的差异只有两处：①依赖 Radix 组上下文的变体（group-data-
 * [orientation=*]/tabs、group-data-[variant=*]/tabs-list 以及 line 变体的
 * after: 下划线）在本组件里恒不生效，故不抄；②激活态的 `data-[state=active]:*`
 * 改写为 `active` 分支（默认 variant 的 active 阴影 shadow-sm 一并并入）。
 */
const TAB_TRIGGER_CLASS = "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
const TAB_TRIGGER_ACTIVE_CLASS = 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground'

/*
 * 原 legacy `.notes-resize-handle` 的视觉值逐条翻成 utilities：background
 * zinc-500/12（原 rgba(113,113,122,.12)）、尺寸/光标/圆角由既有类承担；
 * `::before` 角标（10×10，右/下 2px 边，右下 4px 阴影）走 before: 变体，
 * 边框色取浅色 zinc-600/55、深色 zinc-300/62（原浅色规则 + 深色基值）；
 * `border: 0` 由 Tailwind preflight 的全局 `border: 0 solid` 承担。
 */
const RESIZE_HANDLE_CLASS = [
  'notes-resize-handle absolute bottom-2 right-2 size-5 cursor-nwse-resize rounded-md',
  'bg-zinc-500/12 text-muted-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-1 focus-visible:outline-ring',
  "before:absolute before:right-[5px] before:bottom-[5px] before:size-2.5 before:border-r-2 before:border-b-2 before:border-zinc-600/55 dark:before:border-zinc-300/62 before:shadow-[4px_4px_0_-2px_rgba(161,161,170,0.55)] before:content-['']",
].join(' ')

const TOOLBAR_COMMANDS: Array<{ command: NoteToolbarCommand; id: string; label: string; content: React.ReactNode }> = [
  { command: 'bold', id: 'note-bold', label: '加粗', content: 'B' },
  { command: 'italic', id: 'note-italic', label: '斜体', content: <em>I</em> },
  { command: 'strike', id: 'note-strike', label: '删除线', content: <s>S</s> },
  { command: 'bulletList', id: 'note-bullet-list', label: '项目列表', content: '•' },
  { command: 'orderedList', id: 'note-ordered-list', label: '编号列表', content: '1.' },
]

/*
 * 笔记面板（原 notesView 整体 React 化，P3；S3 T3 由 legacy aside 重塑为
 * 浮动 shadcn Card）。#notes-panel 及内部 id（#notes-drag-handle /
 * #close-notes-panel / #chat-note-tab / #global-note-tab / #notes-editor /
 * #note-* / #notes-resize-handle）与 .notes-panel(+open/dragging/resizing)
 * 全部保留作钩子；外观改由 Card/Tabs 类名字面量 + utilities 提供（legacy
 * 的 notes 族规则已退役），定位仍是 #app 外的 fixed 视口贴角。与原实现的对译关系：
 * - renderNotes → 组件每次提交后的同步 effect（编辑器创建 + 内容键变化
 *   时 setContent）+ 类名/禁用态由渲染直接派生；
 * - 开合与范围共用 appState.notesPanelOpen / activeNoteScope（ChatHeader
 *   的 #toggle-notes-panel 与本组件双向经 notifyAppState 回流）；
 * - 拖拽/缩放 → useFloatingPanelGeometry（内联样式直写，类名经 state）；
 * - insertTextIntoActiveNote → 经 services.notesBridge 注册回 index.tsx
 *   的 messageActions（划词「插入笔记」），打开面板后插入并立即保存；
 *   该路径不聚焦编辑器（原行为），头部开关打开才聚焦。
 * 编辑器机制（懒创建 / 250ms 防抖保存 / 目标切换 setContent）在
 * useNoteEditorEngine；TipTap 保持命令式模块。
 */
export function NotesPanel({ createEditor }: { createEditor?: NoteEditorFactory } = {}) {
  const services = useServices()
  const t = useT()
  const version = useStoreSelector(getAppStateVersion)
  const open = useStoreSelector(state => state.notesPanelOpen)
  const activeNoteScope = useStoreSelector(state => state.activeNoteScope)
  const selectedChatId = useStoreSelector(state => state.selectedChatId)

  const [interaction, setInteraction] = useState<'idle' | 'dragging' | 'resizing'>('idle')
  // Card 渲染的是 div（React 19 下 ref 作普通 prop 直达 DOM），故元素型别
  // 取 HTMLDivElement；useFloatingPanelGeometry 收 HTMLElement 超集，兼容。
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragHandleRef = useRef<HTMLDivElement | null>(null)
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null)
  const editorElementRef = useRef<HTMLDivElement | null>(null)
  // 划词插入也会翻开面板，但不抢焦点（原 insertTextIntoActiveNote 不聚焦）
  const suppressNextFocusRef = useRef(false)
  const prevOpenRef = useRef(open)

  const view = useMemo(() => {
    const state = getAppState()
    const chat = state.selectedChatId ? state.store.chatsById[state.selectedChatId] : undefined
    // 原 readAvailableScope：chat 范围仅在群聊存在时生效
    const effectiveScope: NoteScope = activeNoteScope === 'chat' && chat ? 'chat' : 'global'
    const chatId = effectiveScope === 'chat' ? chat?.id : undefined
    return {
      chat,
      effectiveScope,
      chatId,
      targetKey: `${effectiveScope}:${chatId ?? '-'}`,
      content: readNoteContent(state.store, effectiveScope, chatId),
    }
  }, [version, activeNoteScope, selectedChatId])

  const engine = useNoteEditorEngine({
    editorElementRef,
    getTarget: () => ({
      key: view.targetKey,
      scope: view.effectiveScope,
      chatId: view.chatId,
      content: view.content,
    }),
    save: (target, content) => {
      services.runCommand('GROUP_NOTE_SAVE', {
        scope: target.scope,
        ...(target.chatId ? { chatId: target.chatId } : {}),
        content,
      }).catch(error => showError(error instanceof Error ? error.message : String(error)))
    },
    showError: message => showError(message),
    createEditor,
  })

  const geometry = useFloatingPanelGeometry({
    panelRef,
    dragHandleRef,
    resizeHandleRef,
    minWidth: MIN_NOTES_PANEL_WIDTH,
    minHeight: MIN_NOTES_PANEL_HEIGHT,
    margin: FLOATING_PANEL_MARGIN,
    onDraggingChange: dragging => setInteraction(dragging ? 'dragging' : 'idle'),
    onResizingChange: resizing => setInteraction(resizing ? 'resizing' : 'idle'),
  })

  // 原 renderNotes 的编辑器部分：开面板时懒创建，目标变化时 setContent。
  // 不设依赖数组——原实现每次 render() 都跑一遍，这里每次提交后同样幂等执行。
  useEffect(() => {
    if (!open) return
    engine.ensureEditor()?.catch(() => undefined)
    engine.syncTarget()
  })

  // 打开时把面板拉回视口，并跟随窗口尺寸变化（原 clampFloatingPanelPosition）
  useEffect(() => {
    if (!open) return
    geometry.clampPosition()
    window.addEventListener('resize', geometry.clampPosition)
    return () => window.removeEventListener('resize', geometry.clampPosition)
  }, [open, geometry])

  // 头部开关等外部打开 → 聚焦编辑器；划词插入路径不聚焦
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (suppressNextFocusRef.current) suppressNextFocusRef.current = false
      else engine.focusWhenReady()
    }
    prevOpenRef.current = open
  })

  useEffect(() => () => engine.destroy(), [engine])

  // 划词「插入笔记」入口：index.tsx 装配期经桥接闭包转发到 messageActions
  useEffect(() => {
    services.notesBridge.register({
      insertTextIntoActiveNote: text => insertTextIntoActiveNote(text),
    })
  }, [services])

  // 原 `.app-shell.minimized + .notes-panel` 隐藏规则（Task 7 已删）的 React
  // 等价物：浮窗最小化时整面板不渲染，解除「面板必须紧跟壳元素」的相邻兄弟约束。
  const chrome = useAppShellChromeState()
  // 渲染 null 会把 #notes-editor 换成新元素，而引擎 adapter 挂 ref 不随 DOM
  // 重建——须先 saveNow（清防抖、落盘未存内容）再 destroy 旧实例；恢复时
  // 既有的 open 驱动 effect 会对新元素懒重建（legacy 隐藏规则只藏面板，编辑器常驻）。
  useEffect(() => {
    if (!chrome.minimized) return
    engine.saveNow()
    engine.destroy()
  }, [chrome.minimized, engine])
  if (chrome.minimized) return null

  function selectDefaultOpenScope(): void {
    if (view.chat) getAppState().activeNoteScope = 'chat'
  }

  function closePanel(): void {
    getAppState().notesPanelOpen = false
    notifyAppState()
  }

  function selectScope(next: NoteScope): void {
    if (next === 'chat' && !view.chat) return
    getAppState().activeNoteScope = next
    notifyAppState()
  }

  function insertTextIntoActiveNote(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    selectDefaultOpenScope()
    suppressNextFocusRef.current = true
    getAppState().notesPanelOpen = true
    notifyAppState()
    engine.insertTextAndSave(trimmed)
  }

  const panelClassName = [
    'notes-panel',
    // 表面：Card 原语自带 bg-card/border；只覆盖圆角/阴影为规格值（rounded-lg/shadow-md），
    // 并把官方的 flex + gap-6 + py-6 换成 legacy 的 grid 行结构（4 个在流子元素对应 4 行）
    'grid gap-0 rounded-lg py-0 shadow-md',
    // 定位与尺寸：原 legacy .notes-panel 提供；拖拽/缩放后由几何钩子写内联样式覆盖
    'fixed right-6 top-[72px] z-[18] h-[min(620px,calc(100vh-32px))] w-[min(440px,calc(100vw-24px))]',
    'grid-rows-[auto_auto_auto_minmax(0,1fr)] origin-top-right overflow-hidden',
    // 开合：原 legacy .notes-panel / .notes-panel.open（opacity/transform/visibility 三件套）。
    // 过渡属性写 translate/scale 而非 transform：v4 的 translate-*/scale-* 产出的是
    // translate/scale 独立属性（dist 实测），写 transform 动画不到。
    'transition-[opacity,translate,scale] duration-150 ease-out',
    open
      ? 'open visible pointer-events-auto translate-y-0 scale-100 opacity-100'
      : 'invisible pointer-events-none translate-y-2 scale-[.98] opacity-0',
    interaction === 'dragging' ? 'dragging select-none transition-none' : '',
    interaction === 'resizing' ? 'resizing select-none transition-none' : '',
  ].filter(Boolean).join(' ')

  // 原 legacy `.notes-panel-header`（min-height: 74px、cursor: grab）与
  // `.notes-panel.dragging .notes-panel-header`（cursor: grabbing）；内边距取
  // Card 的 px-6 节奏，纵向自管（Card 的 py-6 已被 py-0 覆盖）。
  // `[.border-b]:pb-3` 必须显式写：CardHeader 基类带 `[.border-b]:pb-6`，
  // 同组覆盖靠 cn 的后者胜。
  const dragHandleClassName = [
    'min-h-[74px] gap-1.5 border-b border-border px-6 pb-3 pt-3.5 [.border-b]:pb-3',
    'select-none',
    interaction === 'dragging' ? 'cursor-grabbing' : 'cursor-grab',
  ].join(' ')

  return (
    <Card ref={panelRef} id="notes-panel" role="complementary" aria-label={t('笔记面板')} className={panelClassName}>
      <CardHeader
        ref={dragHandleRef}
        id="notes-drag-handle"
        className={dragHandleClassName}
        title={t('拖动笔记')}
        onPointerDown={geometry.onDragPointerDown}
      >
        <h2 className="truncate text-sm leading-none font-semibold tracking-tight">{t('笔记')}</h2>
        <p className="tiny truncate text-xs text-muted-foreground">{t('手动记录或收集 Mark 内容。')}</p>
        <CardAction>
          <Button
            id="close-notes-panel"
            variant="ghost"
            size="icon-sm"
            className="size-7 text-muted-foreground"
            type="button"
            aria-label={t('关闭笔记')}
            onClick={closePanel}
          >×</Button>
        </CardAction>
      </CardHeader>
      <div className="note-scope-tabs mx-6 mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground" role="tablist" aria-label={t('笔记范围')}>
        <button
          id="chat-note-tab"
          className={cn('note-scope-tab', TAB_TRIGGER_CLASS, view.effectiveScope === 'chat' && ['active', TAB_TRIGGER_ACTIVE_CLASS])}
          type="button"
          data-note-scope="chat"
          disabled={!view.chat}
          onClick={() => selectScope('chat')}
        >{t('当前群聊')}</button>
        <button
          id="global-note-tab"
          className={cn('note-scope-tab', TAB_TRIGGER_CLASS, view.effectiveScope === 'global' && ['active', TAB_TRIGGER_ACTIVE_CLASS])}
          type="button"
          data-note-scope="global"
          onClick={() => selectScope('global')}
        >{t('全局笔记')}</button>
      </div>
      <div className="note-toolbar flex items-center gap-0.5 px-6 py-2" aria-label={t('富文本工具栏')}>
        {TOOLBAR_COMMANDS.map(({ command, id, label, content }) => (
          <Button key={id} id={id} variant="ghost" size="icon-sm" className="note-tool-btn size-7 rounded-md text-xs text-muted-foreground" type="button" aria-label={t(label)} onClick={() => engine.runCommand(command)}>{content}</Button>
        ))}
        <span className="note-toolbar-spacer flex-1"></span>
        <Button id="note-undo" variant="ghost" size="icon-sm" className="note-tool-btn size-7 rounded-md text-muted-foreground" type="button" aria-label={t('撤销')} onClick={() => engine.runCommand('undo')}>↶</Button>
        <Button id="note-redo" variant="ghost" size="icon-sm" className="note-tool-btn size-7 rounded-md text-muted-foreground" type="button" aria-label={t('重做')} onClick={() => engine.runCommand('redo')}>↷</Button>
      </div>
      <div ref={editorElementRef} id="notes-editor" className="notes-editor min-h-0 bg-transparent px-6 pb-2.5 text-sm" aria-label={t('富文本笔记编辑器')}></div>
      <button
        ref={resizeHandleRef}
        id="notes-resize-handle"
        className={RESIZE_HANDLE_CLASS}
        type="button"
        aria-label={t('调整笔记大小')}
        title={t('调整笔记大小')}
        onPointerDown={geometry.onResizePointerDown}
      ></button>
    </Card>
  )
}
