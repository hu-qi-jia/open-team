import { useEffect, useState } from 'react'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, notifyAppState } from '../../lib/appStore'
import { validatePersonDraft, visibleChatSite } from '../../lib/peopleLibrary'
import { modelKeyForSite } from '../../lib/rolePanelItems'
import { showError } from '../../lib/toast'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

/*
 * 临时添加弹窗（原 openTemporaryPersonDialog / addTemporaryPersonForm
 * React 化，P4；W1 起外壳换 Radix Dialog——#temporary-person-modal id
 * 移到 DialogContent，Escape/遮罩点击关闭由 Radix 接管）。表单 id 逐字
 * 保留。提交校验后草稿写入 appState.temporaryPersonDrafts、默认站点写入
 * addPersonSiteByKey（添加人员弹窗共享这两份状态），随后关闭并聚焦回落。
 */
export function TemporaryPersonModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')

  const ui = (source: string) => translateUi(source, language)

  useEffect(() => services.uiBus.on('open-temporary-person', () => {
    setName('')
    setDescription('')
    setPrompt('')
    setOpen(true)
  }), [services])

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const draft = {
      name: name.trim(),
      description: description.trim(),
      systemPrompt: prompt.trim(),
    }
    const validationError = validatePersonDraft(draft)
    if (validationError) {
      showError(ui(validationError))
      return
    }
    const id = `temporary-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const state = getAppState()
    const chatSite = visibleChatSite(state.store.settings.defaultChatSite)
    state.temporaryPersonDrafts.push({ id, ...draft, chatSite })
    state.addPersonSiteByKey.set(`temporary:${id}`, new Set([modelKeyForSite(chatSite)]))
    notifyAppState()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) setOpen(false) }}>
      <DialogContent
        id="temporary-person-modal"
        aria-labelledby="temporary-person-title"
        showCloseButton={false}
        className="template-editor-modal max-h-[min(760px,calc(100vh-48px))] w-[min(520px,calc(100vw-48px))] max-w-none sm:max-w-none overflow-auto bg-popover"
        onOpenAutoFocus={event => {
          // 原打开即聚焦名称框（temporaryPersonNameEl.focus()）；放进
          // Radix 焦点调度内执行，保证不被内容挂载聚焦覆盖
          event.preventDefault()
          document.getElementById('temporary-person-name')?.focus()
        }}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
          <div>
            <DialogTitle id="temporary-person-title">{ui('临时添加')}</DialogTitle>
            {/* 说明行 id 交给 Radix 自动生成，避免与表单 #temporary-person-description 撞 id */}
            <DialogDescription className="tiny">{ui('临时人员会先进入待选列表，确认后才加入当前群聊。')}</DialogDescription>
          </div>
          <Button id="close-temporary-person" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭临时添加')} onClick={() => setOpen(false)}>×</Button>
        </DialogHeader>
        <form id="add-temporary-person-form" className="modal-form mt-0" onSubmit={submit}>
          <div className="field">
            <label htmlFor="temporary-person-name">{ui('人员名称')}</label>
            <input id="temporary-person-name" type="text" autoComplete="off" value={name} onChange={event => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="temporary-person-description">{ui('描述')}</label>
            <textarea id="temporary-person-description" value={description} onChange={event => setDescription(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="temporary-person-prompt">{ui('人设')}</label>
            <textarea id="temporary-person-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit">{ui('加入待选列表')}</button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
