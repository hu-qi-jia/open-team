// src/teamPage/ui/hooks/useAppShellChrome.test.tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppShellChromeState, useAppSizeTier } from './useAppShellChrome'

function TierProbe() {
  return <output>tier={useAppSizeTier()}</output>
}
function ChromeProbe() {
  const { minimized, fullscreen } = useAppShellChromeState()
  return <output>minimized={String(minimized)} fullscreen={String(fullscreen)}</output>
}

describe('useAppShellChrome hooks', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app" class="app-shell" data-app-size="wide"></div>'
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('读取初始 data-app-size', () => {
    render(<TierProbe />)
    expect(screen.getByText('tier=wide')).toBeTruthy()
  })

  // 注：MutationObserver 回调以微任务投递，同步测试体不清空微任务队列，
  // 故用 await act(async …) 触发（断言与被测行为与简报一致）。
  it('data-app-size 变化时重渲（medium → compact）', async () => {
    render(<TierProbe />)
    await act(async () => {
      document.getElementById('app')!.setAttribute('data-app-size', 'medium')
    })
    expect(screen.getByText('tier=medium')).toBeTruthy()
    await act(async () => {
      document.getElementById('app')!.setAttribute('data-app-size', 'compact')
    })
    expect(screen.getByText('tier=compact')).toBeTruthy()
  })

  it('#app class 含 minimized/fullscreen 时 chrome 态翻转', async () => {
    render(<ChromeProbe />)
    expect(screen.getByText('minimized=false fullscreen=false')).toBeTruthy()
    await act(async () => {
      document.getElementById('app')!.classList.add('minimized')
    })
    expect(screen.getByText('minimized=true fullscreen=false')).toBeTruthy()
    await act(async () => {
      const app = document.getElementById('app')!
      app.classList.remove('minimized')
      app.classList.add('fullscreen')
    })
    expect(screen.getByText('minimized=false fullscreen=true')).toBeTruthy()
  })
})
