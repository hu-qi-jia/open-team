import { useEffect, useMemo, useState } from 'react'
import type { RoleTemplate } from '../../../../group/types'
import { getRoleTemplateById } from '../../../../group/roleTemplates'
import { localizeRoleTemplate, normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import { templateMetaText, templateModelLabel } from '../../lib/peopleLibrary'
import { AppModal } from '../common/AppModal'

/*
 * 内置人员只读详情弹窗（原 openBuiltinTemplateDetail 的
 * #builtin-template-modal React 化，P4；W1 起外壳换 Radix Dialog——
 * #builtin-template-detail-modal id 移到 DialogContent，Escape/遮罩
 * 点击关闭由 Radix 接管并统一走 close() 清 previewTemplateId。
 * **S4-T4 起外壳改由公共组合壳 `common/AppModal` 承担**（size="lg" /
 * height="auto"）：id / aria-labelledby / 宽度类 / bg-popover / 自绘 ×
 * 全部移交 AppModal，正文内边距改由 bodyClassName="p-6" 补回。
 * 开启入口：uiBus 'open-builtin-template-detail'（展示目标经
 * appState.previewTemplateId 传递，由 PeopleLibraryModal 的「详情」
 * 按钮写入）。标题/元信息/提示词由 store 版本驱动派生。
 * 元信息行改用壳的 descriptionId="builtin-template-detail-meta"：既保住
 * 这个被单测断言的 id，又让 content 的 aria-describedby 指回弹窗内真实
 * 存在的节点（迁移前显式 id 顶掉了 Radix 自动 id，留下悬空引用）。
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
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) close() }}
      // lg = 720px：这个档就是为「提示词预览需要宽度」的内置详情留的
      size="lg"
      height="auto"
      contentId="builtin-template-detail-modal"
      titleId="builtin-template-detail-title"
      title={displayTemplate?.name ?? ui('内置人员')}
      description={template
        ? `${templateMetaText(displayTemplate!, language)} · ${ui(`默认模型：${templateModelLabel(template, getAppState().store)}`)}`
        : ui('系统内置人员')}
      descriptionId="builtin-template-detail-meta"
      closeId="close-builtin-template-detail"
      closeLabel={ui('关闭内置人员详情')}
      onClose={close}
      // 正文内边距靠这里补回来：本弹窗自身不带 padding，而壳用 p-0 收掉了
      // 原语基类的 p-6
      bodyClassName="p-6"
    >
      {/* 原 .template-prompt-preview（退役的 legacy 规则）：max-height /
          overflow / radius / 1px 边框 / padding 14px / 等宽字体 / 12px /
          line-height 1.65 / white-space:pre-wrap / 前景色。
          底色是 bg-background 不是 bg-muted——原值暗色近黑（复合后 ≈ #090d12，
          正落在 --background 上），浅色覆盖值就是 #fff；bg-muted 在暗色是
          提亮块、浅色是灰块，两主题都会跑偏。
          ① border border-border 不能漏：原规则有 1px 边框，浅色覆盖只改了
             border-color 没取消边框；
          ② whitespace-pre-wrap 不能漏：丢了 <pre> 会退回 UA 默认的
             white-space:pre，长提示词从自动换行变成横向溢出（行为回退，
             jsdom 抓不到）；leading-[1.65] 丢了会被 text-xs 的 1.33 改行距；
          ③ text-foreground 对应暗色 #e4e4e7 / 浅色 var(--text)（= --foreground
             的别名），不能漏。
          类名保留作钩子（RolePanel.test.tsx 与 T6 的取样点都在用） */}
      <pre
        id="builtin-template-detail-prompt"
        className="template-prompt-preview max-h-[min(520px,calc(100vh-190px))] overflow-auto rounded-md border border-border bg-background p-3.5 font-mono text-xs leading-[1.65] whitespace-pre-wrap text-foreground"
      >{displayTemplate?.systemPrompt || ui('未填写提示词')}</pre>
    </AppModal>
  )
}
