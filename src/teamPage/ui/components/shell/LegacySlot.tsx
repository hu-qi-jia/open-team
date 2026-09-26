import { memo, type HTMLAttributes } from 'react'

export interface LegacySlotProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'main' | 'aside' | 'span' | 'section'
  html: string
}

/*
 * 未迁移区域的占位渲染：把原 team.html 的静态标记原样注入，且
 * memo(..., () => true) 让它永不重渲染——vanilla 视图对这些容器做的
 * innerHTML / attribute 修改不会被 React 覆写，也不会因结构变化被重建。
 * 对应区域 React 化时，删除对应 slot、换成真组件。
 */
export const LegacySlot = memo(function LegacySlot({ as: Tag = 'div', html, ...rest }: LegacySlotProps) {
  return <Tag {...rest} dangerouslySetInnerHTML={{ __html: html }} />
}, () => true)
