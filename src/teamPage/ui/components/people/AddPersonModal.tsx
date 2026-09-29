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
import { AppModal } from '../common/AppModal'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { CategoryFilter, EmptyState, TypeTabs } from './primitives'

/*
 * 添加人员弹窗（原 peopleLibraryView 的 add-person-modal + 站点 pill
 * 逻辑 React 化，P4；W1 起外壳换 Radix Dialog——#add-person-modal id
 * 移到 DialogContent，Escape/遮罩点击关闭经 onOpenChange 走 close 清
 * 勾选集合。**S4-T4 起外壳改由公共组合壳 `common/AppModal` 承担**
 * （size="xl" / height="auto"）：id / aria-labelledby / 宽度类 /
 * bg-popover / 自绘 × 全部移交 AppModal，正文内边距改由
 * bodyClassName="p-6" 补回（壳用 p-0 收掉了原语基类的 p-6）；列表行
 * 视觉从 legacy 翻成 utilities（.select-row / .select-row-content /
 * .template-description / .add-person-site-control 的**类名保留**作
 * 探针钩子——screenshot-bugfix-acceptance.mjs 直接断言这一行的几何与
 * 取色）。内部 id 逐字保留。对译关系：
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
    <AppModal
      open={open}
      onOpenChange={next => { if (!next) close() }}
      size="xl"
      height="auto"
      contentId="add-person-modal"
      titleId="add-person-title"
      title={ui('添加人员')}
      // 说明行 id 交给 Radix 自动生成（不传 descriptionId），与迁移前一致
      description={ui('从人员库或临时草稿中选择人员，并为每个人指定站点。')}
      headerActions={(
        <Button id="open-temporary-person" variant="ghost" size="sm" type="button" onClick={() => services.uiBus.emit('open-temporary-person')}>{ui('临时添加')}</Button>
      )}
      closeId="close-add-person"
      closeLabel={ui('关闭添加人员')}
      onClose={close}
      // 正文内边距靠这里补回来：本弹窗自身不带任何 padding（.modal-form 只有
      // grid/gap/margin，.modal-card 只有 border/radius/padding 而已），而壳
      // 用 p-0 收掉了原语基类的 p-6
      bodyClassName="p-6"
    >
      {/* 原 .modal-grid.single-column（单列网格）：本弹窗只有一个子项，
          gap 不参与布局，保留 display:grid 的形状即可 */}
      <div className="grid gap-3.5">
        {/* 原 .modal-form.modal-card.modal-grid-wide：.modal-form 的
            display/gap/margin 仍由共享 legacy 规则承担（T5 退役），这里补
            .modal-card 的三件套——边框/圆角/底色，翻成语义 token */}
        <form id="add-library-people-form" className="modal-form mt-3 grid gap-3 rounded-lg border border-border bg-card p-3" onSubmit={submit}>
          <h3>{ui('选择人员')}</h3>
          {/* 原 .add-person-toolbar：display:grid; gap:10px */}
          <div className="add-person-toolbar grid gap-2.5">
            <Input
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
          {/* 原 .select-list：grid; gap:8px; max-height:360px; overflow:auto。
              类名保留作钩子（行选择器都在它下面） */}
          <div id="add-library-people-list" className="select-list grid gap-2 max-h-[360px] overflow-auto">
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
          <Button size="sm" type="submit">{ui('加入选中人员')}</Button>
        </form>
      </div>
    </AppModal>
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
    // 原 .select-row：grid / 三列 auto minmax(0,1fr) auto / gap 10px /
    // align-items:center / 1px 边框 / radius 8px / padding 10px / 底色。
    // **类名保留**——screenshot-bugfix-acceptance.mjs 直接断言这一行的行
    // 几何（checkbox 16×16 且居中于整行、pill 居中、与裸 .site-pill 同色），
    // 底色由 rgba(24,24,27,.46) 换成 bg-card：暗色 --card = rgb(24,24,27)，
    // 与该半透明层合成在 --popover（同值）上的结果逐像素相同
    <div className="select-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md border border-border bg-card p-2.5">
      {/* 裸 checkbox 会被 legacy 的全局 `input{height:36px;padding:0 11px;width:100%}`
          撑成 36px 高、横向 padding 22px 的盒子（legacy 层晚于 preflight，压得住） */}
      <input
        type="checkbox"
        className="size-4 shrink-0"
        value={item.key}
        checked={checked}
        disabled={item.chatSites.length === 0}
        onChange={onToggle}
      />
      {/* 原 .select-row-content：min-width:0（grid 项被块化后才生效） */}
      <span className="select-row-content min-w-0">
        <strong>{display.name}</strong>
        {/* 原 .template-description：mt 2px / 12px / line-height 1.45 /
            --muted-foreground。**类名保留**——bugfix 探针断言它的对比度 */}
        <div className="template-description mt-0.5 text-xs leading-[1.45] text-muted-foreground">{display.description || ui('未填写描述')}</div>
        <div className="template-description mt-0.5 text-xs leading-[1.45] text-muted-foreground">{siteText}</div>
      </span>
      {/* 原 .add-person-site-control：gap 6px / wrap / 右对齐（display 来自
          .role-site-control，本行显式给 flex 兜底，类名保留作钩子）。站点
          pill 的 label.site-pill > input[type=checkbox] 结构与
          stopPropagation / disabled / .active / .disabled 语义逐条不变 */}
      <div className="role-site-control add-person-site-control relative flex flex-wrap justify-end gap-1.5">
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
