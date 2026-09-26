import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RoomMode } from '../../../../group/types'
import { useServices } from '../../context/ServicesContext'
import { useT } from '../../hooks/useT'
import { showError } from '../../lib/toast'

interface QuickCreateChatContextValue {
  open: boolean
  openPopover(): void
  closePopover(): void
}

const QuickCreateChatContext = createContext<QuickCreateChatContextValue | undefined>(undefined)

function useQuickCreateChat(): QuickCreateChatContextValue {
  const value = useContext(QuickCreateChatContext)
  if (!value) throw new Error('QuickCreateChat 系列组件必须位于 <QuickCreateChatProvider> 内')
  return value
}

/*
 * 快速建群（原 #quick-create-chat + #create-chat-form 整体 React 化）。
 * 触发钮在 sidebar panel-header 内、表单在其后（原 DOM 结构保持——表单展开时
 * 原地把 #chat-list 往下推，不用浮层）。因此拆成复合组件经 context 共享状态。
 *
 * 已知偏差（后续用户重设计时再换 Popover）：原交互就是原位展开，非浮层。
 * 「从模板中创建」经 uiBus 发给 vanilla 侧 teamUiController.openGroupTemplate；
 * 模板确认后 vanilla 经 'close-create-chat-popover' 命令收回本表单。
 */
export function QuickCreateChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { uiBus } = useServices()

  useEffect(() => uiBus.on('close-create-chat-popover', () => setOpen(false)), [uiBus])

  return (
    <QuickCreateChatContext.Provider
      value={{
        open,
        openPopover: () => setOpen(true),
        closePopover: () => setOpen(false),
      }}
    >
      {children}
    </QuickCreateChatContext.Provider>
  )
}

export function QuickCreateChatTrigger() {
  const t = useT()
  const { open, openPopover } = useQuickCreateChat()
  return (
    <button
      id="quick-create-chat"
      className="icon-btn"
      type="button"
      aria-label={t('新建群聊')}
      aria-controls="chat-create-popover"
      aria-expanded={open}
      onClick={openPopover}
    >＋</button>
  )
}

export function QuickCreateChatForm() {
  const t = useT()
  // 不在渲染期解构服务方法：hooks 先于 if (!open) 执行，表单关闭时也会渲染到这里，
  // services 字段保持事件期访问（见 ServicesContext 的约定说明）。
  const services = useServices()
  const { open, closePopover } = useQuickCreateChat()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<RoomMode>('collaborative')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) nameInputRef.current?.focus()
  }, [open])

  if (!open) return null

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const trimmed = name.trim()
    services.runCommand('GROUP_CHAT_CREATE', { name: trimmed || t('新群聊'), mode, roles: [] })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
    setName('')
    closePopover()
  }

  function cancel(): void {
    setName('')
    closePopover()
  }

  return (
    <form id="create-chat-form" className="chat-create" onSubmit={submit}>
      <div id="chat-create-popover">
        <h3>{t('新建群聊')}</h3>
      </div>
      <div className="field">
        <label htmlFor="new-chat-name">{t('群聊名称')}</label>
        <input
          id="new-chat-name"
          ref={nameInputRef}
          type="text"
          placeholder={t('例如：产品方案讨论')}
          autoComplete="off"
          value={name}
          onChange={event => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label>{t('群聊模式')}</label>
        <div className="mode-options">
          <label className="mode-option" htmlFor="new-chat-mode-collaborative">
            <input
              id="new-chat-mode-collaborative"
              type="radio"
              name="new-chat-mode"
              value="collaborative"
              checked={mode === 'collaborative'}
              onChange={() => setMode('collaborative')}
            />
            <span>
              <span className="mode-name">{t('协作群聊')}</span>
              <span className="mode-help">{t('人员参考群聊上下文，适合接力讨论。')}</span>
            </span>
          </label>
          <label className="mode-option" htmlFor="new-chat-mode-independent">
            <input
              id="new-chat-mode-independent"
              type="radio"
              name="new-chat-mode"
              value="independent"
              checked={mode === 'independent'}
              onChange={() => setMode('independent')}
            />
            <span>
              <span className="mode-name">{t('独立专家')}</span>
              <span className="mode-help">{t('人员独立回答，适合并行评审。')}</span>
            </span>
          </label>
        </div>
      </div>
      <div className="two-col">
        <button id="cancel-create-chat" className="btn" type="button" onClick={cancel}>{t('取消')}</button>
        <button className="btn btn-primary" type="submit">{t('创建')}</button>
      </div>
      <div className="chat-create-template-row">
        <TemplateCreateButton />
      </div>
    </form>
  )
}

function TemplateCreateButton() {
  const t = useT()
  const { uiBus } = useServices()
  return (
    <button
      id="open-group-template-create"
      className="btn btn-ghost chat-create-template-btn"
      type="button"
      onClick={() => uiBus.emit('open-group-template-create')}
    >{t('从模板中创建')}</button>
  )
}
