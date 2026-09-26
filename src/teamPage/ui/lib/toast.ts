import { toast as sonnerToast } from 'sonner'

/*
 * React 组件的错误/成功出口（sonner 宿主由 App 挂载）。
 * 与 vanilla 侧 #error presenter（teamPageServices.createErrorPresenter）并存；
 * P5 清理阶段 vanilla presenter 退役后二者合一。
 */
export function showError(message: string): void {
  sonnerToast.error(message)
}

export function showSuccess(message: string): void {
  sonnerToast.success(message)
}
