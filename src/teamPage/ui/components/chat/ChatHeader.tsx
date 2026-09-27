import { AtSign, MoreHorizontal, PanelLeft, RotateCcw, StickyNote, Users, Workflow } from 'lucide-react'
import type { GroupChat, GroupRole, RoomMode } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import type { TeamPageState } from '../../../appState'
import { useServices } from '../../context/ServicesContext'
import { useAppSizeTier } from '../../hooks/useAppShellChrome'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, notifyAppState } from '../../lib/appStore'
import { showError } from '../../lib/toast'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Separator } from '../ui/separator'
import { useSidebar } from '../ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'

/*
 * 聊天头 v2（S1 壳层，shadcn 化）。全部工具钮图标化（aria-label/Tooltip
 * 提供无障碍名），状态由 status-pill span 改为 Badge（outline + data-status），
 * 主题分段控件（HeaderStaticControls/#theme-switch）已退役——主题入口自
 * P4e 起在设置菜单。
 * 档位收纳规则（useAppSizeTier 读 #app[data-app-size]）：
 * - wide：恢复会话 / 编排（协作模式）/ 免@（协作模式）/ 成员 / 笔记 全部平铺；
 * - medium：恢复会话 / 编排 / 免@ 收进「更多操作」菜单（笔记保留）；
 * - compact：上述之外笔记也收进菜单，并新增唤出侧栏钮（PanelLeft，走
 *   sidebar 原语官方 API useSidebar().toggleSidebar()——视口感知：<768 视口
 *   切 Sheet 分支消费 openMobile，桌面走受控 open 经 AppShellFrame 写回
 *   userOpen 偏好。不直接写 useSidebarPrefs：真小视口下 Sheet 分支根本
 *   不消费该偏好，只会被静默持久化（R2-a））。
 * 「更多操作」菜单只收纳当档缺失的钮，收起项与平铺项永不重复。
 * 既有行为函数 restoreChat / toggleManualMention / toggleNotesPanel /
 * togglePeopleDrawer 与编排骨手（services.uiBus 'open-orchestration'）
 * 原样保留；免@ 双写 aria-pressed 改为 role="switch" + aria-checked。
 */
export function ChatHeader() {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const services = useServices()

  const ui = (source: string) => translateUi(source, language)

  const chatName = useStoreSelector(state => currentChatOf(state)?.name)
  const chatMode = useStoreSelector(state => currentChatOf(state)?.mode)
  const chatStatus = useStoreSelector(state => currentChatOf(state)?.status)
  const requireManualMention = useStoreSelector(state => currentChatOf(state)?.requireManualMention)
  const roleCount = useStoreSelector(roleCountOf)
  const messageCount = useStoreSelector(messageCountOf)
  const drawerOpen = useStoreSelector(state => state.peopleDrawerOpen)
  const chatId = useStoreSelector(state => state.selectedChatId)
  const notesPanelOpen = useStoreSelector(state => state.notesPanelOpen)

  const tier = useAppSizeTier()
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const sidebarOpen = isMobile ? openMobile : open
  const showTool = tier === 'wide' // 恢复会话 / 编排 / 免@
  const showPanel = tier !== 'compact' // 笔记

  const manualMentionOn = requireManualMention === false
  const mentionRuleHint = ui('开启后，普通消息也会触发所有成员回复；关闭后，只有 @ 成员或 @所有人才触发回复')

  function toggleManualMention(): void {
    if (!chatId) return
    services.runCommand('GROUP_CHAT_UPDATE', { chatId, requireManualMention: manualMentionOn ? true : false })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function toggleNotesPanel(): void {
    const state = getAppState()
    // 有群聊时打开面板回默认 chat 范围（原 notesView.selectDefaultOpenScope）
    if (!state.notesPanelOpen && state.selectedChatId && state.store.chatsById[state.selectedChatId]) state.activeNoteScope = 'chat'
    state.notesPanelOpen = !state.notesPanelOpen
    notifyAppState()
  }

  function togglePeopleDrawer(): void {
    const state = getAppState()
    state.peopleDrawerOpen = !state.peopleDrawerOpen
    notifyAppState()
  }

  // 原teamUiController #restore-chat：重摆全部站点人员 iframe，未分配到
  // 窗口的走 GROUP_ROLE_RECOVER 补救（API 成员不参与）
  function restoreChat(): void {
    const state = getAppState()
    const chat = state.selectedChatId ? state.store.chatsById[state.selectedChatId] : undefined
    if (!chat) return
    const roles = chat.roleIds
      .map(roleId => state.store.rolesById[roleId])
      .filter((role): role is GroupRole => Boolean(role) && role.modelSource !== 'external')
    services.log.info('ui:restore-chat', { chatId: chat.id, roleIds: roles.map(role => role.id) })
    const restoredFrames = services.iframeHost.restoreChat({ ...chat, roleIds: roles.map(role => role.id) }, roles)
    const assignedRoleIds = new Set(restoredFrames.filter(frame => frame.status === 'assigned').map(frame => frame.roleId))
    const rolesToRecover = roles.filter(role => !assignedRoleIds.has(role.id))
    Promise.all(rolesToRecover.map(role => services.runCommand('GROUP_ROLE_RECOVER', { chatId: chat.id, roleId: role.id })))
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* compact 档右侧让出窗控圆点带（floating-toolbar absolute right:18px +
          3×11px 圆点 ≈ 63px；78px 让位留 ~15px 间距，圆点几何零改动，R2-b） */}
      <header className={`flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-4${tier === 'compact' ? ' pr-[78px]' : ''}`}>
        {tier === 'compact' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
                aria-expanded={sidebarOpen}
                aria-label={ui(sidebarOpen ? '收起侧栏' : '打开侧栏')}
                onClick={toggleSidebar}
              >
                <PanelLeft className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ui('群聊列表')}</TooltipContent>
          </Tooltip>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 id="chat-title" className="truncate text-sm font-semibold tracking-tight">{chatName !== undefined ? chatName : ui('未选择群聊')}</h2>
            {chatStatus !== undefined && (
              <Badge variant="outline" data-status={chatStatus} className="text-muted-foreground">{ui(chatStatusLabel(chatStatus))}</Badge>
            )}
          </div>
          <p id="chat-subtitle" className="truncate text-xs text-muted-foreground">
            {chatMode !== undefined
              ? (roleCount ? ui(`${modeLabel(chatMode)} · ${roleCount} 位成员 · ${messageCount} 条消息`) : ui('暂无成员'))
              : ui('创建或选择一个群聊开始协作')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showTool && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button id="restore-chat" variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={ui('恢复会话')} onClick={restoreChat}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ui('恢复会话')}</TooltipContent>
            </Tooltip>
          )}
          {showTool && chatMode === 'collaborative' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button id="open-orchestration" variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={ui('编排')} onClick={() => services.uiBus.emit('open-orchestration')}>
                  <Workflow className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ui('编排')}</TooltipContent>
            </Tooltip>
          )}
          {showTool && chatMode === 'collaborative' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={manualMentionOn ? 'size-8 bg-accent text-accent-foreground' : 'size-8 text-muted-foreground'}
                  type="button"
                  role="switch"
                  aria-checked={manualMentionOn}
                  aria-label={mentionRuleHint}
                  title={mentionRuleHint}
                  onClick={toggleManualMention}
                >
                  <AtSign className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ui('免@')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                id="toggle-people-drawer"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                disabled={chatMode === undefined}
                aria-label={ui(drawerOpen ? '收起成员面板' : '打开成员面板')}
                aria-expanded={drawerOpen}
                onClick={togglePeopleDrawer}
              >
                <Users className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{ui('成员')}</TooltipContent>
          </Tooltip>
          {showPanel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  id="toggle-notes-panel"
                  variant="ghost"
                  size="icon"
                  className={notesPanelOpen ? 'size-8 bg-accent text-accent-foreground' : 'size-8 text-muted-foreground'}
                  aria-expanded={notesPanelOpen}
                  aria-controls="notes-panel"
                  aria-label={ui('笔记')}
                  onClick={toggleNotesPanel}
                >
                  <StickyNote className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{ui('笔记')}</TooltipContent>
            </Tooltip>
          )}
          {/* 菜单只在该档确有收纳项时渲染（wide 档 showTool && showPanel 全平铺，
              触发钮 + 分隔线一并隐藏——零项空菜单，R3-2） */}
          {!(showTool && showPanel) && (
            <>
              <Separator orientation="vertical" className="mx-1 !h-5" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={ui('更多操作')}>
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!showTool && <DropdownMenuItem onSelect={restoreChat}>{ui('恢复会话')}</DropdownMenuItem>}
                  {!showTool && chatMode === 'collaborative' && <DropdownMenuItem onSelect={() => services.uiBus.emit('open-orchestration')}>{ui('编排')}</DropdownMenuItem>}
                  {!showTool && chatMode === 'collaborative' && (
                    <DropdownMenuCheckboxItem checked={manualMentionOn} onCheckedChange={toggleManualMention} onSelect={event => event.preventDefault()}>{ui('免@')}</DropdownMenuCheckboxItem>
                  )}
                  {!showPanel && <DropdownMenuItem onClick={toggleNotesPanel}>{ui('笔记')}</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </header>
    </TooltipProvider>
  )
}

function currentChatOf(state: TeamPageState): GroupChat | undefined {
  return state.selectedChatId ? state.store.chatsById[state.selectedChatId] : undefined
}

function roleCountOf(state: TeamPageState): number {
  const chat = currentChatOf(state)
  if (!chat) return 0
  return chat.roleIds.filter(roleId => Boolean(state.store.rolesById[roleId])).length
}

function messageCountOf(state: TeamPageState): number {
  const chat = currentChatOf(state)
  if (!chat) return 0
  return chat.messageIds.filter(messageId => Boolean(state.store.messagesById[messageId])).length
}

export function modeLabel(mode: RoomMode): string {
  return mode === 'collaborative' ? '协作群聊模式' : '独立专家模式'
}

export function chatStatusLabel(status: GroupChat['status']): string {
  const labels: Record<GroupChat['status'], string> = {
    draft: '草稿',
    initializing: '初始化中',
    ready: '进行中',
    running: '运行中',
    error: '异常',
  }
  return labels[status]
}
