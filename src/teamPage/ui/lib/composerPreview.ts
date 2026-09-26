import {
  defaultMentionTargetForMessage,
  parseGroupMentions,
  roleMentionLabel,
  roleMentionLabelOptionsFromSettings,
} from '../../../group/mentionParser'
import type { GroupChat, GroupRole } from '../../../group/types'
import { getVisibleThinkingRoles, shouldAutoReconnectRole } from '../../chatExperience'

/*
 * 输入区预览的纯派生（原 composerView.renderComposerState 的 9 分支
 * 目标状态机对译）。输入区组件只负责把派生结果渲染出来；分支顺序、
 * 文案与禁用条件与原实现逐行对应（RTL 用例锁行为）。
 */

export type MentionLabelOptions = ReturnType<typeof roleMentionLabelOptionsFromSettings>

export interface ComposerPreviewInput {
  chat: GroupChat | undefined
  roles: GroupRole[]
  /** 输入框 trim 后的草稿 */
  raw: string
  /** appState.reconnectingRoleKeys（原样传入，key 为 `${chatId}:${roleId}`） */
  reconnectingKeys: ReadonlySet<string>
  mentionLabelOptions: MentionLabelOptions
}

export interface ComposerPreview {
  targetText: string
  sendDisabled: boolean
  busyText: string
}

export function deriveComposerPreview(input: ComposerPreviewInput): ComposerPreview {
  const { chat, roles, raw, reconnectingKeys, mentionLabelOptions } = input
  const roleDisplayName = (role: GroupRole): string => roleMentionLabel(role, mentionLabelOptions)

  const busyText = deriveBusyText(roles, mentionLabelOptions)

  if (!chat) return { targetText: '选择群聊后可发送', sendDisabled: true, busyText }
  if (roles.length === 0) return { targetText: '当前群聊还没有人员', sendDisabled: true, busyText }

  if (!raw) {
    return {
      targetText: defaultMentionTargetForMessage('', chat) === 'all'
        ? '输入消息；不 @ 会让所有成员回复，也可 @ 指定成员'
        : '输入消息；不 @ 仅记录，@ 人员触发回复',
      sendDisabled: true,
      busyText,
    }
  }

  const parsed = parseGroupMentions(raw || 'x', roles, {
    ...mentionLabelOptions,
    defaultTarget: defaultMentionTargetForMessage(raw, chat),
  })
  if (!parsed.ok) return { targetText: parsed.error, sendDisabled: true, busyText }

  const targets = roles.filter(role => parsed.targetRoleIds.includes(role.id))
  if (targets.length === 0) {
    return { targetText: '将作为群消息记录，不触发 AI；@ 人员可触发回复', sendDisabled: false, busyText }
  }

  const reconnecting = targets.filter(role => reconnectingKeys.has(teamRoleKey(role.chatId, role.id)))
  if (reconnecting.length > 0) {
    const readyTargets = targets.filter(role => !reconnecting.includes(role) && role.status === 'ready')
    return {
      targetText: readyTargets.length > 0
        ? `将发送给：${readyTargets.map(roleDisplayName).join('、')}；正在连接：${reconnecting.map(roleDisplayName).join('、')}`
        : `正在自动连接：${reconnecting.map(roleDisplayName).join('、')}`,
      sendDisabled: readyTargets.length === 0,
      busyText,
    }
  }

  const unavailable = targets.filter(role => role.status !== 'ready')
  if (unavailable.length > 0) {
    const waiting = unavailable.filter(role => !shouldAutoReconnectRole(role))
    const readyTargets = targets.filter(role => role.status === 'ready')
    if (waiting.length > 0 && readyTargets.length === 0) {
      return { targetText: `请稍等：${waiting.map(roleDisplayName).join('、')} 正在回复`, sendDisabled: true, busyText }
    }
    if (waiting.length > 0) {
      return {
        targetText: `将发送给：${readyTargets.map(roleDisplayName).join('、')}；跳过正在回复：${waiting.map(roleDisplayName).join('、')}`,
        sendDisabled: false,
        busyText,
      }
    }
    return { targetText: `将先自动连接：${unavailable.map(roleDisplayName).join('、')}`, sendDisabled: false, busyText }
  }

  return { targetText: `将发送给：${targets.map(roleDisplayName).join('、')}`, sendDisabled: false, busyText }
}

/** 正在回复提示（原 busyPreviewEl 写入逻辑）。 */
export function deriveBusyText(roles: GroupRole[], mentionLabelOptions: MentionLabelOptions): string {
  const thinking = getVisibleThinkingRoles(roles)
  return thinking.length > 0
    ? `正在回复：${thinking.map(role => roleMentionLabel(role, mentionLabelOptions)).join('、')}`
    : ''
}

export interface ResolveTargetsResult {
  ok: true
  roles: GroupRole[]
}

/** 发送前的目标解析（原 resolveMessageTargets 对译），失败带错误文案。 */
export function resolveMessageTargets(
  raw: string,
  roles: GroupRole[],
  chat: GroupChat,
  mentionLabelOptions: MentionLabelOptions,
): ResolveTargetsResult | { ok: false; error: string } {
  const parsed = parseGroupMentions(raw, roles, {
    ...mentionLabelOptions,
    defaultTarget: defaultMentionTargetForMessage(raw, chat),
  })
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return { ok: true, roles: roles.filter(role => parsed.targetRoleIds.includes(role.id)) }
}

export function teamRoleKey(chatId: string, roleId: string): string {
  return `${chatId}:${roleId}`
}
