// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShellFrame } from './AppShellFrame'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

/*
 * Rail 退役后，三个入口钮（人员库/全部笔记/添加大模型）迁入侧栏底部
 * 工具行（AppShellFrame ToolButton）。本文件接替 Rail.test.tsx 的契约：
 * 点击必须经 uiBus 发射对应命令（弹窗群据此开启）。
 * useAppSizeTier 在首渲染期就读 #app，注入的壳元素要先于 render 落位。
 */
describe('AppShellFrame footer tool buttons', () => {
  it('emits the people-library command when 人员库 is clicked', () => {
    const services = createFakeServices()
    const emit = vi.spyOn(services.uiBus, 'emit')

    document.body.innerHTML = '<div id="app" class="app-shell" data-app-size="wide"></div>'
    renderWithServices(<AppShellFrame>workspace</AppShellFrame>, { services })

    fireEvent.click(screen.getByRole('button', { name: '人员库' }))
    expect(emit).toHaveBeenCalledWith('open-people-library')
  })
})
