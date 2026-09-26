import type { TeamLanguage } from '../../../shared/i18n'

/*
 * 语言切换的乐观覆盖（原 languageSettingsController.pendingLanguage 语义）：
 * SettingsMenu 发出 GROUP_SETTINGS_UPDATE 前先置位，落定/失败后清除；
 * <LanguageSync/> 与本组件在 pending 存在期间以它为准渲染/翻译，
 * 避免 store 回包前的一拍延迟。模块级单例——语言是全局态。
 */
let pending: TeamLanguage | undefined

export function getPendingLanguage(): TeamLanguage | undefined {
  return pending
}

export function setPendingLanguage(language: TeamLanguage): void {
  pending = language
}

export function clearPendingLanguage(language: TeamLanguage): void {
  if (pending === language) pending = undefined
}
