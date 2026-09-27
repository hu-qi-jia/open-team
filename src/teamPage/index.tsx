import type { ChatSite, GroupChat, GroupMessage, GroupRole, OpenTeamStore } from '../group/types'
import { getDefaultChatSiteUrl } from '../group/conversationUrl'
import { createDefaultStore } from '../group/store'
import { createTeamPageState, pickSelectedChatId } from './appState'
import { createChatListActions } from './chatListActions'
import { createChatSwitcher } from './chatSwitcher'
import { createTeamPageDomRefs } from './domRefs'
import { createFloatingWindowControls } from './floatingWindow'
import { createIframeHost } from './iframeHost'
import { createRoleRecoveryController } from './roleRecoveryController'
import { createTeamPageRuntimeClient, type StorePushMessage } from './runtimeClient'
import { createTeamPagePrimaryCoordinator } from './teamPagePrimary'
import { createErrorPresenter, teamPageLog } from './teamPageServices'
import { createThemeController } from './themeController'
import { createIndexedDbImageAttachmentRepository } from '../shared/imageAttachmentRepository'
import './ui/styles/globals.css'
import { bindAppState, notifyAppState } from './ui/lib/appStore'
import { applyOrchestrationAutoStreamChunk } from './ui/lib/orchestrationStreamStore'
import { createUiBus } from './ui/lib/uiBus'
import { mountTeamPageApp } from './ui/mount'
import type { TeamPageServices } from './ui/context/ServicesContext'

const appState = createTeamPageState()
const imageAttachmentRepository = createIndexedDbImageAttachmentRepository()
bindAppState(appState)
const uiBus = createUiBus()

let store: OpenTeamStore = appState.store
const log = teamPageLog

// runtimeClient 只依赖模块内提升的函数声明（applyStore / refreshStore）与 log，
// 创建期零副作用，因此先于 React 挂载创建。services 直接持有实例值而非 getter：
// 组件在渲染期解构 services 字段是惯用写法，若这里沿用「挂载后再声明 + getter」，
// 首帧解构即触发 TDZ ReferenceError → flushSync 抛出 → 整页只剩背景
// （P1 验收白屏的根因）。唯一保留 getter 的是 iframeHost——它依赖 domRefs
// 产出的容器，而 domRefs 必须等 React 渲染出骨架 DOM 才能创建；全工程无组件
// 在渲染期访问 iframeHost，仅事件期经 services 转交（mountOrder 边界测试锁此约定）。
const runtimeClient = createTeamPageRuntimeClient({
  getHostTabId: () => appState.hostTabId,
  applyStore,
  refreshStore,
  log,
})
const sendRuntimeMessage = runtimeClient.sendRuntimeMessage
const runCommand = runtimeClient.runCommand

// React 先同步挂载出全部骨架 DOM（携带 domRefs 需要的全部 id），
// 之后的 createTeamPageDomRefs() 才能查询到它们。
// chatOperations 依赖 domRefs 之后才创建的 vanilla 模块
// （showError / iframeHost），这里用闭包把解引用推迟到
// 调用时（事件期）——不要改回 getter（P1 白屏教训：渲染期解构 getter 字段
// 会 TDZ 崩掉首帧），也不要改成渲染期直接解构。
const teamPageServices: TeamPageServices = {
  imageAttachmentRepository,
  uiBus,
  log,
  runCommand,
  sendRuntimeMessage,
  get iframeHost() { return iframeHost },
  switchChat: chatId => chatSwitcher.switchChat(chatId),
  chatOperations: {
    clearMessages: chatId => chatListActions.clearChatMessages(chatId),
    deleteChat: chatId => chatListActions.deleteChat(chatId),
  },
  reconnectRolesForSend: (chat, roles) => reconnectRolesForSend(chat, roles),
  // 成员抽屉 ◇ 登录按钮（P4d 起 React 自持）：站点取「选中人员的
  // chatSite，缺省回默认站点」，chrome.tabs.create 留在组件树之外
  openAiSiteLogin: () => openAiSiteLogin(),
  // 编排模板建人 / 自动编排的命令响应自带新 store，组件经此回填
  // （与 background 推送同源，见 ServicesContext 注释）
  applyStore,
  composerBridge: {
    register: api => {
      insertMention = api.insertMention
      setReference = api.setReference
    },
  },
  notesBridge: {
    register: api => {
      insertTextIntoActiveNote = api.insertTextIntoActiveNote
    },
  },
  messageActions: {
    insertMention: role => insertMention(role),
    setReference: message => setReference(message),
    insertTextIntoActiveNote: text => insertTextIntoActiveNote(text),
    resyncMessageReply: message => resyncMessageReply(message),
    retryRoleReply: (role, messageId) => retryRoleReply(role, messageId),
    stopRoleReply: role => stopRoleReply(role),
    focusRoleFrame: (chatId, roleId) => focusRoleFrame(chatId, roleId),
  },
}
// Composer / NotesPanel（P2c、P3 起 React 化）挂载后分别经
// services.composerBridge / notesBridge 回填实现；messageActions 在事件期
// 调用这些闭包。声明必须在 mountTeamPageApp 之前：flushSync 会同步冲刷
// passive effect，两个组件的 mount effect 在模块求值期间就会调用
// register 回填
let insertMention = (_role: GroupRole): void => {}
let setReference = (_message: GroupMessage): void => {}
let insertTextIntoActiveNote = (_text: string): void => {}

mountTeamPageApp(teamPageServices)

const teamDomRefs = createTeamPageDomRefs()
const { appShellEl, closeWindowEl, toggleWindowSizeEl, toggleFullscreenEl } = teamDomRefs
const { errorEl } = teamDomRefs
const { themeLightEl, themeDarkEl } = teamDomRefs
const { windowLauncherEl, windowResizeHandleEl } = teamDomRefs
const showError = createErrorPresenter(errorEl)
const themeController = createThemeController({
  root: document.documentElement,
  lightButton: themeLightEl,
  darkButton: themeDarkEl,
})
themeController.initializeTheme()

const iframeHost = createIframeHost({
  visibleHost: teamDomRefs.iframeHostEl,
  onEvent(event) {
    log.debug(`iframe-host:${event.type}`, event)
  },
})
const primaryCoordinator = createTeamPagePrimaryCoordinator({
  navigator,
  window,
  onPrimaryChange: handlePrimaryModeChange,
  log,
})

// 编排状态浮层（P4c 起 OrchestrationStatusCard 自渲）；floatingWindow 与
// iframeHost 仍由本模块持有
const floatingWindowControls = createFloatingWindowControls({
  appShellEl,
  closeWindowEl,
  toggleWindowSizeEl,
  toggleFullscreenEl,
  windowLauncherEl,
  windowResizeHandleEl,
})
const setWindowMinimized = floatingWindowControls.setWindowMinimized
const registerFloatingWindowControls = floatingWindowControls.registerFloatingWindowControls
// 成员抽屉 / 笔记面板 / 全部笔记弹窗（P3 起 React 化）：外部翻转 appState
// 或 uiBus 命令后经 notifyAppState / uiBus 通知，组件自行重渲
const chatSwitcher = createChatSwitcher({
  state: appState,
  runCommand,
  showError,
})
const switchChat = chatSwitcher.switchChat
const chatListActions = createChatListActions({
  state: appState,
  getStore: () => store,
  applyStore,
  iframeHost,
  runCommand,
  sendRuntimeMessage,
  log,
  showError,
})
const roleRecoveryController = createRoleRecoveryController({
  state: appState,
  getStore: () => store,
  getCurrentRoles,
  refreshStore,
  switchChat,
  // React 输入区自行订阅 store 版本；这里只需触发一次 React 通知
  renderComposerState: () => notifyAppState(),
  setWindowMinimized,
  iframeHost,
  runCommand,
  showError,
  log,
})
const notifyRoleReadyWaiters = roleRecoveryController.notifyRoleReadyWaiters
const reconnectRolesForSend = roleRecoveryController.reconnectRolesForSend
const focusRoleFrame = roleRecoveryController.focusRoleFrame
const resyncMessageReply = roleRecoveryController.resyncMessageReply
const retryRoleReply = roleRecoveryController.retryRoleReply
const stopRoleReply = roleRecoveryController.stopRoleReply

// 成员抽屉 ◇ 登录按钮的站点解析（原 teamUiController deps.getSelectedLoginSite）
function selectedLoginSite(): ChatSite {
  return store.rolesById[appState.selectedRoleId ?? '']?.chatSite ?? store.settings.defaultChatSite
}

function openAiSiteLogin(): void {
  chrome.tabs.create({ url: getDefaultChatSiteUrl(selectedLoginSite()) })
    .catch(error => showError(error instanceof Error ? error.message : String(error)))
}

async function resolveHostTabId(): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  appState.hostTabId = tab?.id
  log.info('host-tab:resolved', { hostTabId: appState.hostTabId, url: tab?.url })
  iframeHost.setHostTabId(appState.hostTabId)
}

async function refreshStore(showFailure = true): Promise<void> {
  try {
    const response = await sendRuntimeMessage('GROUP_STORE_GET')
    if (response.ok === false) throw new Error(response.error || '读取群聊数据失败')
    if (response.controlStatus) appState.controlStatus = response.controlStatus
    applyStore(response.store ?? createDefaultStore())
  } catch (error) {
    applyStore(createDefaultStore())
    if (showFailure) showError(error instanceof Error ? error.message : String(error))
  }
}

function applyStore(nextStore: OpenTeamStore): void {
  appState.store = nextStore
  store = appState.store
  appState.selectedChatId = pickSelectedChatId(appState)
  const roles = getCurrentRoles()
  if (!appState.selectedRoleId || !roles.some(role => role.id === appState.selectedRoleId)) appState.selectedRoleId = roles[0]?.id
  if (appState.selectedReference && appState.selectedReference.messageId && !getCurrentMessages().some(message => message.id === appState.selectedReference?.messageId)) {
    appState.selectedReference = undefined
  }
  syncIframeHost()
  render()
  notifyRoleReadyWaiters()
  notifyAppState()
}

function getCurrentChat(): GroupChat | undefined {
  return appState.selectedChatId ? store.chatsById[appState.selectedChatId] : undefined
}

function getCurrentRoles(): GroupRole[] {
  const chat = getCurrentChat()
  if (!chat) return []
  return chat.roleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
}

function getCurrentMessages(): GroupMessage[] {
  const chat = getCurrentChat()
  if (!chat) return []
  return chat.messageIds.map(messageId => store.messagesById[messageId]).filter((message): message is GroupMessage => Boolean(message))
}

function syncIframeHost(): void {
  if (!primaryCoordinator.isPrimary()) {
    iframeHost.setEnabled(false)
    return
  }

  const chat = getCurrentChat()
  if (!chat) return
  iframeHost.setEnabled(true)
  const roles = getCurrentRoles()
  const siteRoles = roles.filter(role => role.modelSource !== 'external')
  log.debug('iframe-sync:activate-chat', {
    chatId: chat.id,
    roleIds: siteRoles.map(role => role.id),
    roleStatuses: roles.map(role => ({ id: role.id, name: role.name, status: role.status, conversationUrl: role.geminiConversationUrl })),
  })
  iframeHost.activateChat({ ...chat, roleIds: siteRoles.map(role => role.id) }, siteRoles)
}

function handlePrimaryModeChange(isPrimary: boolean): void {
  iframeHost.setEnabled(isPrimary)
  document.body.dataset.teamPagePrimary = String(isPrimary)
  if (isPrimary) {
    log.info('team-page-primary:enabled', { hostTabId: appState.hostTabId })
    syncIframeHost()
    return
  }

  log.warn('team-page-primary:passive', { hostTabId: appState.hostTabId })
  showError('已检测到另一个 OpenTeam 页面正在运行。当前页面已暂停 AI iframe，避免两个页面同时加载导致卡死。')
}

function render(): void {
  // 人员库 5 弹窗（P4a）、外部模型弹窗（P4b）、编排弹窗与状态浮层（P4c）
  // 已由 React 组件自渲；本函数只负责把数据变化回流给 React
  notifyAppState()
}

function registerRuntimePush(): void {
  chrome.runtime.onMessage.addListener((message: StorePushMessage, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false
    if (message.type === 'GROUP_ROLE_RECOVERY_REQUEST') {
      handleRoleRecoveryRequest(message, sendResponse)
      return true
    }
    if (message.type === 'GROUP_CONTROL_STATUS_UPDATED') {
      appState.controlStatus = message.controlStatus
      notifyAppState()
      return false
    }
    if (message.type === 'GROUP_ORCHESTRATION_AUTO_STREAM_CHUNK') {
      // 编排自动生成的流式 chunk：转发给独立外部 store（OrchestrationModal
      // 经 useSyncExternalStore 订阅），streamId 不匹配时内部忽略
      applyOrchestrationAutoStreamChunk(message)
      return false
    }
    if (message.type === 'TEAM_FRAME_ROLE_READY') iframeHost.markRoleReady(message.chatId, message.roleId)
    if ('store' in message && message.store) {
      applyStore(message.store)
    } else if (message.type.startsWith('GROUP_') || message.type.startsWith('TEAM_')) {
      refreshStore(false).catch(error => log.warn('runtime-push:refresh-failed', { type: message.type, error: error instanceof Error ? error.message : String(error) }))
    }
    if (message.type === 'GROUP_DELIVERY_ERROR') {
      const errorMessage = message.error || message.message
      if (errorMessage) showError(errorMessage)
    }
    return false
  })
}

function handleRoleRecoveryRequest(message: Extract<StorePushMessage, { type: 'GROUP_ROLE_RECOVERY_REQUEST' }>, sendResponse: (response?: unknown) => void): void {
  const chat = store.chatsById[message.chatId]
  const role = store.rolesById[message.roleId]
  if (!chat || !role || role.chatId !== chat.id) {
    log.warn('orchestration-diagnostic:role-recovery:missing-role', {
      chatId: message.chatId,
      roleId: message.roleId,
      reason: message.reason,
      hasChat: Boolean(chat),
      hasRole: Boolean(role),
      roleChatId: role?.chatId,
    })
    sendResponse({ ok: false, error: '找不到要恢复的人员' })
    return
  }
  log.warn('orchestration-diagnostic:role-recovery:start', {
    chatId: chat.id,
    roleId: role.id,
    roleName: role.name,
    chatSite: role.chatSite,
    reason: message.reason,
  })
  reconnectRolesForSend(chat, [role])
    .then(() => {
      log.warn('orchestration-diagnostic:role-recovery:ready', {
        chatId: chat.id,
        roleId: role.id,
        roleName: role.name,
        chatSite: role.chatSite,
      })
      sendResponse({ ok: true })
    })
    .catch(error => {
      const reason = error instanceof Error ? error.message : String(error)
      log.warn('orchestration-diagnostic:role-recovery:failed', { chatId: chat.id, roleId: role.id, roleName: role.name, chatSite: role.chatSite, reason: message.reason, error: reason })
      sendResponse({ ok: false, error: reason })
    })
}

async function boot(): Promise<void> {
  await resolveHostTabId()
  await primaryCoordinator.start()
  window.addEventListener('pagehide', () => primaryCoordinator.dispose(), { once: true })
  registerRuntimePush()
  themeController.registerThemeEvents()
  registerFloatingWindowControls()
  render()
  await refreshStore(false)
}

boot().catch(error => showError(error instanceof Error ? error.message : String(error)))
