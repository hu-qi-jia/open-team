import { useEffect, useSyncExternalStore } from 'react'
import { applyTeamLanguage } from '../../../languageController'
import { normalizeLanguage } from '../../../../shared/i18n'
import { getAppState, getAppStateVersion, subscribeAppState } from '../../lib/appStore'
import { getPendingLanguage } from '../../lib/languageOverride'

/*
 * 全页语言同步：appStore 每次版本推进（= 每次 applyStore / 控制态推送）
 * 都重放一遍 applyTeamLanguage——未迁移的 vanilla 视图每次 render 都会
 * 重建带源文案的 DOM，只有按版本重放才能保持 EN 翻译（与原
 * render() → languageSettingsController.render() 的节奏一致）。
 * pending 乐观语言存在时优先于 store。
 * React 自身渲染的文本在渲染期已是目标语言，TreeWalker 对其幂等。
 */
export function LanguageSync() {
  const version = useSyncExternalStore(subscribeAppState, getAppStateVersion, getAppStateVersion)

  useEffect(() => {
    applyTeamLanguage(getPendingLanguage() ?? normalizeLanguage(getAppState().store.settings.language))
  }, [version])

  return null
}
