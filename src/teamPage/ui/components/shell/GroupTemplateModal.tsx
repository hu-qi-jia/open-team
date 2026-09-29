import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
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
import { AppModal } from '../common/AppModal'
import { Button } from '../ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

/*
 * 群模板弹窗（teamUiController 群模板段整体 React 化，P4d；标记与
 * team.html 末版快照逐字对译）。S5/T3 起外壳换公共壳 common/AppModal：
 * size=full（宽度 1500 不变、沟槽 32→48）、height=fixed（定高 760，取代
 * legacy 的近满视口 820–926）、footer 槽放确认创建钮、closeOn=escape-only
 * （取代本地 onInteractOutside preventDefault，逐字等价）、initialFocusId
 * 取代本地 onOpenAutoFocus 的裸 .focus()（壳的版本带 preventScroll:true）。
 * legacy 的 .group-template-* 原值逐属性翻成 utilities 写在本文件；类名与 id
 * 原样保留作钩子（测试与 p4d/w1c5/w3-3 探针在用），规则留待 T4 整族退役。
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
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) closeGroupTemplate() }}
      size="full"
      height="fixed"
      title={ui('从模板中创建')}
      titleId="group-template-title"
      description={ui('选择一个现成小组，创建后会自动加入模板人员。')}
      closeId="close-group-template-modal"
      closeLabel={ui('关闭群聊模板')}
      onClose={closeGroupTemplate}
      initialFocusId="group-template-search"
      contentId="group-template-modal"
      // .group-template-modal 规则由 T4 退役，类名留作 legacy 钩子；min-h-0
      // 必须显式写上——legacy 的 min-height:min(820px,100vh-24) 不在壳的覆盖
      // 清单里（层序只对「写了的属性」生效），不中立就会压过 760 的定高
      contentClassName="group-template-modal min-h-0"
      closeOn="escape-only"
      // 正文行四件都在抵消壳：grid-rows 两行容纳「工具行 + 列表」（minmax(0,1fr)
      // 底行必须能收缩，1fr 的最小尺寸是 auto 会撑破）；gap-4 是补回原语
      // ui/dialog.tsx 的 gap-4——旧路径下 4 个子元素间各有 16px，壳用 gap-0 收掉后
      // 「工具行 ↔ 列表」的间距凭空归零（复审实测：分类条底边 → 列表顶边 0px，
      // legacy 同口径是 16px；这是既有渲染值，不是偏好）；overflow-hidden 抵掉
      // height="fixed" 给正文行加的 overflow-auto——整壳唯一的滚动容器是
      // #group-template-list；px-6 则是补回壳 p-0 收掉的原语内边距（头/脚各自
      // px-6 py-4 补过，这两块归壳的既有约定，本任务不动；jsdom 不算布局，
      // 靠真浏览器探针与 T5 的 s5-1b 量）
      bodyClassName="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-6 py-4"
      footerClassName="group-template-footer flex justify-end"
      footer={(
        <Button id="confirm-group-template-create" type="button" disabled={!selectedTemplate} onClick={confirmCreate}>
          {ui(selectedTemplate?.riskLevel === 'professional' ? '了解限制并创建' : '确认创建')}
        </Button>
      )}
    >
      <div className="group-template-toolbar grid min-w-0 gap-2.5">
        <label className="group-template-search-field grid gap-1.5" htmlFor="group-template-search">
          <span className="text-[11px] font-[760] text-muted-foreground">{ui('搜索模板')}</span>
          <input
            id="group-template-search"
            ref={searchRef}
            type="search"
            autoComplete="off"
            className="h-[38px]"
            placeholder={ui('搜索任务、行业、角色或模板名称，例如：写论文、合同、面试、AI Agent')}
            value={query}
            onChange={event => changeQuery(event.target.value)}
          />
        </label>
        <div id="group-template-categories" className="group-template-categories flex flex-wrap gap-2 overflow-visible px-0.5 pb-0.5" aria-label={ui('群聊模板分类')}>
          {getBuiltinGroupTemplateCategories().map(item => (
            <button
              key={item}
              type="button"
              // 工具类一律走 cn()：模板串里紧贴 ${ 的类名会被 Tailwind 扫描器静默丢掉（:151 的旧写法）
              className={cn(
                'group-template-category-filter shrink-0 cursor-pointer rounded-full border border-border bg-popover px-2.5 py-1.5 text-xs font-[780] text-muted-foreground',
                // hover / focus-visible / 选中三态是 legacy 1359–1361 同一批声明，
                // 必须逐字同值：Tailwind 把 hover 变体排在基础工具类之后，值一旦
                // 不同，悬停选中项就会看到 hover 的值（T2 的事故形态）
                'hover:border-muted-foreground/46 hover:bg-accent hover:text-foreground',
                'focus-visible:border-muted-foreground/46 focus-visible:bg-accent focus-visible:text-foreground',
                'aria-pressed:border-muted-foreground/46 aria-pressed:bg-accent aria-pressed:text-foreground',
                // legacy 在 hover/focus-visible/.active 三态都写了 outline:none；
                // 提升到基础态等价（Chrome 只在 :focus-visible 画 UA 焦点环，已被覆盖）
                'outline-none',
                // 显式中立 legacy 2348–2356 里那条「浅色专属 .active 内阴影」
                // （inset 0 0 0 1px rgba(113,113,122,.14)，同规则还挂在 .theme-option/
                // .mode-option 上）：B 组本身没有这个属性，留着就是浅色下 active 比
                // hover 多一层装饰，既违反「三态同批值」，又会在 T4 摘掉 2351 行那天
                // 无声消失。基态 shadow-none 让两主题内三态一致
                'shadow-none',
                category === item && 'active',
              )}
              aria-pressed={category === item}
              onClick={() => changeCategory(item)}
            >{localizeCategory(item, language) ?? item}</button>
          ))}
        </div>
      </div>
      <div
        id="group-template-list"
        // max-h-none：legacy 的 max-height:min(720px,100vh-240) 该丢（定高由壳给，
        // 再压 720 会与「列表内部可滚」打架）——显式中立，T4 删规则时不变
        className="group-template-list grid max-h-none min-h-0 grid-cols-[repeat(auto-fit,minmax(520px,1fr))] content-start gap-4 overflow-auto pr-0.5"
        aria-label={ui('群聊模板')}
      >
        {templates.length === 0 ? (
          /* 钩子类保留：GroupTemplateModal.test 以 .group-template-empty 断言文案、
           * 以 .group-template-empty-actions button 点击动作；空态视觉全部是本行的
           * utilities（Empty 原语 + col-span-full/min-h-60/p-6 md:p-8），legacy.css
           * 里这两族本来一条规则都没有 */
          <Empty className="group-template-empty col-span-full min-h-60 p-6 md:p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SearchX className="size-4" /></EmptyMedia>
              <EmptyTitle className="text-sm font-medium">{ui('没有找到匹配的小组')}</EmptyTitle>
              <EmptyDescription className="text-xs">{ui('可以试试换个说法，例如搜索「写论文」「合同」「面试」「投放」「装修」。')}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="group-template-empty-actions flex-row justify-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={clearSearch}>{ui('清空搜索')}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={showAllTemplates}>{ui('查看全部模板')}</Button>
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
    </AppModal>
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
      className={cn(
        // 这里只接管了 legacy 的 background-color（rgba(24,24,27,.52) → bg-card）；
        // legacy 的 background-image（linear-gradient(145deg, rgba(161,161,170,.08),
        // transparent 46%)，legacy.css:1388-1390）**至今仍在生效**——bg-card 是
        // background-color，压不住 background-image。实测（复审 2026-09-29）：
        // 暗色下 option.background-image 仍带这层渐变，只有把 legacy 规则整条摘掉
        // 它才消失。即它将在 **T4 删规则那天**才消失 → 记入「T4 时点的可见变化」
        'group-template-option relative grid min-h-[190px] cursor-pointer content-start gap-[11px] rounded-md border border-border bg-card p-4 text-left text-foreground',
        // 三态同值 + --glow remap（globals.css:177/207 两主题同值 0 0 0 1px var(--border)）
        // → ring-1 ring-border；理由同上面的分类片
        'hover:border-muted-foreground/52 hover:bg-accent hover:ring-1 hover:ring-border',
        'focus-visible:border-muted-foreground/52 focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-border',
        'aria-pressed:border-muted-foreground/52 aria-pressed:bg-accent aria-pressed:ring-1 aria-pressed:ring-border',
        'outline-none',
        selected ? 'active' : '',
        hasLongSummary ? 'has-long-summary' : '',
      )}
      data-template-id={template.id}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="group-template-option-top flex items-start justify-between gap-2.5">
        <span className="group-template-heading grid min-w-0 gap-[5px]">
          <span className="group-template-title-row flex min-w-0 items-center gap-2">
            <strong className="line-clamp-2 min-w-0 text-sm font-[820] leading-[1.25]">{displayTemplate.name}</strong>
            {risk && (
              // 风险色在 globals.css 无对应 token（--warning 是 legacy 的填充色
              // remap，当文字色在浅色下对比度只有 ~1.7:1），故按 legacy 的亮/暗
              // 两套原值各写一遍：亮色为 base、暗色走 dark: 变体（唯一一处例外）
              <span className={cn(
                `group-template-risk group-template-risk-${template.riskLevel}`,
                'shrink-0 rounded-full border px-[7px] py-0.5',
                template.riskLevel === 'professional'
                  ? 'border-[rgba(190,48,76,0.24)] bg-[#fff2f4] text-[#a32644] dark:border-[rgba(246,96,122,0.34)] dark:bg-[rgba(246,96,122,0.1)] dark:text-[#ff9fb2]'
                  : 'border-[rgba(194,129,32,0.26)] bg-[#fff8ec] text-[#8a5a0a] dark:border-[rgba(240,162,58,0.28)] dark:bg-[rgba(240,162,58,0.08)] dark:text-[#ffd18a]',
              )}>{risk}</span>
            )}
          </span>
          <span className="group-template-role-count text-[11px] font-[760] leading-[1.2] text-muted-foreground">{ui(`${template.roles.length} 个角色`)}</span>
        </span>
        <span className="group-template-category shrink-0 rounded-full border border-muted-foreground/24 px-[7px] py-0.5 text-[11px] font-[760] text-foreground/85">{displayTemplate.category}</span>
      </span>
      <span className="group-template-summary line-clamp-2 text-xs leading-[1.6] text-muted-foreground" title={hasLongSummary ? displayTemplate.summary : undefined}>{displayTemplate.summary}</span>
      <span className="group-template-meta text-[11px] leading-normal text-muted-foreground">
        {ui(`适用：${displayTemplate.userTypes.slice(0, 3).join(language === 'en' ? ', ' : '、')}`)}
      </span>
      <span className="group-template-roles flex flex-wrap content-start gap-2 pb-0.5">
        {displayTemplate.roles.map(role => (
          <span key={role.name} className="rounded-full border border-border bg-muted-foreground/10 px-[7px] py-[3px] text-[11px] leading-[1.2] text-foreground/85">{role.name}</span>
        ))}
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
