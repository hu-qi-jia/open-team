import { normalizeLanguage, translateUi } from '../../../shared/i18n'
import { useStoreSelector } from './useStoreSelector'

/*
 * 组件内翻译：读 store.settings.language，返回 (source) => string。
 * React 渲染出的文本在渲染期就已是目标语言；<html> 的语言标记同步
 * 由 <LanguageSync/>（applyDocumentLanguage）负责。
 */
export function useT(): (source: string) => string {
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  return (source: string) => translateUi(source, language)
}
