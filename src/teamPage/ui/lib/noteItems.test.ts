import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '../../../group/store'
import type { OpenTeamStore, RichNoteDocument } from '../../../group/types'
import { collectNoteItems } from './noteItems'

/*
 * 全部笔记弹窗的条目收集纯函数（原 allNotesView.test 的 collectNoteItems
 * 用例随迁）。全局、现存群聊、已删除群聊笔记的排序与文案在此锁定。
 */
describe('collectNoteItems', () => {
  it('collects global, live chats, and deleted chat notes for the notebook sidebar', () => {
    const liveChat = makeChat('chat-live', '产品群')
    const emptyChat = makeChat('chat-empty', '空笔记群')
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      chatOrder: [liveChat.id, emptyChat.id],
      chatsById: { [liveChat.id]: liveChat, [emptyChat.id]: emptyChat },
      globalNote: note('全局记录'),
      chatNotesById: {
        [liveChat.id]: note('群聊记录'),
        'chat-deleted-123456': note('删除后还在的记录'),
      },
    }

    const items = collectNoteItems(store)

    expect(items.map(item => item.title)).toEqual(['全局笔记', '产品群', '空笔记群', '已删除群聊 chat-del…'])
    expect(items.map(item => item.meta)).toEqual(['手动记录', '群聊笔记', '群聊笔记', '已删除群聊的笔记'])
  })

  it('skips empty notes of deleted chats and keeps the global entry first', () => {
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      chatNotesById: {
        'chat-deleted-empty': { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    }

    const items = collectNoteItems(store)

    expect(items.map(item => item.id)).toEqual(['global'])
  })
})

function makeChat(id: string, name: string): OpenTeamStore['chatsById'][string] {
  return {
    id,
    name,
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
}

function note(text: string): RichNoteDocument {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
