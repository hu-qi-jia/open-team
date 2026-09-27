import { useEffect, useMemo, useState } from 'react'
import type { RoleTemplate } from '../../../../group/types'
import { getRoleTemplateById } from '../../../../group/roleTemplates'
import { localizeRoleTemplate, normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import { templateMetaText, templateModelLabel } from '../../lib/peopleLibrary'

/*
 * 内置人员只读详情弹窗（原 openBuiltinTemplateDetail 的
 * #builtin-template-modal React 化，P4）。开启入口：uiBus
 * 'open-builtin-template-detail'（展示目标经 appState.previewTemplateId
 * 传递，由 PeopleLibraryModal 的「详情」按钮写入）。标题/元信息/提示词
 * 由 store 版本驱动派生。
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
    getAppState().previewTemplateId = undefined
  }

  const displayTemplate = template ? localizeRoleTemplate(template, language) : undefined

  return (
    <div
      id="builtin-template-detail-modal"
      className="modal-backdrop"
      hidden={!open}
      onClick={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section className="modal template-detail-modal" role="dialog" aria-modal="true" aria-labelledby="builtin-template-detail-title">
        <div className="modal-header">
          <div>
            <h2 id="builtin-template-detail-title">{displayTemplate?.name ?? ui('内置人员')}</h2>
            <p id="builtin-template-detail-meta" className="tiny">
              {template
                ? `${templateMetaText(displayTemplate!, language)} · ${ui(`默认模型：${templateModelLabel(template, getAppState().store)}`)}`
                : ui('系统内置人员')}
            </p>
          </div>
          <button id="close-builtin-template-detail" className="icon-btn modal-close" type="button" aria-label={ui('关闭内置人员详情')} onClick={close}>×</button>
        </div>
        <pre id="builtin-template-detail-prompt" className="template-prompt-preview">{displayTemplate?.systemPrompt || ui('未填写提示词')}</pre>
      </section>
    </div>
  )
}
