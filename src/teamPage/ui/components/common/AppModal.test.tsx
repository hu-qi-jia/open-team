// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppModal, type AppModalProps } from './AppModal'

/*
 * 公共弹窗外壳 AppModal 的壳契约单测（S4 / Task 1）。
 * AppModal 是纯组合件：只消费 ui/dialog 原语 + ui/button + lucide X，
 * 不依赖 store / services / uiBus，因此直接 render 即可，无需 TestProviders。
 * 断言分四组：宽度令牌（沟槽统一 48px）、高度策略（auto / fixed）、
 * 头部契约（titleId / descriptionId / 自绘关闭钮）、首焦收敛。
 */

const CONTENT_ID = 'app-modal-test'

function renderModal(overrides: Partial<AppModalProps> = {}) {
  const props: AppModalProps = {
    open: true,
    onOpenChange: () => {},
    title: '测试标题',
    titleId: 'app-modal-title',
    closeId: 'close-app-modal',
    closeLabel: '关闭测试弹窗',
    onClose: () => {},
    contentId: CONTENT_ID,
    children: <div>内容</div>,
    ...overrides,
  }
  return render(<AppModal {...props} />)
}

function contentEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>(`#${CONTENT_ID}`)
  if (!el) throw new Error(`未找到弹窗内容节点 #${CONTENT_ID}`)
  return el
}

describe('team page app modal shell', () => {
  it('applies the width token and the single 48px gutter', () => {
    renderModal({ size: 'lg' })
    const className = contentEl().className

    expect(className).toContain('w-[min(720px,calc(100vw-48px))]')
    // 原语基类 max-w-[calc(100%-2rem)] sm:max-w-lg 必须被 max-w-none sm:max-w-none 抵掉
    expect(className).not.toContain('max-w-lg')
  })

  it('uses fixed height mode with a scrollable body row', () => {
    renderModal({ height: 'fixed' })
    const el = contentEl()

    expect(el.classList.contains('h-[min(760px,calc(100vh-48px))]')).toBe(true)
    expect(el.classList.contains('grid-rows-[auto_minmax(0,1fr)]')).toBe(true)
  })

  it('uses auto height mode with a max-height cap (never unbounded)', () => {
    renderModal()
    const el = contentEl()

    expect(el.classList.contains('max-h-[min(760px,calc(100vh-48px))]')).toBe(true)
    expect(el.classList.contains('overflow-auto')).toBe(true)
  })

  it('renders the close button with the given id and label, and routes it to onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ closeId: 'close-app-modal', closeLabel: '关闭测试弹窗', onClose })

    const closeButton = document.querySelector<HTMLButtonElement>('#close-app-modal')
    expect(closeButton).not.toBeNull()
    expect(closeButton!.getAttribute('aria-label')).toBe('关闭测试弹窗')

    await user.click(closeButton!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders title/description with the given ids, and omits aria-describedby when there is no description', () => {
    const first = renderModal({ description: '测试说明', descriptionId: 'app-modal-description' })
    const withDescription = contentEl()

    expect(document.querySelector('#app-modal-title')?.textContent).toBe('测试标题')
    expect(document.querySelector('#app-modal-description')?.textContent).toBe('测试说明')
    expect(withDescription.getAttribute('aria-labelledby')).toBe('app-modal-title')
    expect(withDescription.getAttribute('aria-describedby')).toBe('app-modal-description')

    first.unmount()
    renderModal()
    const withoutDescription = contentEl()

    expect(document.querySelector('#app-modal-description')).toBeNull()
    expect(withoutDescription.getAttribute('aria-labelledby')).toBe('app-modal-title')
    // Radix 无 description 时不该留下悬空引用
    expect(withoutDescription.hasAttribute('aria-describedby')).toBe(false)
  })

  it('focuses #initialFocusId on open instead of the first focusable element', async () => {
    renderModal({
      initialFocusId: 'app-modal-target-field',
      children: (
        <div>
          <input id="app-modal-first-field" />
          <input id="app-modal-target-field" />
        </div>
      ),
    })

    await waitFor(() => {
      expect(document.activeElement?.id).toBe('app-modal-target-field')
    })
  })

  it('carries contentId and contentClassName on the dialog content element', () => {
    renderModal({ contentId: 'app-modal-custom-id', contentClassName: 'app-modal-custom-class' })

    const el = document.querySelector<HTMLElement>('#app-modal-custom-id')
    expect(el).not.toBeNull()
    expect(el!.classList.contains('app-modal-custom-class')).toBe(true)
  })
})
