import { useEffect, useState } from 'react'
import type { ExternalModelConfig, ExternalModelFormat } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { Server } from 'lucide-react'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import { externalModels } from '../../lib/peopleLibrary'
import { showError } from '../../lib/toast'
import { AppModal } from '../common/AppModal'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog'
import { Button } from '../ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'
import { Input } from '../ui/input'

/*
 * 外部模型弹窗（原 externalModelsView React 化，P4b）。W1 起外壳换 Radix
 * Dialog——#external-models-modal id 移到 DialogContent，Escape/遮罩点击关闭经
 * onOpenChange 走 close；删除确认 AlertDialog 移出 Dialog 成为 fragment
 * 兄弟。**S4-T5 起外壳改由公共组合壳 `common/AppModal` 承担**
 * （size="sm" / height="auto"）：id / aria-labelledby / 宽度类 / bg-popover
 * 全部移交 AppModal（编辑器宽度类随之退役，legacy 规则同 commit 删除）；
 * 首开聚焦收敛成壳的 initialFocusId="external-model-name"（原 onOpenAutoFocus
 * 与 queueMicrotask 两处 focus 的等价改写）；正文内边距改由 bodyClassName="p-6"
 * 补回（壳用
 * p-0 收掉了原语基类的 p-6）。height="auto" 还给这个弹窗补上了它从没有过的
 * 高度上限（迁移前它是全库唯一内容可撑破视口的弹窗）。表单控件换官方
 * Input 原语（原生 <select> 保持原生）。内部 id 逐字保留。
 * 对译关系：
 * - 开启入口：Rail 的 #open-external-models → uiBus 'open-external-models'
 *   （打开即重置表单并聚焦名称框，原 openExternalModels）；
 * - 列表 = store 版本驱动派生（外部模型命令经 background 落盘后广播，
 *   applyStore 通知重渲，原 renderExternalModels 手动重渲对译）；
 * - 「测试」→ services.sendRuntimeMessage('EXTERNAL_MODEL_TEST')，按钮
 *   测试中/测试通过 状态 1200ms 后还原（原 testModel）；失败立即还原并
 *   showError（保留 friendlyMessage 优先）；
 * - 「删除」window.confirm → AlertDialog，确认后 EXTERNAL_MODEL_DELETE；
 * - 「编辑」回填表单，「新建」（#reset-external-model-form）清空表单，
 *   提交按 modelId 有无分流 EXTERNAL_MODEL_CREATE / EXTERNAL_MODEL_UPDATE
 *   （原 saveModel）。
 */

interface ExternalModelDraft {
  modelId: string
  name: string
  format: ExternalModelFormat
  baseUrl: string
  apiKey: string
  modelName: string
}

const EMPTY_DRAFT: ExternalModelDraft = {
  modelId: '',
  name: '',
  format: 'openai',
  baseUrl: '',
  apiKey: '',
  modelName: '',
}

type TestPhase = 'testing' | 'passed'

export function ExternalModelsModal() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  // store 版本订阅：外部模型命令经 background 落盘后 applyStore 通知重渲
  useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ExternalModelDraft>(EMPTY_DRAFT)
  const [testState, setTestState] = useState<{ id: string; phase: TestPhase } | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<ExternalModelConfig | undefined>(undefined)

  const ui = (source: string) => translateUi(source, language)

  const models = externalModels(getAppState().store)

  useEffect(() => services.uiBus.on('open-external-models', () => {
    setDraft(EMPTY_DRAFT)
    setOpen(true)
    // 打开即聚焦名称框（原 externalModelNameEl.focus()）——改由壳的
    // initialFocusId="external-model-name" 在内容挂载时承担；生产里唯一的
    // 再触发路径（编排的 ensureExternalApiConfigured）发事件时本弹窗必为
    // 关闭态，仍是「挂载即聚焦」，与迁移前的两处 focus 等价
  }), [services])

  // Escape/遮罩关闭改由 Radix 接管（onOpenChange → close）；原 document
  // 级 Escape 监听随之外移除

  function close(): void {
    setOpen(false)
    setDraft(EMPTY_DRAFT)
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const payload = {
      name: draft.name.trim(),
      format: draft.format === 'anthropic' ? 'anthropic' as const : 'openai' as const,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      modelName: draft.modelName.trim(),
    }
    try {
      if (draft.modelId) {
        await services.runCommand('EXTERNAL_MODEL_UPDATE', { modelId: draft.modelId, ...payload })
      } else {
        await services.runCommand('EXTERNAL_MODEL_CREATE', payload)
      }
      setDraft(EMPTY_DRAFT)
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  async function testModel(model: ExternalModelConfig): Promise<void> {
    setTestState({ id: model.id, phase: 'testing' })
    try {
      const response = await services.sendRuntimeMessage('EXTERNAL_MODEL_TEST', { modelId: model.id })
      if ((response as { ok?: boolean; error?: string }).ok === false) {
        throw new Error((response as { error?: string }).error || '外部模型测试失败')
      }
      setTestState({ id: model.id, phase: 'passed' })
    } catch (error) {
      setTestState(undefined)
      const friendly = (error as { friendlyMessage?: string }).friendlyMessage
      showError(friendly ?? (error instanceof Error ? error.message : String(error)))
      return
    }
    // 测试通过文案停留 1200ms 后还原（原 testModel 的 setTimeout 对译）
    window.setTimeout(() => setTestState(undefined), 1200)
  }

  function confirmDelete(): void {
    if (!deleteTarget) return
    const modelId = deleteTarget.id
    setDeleteTarget(undefined)
    setDraft(EMPTY_DRAFT)
    services.runCommand('EXTERNAL_MODEL_DELETE', { modelId })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  return (
    <>
      <AppModal
        open={open}
        onOpenChange={next => { if (!next) close() }}
        size="sm"
        height="auto"
        contentId="external-models-modal"
        titleId="external-models-title"
        title={ui('外部模型')}
        description={ui('配置 OpenAI 或 Anthropic 兼容 API，人员可直接选择这些模型。')}
        closeId="close-external-models"
        closeLabel={ui('关闭外部模型')}
        onClose={close}
        initialFocusId="external-model-name"
        // 正文内边距靠这里补回来：本弹窗自身不带任何 padding（.modal-form 只有
        // grid/gap/margin），而壳用 p-0 收掉了原语基类的 p-6。height="auto" 下
        // 不再加 overflow-auto——滚动归壳的 max-h 封顶，正文行只做收缩
        bodyClassName="p-6"
      >
        {/* S7/T4：.template-list 规则退役，grid/gap/content-start 由 utilities 承担 */}
        <div id="external-models-list" className="template-list grid content-start gap-2">
          {models.length === 0 ? (
            <Empty className="my-4 p-4">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Server className="size-4" /></EmptyMedia>
                <EmptyTitle className="text-sm font-medium">{ui('暂无外部模型')}</EmptyTitle>
                <EmptyDescription className="text-xs">{ui('在下方表单保存第一个外部模型后，会显示在这里。')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : models.map(model => {
            const phase = testState?.id === model.id ? testState.phase : undefined
            return (
              <Card key={model.id} className="template-card gap-1.5 rounded-lg border-border bg-card p-3 text-left">
                <CardHeader className="gap-1 px-0">
                  <CardTitle className="text-sm font-medium leading-tight">{model.name}</CardTitle>
                  <CardDescription className="text-xs leading-relaxed">{ui(`${model.format === 'anthropic' ? 'Anthropic' : 'OpenAI'} · ${model.modelName}`)}</CardDescription>
                  <CardAction className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="external-model-test"
                      disabled={phase === 'testing'}
                      onClick={() => { void testModel(model) }}
                    >{phase === 'testing' ? ui('测试中') : phase === 'passed' ? ui('测试通过') : ui('测试')}</Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="external-model-edit"
                      onClick={() => setDraft({
                        modelId: model.id,
                        name: model.name,
                        format: model.format,
                        baseUrl: model.baseUrl,
                        apiKey: model.apiKey,
                        modelName: model.modelName,
                      })}
                    >{ui('编辑')}</Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="external-model-delete"
                      onClick={() => setDeleteTarget(model)}
                    >{ui('删除')}</Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="px-0 text-xs text-muted-foreground">{model.baseUrl}</CardContent>
              </Card>
            )
          })}
        </div>
        {/* .modal-form 是共享族（另外三个使用者是 T3/T4 已过审的弹窗，规则留到
            S6）——类名与 legacy 规则都原样保留、只消费 */}
        <form id="external-model-form" className="modal-form mt-3 grid gap-3" onSubmit={event => { void submit(event) }}>
          <input id="external-model-id" type="hidden" value={draft.modelId} readOnly />
          <div className="field grid gap-[7px]">
            <label htmlFor="external-model-name">{ui('显示名称')}</label>
            <Input
              id="external-model-name"
              type="text"
              autoComplete="off"
              placeholder={ui('例如：本地模型')}
              value={draft.name}
              onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="field grid gap-[7px]">
            <label htmlFor="external-model-format">{ui('接口格式')}</label>
            {/* 原生 <select> 保持原生（换 Radix Select 会改键盘与取值行为，S3 的
                RolePanel 与 T3 的人员编辑已定同例）；框体视觉用与 ui/input 同一套
                框体 utilities，不再依赖 legacy 全局 select{} */}
            <select
              id="external-model-format"
              value={draft.format}
              onChange={event => setDraft(current => ({ ...current, format: event.target.value === 'anthropic' ? 'anthropic' : 'openai' }))}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
            >
              <option value="openai">{ui('OpenAI 格式')}</option>
              <option value="anthropic">{ui('Anthropic 格式')}</option>
            </select>
          </div>
          <div className="field grid gap-[7px]">
            <label htmlFor="external-model-base-url">{ui('模型地址')}</label>
            <Input
              id="external-model-base-url"
              type="url"
              autoComplete="off"
              placeholder="https://api.example.com/v1"
              value={draft.baseUrl}
              onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))}
            />
          </div>
          <div className="field grid gap-[7px]">
            <label htmlFor="external-model-api-key">{ui('模型 Key')}</label>
            <Input
              id="external-model-api-key"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))}
            />
          </div>
          <div className="field grid gap-[7px]">
            <label htmlFor="external-model-model-name">{ui('模型名称')}</label>
            <Input
              id="external-model-model-name"
              type="text"
              autoComplete="off"
              placeholder={ui('gpt-4.1 / claude-sonnet')}
              value={draft.modelName}
              onChange={event => setDraft(current => ({ ...current, modelName: event.target.value }))}
            />
          </div>
          <div className="template-actions flex items-center justify-between gap-2.5">
            <Button id="reset-external-model-form" variant="outline" size="sm" type="button" onClick={() => setDraft(EMPTY_DRAFT)}>{ui('新建')}</Button>
            <Button type="submit" size="sm">{ui('保存外部模型')}</Button>
          </div>
        </form>
      </AppModal>

      <AlertDialog open={deleteTarget !== undefined} onOpenChange={nextOpen => { if (!nextOpen) setDeleteTarget(undefined) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ui('删除外部模型')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? ui(`确定删除外部模型「${deleteTarget.name}」吗？`) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{ui('取消')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>{ui('删除')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
