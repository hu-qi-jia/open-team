import type { ChatSite, ExternalModelConfig, GroupChat, OpenTeamStore, RoleModelSource, RoleTemplate } from '../../../group/types'
import { ROLE_NAME_MAX_CHARACTERS } from '../../../group/roleTemplates'
import { localizeCategory, localizeRoleTemplate, translateUi, type TeamLanguage } from '../../../shared/i18n'
import { modelKeyForExternal, modelKeyForSite, rolePatchForModelKey, siteLabel } from './rolePanelItems'

/*
 * 人员库弹窗群的纯派生（原 peopleLibraryView 模块级工具函数 + 内部
 * 过滤/分页/站点解析逻辑对译，P4）。组件只负责渲染与交互；过滤条件、
 * 分页钳制、站点 pill 的勾选集合运算、校验与文案在此单测锁定。
 * 模型 key 复用 rolePanelItems（site:xxx / external:xxx）。
 */

export const TEMPLATE_CATEGORY_ALL = '全部'
export const PEOPLE_LIBRARY_PAGE_SIZE = 5

const VISIBLE_CHAT_SITES = ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok'] as const

export type TemplateDraft = Pick<RoleTemplate, 'name' | 'description' | 'systemPrompt' | 'defaultModelSource' | 'defaultChatSite' | 'defaultExternalModelId' | 'chatGptGptsUrl' | 'grokProjectUrl'>

export type AddPersonItem =
  | { key: string; source: 'library'; type: RoleTemplate['type']; roleTemplateId: string; name: string; category?: string; sourceTemplateId?: string; sourceTemplateName?: string; description?: string; systemPrompt: string; chatSites: string[]; disabledSites: Set<string> }
  | { key: string; source: 'temporary'; type: 'custom'; draftId: string; name: string; category?: string; sourceTemplateName?: string; description?: string; systemPrompt: string; chatSites: string[]; disabledSites: Set<string> }

export interface PeopleLibraryFilter {
  type: RoleTemplate['type']
  category: string
  query: string
}

export function visibleChatSite(site: ChatSite | undefined): ChatSite {
  return site && VISIBLE_CHAT_SITES.includes(site as (typeof VISIBLE_CHAT_SITES)[number]) ? site : 'gemini'
}

export function externalModels(store: OpenTeamStore): ExternalModelConfig[] {
  return store.settings.externalModelOrder
    .map(modelId => store.settings.externalModelsById[modelId])
    .filter((model): model is ExternalModelConfig => Boolean(model))
}

export function templateModelLabel(template: RoleTemplate, store: OpenTeamStore): string {
  if (template.defaultModelSource === 'external' && template.defaultExternalModelId) {
    return externalModelLabel(store.settings.externalModelsById[template.defaultExternalModelId])
  }
  return siteLabel(visibleChatSite(template.defaultChatSite ?? store.settings.defaultChatSite))
}

export function externalModelLabel(model: ExternalModelConfig | undefined): string {
  return model ? `API · ${model.name}` : 'API · 未配置'
}

export function templateTypeLabel(type: RoleTemplate['type'], language: TeamLanguage): string {
  return translateUi(type === 'builtin' ? '内置人员' : '自定义人员', language)
}

export function templateMetaText(template: RoleTemplate, language: TeamLanguage): string {
  return [
    templateTypeLabel(template.type, language),
    localizeCategory(template.category, language),
    template.sourceTemplateName,
  ].filter(Boolean).join(' · ')
}

export function addPersonMetaText(item: AddPersonItem, language: TeamLanguage): string {
  return [
    templateTypeLabel(item.type, language),
    localizeCategory(item.category, language),
    item.sourceTemplateName,
  ].filter(Boolean).join(' · ')
}

export function categoryOptions(categories: Array<string | undefined>): string[] {
  const uniqueCategories = categories
    .map(category => category?.trim())
    .filter((category): category is string => Boolean(category))
  return [TEMPLATE_CATEGORY_ALL, ...Array.from(new Set(uniqueCategories))]
}

export function matchesTemplateCategory(template: RoleTemplate, category: string): boolean {
  return category === TEMPLATE_CATEGORY_ALL || template.category === category
}

export function matchesTemplateSearch(template: RoleTemplate, queryValue: string, language: TeamLanguage = 'zh-CN'): boolean {
  const query = queryValue.trim().toLowerCase()
  if (!query) return true
  const displayTemplate = localizeRoleTemplate(template, language)
  return personFieldTexts(template, displayTemplate).some(value => value.toLowerCase().includes(query))
}

/** 原 matchesAddPersonSearch：原文与展示文案双双参与匹配 */
export function matchesAddPersonItem(item: AddPersonItem, queryValue: string, language: TeamLanguage = 'zh-CN'): boolean {
  const query = queryValue.trim().toLowerCase()
  if (!query) return true
  const display = displayAddPersonItemFields(item, language)
  return personFieldTexts(item, display).some(value => value.toLowerCase().includes(query))
}

/** 原 displayAddPersonItem：库内人员按语言本地化展示字段，临时人员原样 */
export function displayAddPersonItemFields(item: AddPersonItem, language: TeamLanguage): Pick<AddPersonItem, 'name' | 'category' | 'sourceTemplateName' | 'description' | 'systemPrompt'> {
  if (item.source === 'temporary') return item
  const localized = localizeRoleTemplate({
    id: item.roleTemplateId,
    type: item.type,
    name: item.name,
    category: item.category,
    sourceTemplateId: item.sourceTemplateId,
    sourceTemplateName: item.sourceTemplateName,
    description: item.description,
    systemPrompt: item.systemPrompt,
    createdAt: 0,
    updatedAt: 0,
  }, language)
  return {
    name: localized.name,
    category: localized.category,
    sourceTemplateName: localized.sourceTemplateName,
    description: localized.description,
    systemPrompt: localized.systemPrompt,
  }
}

function personFieldTexts(
  fields: { name: string; category?: string; sourceTemplateName?: string; description?: string; systemPrompt: string },
  display: typeof fields,
): string[] {
  return [
    fields.name,
    fields.category ?? '',
    fields.sourceTemplateName ?? '',
    fields.description ?? '',
    fields.systemPrompt,
    display.name,
    display.category ?? '',
    display.sourceTemplateName ?? '',
    display.description ?? '',
    display.systemPrompt,
  ]
}

export function filteredPeopleLibraryTemplates(templates: RoleTemplate[], filter: PeopleLibraryFilter, language: TeamLanguage = 'zh-CN'): RoleTemplate[] {
  return templates.filter(template => (
    template.type === filter.type &&
    matchesTemplateCategory(template, filter.category) &&
    matchesTemplateSearch(template, filter.query, language)
  ))
}

/** 原_peopleLibrary ensureTypeHasItems：当前类型无条目且未搜索时回退另一类型 */
export function fallbackTemplateType(templates: RoleTemplate[], type: RoleTemplate['type'], hasQuery: boolean): RoleTemplate['type'] {
  if (hasQuery) return type
  if (templates.some(template => template.type === type)) return type
  const fallbackType = type === 'builtin' ? 'custom' : 'builtin'
  return templates.some(template => template.type === fallbackType) ? fallbackType : type
}

export function peopleLibraryPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PEOPLE_LIBRARY_PAGE_SIZE))
}

export function clampPeopleLibraryPage(page: number, total: number): number {
  return Math.min(Math.max(0, page), peopleLibraryPageCount(total) - 1)
}

export function pagedTemplates(templates: RoleTemplate[], page: number): RoleTemplate[] {
  const start = clampPeopleLibraryPage(page, templates.length) * PEOPLE_LIBRARY_PAGE_SIZE
  return templates.slice(start, start + PEOPLE_LIBRARY_PAGE_SIZE)
}

export function validatePersonDraft(draft: Pick<TemplateDraft, 'name' | 'description' | 'systemPrompt'>): string | undefined {
  if (!draft.name) return '人员名称不能为空'
  if (Array.from(draft.name).length > ROLE_NAME_MAX_CHARACTERS) return `人员名称最多 ${ROLE_NAME_MAX_CHARACTERS} 个字`
  return undefined
}

export function personaGenerationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'Unknown OpenTeam message') return 'AI 生成人设需要重新加载 OpenTeam 扩展后再使用'
  return message
}

/** 模板在当前群的默认模型 key（外部模型失效时回落默认站点） */
export function defaultModelKeyForTemplate(template: RoleTemplate, store: OpenTeamStore): string {
  if (template.defaultModelSource === 'external' && template.defaultExternalModelId && store.settings.externalModelsById[template.defaultExternalModelId]) {
    return modelKeyForExternal(template.defaultExternalModelId)
  }
  return modelKeyForSite(visibleChatSite(template.defaultChatSite ?? store.settings.defaultChatSite))
}

/** 模型 key → GROUP_ROLES_CREATE_BATCH 条目的模型字段 patch */
export function payloadForModelKey(key: string): { modelSource: RoleModelSource; chatSite?: ChatSite; externalModelId?: string } {
  return rolePatchForModelKey(key)
}

/** 当前群中已使用某模板的站点集合（这些站点 pill 置灰） */
export function usedLibrarySites(template: RoleTemplate, chat: GroupChat | undefined, store: OpenTeamStore): Set<string> {
  if (!chat) return new Set()
  return new Set(chat.roleIds
    .map(roleId => store.rolesById[roleId])
    .filter(role => role?.templateId === template.id)
    .map(role => roleModelKey(role, store)))
}

/** 当前群中同名成员已占用的站点集合（临时人员防重复） */
export function usedNameSites(name: string, chat: GroupChat | undefined, store: OpenTeamStore): Set<string> {
  if (!chat) return new Set()
  return new Set(chat.roleIds
    .map(roleId => store.rolesById[roleId])
    .filter(role => role?.name.trim().toLowerCase() === name.trim().toLowerCase())
    .map(role => roleModelKey(role, store)))
}

function roleModelKey(role: { modelSource?: RoleModelSource; externalModelId?: string; chatSite?: ChatSite }, store: OpenTeamStore): string {
  if (role.modelSource === 'external' && role.externalModelId) return modelKeyForExternal(role.externalModelId)
  return modelKeyForSite(visibleChatSite(role.chatSite ?? store.settings.defaultChatSite))
}

/**
 * 原 selectedAddPersonSites 纯化：优先取用户已选站点（剔除置灰项），
 * 否则回落默认站点、再回落首个可用站点。与原实现一致地不修改调用方状态。
 */
export function resolveAddPersonSites(
  selectedSites: Set<string> | undefined,
  fallbackSite: string,
  disabledSites: Set<string>,
  store: OpenTeamStore,
): string[] {
  const modelKeys = selectableModelKeys(store)
  const visibleSelectedSites = selectedSites ? modelKeys.filter(site => selectedSites.has(site) && !disabledSites.has(site)) : []
  if (visibleSelectedSites.length > 0) return visibleSelectedSites

  const fallback = modelKeys.includes(fallbackSite) ? fallbackSite : modelKeyForSite(visibleChatSite(store.settings.defaultChatSite))
  const nextSite = disabledSites.has(fallback) ? modelKeys.find(site => !disabledSites.has(site)) : fallback
  return nextSite ? [nextSite] : []
}

function selectableModelKeys(store: OpenTeamStore): string[] {
  return [
    ...VISIBLE_CHAT_SITES.map(site => modelKeyForSite(site)),
    ...externalModels(store).map(model => modelKeyForExternal(model.id)),
  ]
}
