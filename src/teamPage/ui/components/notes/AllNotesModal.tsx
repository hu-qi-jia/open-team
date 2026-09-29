import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'cn'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import type { NoteEditorFactory } from '../../lib/noteEditor'
import { collectNoteItems, type NoteListItem } from '../../lib/noteItems'
import { showError } from '../../lib/toast'
import { AppModal } from '../common/AppModal'
import { Button } from '../ui/button'
import { Empty, EmptyDescription } from '../ui/empty'
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
 * 经 onOpenChange 走 closeAllNotes 先落保存；S5/T2 起再换公共壳
 * common/AppModal（size=2xl / height=fixed，关闭语义取壳缺省的
 * 「Escape + 背板点击关」），.all-notes-modal 类名与全部 id 原样保留作钩子
 * （#all-notes-list、#all-notes-active-title/-meta、#all-notes-editor、
 * #all-note-* 工具栏）。legacy 的原值逐属性翻成 utilities：宽度 980→1160
 * （用户拍板）、高度内容驱动→恒定 760、两栏工作区的内边距改由正文行
 * （bodyClassName）承担，滚动容器只留左栏列表一个。与原实现的对译关系：
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
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) closeAllNotes() }}
      size="2xl"
      height="fixed"
      title={t('全部笔记')}
      titleId="all-notes-title"
      description={t('全局、群聊、已删除群聊')}
      closeId="close-all-notes"
      closeLabel={t('关闭全部笔记')}
      onClose={closeAllNotes}
      contentId="all-notes-modal"
      // .all-notes-modal 规则由 T4 退役，类名留作 legacy 钩子（既有脚本与
      // 用例按它取元素；宽度/高度/overflow 已全部由壳 utilities 接管）
      contentClassName="all-notes-modal"
      // 两半都承重：p-6 补回壳用 p-0 收掉的原语内边距（本弹窗自身不带
      // padding，jsdom 不算布局、漏了单测抓不到）；overflow-hidden 抵掉
      // height="fixed" 给正文行加的 overflow-auto——整壳唯一的滚动容器必须是
      // 左栏 #all-notes-list，否则两层滚动叠加成双滚动条
      bodyClassName="overflow-hidden p-6"
    >
      {/* 两栏工作区（原 .all-notes-workspace）：h-full + minmax(0,1fr) 撑满
          正文行，左栏自己滚；≤760px 改单栏——左列表退化成横向滚动条带
          （auto 行），编辑器行吸收剩余高度。
          border-t-0 / max-h-none：把两条仍活着的 legacy 属性显式中立——它们
          的来源（.all-notes-workspace 的 border-top、.all-notes-list 的
          max-height）都是「内容驱动 + 620 地板」时期的产物，T4 删规则时必须
          保证渲染不变：border-top 已由壳头部的 border-b 承担（不中立会与它
          叠成两条相距 24px 的线）；max-height 不中立会让左栏在行内短 13px
          （border-r 断头 + 底部留空隙）。 */}
      <div className="all-notes-workspace grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] border-t-0 max-[760px]:grid-cols-1 max-[760px]:grid-rows-[auto_minmax(0,1fr)]">
        <div
          id="all-notes-list"
          className="all-notes-list grid max-h-none min-h-0 content-start gap-2 overflow-auto border-r border-border bg-background p-3.5 max-[760px]:flex max-[760px]:overflow-x-auto max-[760px]:border-r-0"
          aria-label={t('笔记范围')}
        >
          {items.length === 0 ? (
            <Empty className="border border-dashed border-border p-7 md:p-7">
              <EmptyDescription>{t('还没有笔记')}</EmptyDescription>
            </Empty>
          ) : items.map(item => {
            // 工具类一律走 cn()：模板串里紧贴 ${ 的类名会被扫描器静默丢掉
            const isActive = item.id === activeTargetId
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'all-note-target grid w-full cursor-pointer gap-[5px] rounded-md border border-transparent bg-transparent px-3 py-[11px] text-left text-foreground',
                  'max-[760px]:min-w-[160px]',
                  // 选中态压过 hover/focus-visible（legacy 里 .active 规则在
                  // :hover 之后，故选中项悬停不换底、不换边）——两条分支互斥
                  isActive
                    ? 'active'
                    : cn(
                        'hover:bg-accent focus-visible:bg-accent',
                        // legacy 里 .deleted-chat(0,2,0) 排在 :hover(0,2,0) 之后
                        // → 悬停时琥珀边胜、底色照旧走 :hover 的灰。Tailwind 把
                        // hover 变体排在基础工具类之后，所以琥珀边必须补一条
                        // hover/focus-visible 变体，否则会被灰边顶掉。
                        item.deletedChat
                          ? 'hover:border-[rgba(248,184,78,0.22)] focus-visible:border-[rgba(248,184,78,0.22)]'
                          : 'hover:border-muted-foreground/20 focus-visible:border-muted-foreground/20',
                      ),
                  item.deletedChat && 'deleted-chat border-[rgba(248,184,78,0.22)]',
                  isActive && !item.deletedChat && 'border-muted-foreground/32 bg-accent shadow-[inset_3px_0_0_var(--muted-foreground)]',
                  isActive && item.deletedChat && 'bg-[rgba(248,184,78,0.09)] shadow-[inset_3px_0_0_rgba(248,184,78,0.74)]',
                )}
                data-note-target-id={item.id}
                aria-pressed={isActive}
                onClick={() => selectTarget(item)}
              >
                <span className="all-note-target-title truncate text-[13px] font-[820] text-foreground">{t(item.title)}</span>
                <span className="all-note-target-meta text-[11px] font-[720] text-muted-foreground">{t(item.meta)}</span>
              </button>
            )
          })}
        </div>
        <section className="all-notes-editor-shell grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]" aria-labelledby="all-notes-active-title">
          <div className="all-notes-editor-header flex items-center justify-between gap-3 border-b border-border px-[18px] pt-4 pb-3">
            <div>
              <h3 id="all-notes-active-title" className="m-0 text-base text-foreground">{activeTarget ? t(activeTarget.title) : ''}</h3>
              <p id="all-notes-active-meta" className="tiny text-[12px] text-muted-foreground/72">{activeTarget ? t(activeTarget.meta) : ''}</p>
            </div>
          </div>
          {/* S7/T3：legacy .note-toolbar/.all-note-toolbar 已退役——几何
              （gap 5px、padding 8/16/10）与底边在此 utilities 化接管（与
              NotesPanel 同底边值）；bg-background 沿用（原本就压住 legacy 底色） */}
          <div className="note-toolbar all-note-toolbar flex items-center gap-[5px] border-b border-zinc-500/15 bg-background px-4 pt-2 pb-2.5 dark:border-zinc-500/10">
            {TOOLBAR_COMMANDS.map(({ command, id, label, content }) => (
              <Button key={id} id={id} variant="ghost" size="icon-sm" className="note-tool-btn size-7 cursor-pointer rounded-md border border-zinc-500/15 bg-white/5 text-xs font-[820] text-muted-foreground hover:border-zinc-500/30 focus-visible:border-zinc-500/30 dark:border-zinc-500/15 dark:bg-white/5 dark:hover:border-zinc-400/35 dark:focus-visible:border-zinc-400/35" type="button" aria-label={t(label)} onClick={() => engine.runCommand(command)}>{content}</Button>
            ))}
            <span className="note-toolbar-spacer flex-1"></span>
            <Button id="all-note-undo" variant="ghost" size="icon-sm" className="note-tool-btn size-7 cursor-pointer rounded-md border border-zinc-500/15 bg-white/5 font-[820] text-muted-foreground hover:border-zinc-500/30 focus-visible:border-zinc-500/30 dark:border-zinc-500/15 dark:bg-white/5 dark:hover:border-zinc-400/35 dark:focus-visible:border-zinc-400/35" type="button" aria-label={t('撤销')} onClick={() => engine.runCommand('undo')}>↶</Button>
            <Button id="all-note-redo" variant="ghost" size="icon-sm" className="note-tool-btn size-7 cursor-pointer rounded-md border border-zinc-500/15 bg-white/5 font-[820] text-muted-foreground hover:border-zinc-500/30 focus-visible:border-zinc-500/30 dark:border-zinc-500/15 dark:bg-white/5 dark:hover:border-zinc-400/35 dark:focus-visible:border-zinc-400/35" type="button" aria-label={t('重做')} onClick={() => engine.runCommand('redo')}>↷</Button>
          </div>
          <div
            ref={node => {
              editorElementRef.current = node
              setEditorMounted(node !== null)
            }}
            id="all-notes-editor"
            // min-h-0：抵消 .all-notes-editor 的 min-height:360px（该规则 T4
            // 退役，编辑器行改由 minmax(0,1fr) 吸收剩余高度）；S7/T3 起容器
            // 几何/前景全由本行 utilities 承担（原共享族 .notes-editor 退役）
            className="notes-editor all-notes-editor min-h-0 overflow-auto px-5 pt-[18px] pb-7 text-sm leading-[1.65] text-zinc-950 dark:text-[#ecf6f8]"
            aria-label={t('当前笔记富文本编辑器')}
          ></div>
        </section>
      </div>
    </AppModal>
  )
}
