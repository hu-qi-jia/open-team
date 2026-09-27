import { LayoutGrid, MessagesSquare, Boxes } from 'lucide-react'
import { useServices } from '../../context/ServicesContext'
import { useT } from '../../hooks/useT'
import { SettingsMenu } from './SettingsMenu'
import { cn } from '../../lib/utils'

/*
 * 左侧导航栏（V2 起 shadcnblocks 视觉：纵向图标 rail、zinc 中性、
 * lucide 图标、active 态 bg-accent）。#open-all-notes（P3 起）、
 * #open-people-library（P4a 起）与 #open-external-models（P4b 起）点击
 * 经 uiBus 触发对应 React 弹窗；底部设置钮由 <SettingsMenu/> 接管。
 * `.rail` / `.rail-btn` 类与 data-tooltip 保留为钩子（布局在 legacy、
 * tooltip 在 components 层 zinc 化），视觉细节由本组件的工具类驱动。
 */
export function Rail() {
  const t = useT()
  const services = useServices()
  const railBtn = (active?: boolean) =>
    cn(
      'rail-btn flex size-10 items-center justify-center rounded-lg text-muted-foreground',
      'transition-colors hover:bg-accent hover:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      active && 'bg-accent text-foreground',
    )
  return (
    <nav className="rail" aria-label={t('OpenTeam 导航')}>
      <div></div>
      <div className="rail-actions">
        <button className={railBtn(true)} type="button" aria-label={t('群聊')} data-tooltip={t('群聊')}>
          <MessagesSquare className="size-[18px]" aria-hidden="true" />
        </button>
        <button id="open-all-notes" className={railBtn()} type="button" aria-label={t('查看全部笔记')} data-tooltip={t('全部笔记')} onClick={() => services.uiBus.emit('open-all-notes')}>
          <LayoutGrid className="size-[18px]" aria-hidden="true" />
        </button>
        <button id="open-people-library" className={railBtn()} type="button" aria-label={t('打开人员库')} data-tooltip={t('人员库')} onClick={() => services.uiBus.emit('open-people-library')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-[18px]">
            <path d="M12 12.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z" />
            <path d="M5.7 19.2c.65-3.3 2.82-5.15 6.3-5.15s5.65 1.85 6.3 5.15" />
          </svg>
        </button>
        <button id="open-external-models" className={railBtn()} type="button" aria-label={t('添加大模型')} data-tooltip={t('添加大模型')} onClick={() => services.uiBus.emit('open-external-models')}>
          <Boxes className="size-[18px]" aria-hidden="true" />
        </button>
      </div>
      <div className="rail-bottom">
        <SettingsMenu />
      </div>
    </nav>
  )
}
