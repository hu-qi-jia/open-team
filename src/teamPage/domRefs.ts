export interface TeamPageDomRefs {
  appShellEl: HTMLElement
  closeWindowEl: HTMLButtonElement
  toggleWindowSizeEl: HTMLButtonElement
  toggleFullscreenEl: HTMLButtonElement
  errorEl: HTMLElement
  themeLightEl: HTMLButtonElement
  themeDarkEl: HTMLButtonElement
  windowLauncherEl: HTMLButtonElement
  windowResizeHandleEl: HTMLButtonElement
  iframeHostEl: HTMLElement
}

export function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element
}

// P4a 起人员库 5 弹窗、P4b 起外部模型弹窗、P4c 起编排弹窗与状态浮层、
// P4d 起群模板弹窗/成员抽屉开关/恢复会话由 React 组件持有 DOM，不再进
// domRefs；剩余条目全部是仍由 vanilla 命令式模块（floatingWindow /
// themeController / iframeHost）直接驱动的元素。
export function createTeamPageDomRefs(): TeamPageDomRefs {
  return {
    appShellEl: requireElement<HTMLElement>('#app'),
    closeWindowEl: requireElement<HTMLButtonElement>('#close-window'),
    toggleWindowSizeEl: requireElement<HTMLButtonElement>('#toggle-window-size'),
    toggleFullscreenEl: requireElement<HTMLButtonElement>('#toggle-fullscreen'),
    errorEl: requireElement<HTMLElement>('#error'),
    themeLightEl: requireElement<HTMLButtonElement>('#theme-light'),
    themeDarkEl: requireElement<HTMLButtonElement>('#theme-dark'),
    windowLauncherEl: requireElement<HTMLButtonElement>('#window-launcher'),
    windowResizeHandleEl: requireElement<HTMLButtonElement>('#window-resize-handle'),
    iframeHostEl: requireElement<HTMLElement>('#iframe-host'),
  }
}
