import { toast as sonnerToast } from 'sonner'

/*
 * 全页错误/成功出口（P5 起 vanilla #error presenter 已退役，统一走
 * sonner；宿主由 App 挂载，index.tsx 的装配/运行时错误同样经此提示）。
 */
export function showError(message: string): void {
  sonnerToast.error(message)
}

export function showSuccess(message: string): void {
  sonnerToast.success(message)
}
