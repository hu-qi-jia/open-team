import { createRoot } from 'react-dom/client'
import { ServicesProvider, type TeamPageServices } from './context/ServicesContext'
import { App } from './App'

/*
 * React 挂载入口（index.tsx 装配完 services 后调用）。
 *
 * - 明确不启用 StrictMode：开发期双挂载会初始化两遍命令式模块
 *   （iframeHost 会加载两次 AI 角色页、TipTap 重复挂载），代价过高。
 * - P5 起改为普通并发渲染（不再强制同步提交）：返回的
 *   Promise 在 AppShell 骨架（#app，携带 vanilla 模块需要的全部 id）
 *   提交后 resolve，index.tsx 的 .then() 再查询元素并装配 vanilla 模块。
 *   超时视为渲染失败，交给调用方 showError，避免无声白屏。
 */
export function mountTeamPageApp(services: TeamPageServices): Promise<void> {
  const container = document.getElementById('root')
  if (!container) throw new Error('Missing element: #root')
  const root = createRoot(container)
  root.render(
    <ServicesProvider services={services}>
      <App />
    </ServicesProvider>,
  )

  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 10_000
    const waitForShell = () => {
      if (document.getElementById('app')) {
        resolve()
        return
      }
      if (performance.now() >= deadline) {
        reject(new Error('React 骨架渲染超时（#app 未出现）'))
        return
      }
      requestAnimationFrame(waitForShell)
    }
    requestAnimationFrame(waitForShell)
  })
}
