import { useEffect, useSyncExternalStore } from 'react'
import { normalizeLanguage } from '../../../../shared/i18n'
import { getAppState, getAppStateVersion, subscribeAppState } from '../../lib/appStore'
import { applyDocumentLanguage } from '../../lib/documentLanguage'
import { getPendingLanguage } from '../../lib/languageOverride'

/*
 * 文档级语言同步：pending 乐观语言存在时优先于 store，把 <html> 的
 * lang / data-language 标记对齐当前语言（React 文本在渲染期已是目标
 * 语言，无需 DOM 回写）。随 appStore 版本重放保持与语言切换路径
 * （SettingsMenu 乐观更新 → store 回填）的一致性。
 */
export function LanguageSync() {
  const version = useSyncExternalStore(subscribeAppState, getAppStateVersion, getAppStateVersion)

  useEffect(() => {
    applyDocumentLanguage(getPendingLanguage() ?? normalizeLanguage(getAppState().store.settings.language))
  }, [version])

  return null
}
