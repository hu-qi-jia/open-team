// src/teamPage/appSizeTier.ts
/*
 * 浮窗内容宽度档位（规格 §5.1）。断点依据 #app 实宽而非视口——
 * floatingWindow 在写几何时调用本函数并把结果写进 #app[data-app-size]，
 * CSS 变体与 React hook 都以该属性为唯一档位来源。
 */
export type AppSizeTier = 'compact' | 'medium' | 'wide'

export const APP_SIZE_COMPACT_MAX = 767
export const APP_SIZE_MEDIUM_MAX = 1023

export function deriveAppSizeTier(width: number): AppSizeTier {
  if (width <= APP_SIZE_COMPACT_MAX) return 'compact'
  if (width <= APP_SIZE_MEDIUM_MAX) return 'medium'
  return 'wide'
}
