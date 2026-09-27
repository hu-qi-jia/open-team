import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { formatChatExportMarkdown, safeChatExportFilename } from '../../../chatExport'
import { normalizeLanguage, translateUi, type TeamLanguage } from '../../../../shared/i18n'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState } from '../../lib/appStore'
import { showError } from '../../lib/toast'
import { deriveChatListItems, isChatListItemsEqual, type ChatListItemVM } from '../../lib/chatListItems'
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
import { Button } from '../ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'

/*
 * 群列表（原 chatListView.renderChatList 整体 React 化）：
 * - 数据经 deriveChatListItems selector + 逐项浅比较，store 跳变不误伤重渲染
 * - 切群 / 重命名 / 复制走 services.runCommand 与 services.switchChat
 * - 清空 / 删除的 window.confirm 升级为 AlertDialog（已知视觉偏差，按计划）
 * - 「关闭群聊」原样无确认；导出为纯客户端下载
 */
export function ChatList() {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const services = useServices()
  const items = useStoreSelector(deriveChatListItems, isChatListItemsEqual)
  const [confirmTarget, setConfirmTarget] = useState<{ kind: 'clear' | 'delete'; chat: ChatListItemVM } | undefined>(undefined)

  const ui = (source: string) => translateUi(source, language)

  function renameChat(chat: ChatListItemVM): void {
    const nextName = window.prompt(ui('编辑名称'), chat.name)?.trim()
    if (!nextName) return
    services.runCommand('GROUP_CHAT_UPDATE', { chatId: chat.id, patch: { name: nextName } })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function exportChatRecord(chat: ChatListItemVM): void {
    try {
      const store = getAppState().store
      const fullChat = store.chatsById[chat.id]
      if (!fullChat) return
      const exportedAt = new Date()
      const markdown = formatChatExportMarkdown(store, fullChat, exportedAt)
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = safeChatExportFilename(fullChat.name, exportedAt)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      showError(error instanceof Error ? error.message : '导出群聊记录失败')
    }
  }

  function closeChatFrames(chatId: string): void {
    services.runCommand('GROUP_CHAT_CLOSE', { chatId })
      .then(() => services.iframeHost.removeChat(chatId))
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function switchTo(chatId: string): void {
    services.switchChat(chatId)
  }

  function confirmSelection(): void {
    if (!confirmTarget) return
    const operation = confirmTarget.kind === 'clear'
      ? services.chatOperations.clearMessages(confirmTarget.chat.id)
      : services.chatOperations.deleteChat(confirmTarget.chat.id)
    operation.catch(error => showError(error instanceof Error ? error.message : String(error)))
    setConfirmTarget(undefined)
  }

  return (
    <div id="chat-list" className="chat-list min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1.5">
      {items.length === 0 ? (
        <Empty className="my-4 p-3">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MessageSquare className="size-4" /></EmptyMedia>
            <EmptyTitle className="text-sm font-medium">{ui('还没有群聊')}</EmptyTitle>
            <EmptyDescription className="text-xs">{ui('在上方创建一个群聊，然后从人员库添加人员。')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : items.map(chat => (
        <section
          key={chat.id}
          className={[
            'chat-item group relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-none px-2 py-2 text-left outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring',
            chat.active ? 'active bg-accent text-accent-foreground' : 'hover:bg-accent/60',
            chat.hasActivity ? 'has-activity' : '',
          ].join(' ')}
          tabIndex={0}
          role="button"
          aria-label={switchAriaLabel(language, chat.name)}
          onClick={() => switchTo(chat.id)}
          onKeyDown={event => {
            // 仅在条目本身聚焦时响应 Enter/空格；内部 ⋯ 按钮的键盘事件不冒泡触发切群
            if (event.target !== event.currentTarget) return
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            switchTo(chat.id)
          }}
        >
          <div className={`chat-avatar ${chat.tone} flex size-9 shrink-0 items-center justify-center rounded-md bg-none bg-secondary text-xs font-medium text-secondary-foreground`}>{chat.initial}</div>
          <div className="chat-item-body min-w-0 flex-1">
            <div className="chat-row chat-item-title">
              <button type="button" className="chat-name truncate text-sm font-medium leading-tight">{chat.name}</button>
            </div>
            <div className="summary-line truncate text-xs text-muted-foreground">{chat.summary}</div>
          </div>
          <div className="chat-item-side flex shrink-0 flex-col items-end gap-1">
            <span className="chat-time text-[11px] tabular-nums text-muted-foreground/80">{chat.timeText}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={menuAriaLabel(language, chat.name)}
                >⋯</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end">
                <DropdownMenuItem onSelect={() => renameChat(chat)}>{ui('编辑名称')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => {
                  services.runCommand('GROUP_CHAT_DUPLICATE', { chatId: chat.id })
                    .catch(error => showError(error instanceof Error ? error.message : String(error)))
                }}>{ui('复制群聊')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportChatRecord(chat)}>{ui('导出记录')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setConfirmTarget({ kind: 'clear', chat })}>{ui('清空消息')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => closeChatFrames(chat.id)}>{ui('关闭群聊')}</DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setConfirmTarget({ kind: 'delete', chat })}
                >{ui('删除群聊')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </section>
      ))}

      <AlertDialog open={confirmTarget !== undefined} onOpenChange={open => { if (!open) setConfirmTarget(undefined) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTarget?.kind === 'delete' ? ui('删除群聊') : ui('清空消息')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.kind === 'delete'
                ? ui(`确定删除「${confirmTarget.chat.name}」吗？删除后这个群聊的消息和角色都会移除。`)
                : ui(`确定清空「${confirmTarget?.chat.name}」的聊天消息吗？人员会保留，但所有 iframe 会重新创建。`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ui('取消')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSelection}>
              {confirmTarget?.kind === 'delete' ? ui('删除群聊') : ui('清空消息')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function switchAriaLabel(language: TeamLanguage, chatName: string): string {
  return language === 'en' ? `Switch to ${chatName}` : `切换到 ${chatName}`
}

function menuAriaLabel(language: TeamLanguage, chatName: string): string {
  return language === 'en' ? `Open chat menu for ${chatName}` : `打开 ${chatName} 的群聊菜单`
}
