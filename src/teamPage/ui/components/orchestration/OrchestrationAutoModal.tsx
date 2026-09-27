import { useEffect, useRef } from 'react'
import type { OrchestrationAutoPlanHistoryEntry } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useStoreSelector } from '../../hooks/useStoreSelector'

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
 * #orchestration-auto-modal 与内部类名逐字保留。聊天区 = autoPlanHistory
 * （+ 生成中的「用户消息 / 流式助手回复」占位条目）；底部输入 Enter 直接
 * 发送（Shift+Enter 换行、IME 组合中不触发），发送后清空由父级回写。
 * 流式期间消息区贴底滚动（原 messages.scrollTop = scrollHeight）。
 */
export function OrchestrationAutoModal({ open, entries, instruction, busy, generating, inputPlaceholder, onInstructionChange, onSubmit, onClose }: OrchestrationAutoModalProps) {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const messages = messagesRef.current
    if (messages) messages.scrollTop = messages.scrollHeight
  })

  // 打开即聚焦输入框（原 openAutoPanel 的 focus 对译；受控渲染后执行）
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')?.focus())
  }, [open])

  return (
    <div id="orchestration-auto-modal" className="modal-backdrop modal-backdrop-secondary" hidden={!open}>
      <section className="modal orchestration-auto-modal" role="dialog" aria-modal="true" aria-labelledby="orchestration-auto-title">
        <div className="modal-header">
          <div>
            <h2 id="orchestration-auto-title">{ui('自动编排')}</h2>
            <p className="tiny">{ui('根据任务和你的补充描述生成或修改流程。')}</p>
          </div>
          <button id="close-auto-orchestration" className="icon-btn modal-close" type="button" aria-label={ui('关闭自动编排')} onClick={onClose}>×</button>
        </div>
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
                <button className="btn btn-primary orchestration-auto-submit" type="submit" disabled={busy}>
                  {generating ? ui('生成中...') : ui('发送')}
                </button>
              </div>
            </form>
          </section>
        </div>
      </section>
    </div>
  )
}
