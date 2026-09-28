// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupChat, GroupMessage, GroupRole, OpenTeamStore } from '../../../../group/types'
import { createDefaultStore } from '../../../../group/store'
import { THINKING_TIMEOUT_MS } from '../../../chatExperience'
import { createTeamPageState, type TeamPageState } from '../../../appState'
import { notifyAppState } from '../../lib/appStore'
import { showError, showSuccess } from '../../lib/toast'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import type { TeamPageServices } from '../../context/ServicesContext'
import { Messages } from './Messages'

vi.mock('../../lib/toast', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock('../../../../shared/imageAttachmentRepository', () => ({
  createIndexedDbImageAttachmentRepository: () => ({
    get: vi.fn(async (id: string) => {
      if (id !== 'attachment-ready') return undefined
      return {
        id,
        chatId: 'chat-1',
        messageId: 'msg-image',
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        size: 5,
        fileName: 'chatgpt-image-1.png',
        createdAt: Date.now(),
      }
    }),
  }),
}))

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  restoreScrollStubs?.()
  restoreScrollStubs = undefined
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// jsdom 没有 objectURL API；imageCache 是模块级单例，跨用例存活——图片
// 用例加载过的 URL 会在后续用例的 releaseUnused effect 里触发 revoke。
// 全文件兜底 no-op，图片用例内再用 MockURL spy 覆盖取值路径。
beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:openteam-placeholder'
    URL.revokeObjectURL = () => undefined
  }
})

let restoreScrollStubs: (() => void) | undefined

/** ScrollArea 化后的真实滚动容器：容器级手势（mousedown/mouseup）必须落在 viewport 内 */
function scrollViewportOf(messagesEl: HTMLElement): HTMLElement {
  const viewport = messagesEl.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (!viewport) throw new Error('ScrollArea viewport 未渲染')
  return viewport
}

/*
 * 滚动容器桩：jsdom 没有布局，scrollTop/scrollHeight/clientHeight 全是 0。
 * 装在 Element.prototype 上（而非单个元素），让 React 渲染出的 #messages
 * 在 mount 的 layout effect 里就能读到——对应原实现「容器已带测量值再渲染」。
 */
function installScrollStubs(initialScrollTop: number, scrollHeight: number, clientHeight: number): void {
  let currentScrollTop = initialScrollTop
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get: () => currentScrollTop,
    set: (value: number) => { currentScrollTop = value },
  })
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => clientHeight })
  restoreScrollStubs = () => {
    if (scrollTopDescriptor) Object.defineProperty(Element.prototype, 'scrollTop', scrollTopDescriptor)
    if (scrollHeightDescriptor) Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeightDescriptor)
    if (clientHeightDescriptor) Object.defineProperty(Element.prototype, 'clientHeight', clientHeightDescriptor)
  }
}

function settleMarkMenuTimer(): void {
  act(() => {
    vi.advanceTimersByTime(90)
  })
}

/** appStore 通知是 queueMicrotask 合并的：在 act 内等一次微任务落定再断言 */
async function pushStoreUpdate(): Promise<void> {
  await act(async () => {
    notifyAppState()
    await Promise.resolve()
  })
}

type ServicesOverrides = Partial<Omit<TeamPageServices, 'messageActions'>> & {
  messageActions?: Partial<TeamPageServices['messageActions']>
}

function renderMessagesView(
  store: OpenTeamStore,
  servicesOverrides: ServicesOverrides = {},
  prepareState?: (state: TeamPageState) => void,
): { messagesEl: HTMLElement; services: TeamPageServices; state: TeamPageState } {
  const state = createTeamPageState()
  state.store = store
  state.selectedChatId = store.currentChatId
  prepareState?.(state)
  const base = createFakeServices()
  const services: TeamPageServices = {
    ...base,
    ...servicesOverrides,
    messageActions: { ...base.messageActions, ...servicesOverrides.messageActions },
  }
  renderWithServices(<Messages />, { state, services })
  const messagesEl = document.querySelector<HTMLElement>('#messages')
  if (!messagesEl) throw new Error('#messages 未渲染')
  return { messagesEl, services, state }
}

function makeStore(options: {
  chat: GroupChat
  roles?: GroupRole[]
  messages?: GroupMessage[]
  storeOverrides?: Partial<OpenTeamStore>
}): OpenTeamStore {
  const { chat, roles = [], messages = [], storeOverrides = {} } = options
  return {
    ...createDefaultStore(),
    currentChatId: chat.id,
    chatOrder: [chat.id],
    chatsById: { [chat.id]: chat },
    rolesById: Object.fromEntries(roles.map(role => [role.id, role])),
    messagesById: Object.fromEntries(messages.map(message => [message.id, message])),
    ...storeOverrides,
  }
}

function makeChat(overrides: Partial<GroupChat> = {}): GroupChat {
  const now = Date.now()
  return {
    id: 'chat-1',
    name: '群聊',
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeRole(overrides: Partial<GroupRole> = {}): GroupRole {
  const now = Date.now()
  return {
    id: 'role-1',
    chatId: 'chat-1',
    name: '工程师',
    status: 'ready',
    contextCursor: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeAssistantMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  const now = Date.now()
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    seq: 1,
    type: 'assistant',
    content: '回复内容',
    roleId: 'role-1',
    roleName: '工程师',
    createdAt: now,
    status: 'received',
    ...overrides,
  }
}

function selectBodyText(messagesEl: HTMLElement, start: number, end: number): Range {
  // markdown 正文结构是 .message-body > div > p > text：目标文本节点用
  // TreeWalker 定位，不依赖固定层级
  const body = messagesEl.querySelector('.message-body')
  expect(body).not.toBeNull()
  const walker = document.createTreeWalker(body!, NodeFilter.SHOW_TEXT)
  let bodyText = walker.nextNode()
  while (bodyText && !bodyText.textContent?.includes('重点')) bodyText = walker.nextNode()
  expect(bodyText?.textContent).toContain('重点')
  const range = document.createRange()
  range.setStart(bodyText!, start)
  range.setEnd(bodyText!, end)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  return range
}

describe('team page messages (React)', () => {
  it('keeps message rendering out of the team page entrypoint and pins the image download inside the tile', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.tsx'), 'utf8')
    expect(entrySource).not.toContain('createMessagesView')
    expect(entrySource).not.toContain('function renderMessages')
    expect(entrySource).not.toContain('messageNodeCache')
    expect(entrySource).toContain('messageActions')

    const css = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/styles/legacy.css'), 'utf8')
    const selectorIndex = css.indexOf('.message-image-download.message-tool-btn')
    expect(selectorIndex).toBeGreaterThan(-1)
    const rule = css.slice(selectorIndex, css.indexOf('}', selectorIndex))
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('right: 8px')
    expect(rule).toContain('bottom: 8px')
  })

  it('does not mark a role as failed from the UI when a thinking bubble expires', () => {
    const chat = makeChat({ roleIds: ['role-1'], status: 'running' })
    const role = makeRole({ status: 'thinking', lastPromptMessageId: 'msg-1', updatedAt: Date.now() - THINKING_TIMEOUT_MS })
    const store = makeStore({ chat, roles: [role] })
    const runCommand = vi.fn(async () => undefined)

    const { messagesEl, services } = renderMessagesView(store, { runCommand })

    expect(messagesEl.querySelector('[aria-label="停止回复"]')).toBeNull()
    expect(runCommand).not.toHaveBeenCalled()
    expect(services.log.warn).toHaveBeenCalledWith('ui:thinking-bubble:timeout', {
      chatId: chat.id,
      roleId: role.id,
      timeoutMs: THINKING_TIMEOUT_MS,
    })
  })

  it('renders assistant markdown even when older replies do not have a content format flag', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '这是 **重点** 内容' })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector('.markdown-body strong')?.textContent).toBe('重点')
  })

  it('renders assistant html table fragments as visible markdown tables', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({
      content: '<table><thead><tr><th>模型</th><th>结论</th></tr></thead><tbody><tr><td>Claude</td><td>可行</td></tr></tbody></table>',
    })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    const table = messagesEl.querySelector('.markdown-body table')
    expect(table).not.toBeNull()
    expect(table?.textContent).toContain('模型')
    expect(table?.textContent).toContain('Claude')
    expect(table?.textContent).toContain('可行')
  })

  it('renders assistant math html fragments as visible text instead of blank output', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({
      content: '<math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>',
    })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector('.markdown-body')?.textContent?.replace(/\s+/g, '')).toContain('E=mc2')
  })

  it('renders pure image replies as an adaptive grid with preview, download, and failure states', async () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-image'], nextMessageSeq: 2 })
    const role = makeRole({ id: 'role-1', chatSite: 'chatgpt', name: '视觉设计师' })
    const message = makeAssistantMessage({
      id: 'msg-image',
      content: '',
      roleName: role.name,
      attachments: [
        {
          id: 'attachment-ready',
          type: 'image',
          status: 'ready',
          alt: '已生成图片：产品草图',
          width: 1024,
          height: 1024,
          mimeType: 'image/png',
          size: 5,
          fileName: 'chatgpt-image-1.png',
        },
        {
          id: 'attachment-error',
          type: 'image',
          status: 'error',
          error: '图片获取失败',
        },
      ],
    })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const createObjectURL = vi.fn(() => 'blob:openteam-image')
    const revokeObjectURL = vi.fn()
    const NativeURL = URL
    class MockURL extends NativeURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    }
    vi.stubGlobal('URL', MockURL)

    const { messagesEl } = renderMessagesView(store)

    const grid = messagesEl.querySelector('.message-image-grid.image-count-2')
    expect(grid).not.toBeNull()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(grid?.querySelector('img')?.getAttribute('src')).toBe('blob:openteam-image')
    expect(grid?.querySelector('.message-image-error')?.textContent).toContain('图片获取失败')
    expect(messagesEl.querySelector('.message-body')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="复制回复"]')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="引用回复"]')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="下载图片"]')).not.toBeNull()

    const preview = messagesEl.querySelector<HTMLButtonElement>('[aria-label="预览图片"]')
    expect(preview?.disabled).toBe(false)
    preview?.click()
    expect(open).toHaveBeenCalledWith('blob:openteam-image', '_blank', 'noopener')
  })

  it('renders a direct iframe jump icon beside assistant site badges', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole({ chatSite: 'deepseek' })
    const message = makeAssistantMessage({ content: '可以这样做', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const focusRoleFrame = vi.fn()

    const { messagesEl } = renderMessagesView(store, {
      messageActions: { focusRoleFrame },
    })

    const jump = messagesEl.querySelector<HTMLButtonElement>('.message-name .message-site-jump-btn')
    expect(messagesEl.querySelector('.role-site-badge')?.textContent).toBe('DeepSeek')
    expect(jump?.getAttribute('aria-label')).toBe('跳转到原始窗口')

    jump?.click()

    expect(focusRoleFrame).toHaveBeenCalledWith(chat.id, role.id)
  })

  it('shows configured external model names in assistant badges and user mentions', () => {
    const now = Date.now()
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-user', 'msg-assistant'], nextMessageSeq: 3 })
    const role = makeRole({ name: '弗兰克尔', modelSource: 'external', externalModelId: 'model-1' })
    const userMessage: GroupMessage = {
      id: 'msg-user',
      chatId: chat.id,
      seq: 1,
      type: 'user',
      content: '你能做什么',
      targetRoleIds: [role.id],
      mentionedRoleIds: [role.id],
      createdAt: now,
      status: 'received',
    }
    const assistantMessage = makeAssistantMessage({ id: 'msg-assistant', seq: 2, content: '你好', roleId: role.id, roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [userMessage, assistantMessage] })
    store.settings.externalModelOrder = ['model-1']
    store.settings.externalModelsById = {
      'model-1': {
        id: 'model-1',
        name: 'OpenRouter Claude',
        format: 'openai',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'sk-test',
        modelName: 'anthropic/claude-sonnet',
        createdAt: now,
        updatedAt: now,
      },
    }

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector('.message-mention')?.textContent).toBe('@弗兰克尔（OpenRouter Claude）')
    expect(messagesEl.querySelector('.role-site-badge')?.textContent).toBe('OpenRouter Claude')
  })

  it('shows all-members mentions on user messages', () => {
    const now = Date.now()
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-user'], nextMessageSeq: 2 })
    const role = makeRole({ chatSite: 'deepseek' })
    const userMessage: GroupMessage = {
      id: 'msg-user',
      chatId: chat.id,
      seq: 1,
      type: 'user',
      content: '一起看一下',
      targetRoleIds: [role.id],
      mentionsAll: true,
      createdAt: now,
      status: 'received',
    }
    const store = makeStore({ chat, roles: [role], messages: [userMessage] })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector('.message-mention')?.textContent).toBe('@所有人')
    expect(messagesEl.querySelector('.message-body')?.textContent).toContain('一起看一下')
  })

  it('uses API-specific actions for completed external model replies', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-assistant'], nextMessageSeq: 2 })
    const role = makeRole({ name: '弗兰克尔', modelSource: 'external', externalModelId: 'model-1' })
    const message = makeAssistantMessage({ id: 'msg-assistant', content: 'API 回复', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const retryRoleReply = vi.fn(async () => undefined)

    const { messagesEl } = renderMessagesView(store, {
      messageActions: { retryRoleReply },
    })

    expect(messagesEl.querySelector('[aria-label="跳转到原始窗口"]')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="重新同步完整回复"]')).toBeNull()
    const retryButton = messagesEl.querySelector<HTMLButtonElement>('[aria-label="重新回复"]')
    expect(retryButton).not.toBeNull()
    retryButton?.click()
    expect(retryRoleReply).toHaveBeenCalledWith(role, message.id)
  })

  it('renders retry controls for failed site assistant replies', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-assistant'], nextMessageSeq: 2, status: 'error' })
    const role = makeRole({ status: 'error' })
    const message = makeAssistantMessage({
      id: 'msg-assistant',
      content: '回复超时了。\n\n可以点击下方的重新回复按钮再试一次。',
      contentFormat: 'markdown',
      roleName: role.name,
      status: 'error',
    })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const retryRoleReply = vi.fn(async () => undefined)

    const { messagesEl } = renderMessagesView(store, {
      messageActions: { retryRoleReply },
    })

    const retryButton = messagesEl.querySelector<HTMLButtonElement>('.message-tools [aria-label="重新回复"]')
    expect(retryButton).not.toBeNull()
    expect(messagesEl.querySelector('.message-tools [aria-label="重新同步完整回复"]')).toBeNull()
    retryButton?.click()
    expect(retryRoleReply).toHaveBeenCalledWith(role, message.id)
  })

  it('stops a streaming external reply on pointer down before stream renders can replace the button', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-assistant'], nextMessageSeq: 2, status: 'running' })
    const role = makeRole({
      id: 'role-1',
      name: '产品经理',
      modelSource: 'external',
      externalModelId: 'model-1',
      status: 'thinking',
      lastPromptMessageId: 'msg-user',
      replyAttemptId: 'attempt-1',
    })
    const message = makeAssistantMessage({
      id: 'msg-assistant',
      content: '已经流式返回的内容',
      roleId: role.id,
      roleName: role.name,
      status: 'pending',
    })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const stopRoleReply = vi.fn(async () => undefined)

    const { messagesEl } = renderMessagesView(store, {
      messageActions: { stopRoleReply },
    })

    const stopButton = messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')
    stopButton?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))

    expect(stopRoleReply).toHaveBeenCalledWith(role)
  })

  it('keeps the streaming stop button stable while assistant content updates', async () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-assistant'], nextMessageSeq: 2, status: 'running' })
    const role = makeRole({
      id: 'role-1',
      name: '产品经理',
      modelSource: 'external',
      externalModelId: 'model-1',
      status: 'thinking',
      lastPromptMessageId: 'msg-user',
      replyAttemptId: 'attempt-1',
    })
    const message = makeAssistantMessage({
      id: 'msg-assistant',
      content: '第一段',
      roleId: role.id,
      roleName: role.name,
      status: 'pending',
    })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)
    const firstButton = messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')
    message.content = '第一段第二段'
    await pushStoreUpdate()

    expect(messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')).toBe(firstButton)
    expect(messagesEl.querySelector('.message-body')?.textContent).toContain('第一段第二段')
  })

  it('requests a full reply resync for the current assistant message without retrying the prompt', async () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '不完整回复', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const resyncMessageReply = vi.fn(async () => undefined)

    const { messagesEl, services } = renderMessagesView(store, {
      messageActions: { resyncMessageReply },
    })

    messagesEl.querySelector<HTMLButtonElement>('button[aria-label="重新同步完整回复"]')?.click()

    expect(resyncMessageReply).toHaveBeenCalledWith(message)
    await act(async () => {
      await Promise.resolve()
    })
    expect(showSuccess).toHaveBeenCalledWith('执行成功了')
    expect(services.log.warn).toHaveBeenCalledWith('ui:message-resync:click', {
      chatId: chat.id,
      roleId: role.id,
      messageId: message.id,
      contentLength: message.content.length,
    })
  })

  it('preserves message scroll once after a reply resync render', () => {
    installScrollStubs(120, 960, 0)
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '同步后的完整回复', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { state } = renderMessagesView(store, {}, target => {
      target.preserveNextMessageScroll = true
    })

    const messagesEl = document.querySelector<HTMLElement>('#messages')
    expect(messagesEl?.scrollTop).toBe(120)
    expect(state.preserveNextMessageScroll).toBe(true)
  })

  it('preserves message scroll across push and command renders during reply resync', async () => {
    installScrollStubs(0, 960, 0)
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '不完整回复', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    let finishResync: (() => void) | undefined
    const resyncMessageReply = vi.fn(() => new Promise<void>(resolve => {
      finishResync = resolve
    }))

    const { messagesEl, state } = renderMessagesView(store, {
      messageActions: { resyncMessageReply },
    })
    messagesEl.scrollTop = 120
    messagesEl.querySelector<HTMLButtonElement>('button[aria-label="重新同步完整回复"]')?.click()

    await pushStoreUpdate()
    expect(messagesEl.scrollTop).toBe(120)
    expect(state.preserveNextMessageScroll).toBe(true)

    await pushStoreUpdate()
    expect(messagesEl.scrollTop).toBe(120)

    await act(async () => {
      finishResync?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(state.preserveNextMessageScroll).toBe(false)
  })

  it('keeps the current reading position when new replies render away from the bottom', () => {
    installScrollStubs(120, 1000, 300)
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1', 'msg-2'], nextMessageSeq: 3 })
    const role = makeRole()
    const messages: GroupMessage[] = [
      {
        id: 'msg-1',
        chatId: chat.id,
        seq: 1,
        type: 'user',
        content: '请分析这个方案',
        createdAt: Date.now(),
        status: 'sent',
      },
      makeAssistantMessage({ id: 'msg-2', seq: 2, content: '后续人员的新回复', createdAt: Date.now() + 1 }),
    ]
    const store = makeStore({ chat, roles: [role], messages })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.scrollTop).toBe(120)
  })

  it('continues following new replies when the reader is already near the bottom', () => {
    installScrollStubs(680, 1000, 300)
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '最新回复', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.scrollTop).toBe(1000)
  })

  it('renders saved message highlights without changing the message text', () => {
    const now = Date.now()
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '这里有一段重点内容', roleName: role.name })
    const store = makeStore({
      chat,
      roles: [role],
      messages: [message],
      storeOverrides: {
        messageHighlightsById: {
          [message.id]: [
            { id: 'highlight-1', messageId: message.id, text: '重点', startOffset: 5, endOffset: 7, createdAt: now },
          ],
        },
      },
    })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.textContent).toContain(message.content)
    expect(messagesEl.querySelector('.message-highlight')?.textContent).toBe('重点')
  })

  it('renders saved message highlights with their selected color', () => {
    const now = Date.now()
    const chat = makeChat({ messageIds: ['msg-1'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({ content: '这里有一段重点内容' })
    const store = makeStore({
      chat,
      messages: [message],
      storeOverrides: {
        messageHighlightsById: {
          [message.id]: [
            { id: 'highlight-1', messageId: message.id, text: '重点', startOffset: 5, endOffset: 7, color: '#7dd3fc', createdAt: now },
          ],
        },
      },
    })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector<HTMLElement>('.message-highlight')?.style.getPropertyValue('--message-highlight-rgb')).toBe('125, 211, 252')
  })

  it('offers selected message text actions that can highlight and add to notes', async () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '这里有一段重点内容', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })
    const runCommand = vi.fn(async () => undefined)
    const insertTextIntoActiveNote = vi.fn()

    const { messagesEl } = renderMessagesView(store, {
      runCommand,
      messageActions: { insertTextIntoActiveNote },
    })
    const scrollEl = scrollViewportOf(messagesEl)

    selectBodyText(messagesEl, 5, 7)

    vi.useFakeTimers()
    fireEvent.mouseUp(scrollEl)
    settleMarkMenuTimer()
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="高亮并加入笔记"]')!)
    await act(async () => { await Promise.resolve() })

    expect(insertTextIntoActiveNote).toHaveBeenCalledWith('重点')
    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_HIGHLIGHT_CREATE', {
      chatId: chat.id,
      messageId: message.id,
      text: '重点',
      startOffset: 5,
      endOffset: 7,
      color: '#f8b84e',
    })
  })

  it('shows the mark menu from selection changes and applies the selected highlight color', async () => {
    const chat = makeChat({ messageIds: ['msg-1'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({ content: '这里有一段重点内容' })
    const store = makeStore({ chat, messages: [message] })
    const runCommand = vi.fn(async () => undefined)

    const { messagesEl } = renderMessagesView(store, { runCommand })

    selectBodyText(messagesEl, 5, 7)

    vi.useFakeTimers()
    fireEvent(document, new Event('selectionchange'))
    settleMarkMenuTimer()
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="高亮颜色：蓝色"]')!)
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="高亮"]')!)
    await act(async () => { await Promise.resolve() })

    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_HIGHLIGHT_CREATE', {
      chatId: chat.id,
      messageId: message.id,
      text: '重点',
      startOffset: 5,
      endOffset: 7,
      color: '#7dd3fc',
    })
  })

  it('waits until drag selection ends before showing the mark menu', () => {
    const chat = makeChat({ messageIds: ['msg-1'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({ content: '这里有一段重点内容' })
    const store = makeStore({ chat, messages: [message] })

    const { messagesEl } = renderMessagesView(store)
    const scrollEl = scrollViewportOf(messagesEl)

    selectBodyText(messagesEl, 5, 7)

    vi.useFakeTimers()
    fireEvent.mouseDown(scrollEl)
    fireEvent(document, new Event('selectionchange'))
    expect(document.querySelector('.mark-menu')).toBeNull()

    fireEvent.mouseUp(scrollEl)
    settleMarkMenuTimer()
    expect(document.querySelector('.mark-menu')).not.toBeNull()
  })

  it('keeps the pending mark menu when the drag-ending click lands outside the message body', () => {
    const chat = makeChat({ messageIds: ['msg-1'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({ content: '这里有一段重点内容' })
    const store = makeStore({ chat, messages: [message] })

    const { messagesEl } = renderMessagesView(store)
    const scrollEl = scrollViewportOf(messagesEl)
    const outsideEl = document.createElement('div')
    document.body.append(outsideEl)

    selectBodyText(messagesEl, 5, 7)

    vi.useFakeTimers()
    fireEvent.mouseDown(scrollEl)
    fireEvent(document, new Event('selectionchange'))
    fireEvent.mouseUp(document)
    fireEvent.click(outsideEl)
    settleMarkMenuTimer()

    expect(document.querySelector('.mark-menu')).not.toBeNull()
  })

  it('positions the mark menu well above the selected text', () => {
    const chat = makeChat({ messageIds: ['msg-1'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({ content: '这里有一段重点内容' })
    const store = makeStore({ chat, messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    const range = selectBodyText(messagesEl, 5, 7)
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 120,
        y: 180,
        left: 120,
        top: 180,
        right: 168,
        bottom: 200,
        width: 48,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect),
    })

    vi.useFakeTimers()
    fireEvent(document, new Event('selectionchange'))
    settleMarkMenuTimer()

    expect(document.querySelector<HTMLElement>('.mark-menu')?.style.top).toBe('20px')
  })

  it('renders orchestration metadata labels and review summaries', () => {
    const now = Date.now()
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-review'], nextMessageSeq: 2 })
    const role = makeRole({ name: '复核员' })
    const message = makeAssistantMessage({
      id: 'msg-review',
      content: '复核结果',
      roleName: role.name,
      orchestrationRunId: 'run-1',
      orchestrationRound: 1,
      orchestrationStageId: 'stage-2',
      orchestrationStageIndex: 1,
      orchestrationKind: 'review',
    })
    const store = makeStore({
      chat,
      roles: [role],
      messages: [message],
      storeOverrides: {
        orchestrationRunsById: {
          'run-1': {
            id: 'run-1',
            chatId: chat.id,
            flowId: 'flow-1',
            status: 'completed',
            currentRound: 1,
            maxRounds: 2,
            stageRuns: [
              {
                stageId: 'stage-2',
                stageIndex: 1,
                kind: 'review',
                round: 1,
                status: 'completed',
                roleRuns: { [role.id]: { roleId: role.id, status: 'completed', messageId: message.id } },
                reviewResults: [
                  {
                    round: 1,
                    stageRunId: 'stage-2',
                    reviewerRoleId: role.id,
                    messageId: message.id,
                    decision: 'fail',
                    reason: '还需要补充测试',
                    failedCriteria: ['测试不足'],
                    nextRoundInstruction: '下一轮补齐测试',
                    rawJson: '{}',
                    createdAt: now,
                  },
                ],
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 2 步 · 复核')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('决策：不通过')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('原因：还需要补充测试')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('未通过：测试不足')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('重试说明：下一轮补齐测试')
  })

  it('invalidates cached message nodes when orchestration metadata changes', async () => {
    const chat = makeChat({ messageIds: ['msg-status'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({
      id: 'msg-status',
      type: 'system',
      content: '状态更新',
      orchestrationRunId: 'run-1',
      orchestrationRound: 1,
      orchestrationStageIndex: 0,
      orchestrationKind: 'status',
    })
    const store = makeStore({ chat, messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 1 步 · 状态')
    message.orchestrationStageIndex = 1
    await pushStoreUpdate()

    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 2 步 · 状态')
  })

  it('renders an empty state when no chat is selected', () => {
    const emptyStore = { ...createDefaultStore() }
    const { messagesEl } = renderMessagesView(emptyStore)
    expect(messagesEl.textContent).toContain('选择一个群聊')
    expect(messagesEl.textContent).toContain('左侧群聊列表会显示最近摘要、状态和更新时间。')
  })

  it('renders a people-less chat empty state whose button emits open-add-person', () => {
    const chat = makeChat({ name: '空群' })
    const store = makeStore({ chat })
    const { messagesEl, services } = renderMessagesView(store)
    const received: string[] = []
    services.uiBus.on('open-add-person', () => received.push('open-add-person'))

    expect(messagesEl.textContent).toContain('暂无人员')
    const addPersonButton = messagesEl.querySelector<HTMLButtonElement>('button[data-slot="button"]')
    expect(addPersonButton?.textContent).toBe('添加人员')
    addPersonButton?.click()

    expect(received).toEqual(['open-add-person'])
  })

  it('renders the message flow inside a ScrollArea viewport with a 720px centered column', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '这里有一段重点内容', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    expect(messagesEl.tagName).toBe('SECTION')
    expect(messagesEl.getAttribute('aria-live')).toBe('polite')
    const viewport = messagesEl.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).not.toBeNull()
    // Radix Viewport 在子级自带 display:table 内容包裹层，列容器以 data-slot 定位
    const column = viewport?.querySelector('[data-slot="messages-column"]')
    expect(column?.className).toContain('mx-auto')
    expect(column?.className).toContain('max-w-[720px]')
    expect(column?.className).toContain('px-4')
  })

  it('renders the no-chat empty state inside the same ScrollArea column', () => {
    const emptyStore = { ...createDefaultStore() }
    const { messagesEl } = renderMessagesView(emptyStore)
    const viewport = scrollViewportOf(messagesEl)
    expect(viewport.querySelector('[data-slot="messages-column"]')?.textContent).toContain('选择一个群聊')
  })

  it('points the auto-scroll ref at the ScrollArea viewport instead of the section', async () => {
    installScrollStubs(680, 1000, 300)
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '贴底跟随', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    // 挂载帧近底部 + 无历史测量 → 贴底赋值在首帧就已触发
    expect(messagesEl.scrollTop).toBe(1000)

    // 实例级 scrollTop 陷阱：下一次贴底写入必须落在 viewport（真实滚动元素），
    // 若 ref 仍指向 section，这里将只有 section 侧记录到写入
    const viewport = scrollViewportOf(messagesEl)
    const viewportWrites: number[] = []
    const sectionWrites: number[] = []
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => 1000,
      set: value => { viewportWrites.push(value) },
    })
    Object.defineProperty(messagesEl, 'scrollTop', {
      configurable: true,
      get: () => 120,
      set: value => { sectionWrites.push(value) },
    })

    await pushStoreUpdate()

    expect(viewportWrites).toEqual([1000])
    expect(sectionWrites).toEqual([])
  })

  it('renders a stopped-reply bubble with a resend action', () => {
    const chat = makeChat({ roleIds: ['role-1'] })
    const role = makeRole({ status: 'stopped', lastPromptMessageId: 'msg-user' })
    const store = makeStore({ chat, roles: [role] })
    const retryRoleReply = vi.fn(async () => undefined)

    const { messagesEl } = renderMessagesView(store, {
      messageActions: { retryRoleReply },
    })

    expect(messagesEl.querySelector('.message.stopped')?.textContent).toContain('已停止回复')
    const resend = messagesEl.querySelector<HTMLButtonElement>('[aria-label="重新发送"]')
    expect(resend).not.toBeNull()
    resend?.click()
    expect(retryRoleReply).toHaveBeenCalledWith(role)
  })

  it('renders a thinking control bubble for a role awaiting its first reply', () => {
    const chat = makeChat({ roleIds: ['role-1'], status: 'running' })
    const role = makeRole({ status: 'thinking', lastPromptMessageId: 'msg-user', updatedAt: Date.now() })
    const store = makeStore({ chat, roles: [role] })
    const stopRoleReply = vi.fn(async () => undefined)

    const { messagesEl } = renderMessagesView(store, {
      messageActions: { stopRoleReply },
    })

    expect(messagesEl.querySelector('.message.thinking')?.textContent).toContain('工程师 正在回复…')
    const stop = messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')
    expect(stop).not.toBeNull()
    stop?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    expect(stopRoleReply).toHaveBeenCalledWith(role)
  })

  it('member messages use a size-7 avatar and a muted rounded bubble', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1'], nextMessageSeq: 2 })
    const role = makeRole()
    const message = makeAssistantMessage({ content: '回复内容', roleName: role.name })
    const store = makeStore({ chat, roles: [role], messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    const row = messagesEl.querySelector('[data-message-id="msg-1"]')
    expect(row).not.toBeNull()
    const bubble = row!.querySelector('.message-bubble')!
    expect(bubble.className).toContain('bg-muted')
    expect(bubble.className).toContain('rounded-lg')
    expect(bubble.className).toContain('px-3')
    expect(bubble.className).toContain('py-2')
    const avatar = row!.querySelector('.message-avatar')!
    expect(avatar.className).toContain('size-7')
  })

  it('user messages are right-aligned with a primary bubble', () => {
    const chat = makeChat({ messageIds: ['msg-user'], nextMessageSeq: 2 })
    const message: GroupMessage = {
      id: 'msg-user',
      chatId: chat.id,
      seq: 1,
      type: 'user',
      content: '请分析这个方案',
      createdAt: Date.now(),
      status: 'sent',
    }
    const store = makeStore({ chat, messages: [message] })

    const { messagesEl } = renderMessagesView(store)

    const row = messagesEl.querySelector('[data-message-id="msg-user"]')
    expect(row).not.toBeNull()
    expect(row!.className).toContain('flex-row-reverse')
    const bubble = row!.querySelector('.message-bubble')!
    expect(bubble.className).toContain('bg-primary')
    expect(bubble.className).toContain('rounded-lg')
  })

  it('reply status row renders a spinner next to the role name', () => {
    const chat = makeChat({ roleIds: ['role-1'], status: 'running' })
    const role = makeRole({ status: 'thinking', lastPromptMessageId: 'msg-user', updatedAt: Date.now() })
    const store = makeStore({ chat, roles: [role] })

    const { messagesEl } = renderMessagesView(store)

    const row = messagesEl.querySelector('.message.thinking')
    expect(row).not.toBeNull()
    // Spinner 原语 = Loader2Icon（svg[role="status"]，无 data-slot）
    expect(row!.querySelector('svg[role="status"]')).not.toBeNull()
    expect(row!.textContent).toContain('工程师 正在回复…')
  })

  it('keeps the hidden attribute hiding the whole avatar on grouped continuation messages', () => {
    const chat = makeChat({ roleIds: ['role-1'], messageIds: ['msg-1', 'msg-2'], nextMessageSeq: 3 })
    const role = makeRole()
    const messages = [
      makeAssistantMessage({ id: 'msg-1', seq: 1, content: '第一条回复', roleName: role.name, createdAt: Date.now() }),
      makeAssistantMessage({ id: 'msg-2', seq: 2, content: '第二条回复', roleName: role.name, createdAt: Date.now() + 1 }),
    ]
    const store = makeStore({ chat, roles: [role], messages })

    const { messagesEl } = renderMessagesView(store)

    const firstAvatar = messagesEl.querySelector('[data-message-id="msg-1"] .message-avatar')
    const secondAvatar = messagesEl.querySelector('[data-message-id="msg-2"] .message-avatar')
    expect(firstAvatar?.hasAttribute('hidden')).toBe(false)
    expect(secondAvatar?.hasAttribute('hidden')).toBe(true)
  })

  it('shows showError when a mark command fails', async () => {
    const chat = makeChat({ messageIds: ['msg-1'], nextMessageSeq: 2 })
    const message = makeAssistantMessage({ content: '这里有一段重点内容' })
    const store = makeStore({ chat, messages: [message] })
    const runCommand = vi.fn(async () => {
      throw new Error('高亮保存失败')
    })

    const { messagesEl } = renderMessagesView(store, { runCommand })
    const scrollEl = scrollViewportOf(messagesEl)

    selectBodyText(messagesEl, 5, 7)

    vi.useFakeTimers()
    fireEvent.mouseUp(scrollEl)
    settleMarkMenuTimer()
    fireEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label="高亮"]')!)
    await act(async () => { await Promise.resolve() })

    expect(showError).toHaveBeenCalledWith('高亮保存失败')
  })
})
