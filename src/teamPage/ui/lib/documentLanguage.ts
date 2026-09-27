import { normalizeLanguage, type TeamLanguage } from '../../../shared/i18n'

/*
 * 语言切换的文档级副作用（P5 起替代 languageController.applyTeamLanguage）：
 * React 渲染的文本在渲染期已是目标语言，无需 TreeWalker 回写 DOM；
 * 这里只同步 <html> 的语言标记（lang 属性 + data-language，供 CSS/调试）。
 */
export function applyDocumentLanguage(language: TeamLanguage): void {
  const normalized = normalizeLanguage(language)
  document.documentElement.lang = normalized
  document.documentElement.dataset.language = normalized
}
