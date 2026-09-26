import MarkdownIt from 'markdown-it'
import { extractMarkdownFromDom } from '../../../content/sites/domMarkdown'

/*
 * markdown-it 模块级单例（原 messagesView 的渲染器原样搬入）。
 * html:false 关闭原始 HTML 注入；assistant 内容里混入的站点 HTML 片段
 * （表格/公式等）先经 normalizeAssistantMarkdown 转回 markdown 再渲染。
 */
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, breaks: true })

export function renderMarkdownMessageHtml(content: string): string {
  return markdownRenderer.render(normalizeAssistantMarkdown(content))
}

export function normalizeAssistantMarkdown(content: string): string {
  if (!looksLikeHtmlFragment(content)) return content

  const template = document.createElement('template')
  template.innerHTML = content
  const normalized = extractMarkdownFromDom(template.content)
  return normalized || content
}

function looksLikeHtmlFragment(content: string): boolean {
  return /<(table|thead|tbody|tr|th|td|pre|code|math|mi|mn|mo|msup|msub|mfrac|semantics|annotation|annotation-xml)\b/i.test(content)
}
