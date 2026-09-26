// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { getAllRoleTemplates } from '../../../../group/roleTemplates'
import { createTeamPageState } from '../../../appState'
import { StoreSummary } from './StoreSummary'
import { renderWithServices } from '../../test/TestProviders'
import { notifyAppState } from '../../lib/appStore'

afterEach(() => {
  cleanup()
})

describe('StoreSummary', () => {
  it('renders chat and template counts from the store', () => {
    const state = createTeamPageState()
    state.store.chatOrder = ['chat-1', 'chat-2']
    state.store.chatsById = {
      'chat-1': makeChat('chat-1'),
      'chat-2': makeChat('chat-2'),
    } as typeof state.store.chatsById
    const templateCount = getAllRoleTemplates(state.store).length

    renderWithServices(<StoreSummary />, { state })

    expect(screen.getByText(`2 个群聊 · ${templateCount} 个人员库人员`)).toBeTruthy()
  })

  it('recomputes when a new store version is notified', async () => {
    const state = createTeamPageState()
    const templateCount = getAllRoleTemplates(state.store).length
    renderWithServices(<StoreSummary />, { state })

    state.store.chatOrder = ['chat-1']
    state.store.chatsById = { 'chat-1': makeChat('chat-1') } as typeof state.store.chatsById
    notifyAppState()

    // notifyAppState 经 queueMicrotask 合并通知，等 React 应用新版本号
    await waitFor(() => {
      expect(screen.getByText(`1 个群聊 · ${templateCount} 个人员库人员`)).toBeTruthy()
    })
  })
})

function makeChat(id: string) {
  return {
    id,
    name: `群聊 ${id}`,
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}
