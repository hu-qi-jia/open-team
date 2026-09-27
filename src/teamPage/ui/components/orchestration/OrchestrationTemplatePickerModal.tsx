import { useEffect } from 'react'
import { BUILTIN_ORCHESTRATION_TEMPLATES, type BuiltinOrchestrationTemplate, type OrchestrationTemplateCategory } from '../../../../group/orchestrationTemplates'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { templateCapabilityLabel, templateCategoryLabel } from '../../lib/orchestrationDraft'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

export interface OrchestrationTemplatePickerModalProps {
  open: boolean
  /** 任一忙碌态（生成 / 保存 / 运行 / 套模板中）时禁用模板卡 */
  disabled: boolean
  onApply(templateId: string): void
  onClose(): void
}

/*
 * 编排模板选择弹窗（原 renderTemplatePicker 对译，P4c）。
 * W1 起外壳换 Radix Dialog——#orchestration-template-modal id 移到
 * DialogContent；与主弹窗同为「仅按钮可关」：Escape/背板点击/焦点外移
 * 三 preventDefault + 无 onOpenChange。首开聚焦第一张模板卡改走
 * onOpenAutoFocus（Radix 挂载内容晚于 open 翻转）。
 * 模板卡按 structure / scenario 分组，data-template-id 供测试与
 * applyTemplate 定位。
 */
export function OrchestrationTemplatePickerModal({ open, disabled, onApply, onClose }: OrchestrationTemplatePickerModalProps) {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => document.querySelector<HTMLButtonElement>('.orchestration-template-card')?.focus())
  }, [open])

  return (
    <Dialog open={open}>
      <DialogContent
        id="orchestration-template-modal"
        aria-labelledby="orchestration-template-title"
        showCloseButton={false}
        className="orchestration-template-modal w-[min(760px,calc(100vw-42px))] max-w-none sm:max-w-none gap-3.5 bg-popover"
        onEscapeKeyDown={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
        onOpenAutoFocus={event => {
          event.preventDefault()
          document.querySelector<HTMLButtonElement>('.orchestration-template-card')?.focus()
        }}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
          <div>
            <DialogTitle id="orchestration-template-title">{ui('选择编排模板')}</DialogTitle>
            <DialogDescription className="tiny">{ui('先套用一套结构，再按当前任务微调人员和节点。')}</DialogDescription>
          </div>
          <Button id="close-orchestration-template" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭模板选择')} onClick={onClose}>×</Button>
        </DialogHeader>
        <div id="orchestration-template-content" className="orchestration-template-content">
          <section className="orchestration-template-panel">
            <div className="orchestration-template-heading">
              <h3>{ui('从模板开始')}</h3>
              <span className="tiny">{ui('选择后生成草稿，可继续调整。')}</span>
            </div>
            {(['structure', 'scenario'] as const).map(category => (
              <div key={category} className="orchestration-template-group">
                <span className="orchestration-template-group-title">{ui(templateCategoryLabel(category))}</span>
                <div className="orchestration-template-list">
                  {BUILTIN_ORCHESTRATION_TEMPLATES.filter(item => item.category === (category satisfies OrchestrationTemplateCategory)).map(template => (
                    <button
                      key={template.id}
                      type="button"
                      className="orchestration-template-card"
                      data-template-id={template.id}
                      disabled={disabled}
                      onClick={() => onApply(template.id)}
                    >
                      <span className="orchestration-template-card-top">
                        <strong>{ui(template.name)}</strong>
                        <span className="orchestration-template-tags">{template.capabilities.map(capability => ui(templateCapabilityLabel(capability))).join(' · ')}</span>
                      </span>
                      <span className="orchestration-template-summary">{ui(template.summary)}</span>
                      <span className="orchestration-template-structure">{ui(template.structure)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export type { BuiltinOrchestrationTemplate }
