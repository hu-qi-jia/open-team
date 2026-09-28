// src/teamPage/ui/hooks/useAppShellChrome.test.tsx
// @vitest-environment jsdom
import { useRef } from 'react'
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
function ChromeRenderCountProbe() {
  const renders = useRef(0)
  renders.current += 1
  const { minimized, fullscreen } = useAppShellChromeState()
  return <output>renders={renders.current} minimized={String(minimized)} fullscreen={String(fullscreen)}</output>
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

  // S1 清账回归：快照是对象态（{ minimized, fullscreen }），任何一个字段变化
  // ——哪怕是拖拽期 dragging 这类与渲染输出无关的 class 写入——都必须产出
  // 新快照对象并触发消费者重渲，不得因字段值未变而被 React 判等吞掉。
  it('无关 class 字段变化后消费者仍重渲（render 计数）', async () => {
    render(<ChromeRenderCountProbe />)
    expect(screen.getByText('renders=1 minimized=false fullscreen=false')).toBeTruthy()
    await act(async () => {
      document.getElementById('app')!.classList.add('dragging')
    })
    expect(screen.getByText('renders=2 minimized=false fullscreen=false')).toBeTruthy()
    await act(async () => {
      document.getElementById('app')!.classList.add('minimized')
    })
    expect(screen.getByText('renders=3 minimized=true fullscreen=false')).toBeTruthy()
  })
})
