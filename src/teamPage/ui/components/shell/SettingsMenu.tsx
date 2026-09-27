import { normalizeLanguage, type TeamLanguage } from '../../../../shared/i18n'
import type { TeamTheme } from '../../../themeController'
import { Settings as SettingsIcon } from 'lucide-react'
import { agentControlStatusState, agentControlStatusText } from '../../lib/agentControlStatus'
import { useServices } from '../../context/ServicesContext'
import { useHtmlTheme } from '../../hooks/useHtmlTheme'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { applyDocumentLanguage } from '../../lib/documentLanguage'
import { clearPendingLanguage, getPendingLanguage, setPendingLanguage } from '../../lib/languageOverride'
import { showError } from '../../lib/toast'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/*
 * 设置菜单（原 #settings-button + #settings-menu 整体 React 化）：
 * - 主题：RadioGroup，当前值经 useHtmlTheme 读 <html data-theme> 回显，
 *   切换走 services.theme.setTheme（头部 #theme-light/#theme-dark 退役后的入口）
 * - 语言：RadioGroup + 乐观 pending（pendingLanguage 语义见 languageOverride）
 * - 本机智能体控制：CheckboxItem → GROUP_SETTINGS_UPDATE
 * - 状态行：agentControlStatusState/Text 纯函数（同 index.tsx 原 renderAgentControlSettings）
 * 原 vanilla 分支（teamUiController / languageController / peopleLibraryView /
 * externalModelsView 里的菜单开关与关闭）随本组件一并退役。
 */
export function SettingsMenu() {
  const t = useT()
  // 不在渲染期解构服务方法：services 字段保持事件期访问，组件不依赖
  // index.tsx 的装配顺序（见 ServicesContext 的约定说明）。
  const services = useServices()
  const htmlTheme = useHtmlTheme()

  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const agentControlEnabled = useStoreSelector(state => state.store.settings.agentControlEnabled)
  const agentControlState = useStoreSelector(state => agentControlStatusState(state.store, state.controlStatus))
  const agentControlText = useStoreSelector(state => agentControlStatusText(state.store, state.controlStatus))

  const effectiveLanguage = getPendingLanguage() ?? language

  function updateLanguage(next: TeamLanguage): void {
    if (effectiveLanguage === next) return
    setPendingLanguage(next)
    applyDocumentLanguage(next)
    services.runCommand('GROUP_SETTINGS_UPDATE', { language: next })
      .then(() => clearPendingLanguage(next))
      .catch(error => {
        clearPendingLanguage(next)
        applyDocumentLanguage(effectiveLanguage)
        showError(error instanceof Error ? error.message : String(error))
      })
  }

  function toggleAgentControl(): void {
    services.runCommand('GROUP_SETTINGS_UPDATE', { agentControlEnabled: !agentControlEnabled })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id="settings-button"
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('设置')}
        title={t('设置')}
      >
        <SettingsIcon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-56">
        <DropdownMenuLabel>{t('主题')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={htmlTheme} onValueChange={value => services.theme.setTheme(value as TeamTheme)}>
          <DropdownMenuRadioItem value="light">{t('浅色')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('深色')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('语言')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={effectiveLanguage} onValueChange={value => updateLanguage(value as TeamLanguage)}>
          <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh-CN">中文</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={agentControlEnabled} onCheckedChange={() => toggleAgentControl()} onSelect={event => event.preventDefault()}>
          {t('本机智能体控制')}
        </DropdownMenuCheckboxItem>
        <p className="px-2 py-1.5 text-xs text-muted-foreground" data-control-state={agentControlState}>{t(agentControlText)}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
