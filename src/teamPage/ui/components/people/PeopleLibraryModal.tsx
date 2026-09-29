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
import { AppModal } from '../common/AppModal'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { CategoryFilter, EmptyState, TypeTabs } from './primitives'

/*
 * 人员库弹窗（原 peopleLibraryView 主体 React 化，P4；W1 起外壳换 Radix
 * Dialog——#people-library-modal id 移到 DialogContent，Escape/遮罩点击
 * 关闭经 onOpenChange 走 close；删除确认 AlertDialog 移出 Dialog 成为
 * fragment 兄弟。**S4 起外壳改由公共组合壳 `common/AppModal` 承担**：
 * id / aria-labelledby / 宽度类 / bg-popover / 自绘 × 全部移交 AppModal
 * （本文件不再出现 DialogContent），定高用 height="fixed"。内容区样式
 * 从 legacy 翻成 utilities，同 commit 退役了对应规则）。
 * 内部 id 逐字保留。与原实现的对译关系：
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
      <AppModal
        open={open}
        onOpenChange={next => { if (!next) close() }}
        size="md"
        height="fixed"
        contentId="people-library-modal"
        titleId="people-library-title"
        title={ui('人员库')}
        description={ui('维护可复用人员人设；加入群聊后会复制为独立人员。')}
        headerActions={(
          <Button id="new-template" type="button" size="sm" onClick={() => {
            const state = getAppState()
            state.selectedTemplateId = undefined
            notifyAppState()
            services.uiBus.emit('open-person-template-edit')
          }}>{ui('新建')}</Button>
        )}
        closeId="close-people-library"
        closeLabel={ui('关闭人员库')}
        onClose={close}
        // 两半都承重：p-6 补回壳用 p-0 收掉的原语基类内边距（本弹窗自身
        // 不带任何 padding，jsdom 不算布局、漏了单测抓不到）；overflow-hidden
        // 抵掉 height="fixed" 给内容行加的 overflow-auto，保证整壳唯一的
        // 滚动容器是下面的 #people-library-list（否则两层滚动容器，
        // 「列表区可滚动」的断言会失准）
        bodyClassName="overflow-hidden p-6"
      >
        {/* 工具行 / 列表 / 分页的 4 行栅格（原 .people-library-pane 对译）：
            头部与工具行不动，minmax(0,1fr) 那一行自己滚 */}
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
          <div className="section-title mt-1.5 mb-3 flex items-center justify-between gap-2.5">
            <h3>{ui('人员列表')}</h3>
            <span id="people-library-summary" className="tiny text-[12px] text-muted-foreground/72">{ui(`${view.templates.length} 人`)}</span>
          </div>
          <div className="grid gap-2.5 mb-3">
            <Input
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
          {/* S7/T4：.template-list 规则退役，grid/gap/content-start 由 utilities 承担 */}
          <div id="people-library-list" className="template-list grid content-start gap-2 min-h-0 overflow-auto pr-0.5">
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
          {/* empty:hidden 承接原 `.pagination-bar:empty{display:none}`：这个
              div 恒渲染，只有子节点条件渲染（pageCount > 1），不加就会在
              单页时凭空多出 42px 空白 */}
          <div id="people-library-pagination" className="pagination-bar empty:hidden flex items-center justify-center gap-2.5 min-h-[42px] pt-3">
            {view.pageCount > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pagination-btn"
                  disabled={view.currentPage === 0}
                  onClick={() => setPage(Math.max(0, view.currentPage - 1))}
                >{ui('上一页')}</Button>
                <span className="pagination-label min-w-[54px] text-center text-xs font-[760] text-muted-foreground">{view.currentPage + 1} / {view.pageCount}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="pagination-btn"
                  disabled={view.currentPage >= view.pageCount - 1}
                  onClick={() => setPage(Math.min(view.pageCount - 1, view.currentPage + 1))}
                >{ui('下一页')}</Button>
              </>
            )}
          </div>
        </div>
      </AppModal>

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
    <Card className="template-card gap-1.5 rounded-lg border-border bg-card p-3 text-left">
      {/* px-0 抵消 CardHeader 基类的 px-6：卡片自身 p-3（12px），而 CardContent 走 px-0，
          两侧基准必须一致，否则标题/按钮比下半部元信息多缩进 24px（用户报的「文字错位」） */}
      <CardHeader className="gap-1 px-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium leading-tight">
          <span className="role-name truncate font-medium">{displayTemplate.name}</span>
          {/* 原 .template-type-badge（min-height:20px / border-radius:999px /
              padding:0 7px / font-size:11px / font-weight:820 / line-height:1）
              换 Badge variant="outline"，差异走 className 由 twMerge 覆盖；
              圆角 999px 由 Badge 基类的 rounded-full 承担。
              两类色（原 .template-type-builtin / -custom 的暗色 rgba 与
              浅色覆盖对）换语义 token：内置偏强、自定义偏弱。
              `template-type-${type}` 拼接类名保留（探针钩子） */}
          <Badge
            variant="outline"
            className={`template-type-badge template-type-${template.type} min-h-5 rounded-full px-[7px] py-0 text-[11px] leading-none font-[820] ${template.type === 'builtin' ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground'}`}
          >{ui(template.type === 'builtin' ? '内置' : '自定义')}</Badge>
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">{displayTemplate.description || ui('未填写人员库描述')}</CardDescription>
        {/* CardAction 是普通 div（无 flex/gap），相邻按钮会贴死 */}
        <CardAction className="flex items-center gap-1">
          {template.type === 'builtin' ? (
            <Button type="button" variant="ghost" size="sm" className="template-detail" onClick={event => { event.stopPropagation(); onDetail() }}>{ui('详情')}</Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="template-edit" onClick={event => { event.stopPropagation(); onEdit() }}>{ui('编辑')}</Button>
          )}
          {template.type !== 'builtin' && !used && (
            <Button type="button" variant="destructive" size="sm" className="template-delete" onClick={event => { event.stopPropagation(); onDelete() }}>{ui('删除')}</Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1 px-0 text-xs text-muted-foreground">
        <div>{templateMetaText(displayTemplate, language)}</div>
        <div>{ui(`默认模型：${templateModelLabel(template, store)}${siteSuffix}`)}</div>
      </CardContent>
    </Card>
  )
}
