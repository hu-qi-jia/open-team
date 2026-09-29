/*
 * 样式表「退役后表面」的读取工具（S7/T6 建立）。
 *
 * 背景：S7 的绞杀终点是 `src/teamPage/ui/styles/legacy.css` 整文件下线
 * （1724 行 → 585 行退役注释 → 删除）。此前散落在 5 个守卫测试与 4 个验收
 * 探针里的「legacy.css 零残留」断言因此失去读取对象——直接换成空串会让
 * 上百条断言变成永真的空转。
 *
 * 改判口径：断言目标从「legacy.css」升级为**退役后的整个样式表面**——
 * `styles/` 目录下现存的全部 CSS（globals.css / iframe-host.css /
 * orchestration-canvas.css），剥掉注释后拼接。语义从「旧文件里没有」变成
 * 「任何现存样式表里都没有」，比原先更强：既守住 legacy 的退役成果，也挡住
 * 有人把死规则重新塞回 globals 或某个专题文件。
 *
 * 例外：确有搬进 globals / orchestration-canvas 的族（色板、ProseMirror
 * 后代、X6 画布、.sidebar-resize-handle 等）**不**走本工具——它们的断言应写成
 * 「承接方持有」，详见各调用点的注释。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** legacy.css 的绝对路径——S7/T6 起它应当不存在，断言即「文件已退役」。 */
export const LEGACY_CSS_PATH = resolve(process.cwd(), 'src/teamPage/ui/styles/legacy.css')

const STYLE_DIR = resolve(process.cwd(), 'src/teamPage/ui/styles')

/** legacy.css 是否仍在（S7/T6 后期望为 false）。 */
export function legacyStylesheetExists(): boolean {
  return existsSync(LEGACY_CSS_PATH)
}

/** 剥掉 CSS 注释（与既有守卫测试/探针同一口径）。 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 退役后的样式表面：`styles/` 下现存 CSS 剥注释后的拼接。
 * 目录不存在或为空时返回空串（不会让断言静默变永真——调用点另有
 * `legacyStylesheetExists()` 与文件清单断言兜底）。
 */
export function readStylesheetSurface(): string {
  if (!existsSync(STYLE_DIR)) return ''
  const files = readdirSync(STYLE_DIR)
    .filter(file => file.endsWith('.css'))
    .sort()
  return files
    .map(file => stripCssComments(readFileSync(resolve(STYLE_DIR, file), 'utf8')))
    .join('\n')
}

/** 组成样式表面的文件名（用于「表面非空」这类自证断言）。 */
export function stylesheetSurfaceFiles(): string[] {
  if (!existsSync(STYLE_DIR)) return []
  return readdirSync(STYLE_DIR).filter(file => file.endsWith('.css')).sort()
}
