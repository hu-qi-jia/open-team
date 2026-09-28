import { useEffect, useMemo, useRef, useState } from 'react'
import type { GroupMessage, GroupRole, MessageHighlight, OpenTeamStore, OrchestrationReviewResult } from '../../../../group/types'
import { MessageSquare, Users } from 'lucide-react'
import { Button } from '../ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'
import { ScrollArea } from '../ui/scroll-area'
import { roleMentionLabelOptionsFromSettings } from '../../../../group/mentionParser'
import {
  THINKING_TIMEOUT_MS,
  buildChatRenderItems,
  getChatStartupNotice,
  getStoppedReplyRoles,
  getVisibleThinkingRoles,
} from '../../../chatExperience'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import { useServices } from '../../context/ServicesContext'
import { useAutoScroll } from '../../hooks/useAutoScroll'
import { useMarkMenu } from '../../hooks/useMarkMenu'
import { showError } from '../../lib/toast'
import { computeMessageSignature } from '../../lib/messageSignature'
import { collectActiveImageIds } from '../../lib/imageObjectUrls'
import { imageCache } from './ImageGrid'
import { MarkMenu } from './MarkMenu'
import { MessageItem } from './MessageItem'
import { ReplyControlBubble } from './ReplyControlBubble'
import { OrchestrationStatusCard } from '../orchestration/OrchestrationStatusCard'

interface TimeDividerEntry {
  kind: 'time'
  id: string
  label: string
}

interface MessageBubbleEntry {
  kind: 'message'
  message: GroupMessage
  showName: boolean
  showAvatar: boolean
  role: GroupRole | undefined
  reviewResult: OrchestrationReviewResult | undefined
  highlights: MessageHighlight[] | undefined
  signature: string
  mentionedRoles: GroupRole[]
}

type MessageListEntry = TimeDividerEntry | MessageBubbleEntry

/*
 * 消息流容器（原 messagesView.renderMessages 对译）。
 * 数据派生只在 store 版本变化时进行（useMemo），条目签名在这里一次算好
 * 传给 MessageItem；thinking 占位与超时定时器保持原节奏：可见性是时间
 * 函数，超时后由定时器触发一次重渲重新求值（原 deps.render 同义）。
 * 组件订阅的只有版本号与 selectedChatId，派生数组的新引用不影响
 * MessageItem 的签名 memo。
 */
export function Messages() {
  const services = useServices()
  const version = useStoreSelector(getAppStateVersion)
  const selectedChatId = useStoreSelector(state => state.selectedChatId)
  // 贴底跟随与划词菜单共用的滚动容器 ref：指向 ScrollArea 的 Viewport
  // （真实滚动元素），ref 在 commit 阶段先于 layout effect 挂好，挂载帧
  // 的贴底判定因此照常触发。useAutoScroll / useMarkMenu 的签名不变。
  const scrollRef = useRef<HTMLDivElement>(null)
  const [thinkingTick, setThinkingTick] = useState(0)
  const thinkingTimeoutsRef = useRef<number[]>([])
  const loggedThinkingTimeoutRoleIdsRef = useRef(new Set<string>())

  const view = useMemo(() => {
    const state = getAppState()
    const store = state.store
    const chat = state.selectedChatId ? store.chatsById[state.selectedChatId] : undefined
    const roles = chat
      ? chat.roleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
      : []
    const messages = chat
      ? chat.messageIds.map(messageId => store.messagesById[messageId]).filter((message): message is GroupMessage => Boolean(message))
      : []
    const entries: MessageListEntry[] = buildChatRenderItems(messages, roles).map(item => {
      if (item.type === 'time') return { kind: 'time', id: item.id, label: item.label }
      const message = item.message
      const role = roleForMessage(store, message)
      const reviewResult = findReviewResultForMessage(store, message)
      const highlights = store.messageHighlightsById?.[message.id]
      return {
        kind: 'message',
        message,
        showName: item.showName,
        showAvatar: item.showAvatar,
        role,
        reviewResult,
        highlights,
        signature: computeMessageSignature({
          message,
          showName: item.showName,
          showAvatar: item.showAvatar,
          role,
          reviewResult,
          highlights,
        }),
        mentionedRoles: (message.mentionedRoleIds ?? [])
          .map(roleId => store.rolesById[roleId])
          .filter((mentionedRole): mentionedRole is GroupRole => Boolean(mentionedRole)),
      }
    })
    return { chat, roles, messages, entries }
  }, [version, selectedChatId])

  const mentionLabelOptions = roleMentionLabelOptionsFromSettings(getAppState().store.settings)

  const streamingRoleIds = new Set(view.messages
    .filter(message => message.type === 'assistant' && message.status === 'pending' && message.roleId)
    .map(message => message.roleId!))
  // thinking 可见性按当前时刻求值（原实现每次渲染重取 Date.now()）；
  // thinkingTick 只是让超时定时器到点后能触发一次重渲
  void thinkingTick
  const thinkingRoles = getVisibleThinkingRoles(view.roles).filter(role => !streamingRoleIds.has(role.id))
  const stoppedRoles = getStoppedReplyRoles(view.roles)

  // 列表刷新时释放不再被引用的图片 objectURL（原 releaseUnusedImageUrls）
  useEffect(() => {
    imageCache.releaseUnused(collectActiveImageIds(view.messages))
  })

  // thinking 超时定时器（原 scheduleThinkingTimeouts 对译）
  useEffect(() => {
    for (const timer of thinkingTimeoutsRef.current) window.clearTimeout(timer)
    thinkingTimeoutsRef.current = []
    const now = Date.now()
    for (const role of view.roles) {
      if (role.status !== 'thinking') continue
      const remaining = THINKING_TIMEOUT_MS - (now - role.updatedAt)
      if (remaining <= 0) {
        if (!loggedThinkingTimeoutRoleIdsRef.current.has(role.id)) {
          loggedThinkingTimeoutRoleIdsRef.current.add(role.id)
          services.log.warn('ui:thinking-bubble:timeout', { chatId: role.chatId, roleId: role.id, timeoutMs: THINKING_TIMEOUT_MS })
        }
        continue
      }
      loggedThinkingTimeoutRoleIdsRef.current.delete(role.id)
      thinkingTimeoutsRef.current.push(window.setTimeout(() => setThinkingTick(tick => tick + 1), remaining + 1))
    }
    return () => {
      for (const timer of thinkingTimeoutsRef.current) window.clearTimeout(timer)
    }
  })

  const markMenuController = useMarkMenu({
    containerRef: scrollRef,
    resolveMessage: messageId => getAppState().store.messagesById[messageId],
    onHighlight: mark => {
      services.runCommand('GROUP_MESSAGE_HIGHLIGHT_CREATE', {
        chatId: mark.message.chatId,
        messageId: mark.message.id,
        text: mark.text,
        startOffset: mark.startOffset,
        endOffset: mark.endOffset,
        color: mark.color,
      }).catch(error => showError(error instanceof Error ? error.message : String(error)))
    },
    onInsertIntoNote: text => services.messageActions.insertTextIntoActiveNote(text),
  })

  // shouldPreserve 每轮渲染取最新值 → 滚动决策在每次提交后重跑（原实现
  // 每次 renderMessages 都重新判定贴底/保留）
  useAutoScroll(scrollRef, version, () => Boolean(getAppState().preserveNextMessageScroll))

  // 空态与群聊态共用同一棵 section/ScrollArea 树（S2 Task 8 验收发现）：
  // 原实现两个 return 分支的 ScrollArea 位置/类型不同，store 异步到达时
  // React 会卸载重建 Viewport；而 useMarkMenu 的 effect deps 是
  // [containerRef, hide]（不含元素）——监听器会留在已卸载的旧 viewport 上，
  // container.contains(body) 恒 false，划选菜单整个会话不再出现。
  // 保持元素恒等（条件位留 false 占位）后 ref 始终指向活的 Viewport。
  const chat = view.chat
  const startupNotice = chat && view.messages.length === 0 ? getChatStartupNotice(chat, view.roles) : undefined

  return (
    <section id="messages" className="messages flex h-full min-h-0 flex-col" aria-live="polite">
      {/* S6 表面，位置保持：状态卡在滚动列之外，不做列容器内的 720px 约束 */}
      {chat && <OrchestrationStatusCard />}
      <MessagesScrollArea viewportRef={scrollRef}>
        {/* 内容列（规格 D7）：720px 居中，水平 padding 由列承担；行内条目按
            Task 3 前的现状渲染（px-6 归 Task 4 移除）。 */}
        <div data-slot="messages-column" className="mx-auto flex w-full flex-1 flex-col px-4 max-w-[720px] pb-4">
          {!chat ? (
            <EmptyState title="选择一个群聊" body="左侧群聊列表会显示最近摘要、状态和更新时间。" />
          ) : (
            <>
              {view.messages.length === 0 && (view.roles.length === 0 ? (
                <EmptyState title="暂无人员" body="先添加人员，再开始群聊协作。" icon={<Users className="size-4" />}>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => services.uiBus.emit('open-add-person')}
                  >添加人员</Button>
                </EmptyState>
              ) : (
                <EmptyState
                  title={startupNotice?.title ?? '等待第一条消息'}
                  body={startupNotice?.body ?? '直接发送会记录消息；@ 人员或 @所有人 后触发回复。'}
                />
              ))}
              {view.entries.map(entry => entry.kind === 'time'
                ? <div key={entry.id} className="message-time-divider mx-auto my-3 w-fit rounded-full bg-muted/70 px-2.5 py-0.5 text-[11px] text-muted-foreground">{entry.label}</div>
                : (
                  <MessageItem
                    key={entry.message.id}
                    message={entry.message}
                    showName={entry.showName}
                    showAvatar={entry.showAvatar}
                    role={entry.role}
                    reviewResult={entry.reviewResult}
                    highlights={entry.highlights}
                    signature={entry.signature}
                    mentionedRoles={entry.mentionedRoles}
                    mentionLabelOptions={mentionLabelOptions}
                  />
                ))}
              {thinkingRoles.map(role => (
                <ReplyControlBubble
                  key={`thinking-${role.id}`}
                  role={role}
                  mentionLabelOptions={mentionLabelOptions}
                />
              ))}
              {stoppedRoles.map(role => (
                <ReplyControlBubble
                  key={`stopped-${role.id}`}
                  role={role}
                  mentionLabelOptions={mentionLabelOptions}
                />
              ))}
            </>
          )}
        </div>
      </MessagesScrollArea>
      <MarkMenu controller={markMenuController} />
    </section>
  )
}

/*
 * Messages 专用的 ScrollArea 装配：Radix Viewport 自带 display:table 的内容
 * 包裹层（inline style，普通类压不过），这里用 !important 变体把它转成
 * min-h-full 的 flex 列，列容器以 flex-1 撑满——空态才能借 Empty 的 flex-1
 * 垂直居中（jsdom 无布局，该几何由 Task 8 截图脚本锁定）。表格布局下
 * 百分比高度不可解析（实测 Chromium 空态顶置），不能依赖 min-h-full。
 */
function MessagesScrollArea({ children, viewportRef }: { children: React.ReactNode; viewportRef: React.Ref<HTMLDivElement> }) {
  return (
    <ScrollArea
      className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:flex! [&>[data-slot=scroll-area-viewport]>div]:flex-col [&>[data-slot=scroll-area-viewport]>div]:min-h-full"
      viewportRef={viewportRef}
    >
      {children}
    </ScrollArea>
  )
}

/* W3-3：空态换 Empty 原语（列容器为 flex 列且撑满 viewport 高度，Empty 的
 * flex-1 + justify-center 使内容垂直居中）；icon 可选，默认会话图标 */
function EmptyState({ title, body, children, icon }: { title: string; body: string; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <Empty className="mx-auto max-w-sm">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <MessageSquare className="size-4" />}</EmptyMedia>
        <EmptyTitle className="text-sm font-medium">{title}</EmptyTitle>
        <EmptyDescription className="text-xs">{body}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  )
}

function roleForMessage(store: OpenTeamStore, message: GroupMessage): GroupRole | undefined {
  if (!message.roleId) return undefined
  const role = store.rolesById[message.roleId]
  return role?.chatId === message.chatId ? role : undefined
}

function findReviewResultForMessage(store: OpenTeamStore, message: GroupMessage): OrchestrationReviewResult | undefined {
  if (!message.orchestrationRunId) return undefined
  const run = store.orchestrationRunsById[message.orchestrationRunId]
  for (const stageRun of run?.stageRuns ?? []) {
    const result = stageRun.reviewResults?.find(reviewResult => reviewResult.messageId === message.id)
    if (result) return result
  }
  return undefined
}
