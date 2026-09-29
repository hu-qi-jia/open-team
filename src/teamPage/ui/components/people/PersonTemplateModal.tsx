import { useEffect, useMemo, useState } from 'react'
import type { GeneratedPersonDraft } from '../../../../group/personaGeneration'
import type { ChatSite, OpenTeamStore, RoleTemplate } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import { externalModels, personaGenerationErrorMessage, validatePersonDraft, visibleChatSite, type TemplateDraft } from '../../lib/peopleLibrary'
import { showError } from '../../lib/toast'
import { AppModal } from '../common/AppModal'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

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
 * React 化，P4；W1 起外壳换 Radix Dialog——#person-template-modal id
 * 移到 DialogContent，Escape/遮罩点击关闭经 onOpenChange 走 close 清
 * selectedTemplateId）。表单 id 逐字保留。
 * **S4 起外壳改由公共组合壳 `common/AppModal` 承担**（size="sm" /
 * height="auto"）：id / aria-labelledby / 宽度类 / bg-popover / 自绘 × 全部
 * 移交 AppModal，打开聚焦收敛成壳的 initialFocusId="template-name"（原
 * onOpenAutoFocus + getElementById 的等价改写）；正文内边距改由
 * bodyClassName="p-6" 补回（壳用 p-0 收掉了原语基类的 p-6）。表单控件换
 * 官方 Input / Textarea 原语，原生 <select> 保持原生、框体视觉由 utilities
 * 承担；站点单选与 AI 人设面板的 legacy 视觉值翻成 utilities（同 commit
 * 退役对应规则）。
 * 对译关系：
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

  // 被编辑模板在打开期间被删除 → 自动关闭
  useEffect(() => {
    if (open && getAppState().selectedTemplateId && !target) setOpen(false)
  }, [open, target])

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
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) close() }}
      size="sm"
      height="auto"
      contentId="person-template-modal"
      titleId="template-form-title"
      title={target ? ui(`编辑人员：${target.name}`) : ui('新建人员')}
      description={ui('维护人员名称、人设和默认站点。')}
      closeId="close-person-template"
      closeLabel={ui('关闭人员编辑')}
      onClose={close}
      initialFocusId="template-name"
      // 正文内边距靠这里补回来：本弹窗自身不带任何 padding（.modal-form 只有
      // grid/gap/margin），而壳用 p-0 收掉了原语基类的 p-6。height="auto" 下
      // 不再加 overflow-auto——那是壳给 content 元素的职责。
      bodyClassName="p-6"
    >
      <form id="people-library-form" className="modal-form mt-3 grid gap-3" onSubmit={event => { void submit(event) }}>
        {/* AI 人设面板（原 .ai-persona-panel）：底色取半透明 muted——本设计系统
            暗色下 card/popover/muted 三者同值，实心 bg-muted 在弹窗里等于没有，
            浅色下又会过重；边框在这条面板上承载主要视觉，不能漏 border-border */}
        <div className="grid gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
          <div className="field grid gap-[7px]">
            <label htmlFor="template-ai-description">{ui('描述想要的人设')}</label>
            <Textarea
              id="template-ai-description"
              placeholder={ui('例如：一个擅长小红书增长的内容顾问')}
              value={aiDescription}
              onChange={event => setAiDescription(event.target.value)}
            />
          </div>
          <div className="template-actions flex items-center justify-between gap-2.5">
            <p id="template-persona-generation-status" className="tiny m-0 min-h-4 text-[12px] text-muted-foreground" aria-live="polite">{generationStatus}</p>
            <Button
              id="generate-template-persona"
              variant="ghost"
              size="sm"
              type="button"
              disabled={generating}
              onClick={() => {
                generatePersona().catch(error => showError(personaGenerationErrorMessage(error)))
              }}
            >{generating ? ui('生成中') : ui('AI 生成')}</Button>
          </div>
        </div>
        <div className="field grid gap-[7px]">
          <label htmlFor="template-name">{ui('人员名称')}</label>
          <Input id="template-name" type="text" maxLength={50} autoComplete="off" value={name} onChange={event => setName(event.target.value)} />
        </div>
        <div className="field grid gap-[7px]">
          <label htmlFor="template-description">{ui('描述')}</label>
          <Textarea id="template-description" value={description} onChange={event => setDescription(event.target.value)} />
        </div>
        <div className="field grid gap-[7px]">
          <label htmlFor="template-prompt">{ui('人设')}</label>
          <Textarea id="template-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} />
        </div>
        <div className="field grid gap-[7px]">
          <label>{ui('默认站点')}</label>
          {/* 站点单选（原 .site-segmented / .site-segment / .site-segment input /
              .site-segment:has(input:checked)）：凹槽底色是 bg-background 不是
              bg-muted——原值暗色复合后近黑、浅色就是 #fff，正落在 --background 上；
              --muted 暗色与 --popover/--card 同值，用 bg-muted 会完全看不见。
              选中态用 has-checked: 变体（= :has(:checked)，label 下唯一的后代 input
              就是那个 radio）+ inset-ring 独立槽位（不用 v3 的 ring-inset，那会跟
              既有 ring-* 用法抢同一套槽位）。SITE_RADIOS 与各 id 一字未动。 */}
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-background p-[3px]">
            {SITE_RADIOS.map(({ site: value, id, label }) => (
              <label
                key={id}
                htmlFor={id}
                className="relative grid place-items-center min-h-[34px] rounded-md text-xs font-[760] text-muted-foreground cursor-pointer has-checked:bg-accent has-checked:text-foreground has-checked:inset-ring-1 has-checked:inset-ring-border"
              >
                <input
                  id={id}
                  type="radio"
                  name="template-chat-site"
                  value={value}
                  checked={site === value}
                  disabled={value === 'external' && externalDisabled}
                  onChange={() => changeSite(value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        {site === 'chatgpt' && (
          <div id="template-chatgpt-gpts-field" className="field grid gap-[7px]">
            <label htmlFor="template-chatgpt-gpts-url">{ui('GPTs 链接前缀')}</label>
            <Input
              id="template-chatgpt-gpts-url"
              type="url"
              autoComplete="off"
              placeholder={ui('https://chatgpt.com/g/...')}
              value={gptsUrl}
              onChange={event => setGptsUrl(event.target.value)}
            />
            <p className="tiny text-[12px] text-muted-foreground/72">{ui('选填。保存后，该人员使用 ChatGPT 时会优先打开这个 GPTs。')}</p>
          </div>
        )}
        {site === 'grok' && (
          <div id="template-grok-project-field" className="field grid gap-[7px]">
            <label htmlFor="template-grok-project-url">{ui('Grok 项目链接')}</label>
            <Input
              id="template-grok-project-url"
              type="url"
              autoComplete="off"
              placeholder={ui('https://grok.com/project/...')}
              value={grokUrl}
              onChange={event => setGrokUrl(event.target.value)}
            />
            <p className="tiny text-[12px] text-muted-foreground/72">{ui('选填。保存后，该人员使用 Grok 时会优先打开这个项目。')}</p>
          </div>
        )}
        {site === 'external' && (
          <div id="template-external-model-field" className="field grid gap-[7px]">
            <label htmlFor="template-external-model-select">{ui('外部模型')}</label>
            {/* 原生 <select> 保持原生（换 Radix Select 会改键盘与取值行为，
                S3 的 RolePanel 已定同例）；框体视觉不用原语，改用与
                ui/input 同一套框体 utilities，legacy 来源见任务报告的记录。 */}
            <select
              id="template-external-model-select"
              value={externalModelId}
              onChange={event => setExternalModelId(event.target.value)}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
            >
              {externalDisabled ? (
                <option value="">{ui('先在设置中添加外部模型')}</option>
              ) : models.map(model => (
                <option key={model.id} value={model.id}>{model.name} · {model.modelName}</option>
              ))}
            </select>
          </div>
        )}
        <div className="template-actions flex items-center justify-between gap-2.5">
          <Button size="sm" type="submit">{ui('保存人员')}</Button>
        </div>
      </form>
    </AppModal>
  )
}
