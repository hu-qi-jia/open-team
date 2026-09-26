import { useEffect, useState } from 'react'

export type HtmlTheme = 'light' | 'dark'

/*
 * 读取 themeController 写在 <html data-theme> 上的当前主题。
 * shadcn 的 sonner 组件默认依赖 next-themes；非 next-themes 项目的官方改法
 * 就是换成自己的主题 hook——主题唯一事实源仍是 themeController。
 */
export function useHtmlTheme(): HtmlTheme {
  const [theme, setTheme] = useState<HtmlTheme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setTheme(root.dataset.theme === 'light' ? 'light' : 'dark')
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
