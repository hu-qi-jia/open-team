// 最小 520×480 由 clampShellSize 内的 MIN_SHELL_WIDTH / MIN_SHELL_HEIGHT 兜底，
// 本模块不再自带 min 常量（原 760×520 已随几何规则下沉 shellGeometry 而删除）。
import { clampShellPoint, clampShellSize, readShellGeometry, writeShellGeometry, type ShellGeometry } from './shellGeometry'
import { deriveAppSizeTier } from './appSizeTier'

export interface FloatingWindowDependencies {
  appShellEl: HTMLElement
  closeWindowEl?: HTMLButtonElement
  toggleWindowSizeEl: HTMLButtonElement
  toggleFullscreenEl: HTMLButtonElement
  windowLauncherEl: HTMLButtonElement
  windowResizeHandleEl?: HTMLButtonElement
  windowResizeHandleRightEl?: HTMLButtonElement
  windowResizeHandleBottomEl?: HTMLButtonElement
}

export interface FloatingWindowControls {
  registerFloatingWindowControls(): void
  setWindowMinimized(minimized: boolean): void
  syncAppSizeTier(): void
}

export function createFloatingWindowControls(deps: FloatingWindowDependencies): FloatingWindowControls {
  const dragZoneHeight = 52
  let activeResizeDirection: 'corner' | 'right' | 'bottom' = 'corner'
  let activeResizePointerId: number | undefined
  let persistTimer: number | undefined

  function ensureShellPositioned(): DOMRect {
    const rect = deps.appShellEl.getBoundingClientRect()
    deps.appShellEl.style.left = `${rect.left}px`
    deps.appShellEl.style.top = `${rect.top}px`
    deps.appShellEl.style.transform = 'none'
    return rect
  }

  function moveShellTo(left: number, top: number): void {
    const rect = deps.appShellEl.getBoundingClientRect()
    const clamped = clampShellPoint({ x: left, y: top }, { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight })
    deps.appShellEl.style.left = `${clamped.x}px`
    deps.appShellEl.style.top = `${clamped.y}px`
    deps.appShellEl.style.transform = 'none'
  }

  function resizeShellTo(width: number, height: number): void {
    const clamped = clampShellSize(width, height, window.innerWidth, window.innerHeight)
    deps.appShellEl.style.width = `${clamped.width}px`
    deps.appShellEl.style.height = `${clamped.height}px`
    syncAppSizeTier()
    persistShellGeometry()
    window.requestAnimationFrame(clampShellPosition)
  }

  function clampShellPosition(): void {
    if (deps.appShellEl.classList.contains('fullscreen')) return
    if (deps.appShellEl.style.transform !== 'none') return

    const rect = deps.appShellEl.getBoundingClientRect()
    moveShellTo(rect.left, rect.top)
  }

  function syncAppSizeTier(): void {
    const width = deps.appShellEl.getBoundingClientRect().width
    deps.appShellEl.dataset.appSize = deriveAppSizeTier(Math.round(width))
  }

  function currentGeometry(): ShellGeometry {
    const rect = deps.appShellEl.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  function persistShellGeometry(): void {
    window.clearTimeout(persistTimer)
    // 全屏守卫放在回调内：手势结束后 300ms 内进入全屏会清掉 left/top，
    // 若只在调用时检查，挂起的定时器仍会把全屏矩形写进持久化键。
    persistTimer = window.setTimeout(() => {
      if (deps.appShellEl.classList.contains('fullscreen')) return
      writeShellGeometry(window.localStorage, currentGeometry())
    }, 300)
  }

  function setWindowMinimized(minimized: boolean): void {
    if (minimized) setWindowFullscreen(false)
    if (!minimized && deps.appShellEl.style.transform !== 'none') ensureShellPositioned()
    deps.appShellEl.classList.toggle('minimized', minimized)
    deps.windowLauncherEl.hidden = !minimized
    deps.toggleWindowSizeEl.textContent = minimized ? '□' : '−'
    deps.toggleWindowSizeEl.setAttribute('aria-expanded', String(!minimized))
    if (!minimized) window.requestAnimationFrame(clampShellPosition)
    syncAppSizeTier()
  }

  function setWindowFullscreen(fullscreen: boolean): void {
    if (fullscreen) {
      deps.appShellEl.style.left = ''
      deps.appShellEl.style.top = ''
      deps.appShellEl.style.transform = ''
      deps.appShellEl.classList.remove('minimized')
      deps.windowLauncherEl.hidden = true
      deps.toggleWindowSizeEl.textContent = '−'
      deps.toggleWindowSizeEl.setAttribute('aria-expanded', 'true')
      syncAppSizeTier()
    }
    deps.appShellEl.classList.toggle('fullscreen', fullscreen)
    deps.toggleFullscreenEl.textContent = fullscreen ? '⤡' : '⛶'
    deps.toggleFullscreenEl.setAttribute('aria-pressed', String(fullscreen))
    deps.toggleFullscreenEl.setAttribute('aria-label', fullscreen ? '退出全屏' : '全屏窗口')
    deps.toggleFullscreenEl.title = fullscreen ? '退出全屏' : '全屏窗口'
    syncAppSizeTier()
  }

  function registerFloatingWindowControls(): void {
    const restored = readShellGeometry(window.localStorage)
    if (restored && !deps.appShellEl.classList.contains('fullscreen')) {
      resizeShellTo(restored.width, restored.height)
      moveShellTo(restored.left, restored.top)
    }
    syncAppSizeTier()

    let dragOffsetX = 0
    let dragOffsetY = 0
    let activePointerId: number | undefined
    let resizeStartX = 0
    let resizeStartY = 0
    let resizeStartWidth = 0
    let resizeStartHeight = 0

    deps.appShellEl.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      if (deps.appShellEl.classList.contains('fullscreen')) return
      if (!isTopChromeDragEvent(event)) return

      const rect = ensureShellPositioned()
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      activePointerId = event.pointerId
      deps.appShellEl.classList.add('dragging')
      deps.appShellEl.setPointerCapture(event.pointerId)
      event.preventDefault()
    })

    deps.appShellEl.addEventListener('pointermove', event => {
      if (activePointerId !== event.pointerId) return
      moveShellTo(event.clientX - dragOffsetX, event.clientY - dragOffsetY)
    })

    function stopDragging(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) return
      activePointerId = undefined
      deps.appShellEl.classList.remove('dragging')
      if (deps.appShellEl.hasPointerCapture(event.pointerId)) deps.appShellEl.releasePointerCapture(event.pointerId)
      persistShellGeometry()
    }

    deps.appShellEl.addEventListener('pointerup', stopDragging)
    deps.appShellEl.addEventListener('pointercancel', stopDragging)

    function beginResize(direction: 'corner' | 'right' | 'bottom', handle: HTMLButtonElement, event: PointerEvent): void {
      if (event.button !== 0) return
      if (deps.appShellEl.classList.contains('fullscreen') || deps.appShellEl.classList.contains('minimized')) return

      const rect = ensureShellPositioned()
      resizeStartX = event.clientX
      resizeStartY = event.clientY
      resizeStartWidth = rect.width
      resizeStartHeight = rect.height
      activeResizeDirection = direction
      activeResizePointerId = event.pointerId
      deps.appShellEl.classList.add('resizing')
      handle.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    }

    function stopResizing(handle: HTMLButtonElement, event: PointerEvent): void {
      if (activeResizePointerId !== event.pointerId) return
      activeResizePointerId = undefined
      deps.appShellEl.classList.remove('resizing')
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      persistShellGeometry()
    }

    function bindResizeHandle(handle: HTMLButtonElement, direction: 'corner' | 'right' | 'bottom'): void {
      handle.addEventListener('pointerdown', event => beginResize(direction, handle, event))
      handle.addEventListener('pointermove', event => {
        if (activeResizePointerId !== event.pointerId) return
        resizeShellTo(
          activeResizeDirection === 'bottom' ? resizeStartWidth : resizeStartWidth + event.clientX - resizeStartX,
          activeResizeDirection === 'right' ? resizeStartHeight : resizeStartHeight + event.clientY - resizeStartY,
        )
      })
      handle.addEventListener('pointerup', event => stopResizing(handle, event))
      handle.addEventListener('pointercancel', event => stopResizing(handle, event))
    }
    if (deps.windowResizeHandleEl) bindResizeHandle(deps.windowResizeHandleEl, 'corner')
    if (deps.windowResizeHandleRightEl) bindResizeHandle(deps.windowResizeHandleRightEl, 'right')
    if (deps.windowResizeHandleBottomEl) bindResizeHandle(deps.windowResizeHandleBottomEl, 'bottom')

    deps.closeWindowEl?.addEventListener('click', () => setWindowMinimized(true))
    deps.toggleWindowSizeEl.addEventListener('click', () => setWindowMinimized(!deps.appShellEl.classList.contains('minimized')))
    deps.toggleFullscreenEl.addEventListener('click', () => setWindowFullscreen(!deps.appShellEl.classList.contains('fullscreen')))
    setWindowFullscreen(deps.appShellEl.classList.contains('fullscreen'))
    deps.windowLauncherEl.addEventListener('click', () => setWindowMinimized(false))
    window.addEventListener('resize', () => {
      clampShellPosition()
      syncAppSizeTier()
    })
  }

  function isTopChromeDragEvent(event: PointerEvent): boolean {
    const target = event.target as Element | null
    if (target?.closest('button, input, textarea, select, a, [role="button"], .settings-menu, .modal')) return false
    const rect = deps.appShellEl.getBoundingClientRect()
    return event.clientY - rect.top <= dragZoneHeight
  }

  return { registerFloatingWindowControls, setWindowMinimized, syncAppSizeTier }
}
