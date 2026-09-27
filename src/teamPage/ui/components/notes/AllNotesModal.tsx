import { useEffect, useMemo, useRef, useState } from 'react'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import type { NoteEditorFactory } from '../../lib/noteEditor'
import { collectNoteItems, type NoteListItem } from '../../lib/noteItems'
import { showError } from '../../lib/toast'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { useNoteEditorEngine } from './useNoteEditorEngine'

const TOOLBAR_COMMANDS: Array<{ command: 'bold' | 'italic' | 'strike' | 'bulletList' | 'orderedList'; id: string; label: string; content: React.ReactNode }> = [
  { command: 'bold', id: 'all-note-bold', label: '加粗', content: <b>B</b> },
  { command: 'italic', id: 'all-note-italic', label: '斜体', content: <i>I</i> },
  { command: 'strike', id: 'all-note-strike', label: '删除线', content: <s>S</s> },
  { command: 'bulletList', id: 'all-note-bullet-list', label: '项目列表', content: '•' },
  { command: 'orderedList', id: 'all-note-ordered-list', label: '编号列表', content: '1.' },
]

/*
 * 全部笔记弹窗（原 allNotesView 整体 React 化，P3；W1 起外壳换 Radix
 * Dialog——#all-notes-modal id 移到 DialogContent，Escape/遮罩点击关闭
 * 经 onOpenChange 走 closeAllNotes 先落保存）。内部 id 原样保留
 * （#all-notes-list、#all-notes-active-title/-meta、#all-notes-editor、
 * #all-note-* 工具栏）。与原实现的对译关系：
 * - 开启入口：Rail 的 #open-all-notes 点击 → uiBus 'open-all-notes'
 *   （弹窗组件挂载期订阅；关闭时机由 Radix Escape/遮罩与关闭钮汇入
 *   closeAllNotes）；
 * - renderAllNotes 的收集与目标兜底 → items useMemo（version 驱动）+
 *   selectAvailableTarget effect（活跃目标失活时回退当前群聊/首项）；
 * - 切目标前先落保存（saveNow + 脏标记），与原 closeAllNotes/切目标语义一致；
 * - 编辑器机制复用 useNoteEditorEngine（250ms 防抖 + 脏标记，同原
 *   hasUnsavedChanges：无编辑不落保存）；Radix 关闭卸载编辑器容器，
 *   关闭时 engine.destroy()，重开在新容器重建。
 */
export function AllNotesModal({ createEditor }: { createEditor?: NoteEditorFactory } = {}) {
  const services = useServices()
  const t = useT()
  const version = useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)
  const [activeTargetId, setActiveTargetId] = useState<string | undefined>(undefined)
  const [editorMounted, setEditorMounted] = useState(false)
  const editorElementRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(
    () => (open ? collectNoteItems(getAppState().store) : []),
    [open, version],
  )
  const activeTarget = items.find(item => item.id === activeTargetId)

  const engine = useNoteEditorEngine({
    editorElementRef,
    getTarget: () => {
      if (!open) return undefined
      return activeTarget
        ? { key: activeTarget.id, scope: activeTarget.scope, chatId: activeTarget.chatId, content: activeTarget.content }
        : undefined
    },
    save: (target, content) => {
      services.runCommand('GROUP_NOTE_SAVE', {
        scope: target.scope,
        ...(target.chatId ? { chatId: target.chatId } : {}),
        content,
      }).catch(error => showError(error instanceof Error ? error.message : String(error)))
    },
    showError: message => showError(message),
    createEditor,
    dirtyTracking: true,
  })

  // 原 selectAvailableTarget：活跃目标仍存在则保持，否则回退当前群聊 / 首项
  useEffect(() => {
    if (!open) return
    if (activeTargetId && items.some(item => item.id === activeTargetId)) return
    const currentChatId = getAppState().selectedChatId
    setActiveTargetId((items.find(item => item.chatId === currentChatId) ?? items[0])?.id)
  }, [open, activeTargetId, items])

  // 打开与切目标后同步内容并聚焦（原 registerAllNotesEvents 开钮与
  // renderNoteTargetButton 点击两处 ensureEditor + renderActiveTarget +
  // focusEditorWhenReady；activeTarget 由 activeTargetId 派生，不入依赖）。
  // Radix Presence 挂载内容比 open 晚一拍，activeTargetId 更新可能先于
  // 编辑器容器挂载——以回调 ref 写入的 editorMounted 兜底再触发一次。
  useEffect(() => {
    if (!open || !activeTarget || !editorMounted) return
    engine.syncTarget()
    engine.focusWhenReady()
  }, [open, activeTargetId, editorMounted])

  useEffect(() => {
    services.uiBus.on('open-all-notes', () => setOpen(true))
  }, [services])

  useEffect(() => () => engine.destroy(), [engine])

  // Radix 关闭即卸载 #all-notes-editor；关闭时销毁编辑器实例（解绑已
  // 分离节点），重开时由 ensureEditor 在新容器上重建。Escape/遮罩关闭
  // 也经 onOpenChange → closeAllNotes，先 saveNow 再卸载。
  useEffect(() => {
    if (!open) return
    return () => engine.destroy()
  }, [open, engine])

  function closeAllNotes(): void {
    engine.saveNow()
    setOpen(false)
  }

  function selectTarget(item: NoteListItem): void {
    engine.saveNow()
    setActiveTargetId(item.id)
    engine.focusWhenReady()
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) closeAllNotes() }}>
      <DialogContent
        id="all-notes-modal"
        aria-labelledby="all-notes-title"
        showCloseButton={false}
        className="all-notes-modal max-h-[min(760px,calc(100vh-48px))] w-[min(980px,calc(100vw-48px))] max-w-none sm:max-w-none bg-popover"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
          <div>
            <DialogTitle id="all-notes-title">{t('全部笔记')}</DialogTitle>
            <DialogDescription className="tiny">{t('全局、群聊、已删除群聊')}</DialogDescription>
          </div>
          <Button id="close-all-notes" variant="ghost" size="icon-sm" type="button" aria-label={t('关闭全部笔记')} onClick={closeAllNotes}>×</Button>
        </DialogHeader>
        <div className="all-notes-workspace">
          <div id="all-notes-list" className="all-notes-list" aria-label={t('笔记范围')}>
            {items.length === 0 ? (
              <div className="all-notes-empty">{t('还没有笔记')}</div>
            ) : items.map(item => (
              <button
                key={item.id}
                type="button"
                className={`all-note-target${item.deletedChat ? ' deleted-chat' : ''}${item.id === activeTargetId ? ' active' : ''}`}
                data-note-target-id={item.id}
                aria-pressed={item.id === activeTargetId}
                onClick={() => selectTarget(item)}
              >
                <span className="all-note-target-title">{t(item.title)}</span>
                <span className="all-note-target-meta">{t(item.meta)}</span>
              </button>
            ))}
          </div>
          <section className="all-notes-editor-shell" aria-labelledby="all-notes-active-title">
            <div className="all-notes-editor-header">
              <div>
                <h3 id="all-notes-active-title">{activeTarget ? t(activeTarget.title) : ''}</h3>
                <p id="all-notes-active-meta" className="tiny">{activeTarget ? t(activeTarget.meta) : ''}</p>
              </div>
            </div>
            <div className="note-toolbar all-note-toolbar">
              {TOOLBAR_COMMANDS.map(({ command, id, label, content }) => (
                <Button key={id} id={id} variant="ghost" size="icon-sm" className="note-tool-btn" type="button" aria-label={t(label)} onClick={() => engine.runCommand(command)}>{content}</Button>
              ))}
              <span className="note-toolbar-spacer"></span>
              <Button id="all-note-undo" variant="ghost" size="icon-sm" className="note-tool-btn" type="button" aria-label={t('撤销')} onClick={() => engine.runCommand('undo')}>↶</Button>
              <Button id="all-note-redo" variant="ghost" size="icon-sm" className="note-tool-btn" type="button" aria-label={t('重做')} onClick={() => engine.runCommand('redo')}>↷</Button>
            </div>
            <div
              ref={node => {
                editorElementRef.current = node
                setEditorMounted(node !== null)
              }}
              id="all-notes-editor"
              className="notes-editor all-notes-editor"
              aria-label={t('当前笔记富文本编辑器')}
            ></div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
