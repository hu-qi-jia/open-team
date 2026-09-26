// @vitest-environment jsdom

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { Rail } from './Rail'
import { renderWithServices } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
})

/*
 * Rail 中间三钮仍由 vanilla 视图按 id 绑定（allNotes / peopleLibrary /
 * externalModels 的 registerXEvents），这里锁 id 与语义标签的契约。
 */
describe('Rail', () => {
  it('renders the chat button plus the three vanilla-bound rail buttons', () => {
    renderWithServices(<Rail />, {})

    expect(screen.getByRole('button', { name: '群聊' })).toBeTruthy()
    expect(document.querySelector<HTMLButtonElement>('#open-all-notes')?.getAttribute('aria-label')).toBe('查看全部笔记')
    expect(document.querySelector<HTMLButtonElement>('#open-people-library')?.getAttribute('aria-label')).toBe('打开人员库')
    expect(document.querySelector<HTMLButtonElement>('#open-external-models')?.getAttribute('aria-label')).toBe('添加大模型')
    expect(document.querySelector('#settings-button')).toBeTruthy()
  })
})
