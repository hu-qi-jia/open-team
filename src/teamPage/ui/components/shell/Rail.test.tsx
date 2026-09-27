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
 * Rail 中间三钮点击经 uiBus 打开对应 React 弹窗（P3/P4a/P4b 起），
 * 这里锁 id 与语义标签的契约。
 */
describe('Rail', () => {
  it('renders the chat button plus the three uiBus rail buttons', () => {
    renderWithServices(<Rail />, {})

    expect(screen.getByRole('button', { name: '群聊' })).toBeTruthy()
    expect(document.querySelector<HTMLButtonElement>('#open-all-notes')?.getAttribute('aria-label')).toBe('查看全部笔记')
    expect(document.querySelector<HTMLButtonElement>('#open-people-library')?.getAttribute('aria-label')).toBe('打开人员库')
    expect(document.querySelector<HTMLButtonElement>('#open-external-models')?.getAttribute('aria-label')).toBe('添加大模型')
    expect(document.querySelector('#settings-button')).toBeTruthy()
  })
})
