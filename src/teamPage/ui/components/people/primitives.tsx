import { Users } from 'lucide-react'
import { localizeCategory, translateUi, type TeamLanguage } from '../../../../shared/i18n'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

/*
 * 人员库弹窗群的共享小件（原 renderCategoryFilter / emptyCard /
 * template-type-tabs 内联结构对译）。id 由各弹窗传入以保持原样。
 * W3-3 起空态换 Empty 原语（居中图标 + 标题 + 描述，无描边盒子）。
 * S4-T2 起 .template-type-tabs/-tab(+.active) 与 .template-category-filter/
 * -chip(+:hover/:focus-visible/.active) 的视觉值由 legacy 翻成 utilities，
 * 同 commit 退役了这 8 条规则；两个使用者（PeopleLibraryModal /
 * AddPersonModal）范围都在本阶段内，类名与 data-* 钩子逐字保留。
 */

export function EmptyState({ body, title }: { title: string; body: string }) {
  return (
    <Empty className="mx-auto my-6 max-w-sm p-4 md:p-6">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Users className="size-4" /></EmptyMedia>
        <EmptyTitle className="text-sm font-medium">{title}</EmptyTitle>
        <EmptyDescription className="text-xs">{body}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export interface TypeTabsProps {
  active: 'builtin' | 'custom'
  builtinId: string
  customId: string
  language: TeamLanguage
  ariaLabel: string
  onSelect(type: 'builtin' | 'custom'): void
}

export function TypeTabs({ active, builtinId, customId, language, ariaLabel, onSelect }: TypeTabsProps) {
  const tabs: Array<{ id: string; type: 'builtin' | 'custom' }> = [
    { id: customId, type: 'custom' },
    { id: builtinId, type: 'builtin' },
  ]
  return (
    // 原 .template-type-tabs（grid repeat(2,minmax(0,1fr)) + gap:6px）
    <div className="template-type-tabs grid grid-cols-2 gap-1.5" role="tablist" aria-label={ariaLabel}>
      {tabs.map(({ id, type }) => (
        <button
          key={id}
          id={id}
          type="button"
          data-template-type={type}
          // 原 .template-type-tab / .template-type-tab.active：min-height:34px、
          // 1px 边框、8px 圆角、12px/760 字重；选中态（active 类名是既有契约，
          // 单测断言 className 含 'active'）由 --ring 描边 + bg-muted + 前景色表达。
          // 两个分支各自写全 bg/边框/文字色，互斥取值——纯模板串没有 twMerge，
          // 不能让同组类靠 Tailwind 输出顺序分胜负。
          // 空格不能省：类名紧贴 `${` 会被 Tailwind v4.3.3 扫描器静默丢弃。
          className={`template-type-tab min-h-[34px] cursor-pointer rounded-md border text-xs font-[760] ${active === type ? 'active border-ring bg-muted text-foreground' : 'border-border bg-muted/50 text-muted-foreground'}`}
          aria-selected={active === type}
          onClick={() => onSelect(type)}
        >{translateUi(type === 'builtin' ? '内置人员' : '自定义人员', language)}</button>
      ))}
    </div>
  )
}

export function CategoryFilter({ id, active, categories, language, onSelect, ariaLabel }: {
  id?: string
  active: string
  categories: string[]
  language: TeamLanguage
  ariaLabel: string
  onSelect(category: string): void
}) {
  return (
    // 原 .template-category-filter（flex wrap + gap:6px）
    <div id={id} className="template-category-filter flex flex-wrap gap-1.5" aria-label={ariaLabel}>
      {categories.map(category => (
        <button
          key={category}
          type="button"
          data-category={category}
          // 原 .template-category-chip（min-height:28px、999px 圆角、
          // padding 0 10px、11px/760）与 :hover/:focus-visible/.active 的
          // 同一组高亮值；hover/focus 是真伪类，特异性天然高于基态，
          // 基态与选中态则各自写全取值，不依赖输出顺序。
          // 空格不能省：类名紧贴 `${` 会被 Tailwind v4.3.3 扫描器静默丢弃。
          className={`template-category-chip min-h-7 cursor-pointer rounded-full border px-2.5 py-0 text-[11px] font-[760] ${category === active ? 'active border-ring bg-muted text-foreground' : 'border-border bg-muted/50 text-muted-foreground hover:border-ring hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:bg-muted focus-visible:text-foreground'}`}
          onClick={() => onSelect(category)}
        >{localizeCategory(category, language) ?? category}</button>
      ))}
    </div>
  )
}
