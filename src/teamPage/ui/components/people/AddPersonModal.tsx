import { useEffect, useMemo, useState } from 'react'
import type { GroupChat, OpenTeamStore } from '../../../../group/types'
import { getAllRoleTemplates } from '../../../../group/roleTemplates'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import {
  addPersonMetaText,
  categoryOptions,
  defaultModelKeyForTemplate,
  displayAddPersonItemFields,
  matchesAddPersonItem,
  payloadForModelKey,
  resolveAddPersonSites,
  usedLibrarySites,
  usedNameSites,
  type AddPersonItem,
} from '../../lib/peopleLibrary'
import { selectableModels } from '../../lib/rolePanelItems'
import { showError } from '../../lib/toast'
import { CategoryFilter, EmptyState, TypeTabs } from './primitives'

/*
 * 添加人员弹窗（原 peopleLibraryView 的 add-person-modal + 站点 pill
 * 逻辑 React 化，P4）。#add-person-modal 与内部 id 逐字保留。对译关系：
 * - 开启入口：uiBus 'open-add-person'（消息流空态、成员抽屉表单）——
 *   无当前群聊时忽略（原 getCurrentChat 守卫）；打开即重置搜索/类型/
 *   分类与勾选集合（原 openAddPersonDialog）；
 * - 列表 = 库内人员 + 临时草稿（appState.temporaryPersonDrafts，由
 *   TemporaryPersonModal 写入）；类型无条目时派生回退（原
 *   ensureAddPersonTemplateTypeHasItems）；
 * - 站点 pill：已用站点置灰；勾选集合以 key 存 appState.addPersonSiteByKey，
 *   兜底解析走 resolveAddPersonSites（原 selectedAddPersonSites 纯化）；
 *   「至少保留一个站点」规则与原一致：取消最后一个勾选时回弹；
 * - 提交：勾选项按站点展开为 GROUP_ROLES_CREATE_BATCH 条目（库内
 *   {source:'library', roleTemplateId, ...模型patch}；临时
 *   {source:'temporary', name/description/systemPrompt, ...模型patch}），
 *   成功后关闭并清空勾选与临时草稿（原 addLibraryPeopleForm 提交）。
 */
export function AddPersonModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const version = useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [type, setType] = useState<'builtin' | 'custom'>('custom')
  const [category, setCategory] = useState<string>('全部')
  const [, forceSync] = useState(0)

  const ui = (source: string) => translateUi(source, language)

  const view = useMemo(() => {
    const state = getAppState()
    const store = state.store
    const chat = state.selectedChatId ? store.chatsById[state.selectedChatId] : undefined
    const items = buildAddPersonItems(store, chat, state.temporaryPersonDrafts, state.addPersonSiteByKey)
    // 回退语义同 PeopleLibraryModal：原实现把回退类型写回状态，这里统一
    // 按空查询派生，保证「空类型页签里搜索另一类型」仍能命中
    const effectiveType = fallbackAddPersonType(items, type, false)
    const filtered = items.filter(item => (
      item.type === effectiveType &&
      (category === '全部' || item.category === category) &&
      matchesAddPersonItem(item, searchQuery, language)
    ))
    return { store, chat, items, effectiveType, filtered }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, type, category, searchQuery, language])

  useEffect(() => services.uiBus.on('open-add-person', () => {
    const state = getAppState()
    if (!state.selectedChatId || !state.store.chatsById[state.selectedChatId]) return
    state.addPersonSelectedKeys.clear()
    state.addPersonSiteByKey.clear()
    services.log.info('ui:person-add-dialog:open', { chatId: state.selectedChatId, source: 'mixed' })
    setSearchQuery('')
    setType('custom')
    setCategory('全部')
    setOpen(true)
  }), [services])

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
    getAppState().addPersonSelectedKeys.clear()
    notifyAppState()
  }

  function toggleItem(item: AddPersonItem): void {
    const state = getAppState()
    if (state.addPersonSelectedKeys.has(item.key)) state.addPersonSelectedKeys.delete(item.key)
    else state.addPersonSelectedKeys.add(item.key)
    notifyAppState()
    // 勾选集合在 appState，需要一次重渲让行内勾选态跟上
    forceSync(n => n + 1)
  }

  /**
   * 原 addPersonSiteControl 的 change 处理：以「点击时显示的解析集合」
   * （item.chatSites，即 resolveAddPersonSites 的结果）为基底增删；取消
   * 最后一个站点时回弹（集合 size<=1 且取消 → 不改状态，还原勾选）。
   */
  function toggleSite(item: AddPersonItem, modelKey: string, checked: boolean): void {
    const state = getAppState()
    if (item.disabledSites.has(modelKey)) return
    const nextSites = new Set(item.chatSites)
    if (checked) {
      nextSites.add(modelKey)
    } else if (nextSites.size > 1) {
      nextSites.delete(modelKey)
    } else {
      forceSync(n => n + 1)
      return
    }
    state.addPersonSiteByKey.set(item.key, nextSites)
    notifyAppState()
    forceSync(n => n + 1)
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const chat = view.chat
    if (!chat) return
    const state = getAppState()
    const checkedKeys = new Set(state.addPersonSelectedKeys)
    const items = view.items.filter(item => checkedKeys.has(item.key))
    const payloads = items.flatMap(item => item.chatSites.map(chatSite => {
      const modelPatch = payloadForModelKey(chatSite)
      if (item.source === 'library') return { source: 'library', roleTemplateId: item.roleTemplateId, ...modelPatch }
      return {
        source: 'temporary',
        name: item.name,
        description: item.description,
        systemPrompt: item.systemPrompt,
        ...modelPatch,
      }
    }))
    if (payloads.length === 0) {
      showError(ui('请选择或填写要添加的人员'))
      return
    }
    services.runCommand('GROUP_ROLES_CREATE_BATCH', { chatId: chat.id, items: payloads })
      .then(() => {
        state.addPersonSelectedKeys.clear()
        state.temporaryPersonDrafts.splice(0)
        setOpen(false)
        notifyAppState()
      })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  const typeNoun = ui(view.effectiveType === 'builtin' ? '内置' : '自定义')
  const emptyTitle = ui(searchQuery.trim() ? `没有匹配的${typeNoun}人员` : `暂无${typeNoun}人员`)
  const emptyBody = ui(
    category !== '全部'
      ? `当前分类暂无${typeNoun}人员`
      : view.effectiveType === 'builtin'
        ? '可以切换到自定义人员，或调整搜索词。'
        : '先在人员库中新建人员，或点击右上角临时添加。',
  )

  return (
    <div
      id="add-person-modal"
      className="modal-backdrop"
      hidden={!open}
      onClick={event => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-person-title">
        <div className="modal-header">
          <div>
            <h2 id="add-person-title">{ui('添加人员')}</h2>
            <p className="tiny">{ui('从人员库或临时草稿中选择人员，并为每个人指定站点。')}</p>
          </div>
          <div className="modal-header-actions">
            <button id="open-temporary-person" className="btn btn-ghost" type="button" onClick={() => services.uiBus.emit('open-temporary-person')}>{ui('临时添加')}</button>
            <button id="close-add-person" className="icon-btn modal-close" type="button" aria-label={ui('关闭添加人员')} onClick={close}>×</button>
          </div>
        </div>
        <div className="modal-grid single-column">
          <form id="add-library-people-form" className="modal-form modal-card modal-grid-wide" onSubmit={submit}>
            <h3>{ui('选择人员')}</h3>
            <div className="add-person-toolbar">
              <input
                id="add-person-search"
                type="search"
                placeholder={ui('搜索人员名称、描述或提示词')}
                autoComplete="off"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
              />
              <TypeTabs
                active={view.effectiveType}
                builtinId="add-person-tab-builtin"
                customId="add-person-tab-custom"
                language={language}
                ariaLabel={ui('人员类型')}
                onSelect={next => {
                  setType(next)
                  setCategory('全部')
                }}
              />
              <CategoryFilter
                id="add-person-category-filter"
                active={category}
                categories={categoryOptions(view.items.filter(item => item.type === view.effectiveType).map(item => item.category))}
                language={language}
                ariaLabel={ui('人员分类')}
                onSelect={setCategory}
              />
            </div>
            <div id="add-library-people-list" className="select-list">
              {view.filtered.length === 0 ? (
                <EmptyState title={emptyTitle} body={emptyBody} />
              ) : view.filtered.map(item => (
                <AddPersonRow
                  key={item.key}
                  item={item}
                  store={view.store}
                  language={language}
                  ui={ui}
                  checked={getAppState().addPersonSelectedKeys.has(item.key)}
                  onToggle={() => toggleItem(item)}
                  onToggleSite={(modelKey, checked) => toggleSite(item, modelKey, checked)}
                />
              ))}
            </div>
            <button className="btn btn-primary" type="submit">{ui('加入选中人员')}</button>
          </form>
        </div>
      </section>
    </div>
  )
}

/** 原 addPersonItems：库内人员 + 临时草稿，站点集合按当前选择/兜底解析 */
function buildAddPersonItems(
  store: OpenTeamStore,
  chat: GroupChat | undefined,
  drafts: ReadonlyArray<{ id: string; name: string; description?: string; systemPrompt: string; chatSite: OpenTeamStore['settings']['defaultChatSite'] }>,
  siteByKey: Map<string, Set<string>>,
): AddPersonItem[] {
  const libraryItems: AddPersonItem[] = getAllRoleTemplates(store).map(template => {
    const key = `library:${template.id}`
    const disabledSites = usedLibrarySites(template, chat, store)
    const chatSites = resolveAddPersonSites(siteByKey.get(key), defaultModelKeyForTemplate(template, store), disabledSites, store)
    return {
      key,
      source: 'library' as const,
      type: template.type,
      roleTemplateId: template.id,
      name: template.name,
      category: template.category,
      sourceTemplateId: template.sourceTemplateId,
      sourceTemplateName: template.sourceTemplateName,
      description: template.description,
      systemPrompt: template.systemPrompt,
      chatSites,
      disabledSites,
    }
  })
  const temporaryItems: AddPersonItem[] = drafts.map(draft => {
    const key = `temporary:${draft.id}`
    const disabledSites = usedNameSites(draft.name, chat, store)
    const chatSites = resolveAddPersonSites(siteByKey.get(key), `site:${draft.chatSite}`, disabledSites, store)
    return {
      key,
      source: 'temporary' as const,
      type: 'custom' as const,
      draftId: draft.id,
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      chatSites,
      disabledSites,
    }
  })
  return [...libraryItems, ...temporaryItems]
}

/** 原 ensureAddPersonTemplateTypeHasItems 的派生版 */
function fallbackAddPersonType(items: AddPersonItem[], type: 'builtin' | 'custom', hasQuery: boolean): 'builtin' | 'custom' {
  if (hasQuery) return type
  if (items.some(item => item.type === type)) return type
  const fallbackType = type === 'builtin' ? 'custom' : 'builtin'
  return items.some(item => item.type === fallbackType) ? fallbackType : type
}

interface AddPersonRowProps {
  item: AddPersonItem
  store: OpenTeamStore
  language: ReturnType<typeof normalizeLanguage>
  ui: (source: string) => string
  checked: boolean
  onToggle(): void
  onToggleSite(modelKey: string, checked: boolean): void
}

function AddPersonRow({ item, store, language, ui, checked, onToggle, onToggleSite }: AddPersonRowProps) {
  const display = displayAddPersonItemFields(item, language)
  const siteText = item.chatSites.length === 0
    ? ui('所有可用站点已添加')
    : item.source === 'temporary'
      ? ui('临时人员')
      : addPersonMetaText(item, language)
  return (
    <div className="select-row">
      <input
        type="checkbox"
        value={item.key}
        checked={checked}
        disabled={item.chatSites.length === 0}
        onChange={onToggle}
      />
      <span className="select-row-content">
        <strong>{display.name}</strong>
        <div className="template-description">{display.description || ui('未填写描述')}</div>
        <div className="template-description">{siteText}</div>
      </span>
      <div className="role-site-control add-person-site-control">
        {selectableModels(store).map(model => (
          <label
            key={model.key}
            className={`site-pill ${model.className} add-person-site-option${item.chatSites.includes(model.key) ? ' active' : ''}${item.disabledSites.has(model.key) ? ' disabled' : ''}`}
          >
            <input
              type="checkbox"
              value={model.key}
              checked={item.chatSites.includes(model.key)}
              disabled={item.disabledSites.has(model.key)}
              onClick={event => event.stopPropagation()}
              onChange={event => onToggleSite(model.key, event.target.checked)}
            />
            {model.label}
          </label>
        ))}
      </div>
    </div>
  )
}
