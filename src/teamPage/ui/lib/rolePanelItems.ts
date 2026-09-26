import { roleMentionLabel, roleMentionLabelOptionsFromSettings } from '../../../group/mentionParser'
import type { ChatSite, ExternalModelConfig, GroupRole, OpenTeamStore, RoleModelSource, RoleStatus } from '../../../group/types'

/*
 * 成员抽屉的纯派生（原 rolePanelView 模块级工具函数对译）：
 * 站点/外部模型菜单项、角色当前模型、模型切换 patch、状态与连接文案。
 * 组件只负责渲染；文案与判定逻辑在此单测锁定。
 */

const VISIBLE_CHAT_SITES = ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok'] as const

export interface RoleModelOption {
  key: string
  label: string
  className: string
}

export function siteLabel(site: ChatSite | undefined): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  return 'Gemini'
}

export function selectableModels(store: OpenTeamStore): RoleModelOption[] {
  return [
    ...VISIBLE_CHAT_SITES.map(site => ({ key: modelKeyForSite(site), label: siteLabel(site), className: `site-pill-${site}` })),
    ...externalModels(store).map(model => ({ key: modelKeyForExternal(model.id), label: `API · ${model.name}`, className: 'site-pill-external' })),
  ]
}

export function roleModelOption(role: GroupRole, store: OpenTeamStore): RoleModelOption {
  const key = roleModelKey(role, store)
  return selectableModels(store).find(model => model.key === key) ?? { key, label: 'API · 未配置', className: 'site-pill-external' }
}

export function roleModelKey(role: Pick<GroupRole, 'modelSource' | 'externalModelId' | 'chatSite'>, store: OpenTeamStore): string {
  if (role.modelSource === 'external' && role.externalModelId) return modelKeyForExternal(role.externalModelId)
  return modelKeyForSite(role.chatSite ?? store.settings.defaultChatSite)
}

export function rolePatchForModelKey(key: string): { modelSource: RoleModelSource; chatSite?: ChatSite; externalModelId?: string } {
  const externalModelId = key.startsWith('external:') ? key.slice('external:'.length) : ''
  if (externalModelId) return { modelSource: 'external', externalModelId }
  return { modelSource: 'site', chatSite: visibleChatSite(key.startsWith('site:') ? key.slice('site:'.length) : key) }
}

function externalModels(store: OpenTeamStore): ExternalModelConfig[] {
  return store.settings.externalModelOrder
    .map(modelId => store.settings.externalModelsById[modelId])
    .filter((model): model is ExternalModelConfig => Boolean(model))
}

export function modelKeyForSite(site: ChatSite): string {
  return `site:${site}`
}

export function modelKeyForExternal(modelId: string): string {
  return `external:${modelId}`
}

function visibleChatSite(value: string | undefined): ChatSite {
  return value === 'chatgpt' || value === 'claude' || value === 'deepseek' || value === 'grok' ? value : 'gemini'
}

export function roleStatusLabel(status: RoleStatus): string {
  const labels: Record<RoleStatus, string> = {
    pending: '待唤醒',
    loading: '加载中',
    ready: '在线',
    thinking: '回复中',
    stopped: '已停止',
    error: '异常',
  }
  return labels[status]
}

export function siteHealthLabel(status: NonNullable<GroupRole['siteHealth']>['status']): string {
  const labels: Record<NonNullable<GroupRole['siteHealth']>['status'], string> = {
    ready: '页面可用',
    generating: '页面回复中',
    error: '页面异常',
    blocked: '页面被阻止',
    unauthorized: '需要登录',
  }
  return labels[status]
}

/** 已读进度（原 roleContextProgress 文案）。 */
export function roleContextProgressText(role: GroupRole, ui: (source: string) => string): string {
  return ui(role.contextCursor > 0 ? `已读 ${role.contextCursor} 条` : '尚未读取消息')
}

/** 连接状态（原 roleConnectionStatus 文案），siteHealth 优先。 */
export function roleConnectionStatusText(role: GroupRole, ui: (source: string) => string): string {
  if (role.siteHealth) {
    const label = ui(siteHealthLabel(role.siteHealth.status))
    return role.siteHealth.detail ? `${label}：${role.siteHealth.detail}` : label
  }
  return ui(role.modelSource === 'external' ? '连接 API' : role.geminiConversationUrl ? '网页已连接' : '等待连接')
}

/** 卡片头像/名称的 @ 提及提示（原 wireMentionShortcut title）。 */
export function roleMentionTitle(role: GroupRole, store: OpenTeamStore): string {
  return `@${roleMentionLabel(role, roleMentionLabelOptionsFromSettings(store.settings))}`
}
