import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ServicesProvider, type TeamPageServices } from './context/ServicesContext'
import { App } from './App'

/*
 * React 挂载入口（index.tsx 装配完 services 后调用）。
 *
 * - 明确不启用 StrictMode：开发期双挂载会初始化两遍命令式模块
 *   （iframeHost 会加载两次 AI 角色页、TipTap 重复挂载），代价过高。
 * - flushSync：React 要先同步渲染出骨架 DOM（携带 domRefs 需要的全部
 *   id），随后的 createTeamPageDomRefs() 才能取到元素；同步渲染保证时序。
 */
export function mountTeamPageApp(services: TeamPageServices): void {
  const container = document.getElementById('root')
  if (!container) throw new Error('Missing element: #root')
  const root = createRoot(container)
  try {
    flushSync(() => {
      root.render(
        <ServicesProvider services={services}>
          <App />
        </ServicesProvider>,
      )
    })
  } catch (error) {
    // 首帧崩溃不允许无声白屏：此时 vanilla 侧的错误 presenter 尚未创建
    // （依赖 domRefs），直接把错误写进 #root 再原样抛出（保留控制台堆栈）。
    container.textContent = `OpenTeam 页面加载失败：${error instanceof Error ? error.message : String(error)}`
    throw error
  }
}
