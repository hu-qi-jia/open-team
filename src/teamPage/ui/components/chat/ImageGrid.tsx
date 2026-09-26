import { useEffect, useState } from 'react'
import type { GroupMessage, MessageImageAttachment } from '../../../../group/types'
import { createIndexedDbImageAttachmentRepository } from '../../../../shared/imageAttachmentRepository'
import { showError } from '../../lib/toast'
import { createImageObjectUrlCache } from '../../lib/imageObjectUrls'
import { useServices } from '../../context/ServicesContext'
import { MessageToolButton, handleResyncMessage } from './MessageItem'

/*
 * 消息图片网格（原 renderMessageImageGrid / renderImageAttachment 对译）。
 * 图片仓库与 objectURL 缓存都是模块级单例：仓库是无状态 IndexedDB 包装
 * （与 index.tsx 创建的实例等价），缓存生命周期与页面一致（原为 view 实例
 * 闭包）；「列表不再引用的 URL 释放」由 <Messages> 的 effect 按活跃集调用。
 */
const imageAttachmentRepository = createIndexedDbImageAttachmentRepository()
export const imageCache = createImageObjectUrlCache(id => imageAttachmentRepository.get(id))

export function ImageGrid({ message }: { message: GroupMessage }) {
  const attachments = message.attachments?.filter(attachment => attachment.type === 'image') ?? []
  if (attachments.length === 0) return null
  return (
    <div className={`message-image-grid image-count-${Math.min(attachments.length, 4)}`}>
      {attachments.map(attachment => (
        <ImageTile key={attachment.id} message={message} attachment={attachment} />
      ))}
    </div>
  )
}

function ImageTile({ message, attachment }: { message: GroupMessage; attachment: MessageImageAttachment }) {
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
      <div className="message-image-tile message-image-error">
        <span>{attachment.error || '图片获取失败'}</span>
        <button
          type="button"
          className="message-image-retry"
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
      <div className="message-image-tile message-image-error">
        <span>{loadError}</span>
      </div>
    )
  }

  return (
    <div className={`message-image-tile ${loadedUrl ? '' : 'message-image-loading'}`}>
      <button
        type="button"
        className="message-image-preview"
        aria-label="预览图片"
        disabled={!loadedUrl}
        onClick={() => {
          if (loadedUrl) window.open(loadedUrl, '_blank', 'noopener')
        }}
      >
        <img
          alt={attachment.alt || 'ChatGPT 生成图片'}
          loading="lazy"
          decoding="async"
          width={attachment.width}
          height={attachment.height}
          src={loadedUrl}
        />
      </button>
      <MessageToolButton
        label="下载图片"
        icon="download"
        className="message-image-download"
        disabled={!loadedUrl}
        onClick={() => {
          downloadImageAttachment(attachment).catch(error => showError(error instanceof Error ? error.message : String(error)))
        }}
      />
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
