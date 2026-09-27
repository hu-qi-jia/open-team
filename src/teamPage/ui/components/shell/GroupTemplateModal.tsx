import { useEffect, useRef, useState } from 'react'
import {
  GROUP_TEMPLATE_ALL_CATEGORY,
  buildBuiltinGroupTemplateWelcomeMessage,
  filterBuiltinGroupTemplates,
  getBuiltinGroupTemplate,
  getBuiltinGroupTemplateCategories,
  type BuiltinGroupTemplate,
} from '../../../../group/builtinGroupTemplates'
import { localizeCategory, localizeGroupTemplate, normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { SearchX } from 'lucide-react'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { showError } from '../../lib/toast'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

/*
 * 群模板弹窗（teamUiController 群模板段整体 React 化，P4d；标记与
 * team.html 末版快照逐字对译，样式仍在 legacy.css 的 .group-template-*）。
 * W1 起外壳换 Radix Dialog——#group-template-modal id 移到 DialogContent，
 * Escape 经 onOpenChange 走 closeGroupTemplate；原行为「不响应背板点击」
 * 以 onInteractOutside preventDefault 保真（焦点移出同理不关闭）；
 * 首开聚焦搜索框改走 onOpenAutoFocus（Radix 挂载内容晚于 open 翻转，
 * open effect 里 ref 尚为空）。
 * 与原实现对译关系：
 * - 打开入口：快速建群表单「从模板中创建」经 uiBus 'open-group-template-create'
 *   （原 index.tsx 装配处的转发订阅移入本组件）；打开即重置搜索/分类/选中并
 *   聚焦搜索框，不响应背板点击（原行为只有关闭按钮 + Escape）
 * - 确认创建：localize 后发 GROUP_CHAT_CREATE（名称/模式/人员/欢迎语），
 *   先关弹窗再经 uiBus 'close-create-chat-popover' 收回快速建群表单
 * - 选中随过滤失效：切换分类或输入搜索后选中模板不可见即清除（原
 *   syncGroupTemplateSelection），确认按钮文案/禁用随之联动
 * - 摘要超过 72 字符加 has-long-summary（截断展示，title 悬浮全文）
 */
const GROUP_TEMPLATE_INLINE_SUMMARY_LIMIT = 72

export function GroupTemplateModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(GROUP_TEMPLATE_ALL_CATEGORY)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const searchRef = useRef<HTMLInputElement>(null)

  const ui = (source: string) => translateUi(source, language)

  const selectedTemplate = selectedId ? getBuiltinGroupTemplate(selectedId) : undefined
  const templates = filteredGroupTemplates(category, query, language)

  useEffect(() => services.uiBus.on('open-group-template-create', () => {
    setQuery('')
    setCategory(GROUP_TEMPLATE_ALL_CATEGORY)
    setSelectedId(undefined)
    setOpen(true)
  }), [services])

  // 打开瞬间聚焦搜索框（原 openGroupTemplateModal 尾部 searchEl.focus()）
  // 改由下方 onOpenAutoFocus 承担；Escape 走 Radix 默认（onOpenChange →
  // closeGroupTemplate），背板/焦点外移不关闭由 onInteractOutside 保真

  function closeGroupTemplate(): void {
    // 原 closeGroupTemplateModal 同步清空全部状态，下次打开即初始视图
    setOpen(false)
    setQuery('')
    setCategory(GROUP_TEMPLATE_ALL_CATEGORY)
    setSelectedId(undefined)
  }

  function changeQuery(next: string): void {
    setQuery(next)
    pruneSelection(category, next)
  }

  function changeCategory(next: string): void {
    setCategory(next)
    pruneSelection(next, query)
  }

  // 原syncGroupTemplateSelection：过滤后选中的模板不可见即清除选中
  function pruneSelection(nextCategory: string, nextQuery: string): void {
    if (!selectedId) return
    const visible = filteredGroupTemplates(nextCategory, nextQuery, language)
    if (!visible.some(template => template.id === selectedId)) setSelectedId(undefined)
  }

  function clearSearch(): void {
    setQuery('')
    searchRef.current?.focus()
  }

  function showAllTemplates(): void {
    setCategory(GROUP_TEMPLATE_ALL_CATEGORY)
    setQuery('')
    searchRef.current?.focus()
  }

  function confirmCreate(): void {
    if (!selectedTemplate) return
    const localizedTemplate = localizeGroupTemplate(selectedTemplate, language)
    closeGroupTemplate()
    services.uiBus.emit('close-create-chat-popover')
    services.runCommand('GROUP_CHAT_CREATE', {
      name: localizedTemplate.defaultChatName,
      mode: localizedTemplate.defaultMode,
      roles: localizedTemplate.roles,
      welcomeMessage: buildBuiltinGroupTemplateWelcomeMessage(localizedTemplate, language),
    }).catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) closeGroupTemplate() }}>
      <DialogContent
        id="group-template-modal"
        aria-labelledby="group-template-title"
        showCloseButton={false}
        className="group-template-modal w-[min(1500px,calc(100vw-32px))] max-w-none sm:max-w-none bg-popover"
        onInteractOutside={event => event.preventDefault()}
        onOpenAutoFocus={event => {
          event.preventDefault()
          document.getElementById('group-template-search')?.focus()
        }}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
          <div>
            <DialogTitle id="group-template-title">{ui('从模板中创建')}</DialogTitle>
            <DialogDescription className="tiny">{ui('选择一个现成小组，创建后会自动加入模板人员。')}</DialogDescription>
          </div>
          <Button id="close-group-template-modal" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭群聊模板')} onClick={closeGroupTemplate}>×</Button>
        </DialogHeader>
        <div className="group-template-toolbar">
          <label className="group-template-search-field" htmlFor="group-template-search">
            <span>{ui('搜索模板')}</span>
            <input
              id="group-template-search"
              ref={searchRef}
              type="search"
              autoComplete="off"
              placeholder={ui('搜索任务、行业、角色或模板名称，例如：写论文、合同、面试、AI Agent')}
              value={query}
              onChange={event => changeQuery(event.target.value)}
            />
          </label>
          <div id="group-template-categories" className="group-template-categories" aria-label={ui('群聊模板分类')}>
            {getBuiltinGroupTemplateCategories().map(item => (
              <button
                key={item}
                type="button"
                className={`group-template-category-filter${category === item ? ' active' : ''}`}
                aria-pressed={category === item}
                onClick={() => changeCategory(item)}
              >{localizeCategory(item, language) ?? item}</button>
            ))}
          </div>
        </div>
        <div id="group-template-list" className="group-template-list" aria-label={ui('群聊模板')}>
          {templates.length === 0 ? (
            /* 锚类保留：GroupTemplateModal.test 以 .group-template-empty 断言
             * 文案、以 .group-template-empty-actions .btn 点击动作；空态网格
             * 铺满/最小高原由 legacy 规则承担，W3-3 起改 utility 表达 */
            <Empty className="group-template-empty col-span-full min-h-60 p-6 md:p-8">
              <EmptyHeader>
                <EmptyMedia variant="icon"><SearchX className="size-4" /></EmptyMedia>
                <EmptyTitle className="text-sm font-medium">{ui('没有找到匹配的小组')}</EmptyTitle>
                <EmptyDescription className="text-xs">{ui('可以试试换个说法，例如搜索「写论文」「合同」「面试」「投放」「装修」。')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="group-template-empty-actions flex-row justify-center gap-2">
                <Button className="btn" type="button" variant="ghost" size="sm" onClick={clearSearch}>{ui('清空搜索')}</Button>
                <Button className="btn" type="button" variant="ghost" size="sm" onClick={showAllTemplates}>{ui('查看全部模板')}</Button>
              </EmptyContent>
            </Empty>
          ) : templates.map(template => (
            <GroupTemplateOption
              key={template.id}
              template={template}
              language={language}
              ui={ui}
              selected={template.id === selectedId}
              onSelect={() => setSelectedId(template.id)}
            />
          ))}
        </div>
        <div className="group-template-footer">
          <Button id="confirm-group-template-create" type="button" disabled={!selectedTemplate} onClick={confirmCreate}>
            {ui(selectedTemplate?.riskLevel === 'professional' ? '了解限制并创建' : '确认创建')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface GroupTemplateOptionProps {
  template: BuiltinGroupTemplate
  language: ReturnType<typeof normalizeLanguage>
  ui(source: string): string
  selected: boolean
  onSelect(): void
}

function GroupTemplateOption({ template, language, ui, selected, onSelect }: GroupTemplateOptionProps) {
  const displayTemplate = localizeGroupTemplate(template, language)
  const hasLongSummary = displayTemplate.summary.length > GROUP_TEMPLATE_INLINE_SUMMARY_LIMIT
  const risk = template.riskLevel === 'normal'
    ? undefined
    : ui(template.riskLevel === 'professional' ? '专业边界' : '需谨慎')

  return (
    <button
      type="button"
      className={['group-template-option', selected ? 'active' : '', hasLongSummary ? 'has-long-summary' : ''].filter(Boolean).join(' ')}
      data-template-id={template.id}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="group-template-option-top">
        <span className="group-template-heading">
          <span className="group-template-title-row">
            <strong>{displayTemplate.name}</strong>
            {risk && <span className={`group-template-risk group-template-risk-${template.riskLevel}`}>{risk}</span>}
          </span>
          <span className="group-template-role-count">{ui(`${template.roles.length} 个角色`)}</span>
        </span>
        <span className="group-template-category">{displayTemplate.category}</span>
      </span>
      <span className="group-template-summary" title={hasLongSummary ? displayTemplate.summary : undefined}>{displayTemplate.summary}</span>
      <span className="group-template-meta">
        {ui(`适用：${displayTemplate.userTypes.slice(0, 3).join(language === 'en' ? ', ' : '、')}`)}
      </span>
      <span className="group-template-roles">
        {displayTemplate.roles.map(role => <span key={role.name}>{role.name}</span>)}
      </span>
    </button>
  )
}

/*
 * 原 filteredGroupTemplates：先按分类过滤，再叠加搜索——搜索命中取
 * 「模板搜索分 > 0」与「本地化文案包含归一化查询」的并集，保证中文查询
 * 也能命中未本地化字段（与 EN 界面下搜索中文模板名的行为一致）。
 */
function filteredGroupTemplates(category: string, query: string, language: ReturnType<typeof normalizeLanguage>): BuiltinGroupTemplate[] {
  const normalized = query.trim().toLowerCase()
  const byCategory = filterBuiltinGroupTemplates({ category })
  if (!normalized) return byCategory
  const rawMatches = new Set(filterBuiltinGroupTemplates({ category, query }).map(template => template.id))
  return byCategory.filter(template => rawMatches.has(template.id) || localizedGroupSearchText(template, language).includes(normalized))
}

function localizedGroupSearchText(template: BuiltinGroupTemplate, language: ReturnType<typeof normalizeLanguage>): string {
  const displayTemplate = localizeGroupTemplate(template, language)
  return [
    displayTemplate.name,
    displayTemplate.category,
    displayTemplate.summary,
    ...displayTemplate.userTypes,
    ...displayTemplate.aliases,
    ...displayTemplate.roles.flatMap(role => [role.name, role.description, role.systemPrompt]),
  ].join('\n').toLowerCase()
}
