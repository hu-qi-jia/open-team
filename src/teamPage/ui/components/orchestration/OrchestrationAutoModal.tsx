import { useEffect, useRef } from 'react'
import type { OrchestrationAutoPlanHistoryEntry } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { AppModal } from '../common/AppModal'
import { Button } from '../ui/button'

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
 * S6/T3 起外壳换 AppModal——与主弹窗同为「仅按钮可关」（closeOn
 * 'button-only'：Escape/背板点击均不关）。首开聚焦输入框走壳的
 * initialFocusId（textarea 新挂 id="orchestration-auto-input"，类名钩子
 * .orchestration-auto-input 保留）；弹窗已开时的再次触发兜底逻辑保留。
 * 布局：壳三行 grid = 头部 / 消息区（内部滚动）/ footer 槽（聊天输入行，
 * 原两行 grid 的第二行 + border-top 分隔由槽自带）。聊天区 =
 * autoPlanHistory（+ 生成中的「用户消息 / 流式助手回复」占位条目）；底部
 * 输入 Enter 直接发送（Shift+Enter 换行、IME 组合中不触发），发送后清空
 * 由父级回写。流式期间消息区贴底滚动（原 messages.scrollTop = scrollHeight）。
 */
export function OrchestrationAutoModal({ open, entries, instruction, busy, generating, inputPlaceholder, onInstructionChange, onSubmit, onClose }: OrchestrationAutoModalProps) {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const messages = messagesRef.current
    if (messages) messages.scrollTop = messages.scrollHeight
  })

  // 打开即聚焦输入框（原 openAutoPanel 的 focus 对译）。首开由壳的
  // initialFocusId（Radix onOpenAutoFocus 路径）承担；弹窗已开时的再次触发
  // 由这里兜底
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => document.getElementById('orchestration-auto-input')?.focus())
  }, [open])

  return (
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) onClose() }}
      onClose={onClose}
      size="xl"
      height="fixed"
      closeOn="button-only"
      initialFocusId="orchestration-auto-input"
      contentId="orchestration-auto-modal"
      titleId="orchestration-auto-title"
      closeId="close-auto-orchestration"
      closeLabel={ui('关闭自动编排')}
      title={ui('自动编排')}
      description={ui('根据任务和你的补充描述生成或修改流程。')}
      bodyClassName="overflow-hidden"
      footer={
        <form
          className="orchestration-auto-composer"
          onSubmit={event => {
            event.preventDefault()
            onSubmit()
          }}
        >
          <div className="orchestration-auto-input-shell grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 rounded-2xl border border-border bg-background/50 p-2.5">
            <textarea
              id="orchestration-auto-input"
              className="orchestration-auto-input min-h-12 max-h-40 resize-y border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
            <Button className="orchestration-auto-submit min-h-[38px] px-[18px] text-[13px]" size="sm" type="submit" disabled={busy}>
              {generating ? ui('生成中...') : ui('发送')}
            </Button>
          </div>
        </form>
      }
    >
      <div id="orchestration-auto-content" className="orchestration-auto-content min-h-0">
        <section className="orchestration-auto-chat grid h-full min-h-0 grid-rows-[minmax(0,1fr)]">
          <div className="orchestration-auto-messages flex min-h-0 flex-col gap-3 overflow-auto py-4 pr-1.5" ref={messagesRef}>
            {entries.length === 0 ? (
              <div className="orchestration-auto-empty mx-auto my-auto max-w-[360px] text-center text-[13px] leading-[1.6] text-muted-foreground">{ui('输入你的编排需求，自动编排会像网页对话一样返回结果。')}</div>
            ) : entries.map(entry => (
              <article key={entry.id} className={`orchestration-auto-message flex w-full ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`orchestration-auto-message-content max-w-[min(680px,78%)] rounded-2xl border px-3 py-2.5 text-[13px] leading-[1.62] whitespace-pre-wrap break-words ${
                    entry.role === 'user'
                      ? 'border-zinc-600/25 bg-accent text-foreground'
                      : 'border-border bg-card text-foreground/90'
                  }`}
                >
                  {entry.content}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </AppModal>
  )
}
