import { useEffect, useRef } from 'react'
import type { OrchestrationAutoPlanHistoryEntry } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

export interface OrchestrationAutoModalProps {
  open: boolean
  entries: OrchestrationAutoPlanHistoryEntry[]
  instruction: string
  /** 输入框与发送键禁用（生成中 / 保存中 / 运行中） */
  busy: boolean
  /** 仅生成中：发送键文案切「生成中...」（原 updateActionButtons 对译） */
  generating: boolean
  /** 输入框占位：画布有节点时提示「继续修改」，空画布提示输入需求 */
  inputPlaceholder: string
  onInstructionChange(instruction: string): void
  onSubmit(): void
  onClose(): void
}

/*
 * 自动编排弹窗（原 orchestrationModalView 的 renderAutoPanel 对译，P4c）。
 * W1 起外壳换 Radix Dialog——#orchestration-auto-modal id 移到
 * DialogContent；与主弹窗同为「仅按钮可关」：Escape/背板点击/焦点外移
 * 三 preventDefault + 无 onOpenChange。首开聚焦输入框改走
 * onOpenAutoFocus（Radix 挂载内容晚于 open 翻转）。聊天区 =
 * autoPlanHistory（+ 生成中的「用户消息 / 流式助手回复」占位条目）；底部
 * 输入 Enter 直接发送（Shift+Enter 换行、IME 组合中不触发），发送后清空
 * 由父级回写。流式期间消息区贴底滚动（原 messages.scrollTop =
 * scrollHeight）。
 */
export function OrchestrationAutoModal({ open, entries, instruction, busy, generating, inputPlaceholder, onInstructionChange, onSubmit, onClose }: OrchestrationAutoModalProps) {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const messages = messagesRef.current
    if (messages) messages.scrollTop = messages.scrollHeight
  })

  // 打开即聚焦输入框（原 openAutoPanel 的 focus 对译）。首开由下方
  // onOpenAutoFocus 承担；弹窗已开时的再次触发由这里兜底
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')?.focus())
  }, [open])

  return (
    <Dialog open={open}>
      <DialogContent
        id="orchestration-auto-modal"
        aria-labelledby="orchestration-auto-title"
        showCloseButton={false}
        className="orchestration-auto-modal w-[min(860px,calc(100vw-42px))] max-w-none sm:max-w-none gap-0 bg-popover"
        onEscapeKeyDown={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
        onOpenAutoFocus={event => {
          event.preventDefault()
          document.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')?.focus()
        }}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
          <div>
            <DialogTitle id="orchestration-auto-title">{ui('自动编排')}</DialogTitle>
            <DialogDescription className="tiny">{ui('根据任务和你的补充描述生成或修改流程。')}</DialogDescription>
          </div>
          <Button id="close-auto-orchestration" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭自动编排')} onClick={onClose}>×</Button>
        </DialogHeader>
        <div id="orchestration-auto-content" className="orchestration-auto-content">
          <section className="orchestration-auto-chat">
            <div className="orchestration-auto-messages" ref={messagesRef}>
              {entries.length === 0 ? (
                <div className="orchestration-auto-empty">{ui('输入你的编排需求，自动编排会像网页对话一样返回结果。')}</div>
              ) : entries.map(entry => (
                <article key={entry.id} className={`orchestration-auto-message ${entry.role}`}>
                  <div className="orchestration-auto-message-content">{entry.content}</div>
                </article>
              ))}
            </div>
            <form
              className="orchestration-auto-composer"
              onSubmit={event => {
                event.preventDefault()
                onSubmit()
              }}
            >
              <div className="orchestration-auto-input-shell">
                <textarea
                  className="orchestration-auto-input"
                  value={instruction}
                  placeholder={inputPlaceholder}
                  disabled={busy}
                  onChange={event => onInstructionChange(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }}
                />
                <Button className="orchestration-auto-submit" size="sm" type="submit" disabled={busy}>
                  {generating ? ui('生成中...') : ui('发送')}
                </Button>
              </div>
            </form>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
