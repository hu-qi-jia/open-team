import { useEffect, useMemo, useState } from 'react'
import type { RoleTemplate } from '../../../../group/types'
import { getRoleTemplateById } from '../../../../group/roleTemplates'
import { localizeRoleTemplate, normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import { templateMetaText, templateModelLabel } from '../../lib/peopleLibrary'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

/*
 * 内置人员只读详情弹窗（原 openBuiltinTemplateDetail 的
 * #builtin-template-modal React 化，P4；W1 起外壳换 Radix Dialog——
 * #builtin-template-detail-modal id 移到 DialogContent，Escape/遮罩
 * 点击关闭由 Radix 接管并统一走 close() 清 previewTemplateId）。
 * 开启入口：uiBus 'open-builtin-template-detail'（展示目标经
 * appState.previewTemplateId 传递，由 PeopleLibraryModal 的「详情」
 * 按钮写入）。标题/元信息/提示词由 store 版本驱动派生。
 */
export function BuiltinTemplateDetailModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const version = useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)

  const ui = (source: string) => translateUi(source, language)

  const template = useMemo((): RoleTemplate | undefined => {
    const state = getAppState()
    // 详情入口只对内置人员开放；内置模板不在 roleTemplatesById，需经
    // getRoleTemplateById 先查内置常量
    return state.previewTemplateId ? getRoleTemplateById(state.store, state.previewTemplateId) : undefined
  }, [version])

  useEffect(() => services.uiBus.on('open-builtin-template-detail', () => setOpen(true)), [services])

  function close(): void {
    setOpen(false)
    getAppState().previewTemplateId = undefined
  }

  const displayTemplate = template ? localizeRoleTemplate(template, language) : undefined

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) close() }}>
      <DialogContent
        id="builtin-template-detail-modal"
        aria-labelledby="builtin-template-detail-title"
        aria-describedby="builtin-template-detail-meta"
        showCloseButton={false}
        className="template-detail-modal max-h-[min(760px,calc(100vh-48px))] w-[min(720px,calc(100vw-48px))] max-w-none sm:max-w-none overflow-auto bg-popover"
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
          <div>
            <DialogTitle id="builtin-template-detail-title">{displayTemplate?.name ?? ui('内置人员')}</DialogTitle>
            <DialogDescription id="builtin-template-detail-meta" className="tiny">
              {template
                ? `${templateMetaText(displayTemplate!, language)} · ${ui(`默认模型：${templateModelLabel(template, getAppState().store)}`)}`
                : ui('系统内置人员')}
            </DialogDescription>
          </div>
          <Button id="close-builtin-template-detail" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭内置人员详情')} onClick={close}>×</Button>
        </DialogHeader>
        <pre id="builtin-template-detail-prompt" className="template-prompt-preview">{displayTemplate?.systemPrompt || ui('未填写提示词')}</pre>
      </DialogContent>
    </Dialog>
  )
}
