import { memo } from 'react'

/*
 * AI 角色页 iframe 宿主：iframeHost（命令式模块）持有其内部全部 DOM 与
 * dataset 钩子（data-active-chat / data-background-chat 等）。
 * memo(..., () => true) 钉死容器，React 永不触碰其子树。
 */
export const IframeLayer = memo(function IframeLayer() {
  return <div id="iframe-host" className="iframe-host" aria-hidden="true"></div>
}, () => true)
