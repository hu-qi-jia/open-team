import { useEffect, useMemo, useState } from 'react'
import type { OpenTeamStore, RoleTemplate } from '../../../../group/types'
import { getAllRoleTemplates } from '../../../../group/roleTemplates'
import { localizeRoleTemplate, normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import {
  categoryOptions,
  clampPeopleLibraryPage,
  fallbackTemplateType,
  filteredPeopleLibraryTemplates,
  peopleLibraryPageCount,
  pagedTemplates,
  templateMetaText,
  templateModelLabel,
  visibleChatSite,
} from '../../lib/peopleLibrary'
import { showError } from '../../lib/toast'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { CategoryFilter, EmptyState, TypeTabs } from './primitives'

/*
 * 人员库弹窗（原 peopleLibraryView 主体 React 化，P4；W1 起外壳换 Radix
 * Dialog——#people-library-modal id 移到 DialogContent，Escape/遮罩点击
 * 关闭经 onOpenChange 走 close；删除确认 AlertDialog 移出 Dialog 成为
 * fragment 兄弟）。内部 id 逐字保留。与原实现的对译关系：
 * - 开启入口：Rail 的 #open-people-library → uiBus 'open-people-library'
 *   （打开即重置搜索/类型/分类/页码，同原 openPeopleLibraryEl 处理器）；
 * - renderTemplates → items useMemo（store 版本驱动）：类型无条目回退
 *   （ensureTypeHasItems → fallbackTemplateType 派生，不再回写状态）、
 *   过滤/分页钳制由纯函数承担；
 * - 卡片「编辑」→ 写 appState.selectedTemplateId + uiBus
 *   'open-person-template-edit'；「详情」→ 写 previewTemplateId + uiBus
 *   'open-builtin-template-detail'；「删除」window.confirm → AlertDialog，
 *   确认后 ROLE_TEMPLATE_DELETE（被编辑中的模板随之关闭编辑弹窗——
 *   PersonTemplateModal 自行侦测目标消失）；
 * - 原 document 级 Escape 监听随 Radix 移除：叠加其上的 Radix 弹窗
 *   改为逐层关闭（Escape 只派发最顶层），遮罩点击同理只关顶层。
 */
export function PeopleLibraryModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const version = useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [type, setType] = useState<'builtin' | 'custom'>('custom')
  const [category, setCategory] = useState<string>('全部')
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<RoleTemplate | undefined>(undefined)

  const ui = (source: string) => translateUi(source, language)

  const view = useMemo(() => {
    const state = getAppState()
    const store = state.store
    const allTemplates = getAllRoleTemplates(store)
    // 原实现 ensureTypeHasItems 在空查询时把回退类型写回持久状态，因此
    // 带查询渲染沿用的仍是「空查询语义」的回退结果——React 纯派生统一按
    // hasQuery=false 计算，才能复现「空类型页签里搜索另一类型命中」的行为
    const effectiveType = fallbackTemplateType(allTemplates, type, false)
    const templates = filteredPeopleLibraryTemplates(allTemplates, { type: effectiveType, category, query: searchQuery }, language)
    const currentPage = clampPeopleLibraryPage(page, templates.length)
    return {
      store,
      allTemplates,
      effectiveType,
      templates,
      currentPage,
      pageCount: peopleLibraryPageCount(templates.length),
      visible: pagedTemplates(templates, page),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, type, category, searchQuery, page, language])

  useEffect(() => services.uiBus.on('open-people-library', () => {
    services.log.info('ui:people-library:open', { templateCount: getAllRoleTemplates(getAppState().store).length })
    setSearchQuery('')
    setType('custom')
    setCategory('全部')
    setPage(0)
    setOpen(true)
  }), [services])

  // 打开时把可能越界的页码拉回界内（原 pagedTemplates 每次钳制的对译）
  useEffect(() => {
    if (open) setPage(current => clampPeopleLibraryPage(current, view.templates.length))
  })

  // Escape/遮罩关闭改由 Radix 接管（onOpenChange → close）。原 document
  // 级 Escape 监听移除后，叠加其上的 Radix 弹窗（详情/编辑）不再被一并
  // 关闭，改为逐层关闭（Radix 只派发最顶层）
  function close(): void {
    setOpen(false)
  }

  function openTemplateEditor(templateId: string): void {
    const state = getAppState()
    state.selectedTemplateId = templateId
    notifyAppState()
    services.uiBus.emit('open-person-template-edit')
  }

  function openBuiltinDetail(template: RoleTemplate): void {
    const state = getAppState()
    state.previewTemplateId = template.id
    notifyAppState()
    services.uiBus.emit('open-builtin-template-detail')
  }

  function confirmDelete(): void {
    if (!deleteTarget) return
    const templateId = deleteTarget.id
    setDeleteTarget(undefined)
    services.runCommand('ROLE_TEMPLATE_DELETE', { templateId })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function selectTab(next: 'builtin' | 'custom'): void {
    setType(next)
    setCategory('全部')
    setPage(0)
  }

  const typeNoun = ui(view.effectiveType === 'builtin' ? '内置' : '自定义')
  const emptyTitle = ui(searchQuery.trim() ? `没有匹配的${typeNoun}人员` : `暂无${typeNoun}人员`)
  const emptyBody = ui(
    category !== '全部'
      ? `当前分类暂无${typeNoun}人员`
      : view.effectiveType === 'builtin'
        ? '可以切换到自定义人员，或调整搜索词。'
        : '点击右上角新建人员，保存后会出现在这里。',
  )

  return (
    <>
      <Dialog open={open} onOpenChange={next => { if (!next) close() }}>
        <DialogContent
          id="people-library-modal"
          aria-labelledby="people-library-title"
          showCloseButton={false}
          className="people-library-modal w-[min(640px,calc(100vw-48px))] max-w-none sm:max-w-none bg-popover"
        >
          <DialogHeader className="flex-row items-start justify-between gap-4 text-left">
            <div>
              <DialogTitle id="people-library-title">{ui('人员库')}</DialogTitle>
              <DialogDescription className="tiny">{ui('维护可复用人员人设；加入群聊后会复制为独立人员。')}</DialogDescription>
            </div>
            <div className="chat-row flex items-center gap-2">
              <button id="new-template" className="btn btn-primary" type="button" onClick={() => {
                const state = getAppState()
                state.selectedTemplateId = undefined
                notifyAppState()
                services.uiBus.emit('open-person-template-edit')
              }}>{ui('新建')}</button>
              <Button id="close-people-library" variant="ghost" size="icon-sm" type="button" aria-label={ui('关闭人员库')} onClick={close}>×</Button>
            </div>
          </DialogHeader>
          <div className="people-library-content">
            <div className="people-library-pane">
              <div className="section-title">
                <h3>{ui('人员列表')}</h3>
                <span id="people-library-summary" className="tiny">{ui(`${view.templates.length} 人`)}</span>
              </div>
              <div className="people-library-toolbar">
                <input
                  id="people-library-search"
                  type="search"
                  placeholder={ui('搜索人员名称、描述或提示词')}
                  autoComplete="off"
                  value={searchQuery}
                  onChange={event => {
                    setSearchQuery(event.target.value)
                    setPage(0)
                  }}
                />
                <TypeTabs
                  active={view.effectiveType}
                  builtinId="people-library-tab-builtin"
                  customId="people-library-tab-custom"
                  language={language}
                  ariaLabel={ui('人员库类型')}
                  onSelect={selectTab}
                />
                <CategoryFilter
                  id="people-library-category-filter"
                  active={category}
                  categories={categoryOptions(view.allTemplates.filter(template => template.type === view.effectiveType).map(template => template.category))}
                  language={language}
                  ariaLabel={ui('人员分类')}
                  onSelect={next => {
                    setCategory(next)
                    setPage(0)
                  }}
                />
              </div>
              <div id="people-library-list" className="template-list">
                {view.templates.length === 0 ? (
                  <EmptyState title={emptyTitle} body={emptyBody} />
                ) : view.visible.map(template => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    store={view.store}
                    language={language}
                    ui={ui}
                    used={isTemplateUsed(template.id, view.store)}
                    onEdit={() => openTemplateEditor(template.id)}
                    onDetail={() => openBuiltinDetail(template)}
                    onDelete={() => setDeleteTarget(template)}
                  />
                ))}
              </div>
              <div id="people-library-pagination" className="pagination-bar">
                {view.pageCount > 1 && (
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost pagination-btn"
                      disabled={view.currentPage === 0}
                      onClick={() => setPage(Math.max(0, view.currentPage - 1))}
                    >{ui('上一页')}</button>
                    <span className="pagination-label">{view.currentPage + 1} / {view.pageCount}</span>
                    <button
                      type="button"
                      className="btn btn-ghost pagination-btn"
                      disabled={view.currentPage >= view.pageCount - 1}
                      onClick={() => setPage(Math.min(view.pageCount - 1, view.currentPage + 1))}
                    >{ui('下一页')}</button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== undefined} onOpenChange={nextOpen => { if (!nextOpen) setDeleteTarget(undefined) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ui('删除人员')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? ui(`确定删除「${deleteTarget.name}」吗？删除后这个人员会从人员库移除。`) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ui('取消')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{ui('删除')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function isTemplateUsed(templateId: string, store: OpenTeamStore): boolean {
  return Object.values(store.rolesById).some(role => role.templateId === templateId)
}

interface TemplateCardProps {
  template: RoleTemplate
  store: OpenTeamStore
  language: ReturnType<typeof normalizeLanguage>
  ui: (source: string) => string
  used: boolean
  onEdit(): void
  onDetail(): void
  onDelete(): void
}

function TemplateCard({ template, store, language, ui, used, onEdit, onDetail, onDelete }: TemplateCardProps) {
  const displayTemplate = localizeRoleTemplate(template, language)
  const defaultChatSite = visibleChatSite(template.defaultChatSite ?? store.settings.defaultChatSite)
  const siteSuffix = defaultChatSite === 'chatgpt' && template.chatGptGptsUrl
    ? ' · GPTs'
    : defaultChatSite === 'grok' && template.grokProjectUrl
      ? ' · Project'
      : ''
  return (
    <section className="template-card">
      <div className="template-card-body">
        <div className="role-row">
          <div className="role-name">{displayTemplate.name}</div>
          <span className={`template-type-badge template-type-${template.type}`}>{ui(template.type === 'builtin' ? '内置' : '自定义')}</span>
        </div>
        <div className="template-description">{displayTemplate.description || ui('未填写人员库描述')}</div>
        <div className="template-description template-meta">{templateMetaText(displayTemplate, language)}</div>
        <div className="template-description">{ui(`默认模型：${templateModelLabel(template, store)}${siteSuffix}`)}</div>
      </div>
      <div className="template-card-actions">
        {template.type === 'builtin' ? (
          <button type="button" className="btn btn-ghost template-detail" onClick={event => { event.stopPropagation(); onDetail() }}>{ui('详情')}</button>
        ) : (
          <button type="button" className="btn btn-ghost template-edit" onClick={event => { event.stopPropagation(); onEdit() }}>{ui('编辑')}</button>
        )}
        {template.type !== 'builtin' && !used && (
          <button type="button" className="btn btn-danger template-delete" onClick={event => { event.stopPropagation(); onDelete() }}>{ui('删除')}</button>
        )}
      </div>
    </section>
  )
}
