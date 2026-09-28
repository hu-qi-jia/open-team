import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Boxes, LayoutGrid, Search, Users } from 'lucide-react'
import { useServices } from '../../context/ServicesContext'
import { useT } from '../../hooks/useT'
import { useAppSizeTier } from '../../hooks/useAppShellChrome'
import { useSidebarPrefs } from '../../hooks/useSidebarPrefs'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '../ui/sidebar'
import { Input } from '../ui/input'
import { ChatList } from '../chat/ChatList'
import { QuickCreateChatForm, QuickCreateChatProvider, QuickCreateChatTrigger } from './QuickCreateChat'
import { StoreSummary } from './StoreSummary'
import { SettingsMenu } from './SettingsMenu'
import { SidebarResizeHandle } from './SidebarResizeHandle'

/*
 * 新壳框架（规格 §4.1/§4.2）：SidebarProvider 受控三态——
 * wide → collapsible="icon" + 默认展开（常驻，右缘可拖宽 200–320px）；
 * medium → collapsible="icon" + 默认收起（56px 图标条）；
 * compact → collapsible="offcanvas" + 默认隐藏（ChatHeader 左上按钮唤出）。
 * userOpen（用户手动开合，useSidebarPrefs 持久化）优先于档位默认。
 * Rail 的四个动作（群聊/人员库/全部笔记/添加大模型）在此收编：
 * 前三者入底部工具行，群聊即当前视图。
 */
export function AppShellFrame({ children }: { children: ReactNode }) {
  const t = useT()
  const services = useServices()
  const tier = useAppSizeTier()
  const sidebar = useSidebarPrefs()
  // §4.2 搜索词：组件本地 UI 态（不入 store/持久化），经 prop 下推 ChatList 过滤
  const [chatQuery, setChatQuery] = useState('')

  const collapsible = tier === 'compact' ? 'offcanvas' : 'icon'
  const open = sidebar.userOpen ?? tier === 'wide'

  // 图标条形态下搜索框整行隐藏（见下方 group-data-[collapsible=icon]:hidden），
  // 过滤词若不复位，用户会看到「群少了几个」却无从清除（S2 终审挂账）。
  useEffect(() => {
    if (collapsible === 'icon' && !open) setChatQuery('')
  }, [collapsible, open])

  return (
    <SidebarProvider
      style={{ '--sidebar-width': `${sidebar.width}px` } as CSSProperties}
      open={open}
      onOpenChange={sidebar.setUserOpen}
    >
      <QuickCreateChatProvider>
        <Sidebar collapsible={collapsible}>
          <SidebarHeader>
            {/* 品牌行含规格 §4.2 的折叠按钮（官方 SidebarTrigger，内部走
                toggleSidebar，与 ChatHeader compact 召唤同一 API）：wide 可收起、
                medium 可展开（不再只有 Ctrl/Cmd+B）。图标条形态只留方钮。 */}
            <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center">
              <div className="flex aspect-square size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground group-data-[collapsible=icon]:hidden" aria-hidden="true">O</div>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">OpenTeam</span>
              <SidebarTrigger className="shrink-0" />
            </div>
            <div className="px-2 group-data-[collapsible=icon]:hidden">
              <StoreSummary />{/* 摘要行；图标条形态整行隐藏 */}
            </div>
            <div className="px-2 pb-1.5 group-data-[collapsible=icon]:px-0">
              <QuickCreateChatTrigger />{/* 全宽 primary 观感，样式调整见 QuickCreateChat.tsx */}
            </div>
            {/* 快速建群表单：原位展开（非浮层），展开时把下方 SidebarContent 往下推。
                AppShell v2 建新壳时漏挂了这行（旧 Sidebar.tsx 有、计划里漏写），
                导致触发钮点击后状态翻转却无人消费 = 「点了没反应」。 */}
            <QuickCreateChatForm />
            {/* §4.2 搜索框：受控过滤群列表；图标条形态整行隐藏（同 StoreSummary，
                48px 条内放不下 h-9 输入框，且该档条目本就只露 Avatar） */}
            <div className="px-2 pb-1.5 group-data-[collapsible=icon]:hidden">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={chatQuery}
                  onChange={event => setChatQuery(event.target.value)}
                  className="h-9 pl-8"
                  placeholder={t('搜索群聊')}
                  aria-label={t('搜索群聊')}
                />
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <ChatList query={chatQuery} />{/* #chat-list id 保留；条目为 SidebarMenu/SidebarMenuButton 词汇（§4.2 精修：搜索过滤 + 图标条形态） */}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem className="flex items-center gap-0.5">
                <ToolButton label={t('人员库')} onClick={() => services.uiBus.emit('open-people-library')}><Users className="size-4" /></ToolButton>
                <ToolButton label={t('全部笔记')} onClick={() => services.uiBus.emit('open-all-notes')}><LayoutGrid className="size-4" /></ToolButton>
                <ToolButton label={t('添加大模型')} onClick={() => services.uiBus.emit('open-external-models')}><Boxes className="size-4" /></ToolButton>
                <span className="flex-1" />
                <SettingsMenu />{/* 触发钮类名从 rail-btn 换成 size-8 rounded-md ghost，side="top" */}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        {tier === 'wide' && open && <SidebarResizeHandle />}
        <main id="workspace" className="flex min-w-0 flex-1 flex-col">{children}</main>
      </QuickCreateChatProvider>
    </SidebarProvider>
  )
}

// ToolButton（本文件私有组件）：SidebarMenuButton 的 tooltip 形态——
// 图标条（collapsible=icon）下 sidebar 原语自动展示浮层 tooltip。
function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <SidebarMenuButton asChild tooltip={label} className="size-8 rounded-md text-muted-foreground hover:text-foreground">
      <button type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>
    </SidebarMenuButton>
  )
}
