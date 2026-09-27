import { Users } from 'lucide-react'
import { localizeCategory, translateUi, type TeamLanguage } from '../../../../shared/i18n'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

/*
 * 人员库弹窗群的共享小件（原 renderCategoryFilter / emptyCard /
 * template-type-tabs 内联结构对译）。id 由各弹窗传入以保持原样。
 * W3-3 起空态换 Empty 原语（居中图标 + 标题 + 描述，无描边盒子）。
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
    <div className="template-type-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(({ id, type }) => (
        <button
          key={id}
          id={id}
          type="button"
          data-template-type={type}
          className={`template-type-tab${active === type ? ' active' : ''}`}
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
    <div id={id} className="template-category-filter" aria-label={ariaLabel}>
      {categories.map(category => (
        <button
          key={category}
          type="button"
          data-category={category}
          className={`template-category-chip${category === active ? ' active' : ''}`}
          onClick={() => onSelect(category)}
        >{localizeCategory(category, language) ?? category}</button>
      ))}
    </div>
  )
}
