import { useEffect, useState } from 'react'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, notifyAppState } from '../../lib/appStore'
import { validatePersonDraft, visibleChatSite } from '../../lib/peopleLibrary'
import { modelKeyForSite } from '../../lib/rolePanelItems'
import { showError } from '../../lib/toast'
import { AppModal } from '../common/AppModal'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'

/*
 * 临时添加弹窗（原 openTemporaryPersonDialog / addTemporaryPersonForm
 * React 化，P4；W1 起外壳换 Radix Dialog——#temporary-person-modal id
 * 移到 DialogContent，Escape/遮罩点击关闭由 Radix 接管）。表单 id 逐字
 * 保留。提交校验后草稿写入 appState.temporaryPersonDrafts、默认站点写入
 * addPersonSiteByKey（添加人员弹窗共享这两份状态），随后关闭并聚焦回落。
 * **S4 起外壳改由公共组合壳 `common/AppModal` 承担**（size="sm" /
 * height="auto"）：id / aria-labelledby / 宽度类 / bg-popover / 自绘 × 全部
 * 移交 AppModal，打开聚焦收敛成壳的 initialFocusId="temporary-person-name"
 * （原 onOpenAutoFocus + getElementById 的等价改写）；正文内边距改由
 * bodyClassName="p-6" 补回（壳用 p-0 收掉了原语基类的 p-6）。表单控件换
 * 官方 Input / Textarea 原语。
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
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) setOpen(false) }}
      size="sm"
      height="auto"
      contentId="temporary-person-modal"
      titleId="temporary-person-title"
      title={ui('临时添加')}
      // 说明行 id 交给 Radix 自动生成（不传 descriptionId），避免与表单
      // #temporary-person-description 撞 id
      description={ui('临时人员会先进入待选列表，确认后才加入当前群聊。')}
      closeId="close-temporary-person"
      closeLabel={ui('关闭临时添加')}
      onClose={() => setOpen(false)}
      initialFocusId="temporary-person-name"
      // 正文内边距靠这里补回来：本弹窗自身不带任何 padding，而壳用 p-0
      // 收掉了原语基类的 p-6
      bodyClassName="p-6"
    >
      <form id="add-temporary-person-form" className="modal-form mt-0 grid gap-3" onSubmit={submit}>
        <div className="field grid gap-[7px]">
          <label htmlFor="temporary-person-name">{ui('人员名称')}</label>
          <Input id="temporary-person-name" type="text" autoComplete="off" value={name} onChange={event => setName(event.target.value)} />
        </div>
        <div className="field grid gap-[7px]">
          <label htmlFor="temporary-person-description">{ui('描述')}</label>
          <Textarea id="temporary-person-description" value={description} onChange={event => setDescription(event.target.value)} />
        </div>
        <div className="field grid gap-[7px]">
          <label htmlFor="temporary-person-prompt">{ui('人设')}</label>
          <Textarea id="temporary-person-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} />
        </div>
        <Button size="sm" type="submit">{ui('加入待选列表')}</Button>
      </form>
    </AppModal>
  )
}
