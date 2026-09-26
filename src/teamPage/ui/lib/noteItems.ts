import type { OpenTeamStore, RichNoteDocument } from '../../../group/types'
import type { NoteScope } from './noteEditor'

/*
 * 笔记条目与内容的纯派生（原 allNotesView.collectNoteItems /
 * notesView.readNoteContent 迁出）。全部笔记弹窗与笔记面板共用；
 * collectNoteItems 的行为由 noteItems.test.ts 锁定。
 */

export interface NoteListItem {
  id: string
  scope: NoteScope
  chatId?: string
  title: string
  meta: string
  content: RichNoteDocument
  deletedChat: boolean
}

export const EMPTY_NOTE: RichNoteDocument = { type: 'doc', content: [{ type: 'paragraph' }] }

/** 面板内容的唯一读取口：chat 笔记缺省时回退空文档，global 同理 */
export function readNoteContent(store: OpenTeamStore, scope: NoteScope, chatId: string | undefined): RichNoteDocument {
  if (scope === 'chat' && chatId) return store.chatNotesById?.[chatId] ?? EMPTY_NOTE
  return store.globalNote ?? EMPTY_NOTE
}

export function collectNoteItems(store: OpenTeamStore): NoteListItem[] {
  const items: NoteListItem[] = []
  items.push({
    id: 'global',
    scope: 'global',
    title: '全局笔记',
    meta: '手动记录',
    content: store.globalNote ?? EMPTY_NOTE,
    deletedChat: false,
  })

  const chatNotes = store.chatNotesById ?? {}
  const orderedChatIds = [
    ...store.chatOrder,
    ...Object.keys(chatNotes).filter(chatId => !store.chatOrder.includes(chatId)).sort(),
  ]
  for (const chatId of orderedChatIds) {
    const chat = store.chatsById[chatId]
    const content = chatNotes[chatId] ?? EMPTY_NOTE
    if (!chat && isEmptyNote(content)) continue
    items.push({
      id: chatId,
      scope: 'chat',
      chatId,
      title: chat?.name ?? `已删除群聊 ${shortId(chatId)}`,
      meta: chat ? '群聊笔记' : '已删除群聊的笔记',
      content,
      deletedChat: !chat,
    })
  }

  return items
}

function isEmptyNote(document: RichNoteDocument): boolean {
  return notePlainText(document).trim().length === 0
}

function notePlainText(node: RichNoteDocument): string {
  const ownText = typeof node.text === 'string' ? node.text : ''
  const childText = Array.isArray(node.content) ? node.content.map(notePlainText).join(' ') : ''
  return `${ownText} ${childText}`.trim()
}

function shortId(chatId: string): string {
  return chatId.length > 8 ? `${chatId.slice(0, 8)}…` : chatId
}
