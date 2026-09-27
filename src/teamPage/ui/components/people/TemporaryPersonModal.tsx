import { useEffect, useRef, useState } from 'react'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, notifyAppState } from '../../lib/appStore'
import { validatePersonDraft, visibleChatSite } from '../../lib/peopleLibrary'
import { modelKeyForSite } from '../../lib/rolePanelItems'
import { showError } from '../../lib/toast'

/*
 * 临时添加弹窗（原 openTemporaryPersonDialog / addTemporaryPersonForm
 * React 化，P4）。#temporary-person-modal 与表单 id 逐字保留。提交校验后
 * 草稿写入 appState.temporaryPersonDrafts、默认站点写入
 * addPersonSiteByKey（添加人员弹窗共享这两份状态），随后关闭并聚焦回落。
 */
export function TemporaryPersonModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const prevOpenRef = useRef(false)

  const ui = (source: string) => translateUi(source, language)

  useEffect(() => services.uiBus.on('open-temporary-person', () => {
    setName('')
    setDescription('')
    setPrompt('')
    setOpen(true)
  }), [services])

  // 打开瞬间聚焦名称框（原 temporaryPersonNameEl.focus()）
  useEffect(() => {
    if (open && !prevOpenRef.current) document.getElementById('temporary-person-name')?.focus()
    prevOpenRef.current = open
  })

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

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
    <div
      id="temporary-person-modal"
      className="modal-backdrop"
      hidden={!open}
      onClick={event => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <section className="modal template-editor-modal" role="dialog" aria-modal="true" aria-labelledby="temporary-person-title">
        <div className="modal-header">
          <div>
            <h2 id="temporary-person-title">{ui('临时添加')}</h2>
            <p className="tiny">{ui('临时人员会先进入待选列表，确认后才加入当前群聊。')}</p>
          </div>
          <button id="close-temporary-person" className="icon-btn modal-close" type="button" aria-label={ui('关闭临时添加')} onClick={() => setOpen(false)}>×</button>
        </div>
        <form id="add-temporary-person-form" className="modal-form" onSubmit={submit}>
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
      </section>
    </div>
  )
}
