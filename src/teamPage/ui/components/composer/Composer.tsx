import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GroupMessage, GroupRole } from '../../../../group/types'
import { roleMentionLabel, roleMentionLabelOptionsFromSettings } from '../../../../group/mentionParser'
import { shouldAutoReconnectRole, shouldConfirmMentionWithEnter, shouldSendMessageWithEnter } from '../../../chatExperience'
import { runCommandWithReconnect } from '../../../sendWithReconnect'
import { useServices } from '../../context/ServicesContext'
import { getAppState, getAppStateVersion, notifyAppState } from '../../lib/appStore'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { showError } from '../../lib/toast'
import { deriveComposerPreview, resolveMessageTargets } from '../../lib/composerPreview'
import { roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { Button } from '../ui/button'
import { MentionPicker, createMentionOptions } from './MentionPicker'

/*
 * 输入区（原 composerView 对译）。草稿是受控 state；目标预览 / 忙碌预览
 * / 发送禁用全部由 deriveComposerPreview 派生（9 分支状态机移入纯函数）。
 * @ 面板交互语义与原实现逐条对应：
 * - 光标前有未闭合的 @ 才显示（shouldShowMentionPanel）
 * - ↑↓ 循环、Enter 确认（IME 组合态不确认）、Escape 只隐藏到下次输入
 * - 发送成功清空草稿与引用，失败恢复草稿（clearComposerAfterSend /
 *   restoreComposerDraft 对译）
 * #composer / #target-preview / #busy-preview / #message-input /
 * #send-message / #reference-draft / #mention-panel 的 id 保持不变
 * （React 骨架 id 契约、legacy.css 选择器与 E2E 依赖）。
 */

const NOOP_COMPOSER_API: ComposerApi = {
  insertMention: () => undefined,
  setReference: () => undefined,
}

interface ComposerApi {
  insertMention(role: GroupRole): void
  setReference(message: GroupMessage): void
}

export function Composer() {
  const services = useServices()
  const t = useT()
  const version = useStoreSelector(getAppStateVersion)
  const selectedChatId = useStoreSelector(state => state.selectedChatId)

  const [draft, setDraft] = useState('')
  const draftRef = useRef('')
  const [cursor, setCursor] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const pendingSelectionRef = useRef<number | undefined>(undefined)

  const view = useMemo(() => {
    const state = getAppState()
    const store = state.store
    const chat = state.selectedChatId ? store.chatsById[state.selectedChatId] : undefined
    const roles = chat
      ? chat.roleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
      : []
    return {
      chat,
      roles,
      reference: state.selectedReference,
      reconnectingKeys: state.reconnectingRoleKeys,
      labelOptions: roleMentionLabelOptionsFromSettings(store.settings),
    }
  }, [version, selectedChatId])

  const mentionOptions = useMemo(() => createMentionOptions(view.roles), [view.roles])
  const activeMentionIndex = mentionOptions.length === 0
    ? 0
    : Math.min(Math.max(0, mentionIndex), mentionOptions.length - 1)
  const mentionGateOpen = shouldShowMentionPanel(draft, cursor)
  const panelVisible = view.roles.length > 0 && mentionGateOpen && !mentionDismissed

  const preview = useMemo(() => deriveComposerPreview({
    chat: view.chat,
    roles: view.roles,
    raw: draft.trim(),
    reconnectingKeys: view.reconnectingKeys,
    mentionLabelOptions: view.labelOptions,
  }), [view, draft])

  // 外部入口（消息流「引用回复」、成员卡「提及」）经 composerBridge 进入
  useEffect(() => {
    services.composerBridge.register({
      insertMention: role => insertMentionLabel(roleMentionLabel(role, roleMentionLabelOptionsFromSettings(getAppState().store.settings))),
      setReference: message => {
        getAppState().selectedReference = {
          messageId: message.id,
          roleId: message.roleId,
          roleName: message.roleName,
          contentSnapshot: message.content,
        }
        notifyAppState()
        textareaRef.current?.focus()
      },
    })
    return () => services.composerBridge.register(NOOP_COMPOSER_API)
  }, [services])

  // 插入提及后恢复光标（原 setSelectionRange + focus 对译）
  useLayoutEffect(() => {
    if (pendingSelectionRef.current === undefined) return
    const element = textareaRef.current
    const position = pendingSelectionRef.current
    pendingSelectionRef.current = undefined
    if (!element) return
    element.setSelectionRange(position, position)
    element.focus()
  }, [draft])

  function updateDraft(next: string): void {
    draftRef.current = next
    setDraft(next)
  }

  function syncCursor(): void {
    const element = textareaRef.current
    if (element) setCursor(element.selectionStart ?? 0)
  }

  function handleDraftChange(next: string): void {
    updateDraft(next)
    setMentionIndex(0)
    setMentionDismissed(false)
    syncCursor()
  }

  function insertMentionLabel(label: string): void {
    const element = textareaRef.current
    const value = element?.value ?? draftRef.current
    const cursorPosition = element?.selectionStart ?? value.length
    const beforeCursor = value.slice(0, cursorPosition)
    const atIndex = beforeCursor.lastIndexOf('@')
    const rawPrefix = atIndex >= 0 ? value.slice(0, atIndex) : value.slice(0, cursorPosition)
    const prefix = rawPrefix && !/\s$/.test(rawPrefix) ? `${rawPrefix} ` : rawPrefix
    const suffix = value.slice(cursorPosition)
    const inserted = `${prefix}@${label} ${suffix}`
    pendingSelectionRef.current = prefix.length + label.length + 2
    updateDraft(inserted)
    setMentionDismissed(true)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const element = textareaRef.current
    if (!element) return
    const canHandleMention = view.roles.length > 0 && (
      shouldShowMentionPanel(element.value, element.selectionStart ?? element.value.length) || panelVisible
    )
    if (canHandleMention) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionDismissed(false)
        setMentionIndex((activeMentionIndex + 1) % mentionOptions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionDismissed(false)
        setMentionIndex((activeMentionIndex - 1 + mentionOptions.length) % mentionOptions.length)
        return
      }
      if (shouldConfirmMentionWithEnter(event.nativeEvent)) {
        event.preventDefault()
        const option = mentionOptions[activeMentionIndex]
        if (option?.type === 'all') insertMentionLabel('所有人')
        if (option?.type === 'role') insertMentionLabel(roleMentionLabel(option.role, view.labelOptions))
        return
      }
      if (event.key === 'Escape') {
        setMentionDismissed(true)
        return
      }
      return
    }

    if (shouldSendMessageWithEnter(event.nativeEvent)) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  async function submitDraft(): Promise<void> {
    const chat = view.chat
    const raw = draftRef.current.trim()
    if (!chat || !raw) return

    const targetResult = resolveMessageTargets(raw, view.roles, chat, view.labelOptions)
    if (!targetResult.ok) {
      showError(targetResult.error)
      return
    }

    const waitingRoles = targetResult.roles.filter(role => role.status === 'thinking' && !shouldAutoReconnectRole(role))
    const readyRoles = targetResult.roles.filter(role => role.status === 'ready')
    if (waitingRoles.length > 0 && readyRoles.length === 0) {
      showError(`请等待人员回复完成：${waitingRoles.map(role => roleMentionLabel(role, view.labelOptions)).join('、')}`)
      return
    }

    const reference = getAppState().selectedReference
    // 先清空再发送，失败恢复草稿（原 clear/restoreComposerDraft 对译）
    if (draftRef.current.trim() === raw) updateDraft('')
    if (getAppState().selectedReference === reference) {
      getAppState().selectedReference = undefined
      notifyAppState()
    }
    try {
      await runCommandWithReconnect(services, {
        chat,
        roles: targetResult.roles,
        type: 'GROUP_MESSAGE_SEND',
        payload: { chatId: chat.id, raw, reference },
      })
    } catch (error) {
      if (!draftRef.current.trim()) updateDraft(raw)
      if (!getAppState().selectedReference) {
        getAppState().selectedReference = reference
        notifyAppState()
      }
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  function handleFormSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (preview.sendDisabled && getAppState().reconnectingRoleKeys.size > 0) return
    submitDraft()
  }

  return (
    <form id="composer" className="composer mx-6 mb-4 rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring/60" onSubmit={handleFormSubmit}>
      <div id="reference-draft" className="reference-draft mx-3 mt-2.5" hidden={!view.reference}>
        {view.reference && (
          <>
            <div className="reference-draft-preview truncate rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              {`引用 ${view.reference.roleName || '人员'}：${view.reference.contentSnapshot}`}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-1 shrink-0 text-muted-foreground"
              aria-label={t('取消引用')}
              onClick={() => {
                getAppState().selectedReference = undefined
                notifyAppState()
              }}
            >×</Button>
          </>
        )}
      </div>
      {panelVisible && (
        <MentionPicker
          options={mentionOptions}
          activeIndex={activeMentionIndex}
          labelOptions={view.labelOptions}
          roleToneClass={roleToneClass}
          roleAvatarLabel={roleAvatarLabel}
          onSelectOption={option => {
            if (option.type === 'all') insertMentionLabel('所有人')
            if (option.type === 'role') insertMentionLabel(roleMentionLabel(option.role, view.labelOptions))
          }}
        />
      )}
      <textarea
        id="message-input"
        ref={textareaRef}
        className="max-h-40 min-h-[54px] w-full resize-none border-0 bg-transparent px-3.5 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        placeholder="输入消息，@成员可指定回复；不 @ 仅记录到群聊。"
        value={draft}
        onChange={event => handleDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCursor}
        onClick={syncCursor}
      />
      <div className="composer-actions flex items-center justify-between gap-2 px-3.5 pb-3">
        <div className="min-w-0">
          <div id="target-preview" className="muted tiny truncate text-[11px] text-muted-foreground">{preview.targetText}</div>
          <div id="busy-preview" className="tiny truncate text-[11px] text-muted-foreground">{preview.busyText}</div>
        </div>
        <Button id="send-message" size="sm" type="submit" disabled={preview.sendDisabled}>发送</Button>
      </div>
    </form>
  )
}

/** 光标前的未闭合 @ 检测（原 shouldShowMentionPanel 对译）。 */
function shouldShowMentionPanel(value: string, cursor: number): boolean {
  const beforeCursor = value.slice(0, cursor)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return false
  const mentionText = beforeCursor.slice(atIndex + 1)
  return !/\s/.test(mentionText)
}
