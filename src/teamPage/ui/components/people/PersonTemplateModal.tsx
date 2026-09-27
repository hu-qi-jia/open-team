import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeneratedPersonDraft } from '../../../../group/personaGeneration'
import type { ChatSite, OpenTeamStore, RoleTemplate } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import { externalModels, personaGenerationErrorMessage, validatePersonDraft, visibleChatSite, type TemplateDraft } from '../../lib/peopleLibrary'
import { showError } from '../../lib/toast'

const SITE_RADIOS: Array<{ site: ChatSite | 'external'; id: string; label: string }> = [
  { site: 'gemini', id: 'template-site-gemini', label: 'Gemini' },
  { site: 'chatgpt', id: 'template-site-chatgpt', label: 'ChatGPT' },
  { site: 'claude', id: 'template-site-claude', label: 'Claude' },
  { site: 'deepseek', id: 'template-site-deepseek', label: 'DeepSeek' },
  { site: 'grok', id: 'template-site-grok', label: 'Grok' },
  { site: 'external', id: 'template-site-external', label: '外部模型' },
]

type SiteRadioValue = (typeof SITE_RADIOS)[number]['site']

/*
 * 人员编辑弹窗（原 peopleLibraryView 的 person-template-modal + 表单逻辑
 * React 化，P4）。#person-template-modal 与表单 id 逐字保留。对译关系：
 * - 开启入口：uiBus 'open-person-template-edit'（编辑目标经
 *   appState.selectedTemplateId 传递，新建时为空），打开即按目标初始化
 *   （原 openTemplateEditor → renderTemplateEditor）并聚焦名称框；
 * - 站点单选 → 受控 radio；ChatGPT/Grok/外部模型的条件字段随选中态显隐，
 *   隐藏时字段卸载、输入值随之丢弃（原 syncTemplateModelFields 清空对译）；
 * - AI 生成 → services.sendRuntimeMessage('ROLE_TEMPLATE_PERSONA_GENERATE')，
 *   未知路由错误翻译为重载提示（原 personaGenerationErrorMessage）；
 * - 提交 → 校验 + ROLE_TEMPLATE_CREATE / ROLE_TEMPLATE_UPDATE，成功后关闭；
 * - 被编辑模板在打开期间被删除（如人员库删除确认）→ 自动关闭（原
 *   deleteTemplate 里 closeTemplateEditor 时机的对译）。
 */
export function PersonTemplateModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const version = useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [aiDescription, setAiDescription] = useState('')
  const [generationStatus, setGenerationStatus] = useState('')
  const [generating, setGenerating] = useState(false)
  const [site, setSite] = useState<SiteRadioValue>('deepseek')
  const [gptsUrl, setGptsUrl] = useState('')
  const [grokUrl, setGrokUrl] = useState('')
  const [externalModelId, setExternalModelId] = useState('')
  const prevOpenRef = useRef(false)

  const ui = (source: string) => translateUi(source, language)

  // 打开期间的编辑目标（store 版本驱动；模板被删 → undefined → 自动关闭）
  const target = useMemo((): RoleTemplate | undefined => {
    if (!open) return undefined
    const state = getAppState()
    return state.selectedTemplateId ? state.store.roleTemplatesById[state.selectedTemplateId] : undefined
  }, [open, version])

  const models = useMemo(() => externalModels(getAppState().store), [version])

  function initializeFrom(template: RoleTemplate | undefined, store: OpenTeamStore): void {
    setName(template?.name ?? '')
    setDescription(template?.description ?? '')
    setPrompt(template?.systemPrompt ?? '')
    setAiDescription('')
    setGenerationStatus('')
    setGenerating(false)
    const externalSelected = template?.defaultModelSource === 'external' && Boolean(template?.defaultExternalModelId)
    setSite(externalSelected ? 'external' : visibleChatSite(template?.defaultChatSite ?? store.settings.defaultChatSite))
    setExternalModelId(template?.defaultExternalModelId ?? store.settings.externalModelOrder[0] ?? '')
    setGptsUrl(template?.chatGptGptsUrl ?? '')
    setGrokUrl(template?.grokProjectUrl ?? '')
  }

  /** 站点切换即丢弃离开站点的条件输入（原 syncTemplateModelFields 清空对译） */
  function changeSite(next: SiteRadioValue): void {
    if (site === 'chatgpt' && next !== 'chatgpt') setGptsUrl('')
    if (site === 'grok' && next !== 'grok') setGrokUrl('')
    setSite(next)
  }

  useEffect(() => services.uiBus.on('open-person-template-edit', () => {
    const state = getAppState()
    const template = state.selectedTemplateId ? state.store.roleTemplatesById[state.selectedTemplateId] : undefined
    initializeFrom(template, state.store)
    setOpen(true)
  }), [services])

  // 打开瞬间聚焦名称框（原 templateNameEl.focus()；受控渲染完成后执行）
  useEffect(() => {
    if (open && !prevOpenRef.current) document.getElementById('template-name')?.focus()
    prevOpenRef.current = open
  })

  // 被编辑模板在打开期间被删除 → 自动关闭
  useEffect(() => {
    if (open && getAppState().selectedTemplateId && !target) setOpen(false)
  }, [open, target])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })


  function close(): void {
    setOpen(false)
    // 关闭即清编辑目标（原 closeTemplateEditor）
    getAppState().selectedTemplateId = undefined
    notifyAppState()
  }

  async function generatePersona(): Promise<void> {
    const trimmed = aiDescription.trim()
    if (!trimmed) {
      showError(ui('请先描述想要生成的人设'))
      return
    }
    setGenerating(true)
    setGenerationStatus(ui('生成中...'))
    try {
      const response = await services.sendRuntimeMessage('ROLE_TEMPLATE_PERSONA_GENERATE', { description: trimmed }) as { ok?: boolean; error?: string; persona?: GeneratedPersonDraft }
      if (response.ok === false) throw new Error(response.error || 'AI 生成人设失败')
      if (!response.persona) throw new Error('AI 生成人设返回格式无效')
      setName(response.persona.name)
      setDescription(response.persona.description)
      setPrompt(response.persona.systemPrompt)
      setGenerationStatus(ui('已生成，可继续修改后保存'))
    } catch (error) {
      setGenerationStatus('')
      throw error
    } finally {
      setGenerating(false)
    }
  }

  function readDraft(): TemplateDraft {
    const chatSite = site === 'external' ? undefined : site
    return {
      name: name.trim(),
      description: description.trim(),
      systemPrompt: prompt.trim(),
      defaultModelSource: chatSite ? 'site' : 'external',
      defaultChatSite: chatSite,
      defaultExternalModelId: chatSite ? undefined : externalModelId,
      chatGptGptsUrl: site === 'chatgpt' ? gptsUrl.trim() : undefined,
      grokProjectUrl: site === 'grok' ? grokUrl.trim() : undefined,
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const draft = readDraft()
    const validationError = validatePersonDraft(draft)
    if (validationError) {
      showError(ui(validationError))
      return
    }
    const editingId = getAppState().selectedTemplateId
    try {
      if (editingId) {
        await services.runCommand('ROLE_TEMPLATE_UPDATE', { templateId: editingId, ...draft })
      } else {
        await services.runCommand('ROLE_TEMPLATE_CREATE', { ...draft })
      }
      close()
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  const externalDisabled = models.length === 0

  return (
    <div
      id="person-template-modal"
      className="modal-backdrop"
      hidden={!open}
      onClick={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section className="modal template-editor-modal" role="dialog" aria-modal="true" aria-labelledby="template-form-title">
        <div className="modal-header">
          <div>
            <h2 id="template-form-title">{target ? ui(`编辑人员：${target.name}`) : ui('新建人员')}</h2>
            <p className="tiny">{ui('维护人员名称、人设和默认站点。')}</p>
          </div>
          <button id="close-person-template" className="icon-btn modal-close" type="button" aria-label={ui('关闭人员编辑')} onClick={close}>×</button>
        </div>
        <form id="people-library-form" className="modal-form" onSubmit={event => { void submit(event) }}>
          <div className="ai-persona-panel">
            <div className="field">
              <label htmlFor="template-ai-description">{ui('描述想要的人设')}</label>
              <textarea
                id="template-ai-description"
                placeholder={ui('例如：一个擅长小红书增长的内容顾问')}
                value={aiDescription}
                onChange={event => setAiDescription(event.target.value)}
              />
            </div>
            <div className="template-actions template-ai-actions">
              <p id="template-persona-generation-status" className="tiny" aria-live="polite">{generationStatus}</p>
              <button
                id="generate-template-persona"
                className="btn btn-ghost"
                type="button"
                disabled={generating}
                onClick={() => {
                  generatePersona().catch(error => showError(personaGenerationErrorMessage(error)))
                }}
              >{generating ? ui('生成中') : ui('AI 生成')}</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="template-name">{ui('人员名称')}</label>
            <input id="template-name" type="text" maxLength={50} autoComplete="off" value={name} onChange={event => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="template-description">{ui('描述')}</label>
            <textarea id="template-description" value={description} onChange={event => setDescription(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="template-prompt">{ui('人设')}</label>
            <textarea id="template-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} />
          </div>
          <div className="field">
            <label>{ui('默认站点')}</label>
            <div className="site-segmented">
              {SITE_RADIOS.map(({ site: value, id, label }) => (
                <label key={id} className="site-segment" htmlFor={id}>
                  <input
                    id={id}
                    type="radio"
                    name="template-chat-site"
                    value={value}
                    checked={site === value}
                    disabled={value === 'external' && externalDisabled}
                    onChange={() => changeSite(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          {site === 'chatgpt' && (
            <div id="template-chatgpt-gpts-field" className="field">
              <label htmlFor="template-chatgpt-gpts-url">{ui('GPTs 链接前缀')}</label>
              <input
                id="template-chatgpt-gpts-url"
                type="url"
                autoComplete="off"
                placeholder={ui('https://chatgpt.com/g/...')}
                value={gptsUrl}
                onChange={event => setGptsUrl(event.target.value)}
              />
              <p className="tiny">{ui('选填。保存后，该人员使用 ChatGPT 时会优先打开这个 GPTs。')}</p>
            </div>
          )}
          {site === 'grok' && (
            <div id="template-grok-project-field" className="field">
              <label htmlFor="template-grok-project-url">{ui('Grok 项目链接')}</label>
              <input
                id="template-grok-project-url"
                type="url"
                autoComplete="off"
                placeholder={ui('https://grok.com/project/...')}
                value={grokUrl}
                onChange={event => setGrokUrl(event.target.value)}
              />
              <p className="tiny">{ui('选填。保存后，该人员使用 Grok 时会优先打开这个项目。')}</p>
            </div>
          )}
          {site === 'external' && (
            <div id="template-external-model-field" className="field">
              <label htmlFor="template-external-model-select">{ui('外部模型')}</label>
              <select id="template-external-model-select" value={externalModelId} onChange={event => setExternalModelId(event.target.value)}>
                {externalDisabled ? (
                  <option value="">{ui('先在设置中添加外部模型')}</option>
                ) : models.map(model => (
                  <option key={model.id} value={model.id}>{model.name} · {model.modelName}</option>
                ))}
              </select>
            </div>
          )}
          <div className="template-actions">
            <button className="btn btn-primary" type="submit">{ui('保存人员')}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
