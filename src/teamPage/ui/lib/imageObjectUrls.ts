import type { GroupMessage } from '../../../group/types'
import type { ImageAttachmentBlobRecord } from '../../../shared/imageAttachmentRepository'

/*
 * 图片 objectURL 缓存（原 messagesView 的 imageObjectUrls / imageLoadPromises
 * 原样迁移）：按附件 id 缓存 blob URL，in-flight 去重，未再被当前消息列表
 * 引用的 URL 在每次列表刷新时释放。
 */
export interface ImageObjectUrlCache {
  load(attachmentId: string): Promise<string | undefined>
  releaseUnused(activeIds: Set<string>): void
  release(attachmentId: string): void
}

export function createImageObjectUrlCache(
  loadImageAttachment: (id: string) => Promise<ImageAttachmentBlobRecord | undefined>,
): ImageObjectUrlCache {
  const imageObjectUrls = new Map<string, string>()
  const imageLoadPromises = new Map<string, Promise<string | undefined>>()

  async function load(attachmentId: string): Promise<string | undefined> {
    const cached = imageObjectUrls.get(attachmentId)
    if (cached) return cached
    const pending = imageLoadPromises.get(attachmentId)
    if (pending) return pending

    const promise = (async () => {
      const record = await loadImageAttachment(attachmentId)
      if (!record) throw new Error('本地图片不可用，请重新同步')
      const url = URL.createObjectURL(record.blob)
      imageObjectUrls.set(attachmentId, url)
      return url
    })().finally(() => {
      imageLoadPromises.delete(attachmentId)
    })
    imageLoadPromises.set(attachmentId, promise)
    return promise
  }

  function releaseUnused(activeIds: Set<string>): void {
    for (const attachmentId of imageObjectUrls.keys()) {
      if (!activeIds.has(attachmentId)) release(attachmentId)
    }
  }

  function release(attachmentId: string): void {
    const url = imageObjectUrls.get(attachmentId)
    if (!url) return
    URL.revokeObjectURL(url)
    imageObjectUrls.delete(attachmentId)
  }

  return { load, releaseUnused, release }
}

/** 当前消息列表引用的全部就绪图片附件 id（releaseUnused 的活跃集）。 */
export function collectActiveImageIds(messages: GroupMessage[]): Set<string> {
  return new Set(messages
    .flatMap(message => message.attachments ?? [])
    .filter(attachment => attachment.status === 'ready')
    .map(attachment => attachment.id))
}
