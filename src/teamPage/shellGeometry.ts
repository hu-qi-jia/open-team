// src/teamPage/shellGeometry.ts
/*
 * 浮窗几何的纯函数层：钳制与 localStorage 持久化（规格 §5.2 修订——
 * floatingWindow 原本无持久化，这里是新增键 openteam.shellGeometry）。
 * floatingWindow.ts 保留 DOM/指针事件职责，数值规则全部下沉到这里。
 */
export interface ShellGeometry {
  left: number
  top: number
  width: number
  height: number
}

export const SHELL_GEOMETRY_STORAGE_KEY = 'openteam.shellGeometry'
const SCREEN_MARGIN = 8
export const MIN_SHELL_WIDTH = 520
export const MIN_SHELL_HEIGHT = 480

export function clampShellSize(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  const maxWidth = Math.max(MIN_SHELL_WIDTH, viewportWidth - SCREEN_MARGIN * 2)
  const maxHeight = Math.max(MIN_SHELL_HEIGHT, viewportHeight - SCREEN_MARGIN * 2)
  return {
    width: Math.min(Math.max(MIN_SHELL_WIDTH, width), maxWidth),
    height: Math.min(Math.max(MIN_SHELL_HEIGHT, height), maxHeight),
  }
}

export function clampShellPoint(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const spanWidth = Math.min(size.width, viewport.width - SCREEN_MARGIN * 2)
  const spanHeight = Math.min(size.height, viewport.height - SCREEN_MARGIN * 2)
  const maxX = Math.max(SCREEN_MARGIN, viewport.width - spanWidth - SCREEN_MARGIN)
  const maxY = Math.max(SCREEN_MARGIN, viewport.height - spanHeight - SCREEN_MARGIN)
  return {
    x: Math.min(Math.max(SCREEN_MARGIN, point.x), maxX),
    y: Math.min(Math.max(SCREEN_MARGIN, point.y), maxY),
  }
}

function safeStorageGet(storage: Storage | undefined): string | null {
  if (!storage) return null
  try {
    return storage.getItem(SHELL_GEOMETRY_STORAGE_KEY)
  } catch {
    return null
  }
}

export function readShellGeometry(storage: Storage | undefined): ShellGeometry | undefined {
  const raw = safeStorageGet(storage)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<ShellGeometry>
    if (
      typeof parsed.left !== 'number' || typeof parsed.top !== 'number' ||
      typeof parsed.width !== 'number' || typeof parsed.height !== 'number'
    ) return undefined
    return { left: parsed.left, top: parsed.top, width: parsed.width, height: parsed.height }
  } catch {
    return undefined
  }
}

export function writeShellGeometry(storage: Storage | undefined, geometry: ShellGeometry): void {
  if (!storage) return
  try {
    storage.setItem(SHELL_GEOMETRY_STORAGE_KEY, JSON.stringify(geometry))
  } catch {
    // 隐私模式可能拒绝 localStorage；几何只在会话内生效。
  }
}
