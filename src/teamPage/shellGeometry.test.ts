// src/teamPage/shellGeometry.test.ts
import { describe, expect, it } from 'vitest'
import { clampShellPoint, clampShellSize, readShellGeometry, writeShellGeometry } from './shellGeometry'

describe('clampShellSize', () => {
  it('钳到最小 520×480', () => {
    expect(clampShellSize(100, 100, 2000, 1200)).toEqual({ width: 520, height: 480 })
  })
  it('钳到视口减边距', () => {
    expect(clampShellSize(4000, 3000, 2000, 1200)).toEqual({ width: 1984, height: 1184 })
  })
  it('中间值原样保留', () => {
    expect(clampShellSize(900, 700, 2000, 1200)).toEqual({ width: 900, height: 700 })
  })
})

describe('clampShellPoint', () => {
  const size = { width: 520, height: 480 }
  it('左上边界钳到 8px 边距', () => {
    expect(clampShellPoint({ x: -50, y: -50 }, size, { width: 2000, height: 1200 })).toEqual({ x: 8, y: 8 })
  })
  it('右下边界不超过视口减尺寸减边距', () => {
    expect(clampShellPoint({ x: 1900, y: 1100 }, size, { width: 2000, height: 1200 })).toEqual({ x: 1472, y: 712 })
  })
})

describe('shell geometry persistence', () => {
  it('write 后 read 还原', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage
    writeShellGeometry(storage, { left: 12, top: 34, width: 900, height: 700 })
    expect(readShellGeometry(storage)).toEqual({ left: 12, top: 34, width: 900, height: 700 })
  })
  it('无存储/损坏数据返回 undefined', () => {
    expect(readShellGeometry(undefined)).toBeUndefined()
    const broken = { getItem: () => '{oops', setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage
    expect(readShellGeometry(broken)).toBeUndefined()
  })
})
