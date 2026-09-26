import { useT } from '../../hooks/useT'
import { SettingsMenu } from './SettingsMenu'

/*
 * 左侧导航栏。中间三个按钮（#open-all-notes / #open-people-library /
 * #open-external-models）仍由 vanilla 视图注册事件（allNotesView /
 * peopleLibraryView / externalModelsView 的 registerXEvents 按 id 查找），
 * id 与 SVG 必须与原 team.html 逐字一致；底部设置钮已由 <SettingsMenu/> 接管。
 */
export function Rail() {
  const t = useT()
  return (
    <nav className="rail" aria-label={t('OpenTeam 导航')}>
      <div></div>
      <div className="rail-actions">
        <button className="rail-btn active" type="button" aria-label={t('群聊')} data-tooltip={t('群聊')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M6.5 7.2A6.4 6.4 0 0 1 12 4.8c4 0 7.2 2.6 7.2 5.8s-3.2 5.8-7.2 5.8c-.7 0-1.4-.08-2.1-.25L5.2 18.7l1.15-4.05A5.3 5.3 0 0 1 4.8 10.6c0-1.25.62-2.42 1.7-3.4Z" />
          </svg>
        </button>
        <button id="open-all-notes" className="rail-btn" type="button" aria-label={t('查看全部笔记')} data-tooltip={t('全部笔记')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="5" width="5" height="5" rx="1" />
            <rect x="14" y="5" width="5" height="5" rx="1" />
            <rect x="5" y="14" width="5" height="5" rx="1" />
            <rect x="14" y="14" width="5" height="5" rx="1" />
          </svg>
        </button>
        <button id="open-people-library" className="rail-btn" type="button" aria-label={t('打开人员库')} data-tooltip={t('人员库')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="M12 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" />
            <path d="M5.7 19.2c.65-3.3 2.82-5.15 6.3-5.15s5.65 1.85 6.3 5.15" />
          </svg>
        </button>
        <button id="open-external-models" className="rail-btn" type="button" aria-label={t('添加大模型')} data-tooltip={t('添加大模型')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
            <path d="m12 4.5 6.2 3.55v7.1L12 18.7l-6.2-3.55v-7.1L12 4.5Z" />
            <path d="m5.95 8.25 6.05 3.45 6.05-3.45" />
            <path d="M12 11.7v6.8" />
          </svg>
        </button>
      </div>
      <div className="rail-bottom">
        <SettingsMenu />
      </div>
    </nav>
  )
}
