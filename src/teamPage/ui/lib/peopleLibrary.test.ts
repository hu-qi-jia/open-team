import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '../../../group/store'
import { getAllRoleTemplates } from '../../../group/roleTemplates'
import type { GroupChat, OpenTeamStore, RoleTemplate } from '../../../group/types'
import {
  addPersonMetaText,
  categoryOptions,
  clampPeopleLibraryPage,
  defaultModelKeyForTemplate,
  displayAddPersonItemFields,
  externalModelLabel,
  fallbackTemplateType,
  filteredPeopleLibraryTemplates,
  matchesAddPersonItem,
  matchesTemplateCategory,
  matchesTemplateSearch,
  peopleLibraryPageCount,
  pagedTemplates,
  payloadForModelKey,
  personaGenerationErrorMessage,
  resolveAddPersonSites,
  templateMetaText,
  templateModelLabel,
  usedLibrarySites,
  usedNameSites,
  validatePersonDraft,
  visibleChatSite,
} from './peopleLibrary'

/*
 * 人员库弹窗群纯派生单测（原 peopleLibraryView 模块内工具函数 + 内部
 * 过滤/分页/站点解析逻辑对译）。组件交互行为由 people/ 下 RTL 测试覆盖；
 * 这里锁定过滤条件、分页钳制、站点 pill 勾选集合运算、校验与文案。
 */

function makeCustomTemplate(index: number): RoleTemplate {
  return {
    id: `template-${index}`,
    type: 'custom',
    name: `人员${index}`,
    description: `描述${index}`,
    defaultChatSite: 'gemini',
    systemPrompt: `提示词${index}`,
    createdAt: index,
    updatedAt: index,
  }
}

function makeChat(id: string, roleIds: string[] = []): GroupChat {
  return {
    id,
    name: '群聊',
    mode: 'independent',
    roleIds,
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('visibleChatSite', () => {
  it('passes known sites through and falls back to gemini for external/unknown', () => {
    expect(visibleChatSite('deepseek')).toBe('deepseek')
    expect(visibleChatSite(undefined)).toBe('gemini')
  })
})

describe('external model labels', () => {
  it('labels configured models with an API prefix and marks missing ones', () => {
    expect(externalModelLabel({ id: 'm1', name: '本地模型', format: 'openai', baseUrl: '', apiKey: '', modelName: 'gpt' } as never)).toBe('API · 本地模型')
    expect(externalModelLabel(undefined)).toBe('API · 未配置')
  })

  it('resolves the template model label from the external config or the default site', () => {
    const store = createDefaultStore()
    const siteTemplate = makeCustomTemplate(1)
    expect(templateModelLabel(siteTemplate, store)).toBe('Gemini')

    const externalTemplate: RoleTemplate = {
      ...makeCustomTemplate(2),
      defaultModelSource: 'external',
      defaultExternalModelId: 'missing',
    }
    // 标签不校验外部模型存在性（原实现对译）：失效时显示「未配置」；
    // 失效回落默认站点发生在添加人员的兜底解析（defaultModelKeyForTemplate）
    expect(templateModelLabel(externalTemplate, store)).toBe('API · 未配置')
    expect(defaultModelKeyForTemplate(externalTemplate, store)).toBe('site:gemini')
  })
})

describe('templateMetaText / addPersonMetaText', () => {
  it('joins type, localized category, and source group metadata', () => {
    const template: RoleTemplate = {
      ...makeCustomTemplate(1),
      category: '技术研发',
      sourceTemplateName: 'AI Agent 开发群',
    }
    expect(templateMetaText(template, 'zh-CN')).toBe('自定义人员 · 技术研发 · AI Agent 开发群')
    expect(templateMetaText(template, 'en')).toContain('Custom')
  })

  it('renders add-person metadata from the item fields', () => {
    const item = {
      key: 'library:template-1',
      source: 'library' as const,
      type: 'custom' as const,
      roleTemplateId: 'template-1',
      name: '人员1',
      category: '技术研发',
      sourceTemplateName: 'AI Agent 开发群',
      description: '',
      systemPrompt: '',
      chatSites: ['site:gemini'],
      disabledSites: new Set<string>(),
    }
    expect(addPersonMetaText(item, 'zh-CN')).toBe('自定义人员 · 技术研发 · AI Agent 开发群')
  })
})

describe('category filter helpers', () => {
  it('builds category options with 全部 first and de-duplicated', () => {
    expect(categoryOptions(['技术研发', '学生与学习', '技术研发', undefined, '  '])).toEqual(['全部', '技术研发', '学生与学习'])
  })

  it('matches 全部 or exact category', () => {
    const template = { ...makeCustomTemplate(1), category: '技术研发' }
    expect(matchesTemplateCategory(template, '全部')).toBe(true)
    expect(matchesTemplateCategory(template, '技术研发')).toBe(true)
    expect(matchesTemplateCategory(template, '学生与学习')).toBe(false)
  })
})

describe('matchesTemplateSearch / matchesAddPersonItem', () => {
  const frankl: RoleTemplate = {
    id: 'builtin-frankl',
    type: 'builtin',
    name: '弗兰克尔',
    description: '意义顾问',
    defaultChatSite: 'gemini',
    systemPrompt: '苦难中的尊严',
    createdAt: 0,
    updatedAt: 0,
  }

  it('matches raw name, description, and persona text', () => {
    expect(matchesTemplateSearch(frankl, '弗兰克尔')).toBe(true)
    expect(matchesTemplateSearch(frankl, '意义')).toBe(true)
    expect(matchesTemplateSearch(frankl, '苦难')).toBe(true)
    expect(matchesTemplateSearch(frankl, '荒诞')).toBe(false)
    expect(matchesTemplateSearch(frankl, '  ')).toBe(true)
  })

  it('matches localized display text in English mode', () => {
    expect(matchesTemplateSearch(frankl, 'viktor', 'en')).toBe(true)
    expect(matchesTemplateSearch(frankl, '弗兰克尔', 'en')).toBe(true)
  })

  it('matches add-person items through the same field set', () => {
    const item = {
      key: 'library:builtin-frankl',
      source: 'library' as const,
      type: 'builtin' as const,
      roleTemplateId: 'builtin-frankl',
      name: '弗兰克尔',
      description: '意义顾问',
      systemPrompt: '苦难中的尊严',
      chatSites: ['site:gemini'],
      disabledSites: new Set<string>(),
    }
    expect(matchesAddPersonItem(item, '尊严')).toBe(true)
    expect(matchesAddPersonItem(item, '加缪')).toBe(false)
  })

  it('localizes library items for display while keeping temporary items as-is', () => {
    const item = {
      key: 'library:builtin-frankl',
      source: 'library' as const,
      type: 'builtin' as const,
      roleTemplateId: 'builtin-frankl',
      name: '弗兰克尔',
      description: '意义顾问',
      systemPrompt: '',
      chatSites: ['site:gemini'],
      disabledSites: new Set<string>(),
    }
    expect(displayAddPersonItemFields(item, 'en').name).toBe('ViktorFrankl')
    const temporary = {
      key: 'temporary:1',
      source: 'temporary' as const,
      type: 'custom' as const,
      draftId: '1',
      name: '临时人员',
      description: '',
      systemPrompt: '',
      chatSites: ['site:gemini'],
      disabledSites: new Set<string>(),
    }
    expect(displayAddPersonItemFields(temporary, 'en').name).toBe('临时人员')
  })
})

describe('filteredPeopleLibraryTemplates / fallbackTemplateType', () => {
  it('filters by type, category, and query together', () => {
    const a = { ...makeCustomTemplate(1), category: '技术研发' }
    const b = { ...makeCustomTemplate(2), category: '学生与学习' }
    const templates = [a, b]
    expect(filteredPeopleLibraryTemplates(templates, { type: 'custom', category: '技术研发', query: '' })).toEqual([a])
    expect(filteredPeopleLibraryTemplates(templates, { type: 'custom', category: '全部', query: '描述2' })).toEqual([b])
    expect(filteredPeopleLibraryTemplates(templates, { type: 'builtin', category: '全部', query: '' })).toEqual([])
  })

  it('falls back to the other type when the current one is empty and there is no query', () => {
    const custom = makeCustomTemplate(1)
    expect(fallbackTemplateType([custom], 'builtin', false)).toBe('custom')
    expect(fallbackTemplateType([custom], 'builtin', true)).toBe('builtin')
    expect(fallbackTemplateType([], 'custom', false)).toBe('custom')
  })
})

describe('pagination helpers', () => {
  it('pages five entries at a time and clamps out-of-range pages', () => {
    const templates = Array.from({ length: 6 }, (_, index) => makeCustomTemplate(index + 1))
    expect(peopleLibraryPageCount(6)).toBe(2)
    expect(peopleLibraryPageCount(0)).toBe(1)
    expect(pagedTemplates(templates, 0)).toHaveLength(5)
    expect(pagedTemplates(templates, 1)).toEqual([templates[5]])
    expect(pagedTemplates(templates, 99)).toEqual([templates[5]])
    expect(clampPeopleLibraryPage(99, 6)).toBe(1)
    expect(clampPeopleLibraryPage(-1, 6)).toBe(0)
    expect(clampPeopleLibraryPage(0, 0)).toBe(0)
  })
})

describe('validatePersonDraft / personaGenerationErrorMessage', () => {
  it('requires a name and caps it at 50 characters', () => {
    expect(validatePersonDraft({ name: '', description: '', systemPrompt: '' })).toBe('人员名称不能为空')
    expect(validatePersonDraft({ name: '研'.repeat(50), description: '', systemPrompt: '' })).toBeUndefined()
    expect(validatePersonDraft({ name: '研'.repeat(51), description: '', systemPrompt: '' })).toBe('人员名称最多 50 个字')
  })

  it('translates the unknown-route error into a reload hint', () => {
    expect(personaGenerationErrorMessage(new Error('Unknown OpenTeam message'))).toBe('AI 生成人设需要重新加载 OpenTeam 扩展后再使用')
    expect(personaGenerationErrorMessage(new Error('网络断开'))).toBe('网络断开')
    expect(personaGenerationErrorMessage('字符串错误')).toBe('字符串错误')
  })
})

describe('model key mapping', () => {
  it('maps the default template model to an external key only when the config exists', () => {
    const store = createDefaultStore()
    store.settings.externalModelOrder = ['m1']
    store.settings.externalModelsById = {
      m1: { id: 'm1', name: '本地模型', format: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'k', modelName: 'gpt', createdAt: 0, updatedAt: 0 },
    }
    const externalTemplate: RoleTemplate = {
      ...makeCustomTemplate(1),
      defaultModelSource: 'external',
      defaultExternalModelId: 'm1',
    }
    expect(defaultModelKeyForTemplate(externalTemplate, store)).toBe('external:m1')
    expect(defaultModelKeyForTemplate({ ...externalTemplate, defaultExternalModelId: 'missing' }, store)).toBe('site:gemini')
  })

  it('expands model keys into group role create patches', () => {
    expect(payloadForModelKey('site:claude')).toEqual({ modelSource: 'site', chatSite: 'claude' })
    expect(payloadForModelKey('external:m1')).toEqual({ modelSource: 'external', externalModelId: 'm1' })
  })
})

describe('used site sets', () => {
  it('collects the sites a template already occupies in the current chat', () => {
    const store = createDefaultStore()
    const chat = makeChat('chat-1', ['role-1', 'role-2'])
    store.chatsById[chat.id] = chat
    store.rolesById['role-1'] = { id: 'role-1', chatId: 'chat-1', name: '人员1', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, templateId: 'template-1', chatSite: 'gemini' }
    store.rolesById['role-2'] = { id: 'role-2', chatId: 'chat-1', name: '人员1b', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, templateId: 'template-1', modelSource: 'external', externalModelId: 'm1' }
    const template = makeCustomTemplate(1)
    expect(usedLibrarySites(template, chat, store)).toEqual(new Set(['site:gemini', 'external:m1']))
    expect(usedLibrarySites(template, undefined, store)).toEqual(new Set())
  })

  it('collects name-occupied sites case-insensitively for temporary drafts', () => {
    const store = createDefaultStore()
    const chat = makeChat('chat-1', ['role-1'])
    store.chatsById[chat.id] = chat
    store.rolesById['role-1'] = { id: 'role-1', chatId: 'chat-1', name: '  临时人员 ', status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1, chatSite: 'deepseek' }
    expect(usedNameSites('临时人员', chat, store)).toEqual(new Set(['site:deepseek']))
    expect(usedNameSites('其他人', chat, store)).toEqual(new Set())
  })
})

describe('resolveAddPersonSites', () => {
  const store = createDefaultStore()
  const disabled = new Set(['site:gemini'])

  it('keeps the user selection minus disabled sites', () => {
    const selected = new Set(['site:gemini', 'site:claude'])
    expect(resolveAddPersonSites(selected, 'site:gemini', disabled, store)).toEqual(['site:claude'])
  })

  it('falls back to the default site and then the first available site', () => {
    expect(resolveAddPersonSites(undefined, 'site:deepseek', disabled, store)).toEqual(['site:deepseek'])
    expect(resolveAddPersonSites(undefined, 'site:gemini', disabled, store)).toEqual(['site:chatgpt'])
  })

  it('returns an empty set when every site is disabled', () => {
    const all = new Set(['site:gemini', 'site:chatgpt', 'site:claude', 'site:deepseek', 'site:grok'])
    expect(resolveAddPersonSites(undefined, 'site:gemini', all, store)).toEqual([])
  })
})

describe('default store integration', () => {
  it('seeds custom templates so the custom tab has entries by default', () => {
    const store: OpenTeamStore = createDefaultStore()
    const templates = getAllRoleTemplates(store)
    expect(templates.some(template => template.name === '产品经理')).toBe(true)
    expect(filteredPeopleLibraryTemplates(templates, { type: 'custom', category: '全部', query: '产品' }, 'zh-CN').length).toBeGreaterThan(0)
  })
})
