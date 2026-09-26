import { getAllRoleTemplates } from '../../../../group/roleTemplates'
import { useT } from '../../hooks/useT'
import { useStoreSelector } from '../../hooks/useStoreSelector'

/*
 * 侧栏摘要行：「N 个群聊 · N 个人员库人员」。
 * selector 只返回原始值（数量），由 chatListView 迁移而来（P1 起本组件
 * 是 #store-summary 的唯一写入方）。
 */
export function StoreSummary() {
  const t = useT()
  const chatCount = useStoreSelector(state => state.store.chatOrder.length)
  const templateCount = useStoreSelector(state => getAllRoleTemplates(state.store).length)
  return <p id="store-summary" className="tiny">{t(`${chatCount} 个群聊 · ${templateCount} 个人员库人员`)}</p>
}
