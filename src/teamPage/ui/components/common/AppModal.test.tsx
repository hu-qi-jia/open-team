// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppModal, type AppModalProps } from './AppModal'

/*
 * 公共弹窗外壳 AppModal 的壳契约单测（S4 / Task 1）。
 * AppModal 是纯组合件：只消费 ui/dialog 原语 + ui/button + lucide X，
 * 不依赖 store / services / uiBus，因此直接 render 即可，无需 TestProviders。
 * 断言分六组：宽度令牌（沟槽统一 48px）、高度策略（auto / fixed）、
 * 头部契约（titleId / descriptionId / 自绘关闭钮）、首焦收敛、
 * footer 槽（S5 / T1：条件渲染 + grid 行数）、closeOn（S5 / T1：背板关闭语义）。
 */

const CONTENT_ID = 'app-modal-test'
const CLOSE_ID = 'close-app-modal'

function renderModal(overrides: Partial<AppModalProps> = {}) {
  const props: AppModalProps = {
    open: true,
    onOpenChange: () => {},
    title: '测试标题',
    titleId: 'app-modal-title',
    closeId: CLOSE_ID,
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
    renderModal({
      height: 'fixed',
      children: <div id="app-modal-body-content">内容</div>,
    })
    const el = contentEl()

    expect(el.classList.contains('h-[min(760px,calc(100vh-48px))]')).toBe(true)
    expect(el.classList.contains('grid-rows-[auto_minmax(0,1fr)]')).toBe(true)

    // grid 的第二行（头部之后那一行）才是内容行：min-h-0 允许在 grid 行里收缩，
    // overflow-auto 让它自己滚——名字里的「scrollable body row」指的就是它。
    const rows = el.querySelectorAll<HTMLElement>(':scope > div')
    const bodyRow = rows[rows.length - 1]
    expect(bodyRow.contains(document.querySelector('#app-modal-body-content'))).toBe(true)
    expect(bodyRow.classList.contains('min-h-0')).toBe(true)
    expect(bodyRow.classList.contains('overflow-auto')).toBe(true)
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

  it('routes the Escape key to onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ onClose })

    await user.keyboard('{Escape}')

    // Escape 走 Radix DismissableLayer → onOpenChange(false) → onClose；
    // 这是「逐层关闭」语义的地基（后面的弹窗叠层都靠它）。
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('renders exactly one close button inside the dialog content', () => {
    renderModal()
    const content = contentEl()

    // 自绘 × 是唯一关闭入口
    expect(content.querySelector(`#${CLOSE_ID}`)).not.toBeNull()
    // 原语自带的浮角关闭钮必须被 showCloseButton={false} 关掉：留着它就是第二个
    // 关闭入口（2026-09-28 用户报的「两个 icon」正是这类重复）
    expect(content.querySelectorAll('[data-slot="dialog-close"]')).toHaveLength(0)
    // 兜底按 svg 计（本 fixture 的 children 不含图标）：整壳只允许一个 X
    expect(content.querySelectorAll('svg')).toHaveLength(1)
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

  it('focuses #initialFocusId with { preventScroll: true }', async () => {
    // jsdom 没有布局，测不了 scrollTop，所以这里断的是**调用形态**：壳必须把
    // preventScroll 透给目标元素。裸 .focus() 会在 height="auto" 的滚动容器
    // （max-h-[min(760px,calc(100vh-48px))] overflow-auto）里触发
    // scroll-into-view，把头部与整个列表滚出视野——外部模型弹窗种入 ≥7 个模型
    // 时「打开即停在表单底部」就是这个副作用（T5-Fix1 / F1）。
    // 焦点仍照常落在该元素上（键盘输入不受影响），只是不再把壳滚走。
    const target = document.createElement('input')
    target.id = 'app-modal-prevent-scroll-field'
    document.body.appendChild(target)
    const focusSpy = vi.spyOn(target, 'focus')

    try {
      renderModal({ initialFocusId: 'app-modal-prevent-scroll-field' })

      await waitFor(() => expect(focusSpy).toHaveBeenCalled())
      expect(focusSpy.mock.calls[0][0]).toEqual({ preventScroll: true })
    } finally {
      focusSpy.mockRestore()
      target.remove()
    }
  })

  it('carries contentId and contentClassName on the dialog content element', () => {
    renderModal({ contentId: 'app-modal-custom-id', contentClassName: 'app-modal-custom-class' })

    const el = document.querySelector<HTMLElement>('#app-modal-custom-id')
    expect(el).not.toBeNull()
    expect(el!.classList.contains('app-modal-custom-class')).toBe(true)
  })

  // ---------- footer 槽（S5 / T1） ----------

  it('renders the footer slot after the body row, as the last child of the content', () => {
    renderModal({ footer: <button id="app-modal-footer-action">确认创建</button> })
    const content = contentEl()
    const footer = content.querySelector<HTMLElement>('[data-slot="modal-footer"]')

    expect(footer).not.toBeNull()
    // 调用方给的节点必须落在槽内（不是散在正文里）
    expect(footer!.contains(document.querySelector('#app-modal-footer-action'))).toBe(true)
    // 钉底：footer 必须是 content 的最后一行（正文行之后）
    expect(content.lastElementChild).toBe(footer)
    // 槽自带分隔线与内边距（镜像头部的 border-b … px-6 py-4）
    expect(footer!.classList.contains('border-t')).toBe(true)
    expect(footer!.classList.contains('border-border')).toBe(true)
    expect(footer!.classList.contains('px-6')).toBe(true)
    expect(footer!.classList.contains('py-4')).toBe(true)
  })

  it('adds no node at all to the content when no footer is given', () => {
    renderModal()
    const content = contentEl()

    // ⭐ 空节点陷阱：无条件渲染一个空 footer，会让 content 凭空多出一个子元素。
    // 正文行是按「content 的最后一个子元素 / :scope > div」定位的
    // （people/* 的 5 处用例、ExternalModelsModal、RolePanel），多一个节点
    // 就会让它们同时误红——测出来的不是回归，是选择器脆性。
    // 期望值写死：本 fixture 下 content 恒为「头部行 + 正文行」两个子元素。
    expect(content.children).toHaveLength(2)
    expect(content.querySelector('[data-slot="modal-footer"]')).toBeNull()
  })

  it('uses the three-row grid only when a footer is present in fixed height mode', () => {
    const withoutFooter = renderModal({ height: 'fixed' })
    const twoRows = contentEl()
    expect(twoRows.classList.contains('grid-rows-[auto_minmax(0,1fr)]')).toBe(true)
    expect(twoRows.classList.contains('grid-rows-[auto_minmax(0,1fr)_auto]')).toBe(false)
    withoutFooter.unmount()

    renderModal({ height: 'fixed', footer: <div id="app-modal-fixed-footer" /> })
    const threeRows = contentEl()
    expect(threeRows.classList.contains('grid-rows-[auto_minmax(0,1fr)_auto]')).toBe(true)
    expect(threeRows.classList.contains('grid-rows-[auto_minmax(0,1fr)]')).toBe(false)
  })

  it('merges footerClassName onto the footer slot', () => {
    renderModal({ footer: <div id="app-modal-footer-content" />, footerClassName: 'flex justify-end' })
    const footer = contentEl().querySelector<HTMLElement>('[data-slot="modal-footer"]')

    // 布局归调用方：壳只给分隔线与内边距，justify-end 这类不焊死在壳里
    // （S6 的页脚布局未必一样）
    expect(footer!.classList.contains('flex')).toBe(true)
    expect(footer!.classList.contains('justify-end')).toBe(true)
    expect(footer!.classList.contains('border-t')).toBe(true)
  })

  // ---------- closeOn（S5 / T1） ----------

  // ⚠️ 背板点击一律用 userEvent 走完整指针事件序列（pointerdown → pointerup →
  // click）：Radix Dialog 固定带 deferPointerDownOutside（见
  // @radix-ui/react-dialog 的 DialogContentImpl），主键 pointerdown 只做登记、
  // 后续 click 才真正触发外点关闭。只 dispatch 一个裸 click 会因为缺
  // pointerdown 而永远不触发关闭——那样「关闭未被调用」型断言会永远绿。
  // 既有先例：notes/AllNotesModal.test.tsx:181-184 与
  // shell/GroupTemplateModal.test.tsx:236。

  it('does not close on an overlay click when closeOn is escape-only', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ closeOn: 'escape-only', onClose })

    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)

    // 与下一条「缺省 → 背板点击关」用同一套点击序列，两条互为对照：
    // 那条绿了才证明这条不是「点击根本没送达」的空断言。
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector(`#${CONTENT_ID}`)).not.toBeNull()
  })

  it('still routes the Escape key to onClose when closeOn is escape-only', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ closeOn: 'escape-only', onClose })

    await user.keyboard('{Escape}')

    // 'escape-only' 只砍掉背板这一条路径，Escape（与 ×）必须照旧
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('still routes the close button to onClose when closeOn is escape-only', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ closeOn: 'escape-only', onClose })

    await user.click(document.querySelector<HTMLButtonElement>(`#${CLOSE_ID}`)!)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on an overlay click when closeOn is omitted (default)', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ onClose })

    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  // ---------- closeOn: 'button-only'（S6 / T1，编排三弹窗的「仅按钮可关」） ----------

  // ⚠️ 与 'escape-only' 的本质差异：本壳的 Dialog 是受控的（onOpenChange(false)
  // → onClose），而编排三弹窗迁移前是「无 onOpenChange 的不受控 Dialog +
  // Escape/背板双 preventDefault」。只挡背板不解 Escape 的话，Escape 仍会走
  // onOpenChange(false) → onClose —— 弹窗会被意外关掉。因此 button-only 必须
  // 同时 preventDefault 两条 dismiss 路径。

  it('does not close on Escape when closeOn is button-only', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ closeOn: 'button-only', onClose })

    await user.keyboard('{Escape}')
    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)

    // Escape 与背板两条路径都不可关——与上面 escape-only 的对照用例同口径，
    // 那两条绿了才证明这里的「不关」不是点击/按键没送达的空断言。
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector(`#${CONTENT_ID}`)).not.toBeNull()
  })

  it('still routes the close button to onClose when closeOn is button-only', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderModal({ closeOn: 'button-only', onClose })

    await user.click(document.querySelector<HTMLButtonElement>(`#${CLOSE_ID}`)!)

    // 唯一出口：自绘 ×（与调用方动作钮同走 onClose）
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
