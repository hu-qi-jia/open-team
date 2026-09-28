import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { GroupMessage, MessageImageAttachment } from '../../../../group/types'
import { createIndexedDbImageAttachmentRepository } from '../../../../shared/imageAttachmentRepository'
import { showError } from '../../lib/toast'
import { createImageObjectUrlCache } from '../../lib/imageObjectUrls'
import { useServices } from '../../context/ServicesContext'
import { handleResyncMessage } from './MessageItem'

/*
 * 消息图片网格（原 renderMessageImageGrid / renderImageAttachment 对译）。
 * 图片仓库与 objectURL 缓存都是模块级单例：仓库是无状态 IndexedDB 包装
 * （与 index.tsx 创建的实例等价），缓存生命周期与页面一致（原为 view 实例
 * 闭包）；「列表不再引用的 URL 释放」由 <Messages> 的 effect 按活跃集调用。
 * S2 Task 6：换 grid utilities 视觉——多图固定两列，单图缩为 w-48 小图；
 * 加载文案由 legacy 的 ::after content 改为显式节点，下载浮层改 ghost
 * 样式（bg-background/80 + backdrop-blur，原图钉悬停加深/禁用隐藏的
 * 行为不变，group/image 命名分组避免吃到 MessageItem 的行级 group）。
 * .message-image-* legacy 规则已退役，类名保留作选择器钩子。
 */
const imageAttachmentRepository = createIndexedDbImageAttachmentRepository()
export const imageCache = createImageObjectUrlCache(id => imageAttachmentRepository.get(id))

export function ImageGrid({ message }: { message: GroupMessage }) {
  const attachments = message.attachments?.filter(attachment => attachment.type === 'image') ?? []
  if (attachments.length === 0) return null
  const count = Math.min(attachments.length, 4)
  const single = count === 1
  return (
    <div className={`message-image-grid image-count-${count} mt-1.5 grid gap-1 ${single ? ' w-48' : ' grid-cols-2'}`}>
      {attachments.map(attachment => (
        <ImageTile key={attachment.id} message={message} attachment={attachment} single={single} />
      ))}
    </div>
  )
}

function ImageTile({ message, attachment, single }: { message: GroupMessage; attachment: MessageImageAttachment; single: boolean }) {
  const services = useServices()
  const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (attachment.status === 'error') return
    let cancelled = false
    imageCache.load(attachment.id)
      .then(url => {
        if (cancelled) {
          if (url) imageCache.release(attachment.id)
          return
        }
        if (!url) return
        setLoadedUrl(url)
      })
      .catch(error => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : '图片读取失败')
      })
    return () => {
      cancelled = true
    }
  }, [attachment.id, attachment.status])

  if (attachment.status === 'error') {
    return (
      <div className="message-image-tile message-image-error flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        <span>{attachment.error || '图片获取失败'}</span>
        <button
          type="button"
          className="message-image-retry cursor-pointer rounded-full bg-muted px-2.5 py-1 text-xs transition-colors hover:bg-accent"
          onClick={event => {
            event.stopPropagation()
            handleResyncMessage(services, message)
          }}
        >重新同步</button>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="message-image-tile message-image-error flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        <span>{loadError}</span>
      </div>
    )
  }

  return (
    <div className={`message-image-tile group/image relative overflow-hidden rounded-md border border-border ${loadedUrl ? '' : ' min-h-[150px] bg-muted/40 message-image-loading'}`}>
      <button
        type="button"
        className="message-image-preview block size-full cursor-zoom-in disabled:cursor-wait"
        aria-label="预览图片"
        disabled={!loadedUrl}
        onClick={() => {
          if (loadedUrl) window.open(loadedUrl, '_blank', 'noopener')
        }}
      >
        {/* 类名与 ${ 之间必须留空白：Tailwind 扫描器会丢弃紧贴 `${` 的候选
            （max-h-[520px]${…} → dist/team.css 不生成该类，长图按原尺寸
            渲染撑爆消息流）。同族写法见 MarkMenu 色钮的 ring-offset-popover。 */}
        <img
          alt={attachment.alt || 'ChatGPT 生成图片'}
          loading="lazy"
          decoding="async"
          width={attachment.width}
          height={attachment.height}
          src={loadedUrl}
          className={`block size-full max-h-[520px] ${single ? ' object-contain' : ' object-cover'}`}
        />
      </button>
      {!loadedUrl && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">图片加载中</span>
      )}
      <button
        type="button"
        className="message-image-download absolute right-2 bottom-2 z-10 flex size-8 items-center justify-center rounded-full bg-background/80 text-foreground opacity-90 shadow-sm backdrop-blur-sm transition-opacity hover:bg-background hover:opacity-100 disabled:pointer-events-none disabled:opacity-0 group-hover/image:opacity-100 group-focus-within/image:opacity-100"
        aria-label="下载图片"
        title="下载图片"
        disabled={!loadedUrl}
        onClick={event => {
          event.stopPropagation()
          downloadImageAttachment(attachment).catch(error => showError(error instanceof Error ? error.message : String(error)))
        }}
      >
        <Download className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

async function downloadImageAttachment(attachment: MessageImageAttachment): Promise<void> {
  const url = await imageCache.load(attachment.id)
  if (!url) throw new Error('本地图片不可用，请重新同步')
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = attachment.fileName || 'chatgpt-image.png'
  anchor.rel = 'noreferrer'
  anchor.click()
}
