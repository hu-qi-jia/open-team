import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * P1 白屏回归网：React 首帧渲染会经 ServicesProvider 挂出整个壳层，
 * index.tsx 的装配顺序一旦回退成「先挂载、后声明 runCommand + getter」，
 * 组件渲染期解构 services 字段就会在真实浏览器里 TDZ 崩溃（jsdom 测试
 * 用的是无 getter 的假 services，抓不到这一类错误），只能靠源码断言锁定。
 */
describe('team page mount order boundary', () => {
  const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.tsx'), 'utf8')
  const mountSource = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/mount.tsx'), 'utf8')

  it('creates the runtime client before mounting React, and mounts before reading domRefs', () => {
    const runtimeClientAt = entrySource.indexOf('const runtimeClient = createTeamPageRuntimeClient(')
    const mountAt = entrySource.indexOf('mountTeamPageApp(teamPageServices)')
    const domRefsAt = entrySource.indexOf('const teamDomRefs = createTeamPageDomRefs()')

    expect(runtimeClientAt).toBeGreaterThan(-1)
    expect(mountAt).toBeGreaterThan(-1)
    expect(domRefsAt).toBeGreaterThan(-1)
    expect(runtimeClientAt).toBeLessThan(mountAt)
    expect(mountAt).toBeLessThan(domRefsAt)
  })

  it('keeps services getter lazy only for iframeHost (render-time destructure safety)', () => {
    expect(entrySource).toContain('get iframeHost() { return iframeHost }')
    expect(entrySource).not.toContain('get runCommand()')
    expect(entrySource).not.toContain('get sendRuntimeMessage()')
    expect(entrySource).not.toContain('get log()')
  })

  it('surfaces first-frame mount failures instead of a silent blank page', () => {
    expect(mountSource).toContain('OpenTeam 页面加载失败')
  })
})
