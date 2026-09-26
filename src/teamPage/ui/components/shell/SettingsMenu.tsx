import { normalizeLanguage, type TeamLanguage } from '../../../../shared/i18n'
import { agentControlStatusState, agentControlStatusText } from '../../../agentControlStatusView'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { applyTeamLanguage } from '../../../languageController'
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
 * - 语言：RadioGroup + 乐观 pending（pendingLanguage 语义见 languageOverride）
 * - 本机智能体控制：CheckboxItem → GROUP_SETTINGS_UPDATE
 * - 状态行：agentControlStatusState/Text 纯函数（同 index.tsx 原 renderAgentControlSettings）
 * 原 vanilla 分支（teamUiController / languageController / peopleLibraryView /
 * externalModelsView 里的菜单开关与关闭）随本组件一并退役。
 */
export function SettingsMenu() {
  const t = useT()
  const { runCommand } = useServices()

  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const agentControlEnabled = useStoreSelector(state => state.store.settings.agentControlEnabled)
  const agentControlState = useStoreSelector(state => agentControlStatusState(state.store, state.controlStatus))
  const agentControlText = useStoreSelector(state => agentControlStatusText(state.store, state.controlStatus))

  const effectiveLanguage = getPendingLanguage() ?? language

  function updateLanguage(next: TeamLanguage): void {
    if (effectiveLanguage === next) return
    setPendingLanguage(next)
    applyTeamLanguage(next)
    runCommand('GROUP_SETTINGS_UPDATE', { language: next })
      .then(() => clearPendingLanguage(next))
      .catch(error => {
        clearPendingLanguage(next)
        applyTeamLanguage(effectiveLanguage)
        showError(error instanceof Error ? error.message : String(error))
      })
  }

  function toggleAgentControl(): void {
    runCommand('GROUP_SETTINGS_UPDATE', { agentControlEnabled: !agentControlEnabled })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger id="settings-button" className="rail-btn" aria-label={t('设置')} title={t('设置')}>⚙</DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-56">
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
