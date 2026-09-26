import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { createTeamPageState, type TeamPageState } from '../../appState'
import type { ImageAttachmentRepository } from '../../../shared/imageAttachmentRepository'
import { ServicesProvider, type TeamPageServices } from '../context/ServicesContext'
import { bindAppState } from '../lib/appStore'
import { createUiBus } from '../lib/uiBus'

/*
 * RTL 测试的统一装配：假 services（无 chrome 依赖）+ bindAppState 的
 * 隔离 state。bindAppState 是全局单例，每个用例重绑实现文件内隔离。
 */
export function createFakeServices(overrides: Partial<TeamPageServices> = {}): TeamPageServices {
  const logStub = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logStub,
  }
  return {
    runCommand: vi.fn(async () => undefined),
    sendRuntimeMessage: vi.fn(async () => ({ ok: true })) as TeamPageServices['sendRuntimeMessage'],
    iframeHost: {} as TeamPageServices['iframeHost'],
    imageAttachmentRepository: {} as ImageAttachmentRepository,
    uiBus: createUiBus(),
    log: logStub,
    ...overrides,
  }
}

export interface RenderWithServicesOptions extends RenderOptions {
  services?: TeamPageServices
  state?: TeamPageState
}

export function renderWithServices(ui: ReactElement, options: RenderWithServicesOptions = {}) {
  const { services = createFakeServices(), state = createTeamPageState(), ...renderOptions } = options
  // jsdom 的 navigator.language 是 en-US，defaultLanguageForEnvironment 会把
  // 默认 store 语言定为 en；组件断言以中文源文案书写，这里统一回中文，
  // 语言切换行为由 SettingsMenu 的专用用例显式覆盖。
  state.store.settings.language = 'zh-CN'
  bindAppState(state)
  const utils = render(
    <ServicesProvider services={services}>{ui}</ServicesProvider>,
    renderOptions,
  )
  return { ...utils, services, state }
}
