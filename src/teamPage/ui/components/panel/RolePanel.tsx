import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { cn } from 'cn'
import { ArrowUpRight, FileText, LogIn, RotateCw, Trash2, Users } from 'lucide-react'
import type { GroupRole, RoleStatus } from '../../../../group/types'
import { getAllRoleTemplates } from '../../../../group/roleTemplates'
import { localizeRoleTemplate, normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import { showError } from '../../lib/toast'
import {
  roleConnectionStatusText,
  roleContextProgressText,
  roleMentionTitle,
  roleModelKey,
  roleModelOption,
  rolePatchForModelKey,
  roleStatusLabel,
  selectableModels,
} from '../../lib/rolePanelItems'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { AppModal } from '../common/AppModal'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet'

/*
 * 成员抽屉（原 rolePanelView 整体 React 化，P3；#add-role-form 提交于
 * P4a 收编为 uiBus 'open-add-person'）。S3 起由非模态 shadcn Sheet 承载
 * （portal 进 #app、forceMount 常挂载、收起靠 data-state 位移），根元素
 * 保留 .role-panel(+open) 作 E2E 钩子，内部 id（#role-summary / #role-list /
 * #role-template-select / #add-role-form / #open-gemini-login /
 * #close-people-drawer）全部保留。
 * 抽屉开合与 AI 登录按钮原由 vanilla（teamUiController）绑定，P4d 起自持：
 * - 「收起」翻转 appState.peopleDrawerOpen；抽屉打开时的外点关闭交给 Radix
 *   DismissableLayer（onInteractOutside）。站点菜单打开时抽屉不会被判「外点」：
 *   DropdownMenu 是模态层（react-menu 的 disableOutsidePointerEvents: context.open），
 *   抽屉层的 isPointerEventsEnabled 因此为 false，压根不处理外点
 *   （原 document 监听 + popper 白名单退役）
 * - ◇ 登录按钮经 services.openAiSiteLogin（chrome.tabs.create 留在
 *   装配层，组件树保持零 chrome 依赖）
 * #role-template-select 为遗留隐藏位，其值全工程无人读取，选项仅
 * 按 store 版本填充以保留 DOM 契约。
 * 与原实现的对译关系：
 * - 站点菜单 → DropdownMenu（受控单开；原 .role-site-menu 的 document
 *   关闭逻辑由 Radix 外点/Escape 接管，roleSiteMenuRoleId 状态删除）
 * - 删除确认 window.confirm → AlertDialog（已知视觉偏差，同 P2a 群列表）
 * - 提示词详情 → Dialog（原 .role-prompt-modal 手工挂 body 对译）；
 *   S4-T4 起换公共组合壳 common/AppModal（size="lg" + 自绘 ×），仍是
 *   SheetContent 的子树——抽屉是非模态层，叠层语义依赖这层嵌套
 * - 卡片选中 → state.selectedRoleId + notifyAppState
 * - 提及捷径：头像/名称点击与右键均插入 @（insertMention 经消息动作组）
 * 数据全部由 useStoreSelector 从 appStore 派生。
 */

/*
 * 卡片状态点色板（原 .status-pill::before 的 7px 圆点 + .status-* 文字色，
 * legacy 565-607 已退役）。legacy 侧颜色经 globals.css components 层重映射到
 * 语义 token，就近取 Tailwind 调色板（T5 的取色断言钉住这里的取值）：
 *   ready            → var(--success) → --chart-2：浅色 teal-600（oklch .6 .118 184.7），
 *                      深色 emerald-500（oklch .696 .17 162.48，精确等值）→ 取 emerald-500
 *   thinking/stopped/loading → var(--warning)：浅色 --chart-4 = amber-400，
 *                      深色 --chart-3 = amber-500（精确等值）→ 取 amber-500
 *   error            → var(--danger) → --destructive：浅色 red-600 / 深色 red-400 → 取 red-500
 *   pending          → legacy 无规则，取 .status-pill 的 var(--muted)
 *                      （深色 #a1a1aa = zinc-400，「待唤醒」中性色）→ zinc-400
 */
const STATUS_DOT_CLASS: Record<RoleStatus, string> = {
  pending: 'bg-zinc-400',
  loading: 'bg-amber-500',
  ready: 'bg-emerald-500',
  thinking: 'bg-amber-500',
  stopped: 'bg-amber-500',
  error: 'bg-red-500',
}

export function RolePanel() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const version = useStoreSelector(getAppStateVersion)
  const selectedChatId = useStoreSelector(state => state.selectedChatId)
  const peopleDrawerOpen = useStoreSelector(state => state.peopleDrawerOpen)
  const selectedRoleId = useStoreSelector(state => state.selectedRoleId)

  // Sheet 内容 portal 进 #app（而非 body）：成员抽屉要贴在浮窗右缘，且 #app 的
  // transform 是 absolute 的包含块（§7.1 树注释所说的坑）。#app 由 <App/> 在提交
  // 阶段才插入文档，RolePanel 首次渲染时它还不存在（惰性 initializer 会恒取到
  // null，portal 就永远落在 body）——只能在提交后取一次。
  // 单测环境（RTL 挂 body）没有 #app → 回落 Radix 默认的 document.body，
  // 否则 Portal 传 null 会什么也不渲染，既有断言会连带全红；
  // 「落在 #app 内」由浏览器验收的 s3-1 断言。
  const [appRoot, setAppRoot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setAppRoot(document.getElementById('app'))
  }, [])

  const [openSiteMenuRoleId, setOpenSiteMenuRoleId] = useState<string | undefined>(undefined)
  const [promptDetailRole, setPromptDetailRole] = useState<GroupRole | undefined>(undefined)
  const [deleteRole, setDeleteRole] = useState<GroupRole | undefined>(undefined)

  const view = useMemo(() => {
    const state = getAppState()
    const store = state.store
    const chat = state.selectedChatId ? store.chatsById[state.selectedChatId] : undefined
    const roles = chat
      ? chat.roleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
      : []
    return {
      store,
      chat,
      roles,
      selectedRole: state.selectedRoleId ? store.rolesById[state.selectedRoleId] : undefined,
    }
  }, [version, selectedChatId])

  const ui = (source: string) => translateUi(source, language)

  // 切群后未关闭的站点菜单不应跨群残留（原 chatSwitcher 清 roleSiteMenuRoleId 对译）
  useEffect(() => {
    setOpenSiteMenuRoleId(undefined)
  }, [selectedChatId])

  function openPeopleDrawer(): void {
    const state = getAppState()
    state.peopleDrawerOpen = true
    notifyAppState()
  }

  function closePeopleDrawer(): void {
    const state = getAppState()
    state.peopleDrawerOpen = false
    notifyAppState()
  }

  function selectRole(role: GroupRole): void {
    const state = getAppState()
    state.selectedRoleId = role.id
    setOpenSiteMenuRoleId(undefined)
    notifyAppState()
  }

  function insertMention(role: GroupRole): void {
    services.messageActions.insertMention(role)
  }

  function refreshRole(role: GroupRole): void {
    services.iframeHost.recoverRole(role)
    services.runCommand('GROUP_ROLE_RECOVER', { chatId: role.chatId, roleId: role.id })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function jumpToRoleFrame(role: GroupRole): void {
    services.messageActions.focusRoleFrame(role.chatId, role.id)
  }

  async function switchRoleSite(role: GroupRole, modelKey: string): Promise<void> {
    if (roleModelKey(role, getAppState().store) === modelKey) return
    try {
      await services.runCommand('GROUP_ROLE_UPDATE', { roleId: role.id, patch: rolePatchForModelKey(modelKey) })
      const updatedRole = getAppState().store.rolesById[role.id]
      if (!updatedRole) return
      if (updatedRole.modelSource === 'external') return
      services.iframeHost.recoverRole(updatedRole)
      await services.runCommand('GROUP_ROLE_RECOVER', { chatId: updatedRole.chatId, roleId: updatedRole.id })
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  function confirmDeleteRole(): void {
    if (!deleteRole) return
    services.runCommand('GROUP_ROLE_DELETE', { roleId: deleteRole.id })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
    setDeleteRole(undefined)
  }

  const summaryText = ui(`${view.roles.length} 人员${view.selectedRole ? ` · 当前：${view.selectedRole.name}` : ''}`)

  return (
    <Sheet
      open={peopleDrawerOpen}
      onOpenChange={next => (next ? openPeopleDrawer() : closePeopleDrawer())}
      modal={false}
    >
      {/* modal={false} 天然无遮罩（Radix 的 DialogOverlay 在非模态下 return null），
          不要加 showOverlay 之类的 prop */}
      <SheetContent
        side="right"
        showCloseButton={false}
        forceMount
        container={appRoot ?? undefined}
        // 现状打开抽屉不夺焦：Radix 默认会把焦点移进 content
        onOpenAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => {
          // 关闭态常驻挂载（forceMount）时不做外点处理（原 document 监听同款早退）
          if (!peopleDrawerOpen) return
          // 头部开合钮自己会 toggle；若 Radix 也当外部交互处理会双触发（关→再开）
          if ((event.target as HTMLElement | null)?.closest('#toggle-people-drawer')) {
            event.preventDefault()
            return
          }
          closePeopleDrawer()
        }}
        className={cn(
          // .role-panel(+open) 是既有 E2E/截图脚本与 s3-* 断言的选择器钩子，逐字保留
          'role-panel',
          // 官方 Content 是 fixed z-50 inset-y-0 right-0 w-3/4 sm:max-w-sm gap-4 p-6
          // transition …：全部走 className 交给 twMerge 去重（同组后者胜）
          'absolute inset-y-0 right-0 w-[340px] max-w-[calc(100%-54px)] sm:max-w-none',
          // 层次钉回 legacy 的 z-index:4：官方基类 z-50 会盖住浮窗铬件
          // （.floating-toolbar z-12 / .window-resize-handle z-8，改造前浮在抽屉之上）
          // ——规格 §9「行为不变」要求窗控钮与缩放把手始终可点，
          // 4 的语义即「在应用内容之上、在窗控与窗口把手之下」
          'z-4',
          'gap-0 p-0',
          // 官方 animate-in/out 在 forceMount 常挂载下首帧会播退场动画，且退场动画
          // fill 不保留终态 → 关掉动画，用 data-state 驱动的位移过渡（等价 legacy 0.18s）
          'transition-transform ease-out [animation:none]!',
          'data-[state=open]:duration-300 data-[state=closed]:duration-200',
          'data-[state=closed]:translate-x-full data-[state=closed]:pointer-events-none',
          peopleDrawerOpen ? 'open' : '',
        )}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-3.5">
          <div className="min-w-0">
            <SheetTitle className="truncate text-sm font-semibold tracking-tight">{ui('群聊成员与人员')}</SheetTitle>
            <SheetDescription id="role-summary" className="tiny mt-0.5 truncate text-xs text-muted-foreground">{summaryText}</SheetDescription>
          </div>
          {/* 原 renderRolePanelActions 将登录按钮包进 .role-panel-actions */}
          <div className="role-panel-actions">
            <Button
              id="open-gemini-login"
              variant="outline"
              size="icon-sm"
              className="text-muted-foreground"
              type="button"
              aria-label={ui('AI 站点登录')}
              onClick={() => services.openAiSiteLogin()}
            ><LogIn aria-hidden="true" /></Button>
          </div>
        </SheetHeader>
        {/* 原 .role-scroll 的 padding/overflow（legacy 14px 14px 22px）已翻成 utilities */}
        <div className="role-scroll relative min-h-0 overflow-auto px-3.5 pt-3.5 pb-[22px]">
          {/* S7/T5：原 .section-title 未被本行覆盖的活声明是 gap:10px 与
              margin: 6px 0 12px（display/align/justify 已由 utilities 承担）。 */}
          <div className="section-title mt-1.5 mb-3 flex items-center justify-between gap-2.5 px-4 pb-1.5 pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">{ui('当前群聊人员')}</h3>
            <Button
              id="close-people-drawer"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs text-muted-foreground"
              type="button"
              onClick={closePeopleDrawer}
            >{ui('收起')}</Button>
          </div>
          <div id="role-list" className="role-list grid gap-2 px-3 py-2">
            {!view.chat ? (
              <Empty className="my-2 p-4">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Users className="size-4" /></EmptyMedia>
                  <EmptyTitle className="text-sm font-medium">{ui('未选择群聊')}</EmptyTitle>
                  <EmptyDescription className="text-xs">{ui('选择群聊后可添加、查看、恢复和唤醒人员。')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : view.roles.length === 0 ? (
              <Empty className="my-2 p-4">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Users className="size-4" /></EmptyMedia>
                  <EmptyTitle className="text-sm font-medium">{ui('暂无人员')}</EmptyTitle>
                  <EmptyDescription className="text-xs">{ui('点击添加人员，可从人员库批量加入或临时添加。')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : view.roles.map(role => (
              <RoleCard
                key={role.id}
                role={role}
                store={view.store}
                active={role.id === selectedRoleId}
                language={language}
                ui={ui}
                siteMenuOpen={openSiteMenuRoleId === role.id}
                onSiteMenuOpenChange={open => setOpenSiteMenuRoleId(open ? role.id : undefined)}
                onSelect={() => selectRole(role)}
                onInsertMention={() => insertMention(role)}
                onRefresh={() => refreshRole(role)}
                onJump={() => jumpToRoleFrame(role)}
                onShowPromptDetail={() => setPromptDetailRole(role)}
                onRequestDelete={() => setDeleteRole(role)}
                onSwitchSite={modelKey => switchRoleSite(role, modelKey)}
              />
            ))}
          </div>

          <Card className="editor-card mx-3 mb-3 gap-0 rounded-lg border-border bg-card p-3">
            <form
              id="add-role-form"
              // grid gap-3 承接退役的 `.role-form`（display:grid; gap:12px）
              className="role-form mt-0 grid gap-3"
              onSubmit={event => {
                event.preventDefault()
                // 原 addRoleFormEl submit → openAddPersonDialog；弹窗本体在
                // <AddPersonModal/>（无当前群聊时由其自行忽略）
                services.uiBus.emit('open-add-person')
              }}
            >
              <h3 className="text-sm font-medium">{ui('添加人员')}</h3>
              <p className="tiny mt-0.5 text-xs text-muted-foreground">{ui('从人员库批量选择，或临时添加只属于当前群聊的人员。')}</p>
              {/* 遗留隐藏位：值无人读取，选项按 store 版本填充保留 DOM 契约 */}
              <select id="role-template-select" hidden>
                <option value="">{ui('不使用人员库，手动创建')}</option>
                {getAllRoleTemplates(view.store).map(template => (
                  <option key={template.id} value={template.id}>{localizeRoleTemplate(template, language).name}</option>
                ))}
              </select>
              <Button
                className="mt-2.5 w-full"
                size="sm"
                type="submit"
              >{ui('添加人员')}</Button>
            </form>
          </Card>
        </div>

        {/* 提示词详情（S4-T4 起换公共组合壳 AppModal，size="lg"）。
            **必须留在 SheetContent 的子树里**：抽屉是非模态层，弹窗的层级
            语义依赖这层 React 嵌套（Escape/外点只关最顶层），不能挪到
            SheetContent 外面。原实现靠 aria-describedby={undefined} 压 Radix
            警告，壳不传 description 时天然没有悬空引用（说明行照旧由 Radix
            给自动 id）。#role-prompt-detail-title 保留（单测与 p3 脚本在用）。 */}
        <AppModal
          open={promptDetailRole !== undefined}
          onOpenChange={open => { if (!open) setPromptDetailRole(undefined) }}
          size="lg"
          height="auto"
          titleId="role-prompt-detail-title"
          title={promptDetailRole?.name}
          description={promptDetailRole?.description || ui('未填写人员描述')}
          closeId="close-role-prompt-detail"
          closeLabel={ui('关闭提示词详情')}
          onClose={() => setPromptDetailRole(undefined)}
          // 正文内边距靠这里补回来（壳用 p-0 收掉了原语基类的 p-6）
          bodyClassName="p-6"
        >
          {/* 与内置详情同一份 .template-prompt-preview utilities（legacy 规则
              已退役）：whitespace-pre-wrap 与 leading-[1.65] 不能漏，否则
              <pre> 退回 UA 默认的 white-space:pre → 长提示词横向溢出 */}
          <pre className="template-prompt-preview max-h-[min(520px,calc(100vh-190px))] overflow-auto rounded-md border border-border bg-background p-3.5 font-mono text-xs leading-[1.65] whitespace-pre-wrap text-foreground">{promptDetailRole?.systemPrompt?.trim() || ui('未填写提示词')}</pre>
        </AppModal>

        <AlertDialog open={deleteRole !== undefined} onOpenChange={open => { if (!open) setDeleteRole(undefined) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{ui('删除成员')}</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteRole ? ui(`确定将「${deleteRole.name}」移出当前群聊吗？历史聊天记录会保留。`) : ''}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{ui('取消')}</AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteRole}>{ui('删除成员')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}

interface RoleCardProps {
  role: GroupRole
  store: ReturnType<typeof getAppState>['store']
  active: boolean
  language: ReturnType<typeof normalizeLanguage>
  ui: (source: string) => string
  siteMenuOpen: boolean
  onSiteMenuOpenChange(open: boolean): void
  onSelect(): void
  onInsertMention(): void
  onRefresh(): void
  onJump(): void
  onShowPromptDetail(): void
  onRequestDelete(): void
  onSwitchSite(modelKey: string): void
}

function RoleCard(props: RoleCardProps) {
  const { role, store, active, language, ui } = props
  const model = roleModelOption(role, store)
  const mentionTitle = roleMentionTitle(role, store)
  const mentionShortcutHandlers = {
    title: mentionTitle,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      props.onInsertMention()
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      props.onInsertMention()
    },
  }

  return (
    <Card
      className={cn(
        'role-card relative grid cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors',
        active ? 'active border-ring bg-accent/50' : 'border-border hover:bg-accent/30',
      )}
      onClick={props.onSelect}
    >
      <Avatar className="role-avatar size-10 rounded-md">
        {/* tone 类挂在 Fallback 上（同 MessageItem）：bg-none/bg-secondary 来自
            utilities 层，恒压 legacy 的 role-tone 渐变——与 ChatList 头像同为平涂 */}
        <AvatarFallback
          className={cn(
            'mention-shortcut select-none cursor-pointer rounded-md bg-none bg-secondary text-sm font-medium text-secondary-foreground hover:brightness-[1.08]',
            roleToneClass(role.name),
          )}
          {...mentionShortcutHandlers}
        >
          {roleAvatarLabel(role.name)}
        </AvatarFallback>
      </Avatar>
      <div className="role-card-main min-w-0">
        <div className="role-row flex min-w-0 items-center justify-between gap-2">
          {/* min-w-0 + flex-1 承接退役的 `.role-card .role-name`（flex:1 1 auto; min-width:0），
              长名才能在状态 Badge 前正确截断 */}
          <div className="role-name mention-shortcut min-w-0 flex-1 cursor-pointer truncate text-[13px] font-medium hover:brightness-[1.08]" {...mentionShortcutHandlers}>{role.name}</div>
          <Badge
            variant="outline"
            data-status={role.status}
            className="h-5 shrink-0 gap-1 px-2 text-[10px] text-muted-foreground"
          >
            <span className={cn('size-1.5 rounded-full', STATUS_DOT_CLASS[role.status])} aria-hidden="true" />
            {ui(roleStatusLabel(role.status))}
          </Badge>
        </div>
        <div className="role-description mt-0.5 line-clamp-2 text-xs text-muted-foreground">{role.description || ui('未填写人员描述')}</div>
        <div className="role-meta mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
          {/* S7/T5：原 .role-site-control 的 position:relative 与
              display:inline-flex 两条活声明在此 utilities 化（下拉菜单的
              定位锚点与行内排布都靠它）。 */}
          <div className="role-site-control relative inline-flex">
            <DropdownMenu open={props.siteMenuOpen} onOpenChange={props.onSiteMenuOpenChange}>
              <DropdownMenuTrigger
                className={`site-pill ${model.className} inline-flex h-6 cursor-pointer items-center rounded-md border border-border bg-none bg-muted px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`}
                aria-expanded={props.siteMenuOpen}
                onClick={event => event.stopPropagation()}
              >{model.label}</DropdownMenuTrigger>
              <DropdownMenuContent className="role-site-menu" onClick={event => event.stopPropagation()}>
                {selectableModels(store).map(option => {
                  const activeOption = roleModelKey(role, store) === option.key
                  return (
                    <DropdownMenuItem
                      key={option.key}
                      className={`role-site-option${activeOption ? ' active bg-accent/60' : ''}`}
                      onSelect={() => {
                        props.onSiteMenuOpenChange(false)
                        if (activeOption) return
                        props.onSwitchSite(option.key)
                      }}
                    >{activeOption ? `✓ ${option.label}` : option.label}</DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span className="role-meta-item truncate">{roleContextProgressText(role, ui)}</span>
          <span className="role-meta-item shrink-0">{roleConnectionStatusText(role, ui)}</span>
        </div>
        {/* S7/T5：同 MessageItem 的 ReferenceBox——下面那行的 mx-0/mb-0 已把
            margin 全压死，只剩 line-clamp-2 四件套与 opacity:.68。 */}
        {role.status === 'error' && (
          <div className="reference-box mx-0 mb-0 mt-1.5 line-clamp-2 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground opacity-[0.68]">{ui('人员异常。若目标站点未登录，请打开登录页后点击恢复人员。')}</div>
        )}
      </div>
      <div className="role-card-actions flex flex-col gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="role-prompt-detail cursor-pointer text-muted-foreground"
          data-role-prompt-detail={role.id}
          aria-label={language === 'en' ? `View ${role.name}'s prompt` : `查看 ${role.name} 的提示词`}
          title={ui('查看提示词')}
          onClick={event => {
            event.stopPropagation()
            props.onShowPromptDetail()
          }}
        ><FileText className="size-3.5" aria-hidden="true" /></Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="role-refresh cursor-pointer text-muted-foreground"
          data-role-refresh={role.id}
          aria-label={language === 'en' ? `Refresh ${role.name}'s member window` : `刷新 ${role.name} 的成员窗口`}
          title={role.modelSource === 'external' ? ui('API 成员无需刷新窗口') : ui('刷新成员窗口')}
          disabled={role.modelSource === 'external'}
          onClick={event => {
            event.stopPropagation()
            props.onRefresh()
          }}
        ><RotateCw className="size-3.5" aria-hidden="true" /></Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="role-jump cursor-pointer text-muted-foreground"
          aria-label={language === 'en' ? `Jump to ${role.name}'s source window` : `跳转到 ${role.name} 的原始窗口`}
          title={ui('跳转到原始窗口')}
          onClick={event => {
            event.stopPropagation()
            props.onJump()
          }}
        ><ArrowUpRight className="size-3.5" aria-hidden="true" /></Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          // ghost 变体自带 dark:hover:bg-accent/50，层序上恒压普通 hover 规则
          // （dist 实证：dark 变体块在 hover 块之后）→ 删除钮的红色 hover 需 !
          className="role-delete cursor-pointer text-muted-foreground hover:bg-destructive/10! hover:text-destructive"
          data-role-delete={role.id}
          aria-label={language === 'en' ? `Delete ${role.name}` : `删除 ${role.name}`}
          title={ui('删除成员')}
          onClick={event => {
            event.stopPropagation()
            props.onRequestDelete()
          }}
        ><Trash2 className="size-3.5" aria-hidden="true" /></Button>
      </div>
    </Card>
  )
}

// 成员卡的动作图标统一走 lucide（原为自绘 <svg> + 文本字形 ↻/↗ 混用，
// 字体度量与 svg 的视觉中心不同 → 同一列按钮的 icon 看起来对不齐）。
// PromptDetailIcon / TrashIcon 两个本文件私有组件已随之下线。
