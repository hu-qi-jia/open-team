// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestrationStage } from '../../../../group/types'
import { ServicesProvider, type TeamPageServices } from '../../context/ServicesContext'
import { edgesCanvasKey, stagesCanvasKey } from '../../lib/orchestrationDraft'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { CanvasPortal } from './CanvasPortal'

/*
 * 编排画布容器 RTL（orchestrationCanvas.test.ts 之上的生命周期补充）。
 * X6 经 services.loadX6 注入 MockGraph（生产为真实动态 import）：
 * - 开弹窗挂载 → 创建图 + 初始渲染（mount 尾部 + 加载完成补渲染）；
 * - canvasKey / storeVersion 变化 → canvas.render（重建节点）；
 * - selectedStageId 变化 → 只走 selectStage 属性改写，不重建图
 *   （原「选中节点不重建画布」断言）；
 * - 卸载 → destroy → graph.dispose。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

class MockGraph {
  static instances: MockGraph[] = []
  nodes: Array<{ id?: string; data?: Record<string, unknown> }> = []
  clearCalls = 0
  addNodeCalls = 0
  attrCalls = 0
  disposeCalls = 0
  handlers = new Map<string, Array<(...args: Array<unknown>) => void>>()

  static latest(): MockGraph {
    const graph = MockGraph.instances[MockGraph.instances.length - 1]
    if (!graph) throw new Error('MockGraph was not mounted')
    return graph
  }

  constructor(public options: Record<string, unknown>) {
    MockGraph.instances.push(this)
  }
  clearCells(): void {
    this.clearCalls += 1
    this.nodes = []
  }
  addNode(node: unknown): unknown {
    this.addNodeCalls += 1
    this.nodes.push(node as { id?: string; data?: Record<string, unknown> })
    return node
  }
  addEdge(edge: unknown): unknown { return edge }
  on(eventName: string, handler: (...args: Array<unknown>) => void): void {
    this.handlers.set(eventName, [...this.handlers.get(eventName) ?? [], handler])
  }
  selectNode(stageId: string): void {
    for (const handler of this.handlers.get('node:click') ?? []) handler({ node: { getData: () => ({ stageId }) } })
  }
  getNodes(): Array<{ getData(): Record<string, unknown>; attr(path: string, value: unknown): void }> {
    return this.nodes.map(node => ({
      getData: () => node.data ?? {},
      attr: () => {
        this.attrCalls += 1
      },
    }))
  }
  dispose(): void {
    this.disposeCalls += 1
  }
}

function makeStage(overrides: Partial<OrchestrationStage> = {}): OrchestrationStage {
  return { id: 'stage-1', kind: 'roles', name: '写作', roleIds: ['role-1'], ...overrides }
}

function keyOf(stages: OrchestrationStage[], edges: Parameters<typeof edgesCanvasKey>[0] = []): string {
  return `${stagesCanvasKey(stages)}|${edgesCanvasKey(edges)}`
}

function portalInner(props: Partial<Parameters<typeof CanvasPortal>[0]> = {}) {
  const stages = props.stages ?? [makeStage()]
  return (
    <CanvasPortal
      stages={stages}
      selectedStageId={props.selectedStageId}
      graphEdges={props.graphEdges ?? []}
      canvasKey={props.canvasKey ?? keyOf(stages)}
      storeVersion={props.storeVersion ?? 1}
      onStageSelected={props.onStageSelected ?? (() => {})}
      onRoleDropped={props.onRoleDropped ?? (() => {})}
      onGraphChanged={props.onGraphChanged ?? (() => {})}
    />
  )
}

function renderPortal(
  props: Partial<Parameters<typeof CanvasPortal>[0]> = {},
  overrides: Partial<TeamPageServices> = {},
) {
  const services = createFakeServices({
    loadX6: (async () => ({ Graph: MockGraph })) as unknown as TeamPageServices['loadX6'],
    ...overrides,
  })
  const utils = renderWithServices(portalInner(props), { services })
  // rerender 必须自带 Provider（RTL 的 rerender 会整体替换渲染树）；
  // 根元素形状与 renderWithServices 的初始包装保持一致，避免整树重挂载
  const rerenderWith = (nextProps: Partial<Parameters<typeof CanvasPortal>[0]> = {}) =>
    utils.rerender(
      <ServicesProvider services={services}>{portalInner(nextProps)}</ServicesProvider>,
    )
  return { ...utils, rerender: rerenderWith }
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  MockGraph.instances = []
})

afterEach(() => {
  cleanup()
})

describe('orchestration canvas portal', () => {
  it('creates the graph once on mount and renders the initial draft after X6 loads', async () => {
    renderPortal()

    await flushAsync()

    expect(MockGraph.instances).toHaveLength(1)
    const graph = MockGraph.latest()
    // mount() 尾部渲染 + 加载完成后用最新草稿补一次渲染
    expect(graph.clearCalls).toBe(2)
    expect(graph.addNodeCalls).toBe(2)
    expect(graph.nodes[0]?.id).toBe('stage-1')
    expect(document.querySelector('#orchestration-stage-canvas')).not.toBeNull()
  })

  it('re-renders when the structural canvas key changes but not for description-only edits', async () => {
    const { rerender } = renderPortal()
    await flushAsync()
    const graph = MockGraph.latest()

    // 描述不在结构签名里：不重画（原视图只在名称输入时重画的节奏）
    rerender({ stages: [makeStage({ description: '改了任务描述' })], canvasKey: keyOf([makeStage({ description: '改了任务描述' })]) })
    await flushAsync()
    expect(graph.clearCalls).toBe(2)
    expect(graph.addNodeCalls).toBe(2)

    // 名称进入签名：重画一次
    rerender({ stages: [makeStage({ name: '审核' })], canvasKey: keyOf([makeStage({ name: '审核' })]) })
    await flushAsync()
    expect(graph.clearCalls).toBe(3)
    expect(graph.addNodeCalls).toBe(3)
  })

  it('re-renders when the store version bumps (role renames etc.)', async () => {
    const { rerender } = renderPortal()
    await flushAsync()
    const graph = MockGraph.latest()

    rerender({ storeVersion: 2 })
    await flushAsync()

    expect(graph.clearCalls).toBe(3)
    expect(graph.addNodeCalls).toBe(3)
  })

  it('updates selection through selectStage without rebuilding the graph', async () => {
    const onStageSelected = vi.fn()
    const { rerender } = renderPortal({ onStageSelected })
    await flushAsync()
    const graph = MockGraph.latest()
    const clearCalls = graph.clearCalls
    const addNodeCalls = graph.addNodeCalls

    rerender({ selectedStageId: 'stage-1', onStageSelected })
    await flushAsync()

    expect(graph.clearCalls).toBe(clearCalls)
    expect(graph.addNodeCalls).toBe(addNodeCalls)
    // selectStage 走节点属性改写（选中描边），而非重建
    expect(graph.attrCalls).toBeGreaterThan(0)
  })

  it('destroys the canvas on unmount', async () => {
    const { unmount } = renderPortal()
    await flushAsync()
    const graph = MockGraph.latest()

    unmount()
    await flushAsync()

    expect(graph.disposeCalls).toBe(1)
  })

  it('forwards node clicks and role drops through the canvas callbacks', async () => {
    const onStageSelected = vi.fn()
    const onRoleDropped = vi.fn()
    renderPortal({ onStageSelected, onRoleDropped })
    await flushAsync()

    MockGraph.latest().selectNode('stage-1')
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { getData: () => 'role-9', types: ['application/x-openteam-role-id'] } })
    act(() => {
      document.querySelector('#orchestration-stage-canvas')!.dispatchEvent(drop)
    })

    expect(onStageSelected).toHaveBeenCalledWith('stage-1')
    // CanvasPortal 的 onRoleDropped 只转发 roleId（落点节点由编排弹窗侧决定）
    expect(onRoleDropped).toHaveBeenCalledWith('role-9')
  })
})
