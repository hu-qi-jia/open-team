import { BUILTIN_ORCHESTRATION_TEMPLATES, type BuiltinOrchestrationTemplate, type OrchestrationTemplateCategory } from '../../../../group/orchestrationTemplates'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { templateCapabilityLabel, templateCategoryLabel } from '../../lib/orchestrationDraft'
import { AppModal } from '../common/AppModal'

export interface OrchestrationTemplatePickerModalProps {
  open: boolean
  /** 任一忙碌态（生成 / 保存 / 运行 / 套模板中）时禁用模板卡 */
  disabled: boolean
  onApply(templateId: string): void
  onClose(): void
}

/*
 * 编排模板选择弹窗（原 renderTemplatePicker 对译，P4c）。
 * S6/T2 起外壳换 AppModal——与主弹窗同为「仅按钮可关」（closeOn
 * 'button-only'：Escape/背板点击均不关，× 是唯一出口）。首开聚焦第一张
 * 模板卡改走壳的 initialFocusId（Radix onOpenAutoFocus 路径；卡是 map
 * 出来的，首张卡挂 id="orchestration-template-card-first"）。
 * 模板卡按 structure / scenario 分组，data-template-id 供测试与
 * applyTemplate 定位；.orchestration-template-* 类名是测试/脚本钩子，
 * 逐字保留（视觉已 utilities 化，legacy 规则同 commit 退役）。
 */
export function OrchestrationTemplatePickerModal({ open, disabled, onApply, onClose }: OrchestrationTemplatePickerModalProps) {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)

  return (
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) onClose() }}
      onClose={onClose}
      size="lg"
      height="auto"
      closeOn="button-only"
      initialFocusId="orchestration-template-card-first"
      contentId="orchestration-template-modal"
      titleId="orchestration-template-title"
      closeId="close-orchestration-template"
      closeLabel={ui('关闭模板选择')}
      title={ui('选择编排模板')}
      description={ui('先套用一套结构，再按当前任务微调人员和节点。')}
      bodyClassName="min-h-0"
    >
      {/* 契约 id：OrchestrationModal.test.tsx:244 以 #orchestration-template-content
          定位弹窗正文；壳的 body 行不暴露 id，钩子放 children 顶层。原 legacy 的
          padding-right:2px 随 id 走（pr-0.5）。 */}
      <div id="orchestration-template-content" className="orchestration-template-content pr-0.5 min-h-0">
      <section className="orchestration-template-panel grid gap-2.5">
        <div className="orchestration-template-heading flex items-center justify-between gap-2.5">
          <h3 className="m-0 text-[13px] text-foreground">{ui('从模板开始')}</h3>
          <span className="tiny">{ui('选择后生成草稿，可继续调整。')}</span>
        </div>
        {(['structure', 'scenario'] as const).map(category => (
          <div key={category} className="orchestration-template-group grid grid-cols-[72px_minmax(0,1fr)] items-stretch gap-2.5">
            <span className="orchestration-template-group-title flex items-center text-xs font-extrabold text-muted-foreground">{ui(templateCategoryLabel(category))}</span>
            <div className="orchestration-template-list grid grid-cols-[repeat(auto-fit,minmax(164px,1fr))] gap-2 min-w-0">
              {BUILTIN_ORCHESTRATION_TEMPLATES.filter(item => item.category === (category satisfies OrchestrationTemplateCategory)).map((template, index) => (
                <button
                  key={template.id}
                  type="button"
                  id={index === 0 ? 'orchestration-template-card-first' : undefined}
                  className="orchestration-template-card grid gap-1.5 min-w-0 cursor-pointer rounded-xl border border-border bg-card px-2.5 py-[9px] text-left text-foreground transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-zinc-400/60 hover:bg-accent focus-visible:-translate-y-px focus-visible:border-zinc-400/60 focus-visible:bg-accent disabled:cursor-wait disabled:opacity-[0.62] disabled:hover:translate-y-0 disabled:hover:border-border disabled:hover:bg-card"
                  data-template-id={template.id}
                  disabled={disabled}
                  onClick={() => onApply(template.id)}
                >
                  <span className="orchestration-template-card-top flex items-center justify-between gap-2.5">
                    <strong className="min-w-0 text-xs leading-[1.3] text-foreground">{ui(template.name)}</strong>
                    <span className="orchestration-template-tags shrink-0 text-[10px] font-extrabold text-zinc-400">{template.capabilities.map(capability => ui(templateCapabilityLabel(capability))).join(' · ')}</span>
                  </span>
                  <span className="orchestration-template-summary block min-w-0 truncate text-[11px] text-muted-foreground">{ui(template.summary)}</span>
                  <span className="orchestration-template-structure block min-w-0 truncate text-[10px] font-bold text-zinc-400">{ui(template.structure)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      </div>
    </AppModal>
  )
}

export type { BuiltinOrchestrationTemplate }
