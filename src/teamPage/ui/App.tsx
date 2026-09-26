import { Toaster } from '@/teamPage/ui/components/ui/sonner'

/*
 * P0 阶段 React 仅挂载 sonner 空壳（全局 toast 宿主，暂未被调用——
 * 现有 showError/showSuccess 仍走 #error presenter，P5 收尾时切换）。
 * 壳层骨架自 P1 起在此逐段长出（未迁移区域用 LegacySlot 占位）。
 */
export function App() {
  return <Toaster position="top-center" />
}
