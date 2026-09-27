import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupRole } from '../../../../group/types'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Button } from '../ui/button'

/*
 * 成员抽屉（原 rolePanelView 整体 React 化，P3；#add-role-form 提交于
 * P4a 收编为 uiBus 'open-add-person'）。aside.panel.role-panel 及内部 id
 * （#role-summary / #role-list / #role-template-select /
 * #add-role-form / #open-gemini-login / #close-people-drawer）全部保留。
 * 抽屉开合与 AI 登录按钮原由 vanilla（teamUiController）绑定，P4d 起自持：
 * - 「收起」翻转 appState.peopleDrawerOpen；抽屉打开时的 document 外点
 *   关闭逻辑原样保留（Radix 站点菜单的传送层不算「抽屉外」）
 * - ◇ 登录按钮经 services.openAiSiteLogin（chrome.tabs.create 留在
 *   装配层，组件树保持零 chrome 依赖）
 * #role-template-select 为遗留隐藏位，其值全工程无人读取，选项仅
 * 按 store 版本填充以保留 DOM 契约。
 * 与原实现的对译关系：
 * - 站点菜单 → DropdownMenu（受控单开；原 .role-site-menu 的 document
 *   关闭逻辑由 Radix 外点/Escape 接管，roleSiteMenuRoleId 状态删除）
 * - 删除确认 window.confirm → AlertDialog（已知视觉偏差，同 P2a 群列表）
 * - 提示词详情 → Dialog（原 .role-prompt-modal 手工挂 body 对译）
 * - 卡片选中 → state.selectedRoleId + notifyAppState
 * - 提及捷径：头像/名称点击与右键均插入 @（insertMention 经消息动作组）
 * 数据全部由 useStoreSelector 从 appStore 派生。
 */
export function RolePanel() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const version = useStoreSelector(getAppStateVersion)
  const selectedChatId = useStoreSelector(state => state.selectedChatId)
  const peopleDrawerOpen = useStoreSelector(state => state.peopleDrawerOpen)
  const selectedRoleId = useStoreSelector(state => state.selectedRoleId)
  const drawerRef = useRef<HTMLElement>(null)

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

  // 抽屉外点关闭（原 teamUiController document click 对译）：Radix 站点
  // 菜单（DropdownMenu）内容传送至 body，不算「抽屉外」
  useEffect(() => {
    function onDocumentClick(event: MouseEvent): void {
      const state = getAppState()
      if (!state.peopleDrawerOpen) return
      const target = event.target as Element | null
      if (!target) return
      if (drawerRef.current?.contains(target)) return
      if (document.getElementById('toggle-people-drawer')?.contains(target)) return
      if (target.closest('[data-radix-popper-content-wrapper]')) return
      state.peopleDrawerOpen = false
      notifyAppState()
    }
    document.addEventListener('click', onDocumentClick)
    return () => document.removeEventListener('click', onDocumentClick)
  }, [])

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
    <aside
      ref={drawerRef}
      className={`panel role-panel flex min-h-0 flex-col border-l border-border bg-popover shadow-2xl${peopleDrawerOpen ? ' open' : ''}`}
    >
      <div className="panel-header flex items-center justify-between gap-3 border-b border-border px-4 pb-3 pt-3.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">{ui('群聊成员与人员')}</h2>
          <p id="role-summary" className="tiny mt-0.5 truncate text-xs text-muted-foreground">{summaryText}</p>
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
          >◇</Button>
        </div>
      </div>
      <div className="role-scroll">
        <div className="section-title flex items-center justify-between px-4 pb-1.5 pt-3">
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
            <div className="empty-state px-1 py-4">
              <div className="empty-card rounded-lg border border-dashed border-border p-4 text-center">
                <h3 className="text-sm font-medium">{ui('未选择群聊')}</h3>
                <p className="muted mt-1 text-xs leading-relaxed text-muted-foreground">{ui('选择群聊后可添加、查看、恢复和唤醒人员。')}</p>
              </div>
            </div>
          ) : view.roles.length === 0 ? (
            <div className="empty-state px-1 py-4">
              <div className="empty-card rounded-lg border border-dashed border-border p-4 text-center">
                <h3 className="text-sm font-medium">{ui('暂无人员')}</h3>
                <p className="muted mt-1 text-xs leading-relaxed text-muted-foreground">{ui('点击添加人员，可从人员库批量加入或临时添加。')}</p>
              </div>
            </div>
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

        <form
          id="add-role-form"
          className="editor-card role-form mx-3 mb-3 rounded-lg border border-border bg-card p-3"
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
      </div>

      <Dialog open={promptDetailRole !== undefined} onOpenChange={open => { if (!open) setPromptDetailRole(undefined) }}>
        <DialogContent className="template-detail-modal" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle id="role-prompt-detail-title">{promptDetailRole?.name}</DialogTitle>
            <DialogDescription className="tiny">
              {promptDetailRole?.description || ui('未填写人员描述')}
            </DialogDescription>
          </DialogHeader>
          <pre className="template-prompt-preview">{promptDetailRole?.systemPrompt?.trim() || ui('未填写提示词')}</pre>
        </DialogContent>
      </Dialog>

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
    </aside>
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
    <section
      className={`role-card relative grid cursor-pointer grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors${active ? ' active border-ring bg-accent/50' : ' border-border hover:bg-accent/30'}`}
      onClick={props.onSelect}
    >
      <div
        className={`role-avatar ${roleToneClass(role.name)} mention-shortcut flex size-10 select-none items-center justify-center rounded-md bg-none bg-secondary text-sm font-medium text-secondary-foreground`}
        {...mentionShortcutHandlers}
      >
        {roleAvatarLabel(role.name)}
      </div>
      <div className="role-card-main min-w-0">
        <div className="role-row flex items-center gap-2">
          <div className="role-name mention-shortcut truncate text-[13px] font-medium" {...mentionShortcutHandlers}>{role.name}</div>
          <span className={`status-pill status-${role.status} inline-flex h-5 shrink-0 items-center rounded-full border border-border bg-none px-2 text-[10px] text-muted-foreground`}>{ui(roleStatusLabel(role.status))}</span>
        </div>
        <div className="role-description mt-0.5 line-clamp-2 text-xs text-muted-foreground">{role.description || ui('未填写人员描述')}</div>
        <div className="chat-row tiny role-meta mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <div className="role-site-control">
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
        {role.status === 'error' && (
          <div className="reference-box mt-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">{ui('人员异常。若目标站点未登录，请打开登录页后点击恢复人员。')}</div>
        )}
      </div>
      <div className="role-card-actions flex flex-col gap-0.5">
        <button
          type="button"
          className="role-prompt-detail flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          data-role-prompt-detail={role.id}
          aria-label={language === 'en' ? `View ${role.name}'s prompt` : `查看 ${role.name} 的提示词`}
          title={ui('查看提示词')}
          onClick={event => {
            event.stopPropagation()
            props.onShowPromptDetail()
          }}
        ><PromptDetailIcon /></button>
        <button
          type="button"
          className="role-refresh flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          data-role-refresh={role.id}
          aria-label={language === 'en' ? `Refresh ${role.name}'s member window` : `刷新 ${role.name} 的成员窗口`}
          title={role.modelSource === 'external' ? ui('API 成员无需刷新窗口') : ui('刷新成员窗口')}
          disabled={role.modelSource === 'external'}
          onClick={event => {
            event.stopPropagation()
            props.onRefresh()
          }}
        >↻</button>
        <button
          type="button"
          className="role-jump flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={language === 'en' ? `Jump to ${role.name}'s source window` : `跳转到 ${role.name} 的原始窗口`}
          title={ui('跳转到原始窗口')}
          onClick={event => {
            event.stopPropagation()
            props.onJump()
          }}
        >↗</button>
        <button
          type="button"
          className="role-delete flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          data-role-delete={role.id}
          aria-label={language === 'en' ? `Delete ${role.name}` : `删除 ${role.name}`}
          title={ui('删除成员')}
          onClick={event => {
            event.stopPropagation()
            props.onRequestDelete()
          }}
        ><TrashIcon /></button>
      </div>
    </section>
  )
}

function TrashIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="size-3.5" fill="currentColor">
      <path d="M9 4h6l1 2h4v2H4V6h4l1-2Zm-2 6h10l-.7 9.1A2 2 0 0 1 14.3 21H9.7a2 2 0 0 1-2-1.9L7 10Zm3 2v6h1.6v-6H10Zm2.4 0v6H14v-6h-1.6Z" />
    </svg>
  )
}

function PromptDetailIcon(): React.ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3.8h6.4L17 7.4V20H7V3.8Z" />
      <path d="M13.2 4v3.6h3.6" />
      <path d="M9.6 11h4.8" />
      <path d="M9.6 14h4.8" />
      <path d="M9.6 17h2.8" />
    </svg>
  )
}
