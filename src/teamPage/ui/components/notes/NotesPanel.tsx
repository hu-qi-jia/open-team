import { useEffect, useMemo, useRef, useState } from 'react'
import { useServices } from '../../context/ServicesContext'
import { useFloatingPanelGeometry } from '../../hooks/useFloatingPanelGeometry'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import type { NoteEditorFactory, NoteScope, NoteToolbarCommand } from '../../lib/noteEditor'
import { readNoteContent } from '../../lib/noteItems'
import { showError } from '../../lib/toast'
import { useNoteEditorEngine } from './useNoteEditorEngine'

const FLOATING_PANEL_MARGIN = 12
const MIN_NOTES_PANEL_WIDTH = 320
const MIN_NOTES_PANEL_HEIGHT = 360

const TOOLBAR_COMMANDS: Array<{ command: NoteToolbarCommand; id: string; label: string; content: React.ReactNode }> = [
  { command: 'bold', id: 'note-bold', label: '加粗', content: 'B' },
  { command: 'italic', id: 'note-italic', label: '斜体', content: <em>I</em> },
  { command: 'strike', id: 'note-strike', label: '删除线', content: <s>S</s> },
  { command: 'bulletList', id: 'note-bullet-list', label: '项目列表', content: '•' },
  { command: 'orderedList', id: 'note-ordered-list', label: '编号列表', content: '1.' },
]

/*
 * 笔记面板（原 notesView 整体 React 化，P3）。aside#notes-panel 及内部
 * id（#notes-drag-handle / #close-notes-panel / #chat-note-tab /
 * #global-note-tab / #notes-editor / #note-* / #notes-resize-handle）
 * 全部保留，样式走 legacy.css 同名选择器。与原实现的对译关系：
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
  const panelRef = useRef<HTMLElement | null>(null)
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
    'panel',
    'notes-panel',
    open ? 'open' : '',
    interaction === 'dragging' ? 'dragging' : '',
    interaction === 'resizing' ? 'resizing' : '',
  ].filter(Boolean).join(' ')

  return (
    <aside ref={panelRef} id="notes-panel" className={panelClassName} aria-label={t('笔记面板')}>
      <div ref={dragHandleRef} id="notes-drag-handle" className="panel-header notes-panel-header" title={t('拖动笔记')} onPointerDown={geometry.onDragPointerDown}>
        <div>
          <h2>{t('笔记')}</h2>
          <p className="tiny">{t('手动记录或收集 Mark 内容。')}</p>
        </div>
        <button id="close-notes-panel" className="icon-btn" type="button" aria-label={t('关闭笔记')} onClick={closePanel}>×</button>
      </div>
      <div className="note-scope-tabs" role="tablist" aria-label={t('笔记范围')}>
        <button
          id="chat-note-tab"
          className={`note-scope-tab${view.effectiveScope === 'chat' ? ' active' : ''}`}
          type="button"
          data-note-scope="chat"
          disabled={!view.chat}
          onClick={() => selectScope('chat')}
        >{t('当前群聊')}</button>
        <button
          id="global-note-tab"
          className={`note-scope-tab${view.effectiveScope === 'global' ? ' active' : ''}`}
          type="button"
          data-note-scope="global"
          onClick={() => selectScope('global')}
        >{t('全局笔记')}</button>
      </div>
      <div className="note-toolbar" aria-label={t('富文本工具栏')}>
        {TOOLBAR_COMMANDS.map(({ command, id, label, content }) => (
          <button key={id} id={id} className="note-tool-btn" type="button" aria-label={t(label)} onClick={() => engine.runCommand(command)}>{content}</button>
        ))}
        <span className="note-toolbar-spacer"></span>
        <button id="note-undo" className="note-tool-btn" type="button" aria-label={t('撤销')} onClick={() => engine.runCommand('undo')}>↶</button>
        <button id="note-redo" className="note-tool-btn" type="button" aria-label={t('重做')} onClick={() => engine.runCommand('redo')}>↷</button>
      </div>
      <div ref={editorElementRef} id="notes-editor" className="notes-editor" aria-label={t('富文本笔记编辑器')}></div>
      <button
        ref={resizeHandleRef}
        id="notes-resize-handle"
        className="notes-resize-handle"
        type="button"
        aria-label={t('调整笔记大小')}
        title={t('调整笔记大小')}
        onPointerDown={geometry.onResizePointerDown}
      ></button>
    </aside>
  )
}
