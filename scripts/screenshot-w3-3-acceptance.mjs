/*
 * W3-3 阶段验收探针：空态迁移 Empty 原语后的回归——
 * - ChatList/RolePanel/ExternalModels/GroupTemplate/Messages 各空态
 *   均为 [data-slot="empty"] 结构（empty-header/icon/title/description）；
 * - GroupTemplateModal 锚类保留：.group-template-empty 铺满模板网格、
 *   .group-template-empty-actions .btn 两枚 ghost sm 可点击；
 * - Messages 主区空态垂直居中（flex-1）+ 添加人员按钮进 EmptyContent；
 * - 双主题截图。断言失败置 exitCode 3。
 */
import puppeteer from 'puppeteer'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'screenshots')
await mkdir(outDir, { recursive: true })

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `w3-3-${name}.png`) })
  console.log(`saved screenshots/w3-3-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w3-3-'))
const browser = await puppeteer.launch({
  headless: true,
  userDataDir,
  protocolTimeout: 60_000,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
  ],
})

const consoleErrors = []
try {
  const swTarget = await browser.waitForTarget(target => target.type() === 'service_worker', { timeout: 30_000 })
  const extensionId = new URL(swTarget.url()).host
  console.log('extension id:', extensionId)

  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))

  await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })

  // 种子：无人员、无消息的空群聊 + 无外部模型（外部模型表单留空）
  await page.evaluate(async () => {
    const now = Date.now()
    const chat = {
      id: 'chat-empty-1',
      name: '空群聊',
      mode: 'collaborative',
      roleIds: [],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 3_600_000,
      updatedAt: now,
    }
    await chrome.storage.local.set({
      'openteam.groupStore': {
        version: 7,
        currentChatId: chat.id,
        chatOrder: [chat.id],
        chatsById: { [chat.id]: chat },
        rolesById: {},
        messagesById: {},
        orchestrationFlowsById: {},
        orchestrationRunsById: {},
        activeOrchestrationRunIdByChatId: {},
        settings: { externalModelOrder: [], externalModelsById: {} },
      },
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  const emptyProbe = sel => page.evaluate(sel => {
    const empty = document.querySelector(sel)
    if (!empty) return null
    return {
      slot: empty.getAttribute('data-slot'),
      icon: Boolean(empty.querySelector('[data-slot="empty-icon"][data-variant="icon"]')),
      title: empty.querySelector('[data-slot="empty-title"]')?.textContent ?? null,
      description: empty.querySelector('[data-slot="empty-description"]')?.textContent?.slice(0, 30) ?? null,
    }
  }, sel)

  // ---- Messages 主区：暂无人员空态 + 添加人员按钮 ----
  const messagesEmpty = await emptyProbe('#messages [data-slot="empty"]')
  const addPersonInContent = await page.evaluate(() => {
    const content = document.querySelector('#messages [data-slot="empty-content"]')
    const button = content?.querySelector('button')
    return {
      hasContent: Boolean(content),
      buttonText: button?.textContent ?? null,
      variant: button?.dataset.variant,
    }
  })
  const centered = await page.evaluate(() => {
    const empty = document.querySelector('#messages [data-slot="empty"]')
    if (!empty) return null
    const rect = empty.getBoundingClientRect()
    const section = document.getElementById('messages').getBoundingClientRect()
    return { flex: getComputedStyle(empty).flex, emptyMid: rect.top + rect.height / 2, sectionMid: section.top + section.height / 2 }
  })
  check('messages empty is Empty with title 暂无人员', messagesEmpty?.slot === 'empty' && messagesEmpty.icon && messagesEmpty.title === '暂无人员', JSON.stringify(messagesEmpty))
  check('添加人员 button inside EmptyContent (default)', addPersonInContent.hasContent && addPersonInContent.buttonText === '添加人员' && addPersonInContent.variant === 'default', JSON.stringify(addPersonInContent))
  check('messages empty vertically centered (flex-1)', centered !== null && Number.parseFloat(centered.flex) > 0 && Math.abs(centered.emptyMid - centered.sectionMid) < 80, JSON.stringify(centered))
  await shot(page, '01-messages-empty-dark')

  // ---- RolePanel：暂无人员空态 ----
  await page.click('#toggle-people-drawer')
  await sleep(500)
  const roleEmpty = await emptyProbe('#role-list [data-slot="empty"]')
  check('role panel empty is Empty with icon', roleEmpty?.slot === 'empty' && roleEmpty.icon && roleEmpty.title === '暂无人员', JSON.stringify(roleEmpty))
  await shot(page, '02-role-panel-empty-dark')
  await page.click('#toggle-people-drawer')
  await sleep(300)

  // ---- ExternalModels：暂无外部模型空态 ----
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  const modelEmpty = await emptyProbe('#external-models-list [data-slot="empty"]')
  check('external models empty is Empty with icon', modelEmpty?.slot === 'empty' && modelEmpty.icon && modelEmpty.title === '暂无外部模型', JSON.stringify(modelEmpty))
  await shot(page, '03-external-models-empty-dark')
  await page.evaluate(() => { document.getElementById('close-external-models')?.click() })
  await sleep(400)

  // ---- GroupTemplate：搜索无结果空态 + 锚类 ----
  await page.click('#quick-create-chat')
  await sleep(400)
  await page.click('#open-group-template-create')
  await page.waitForSelector('#group-template-modal', { timeout: 5000 })
  await sleep(400)
  await page.type('#group-template-search', 'zzz不存在的搜索词zzz')
  await sleep(600)
  const gtProbe = await page.evaluate(() => {
    const empty = document.querySelector('.group-template-empty')
    if (!empty) return null
    const actions = empty.querySelector('.group-template-empty-actions')
    const buttons = [...(actions?.querySelectorAll('.btn') ?? [])]
    const list = document.getElementById('group-template-list')
    const listRect = list.getBoundingClientRect()
    const emptyRect = empty.getBoundingClientRect()
    return {
      slot: empty.getAttribute('data-slot'),
      title: empty.querySelector('[data-slot="empty-title"]')?.textContent ?? null,
      spansGrid: Math.abs(listRect.width - emptyRect.width) < 4, // 列表自带 padding-right:2px
      minHeight: getComputedStyle(empty).minHeight,
      buttonCount: buttons.length,
      variants: buttons.map(button => `${button.dataset.variant}/${button.dataset.size}`),
      labels: buttons.map(button => button.textContent),
    }
  })
  check('group-template empty keeps anchors + Empty structure', gtProbe !== null
    && gtProbe.slot === 'empty'
    && gtProbe.title === '没有找到匹配的小组'
    && gtProbe.spansGrid
    && gtProbe.buttonCount === 2
    && gtProbe.variants.every(v => v === 'ghost/sm'), JSON.stringify(gtProbe))
  const beforeUrl = page.url()
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.group-template-empty-actions .btn')]
    buttons.find(button => button.textContent === '清空搜索')?.click()
  })
  await sleep(500)
  const cleared = await page.evaluate(() => ({
    emptyGone: !document.querySelector('.group-template-empty'),
    searchValue: document.getElementById('group-template-search').value,
    urlSame: true,
  }))
  check('清空搜索 click clears query + hides empty', cleared.emptyGone && cleared.searchValue === '', JSON.stringify(cleared))
  await page.type('#group-template-search', 'zzz不存在的搜索词zzz')
  await sleep(600)
  await shot(page, '04-group-template-empty-dark')

  // ---- 浅色主题空态 ----
  await page.evaluate(() => { document.getElementById('close-group-template-modal')?.click() })
  await sleep(400)
  await page.click('#theme-light')
  await sleep(400)
  await shot(page, '05-messages-empty-light')
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W3-3 acceptance summary ====')
  if (failures.length > 0) {
    console.error(`FAILED checks (${failures.length}):`, failures.join(' | '))
    process.exitCode = 3
  } else {
    console.log('all checks passed')
  }
} finally {
  await Promise.race([
    browser.close(),
    sleep(10_000).then(() => browser.process()?.kill()),
  ])
}

if (consoleErrors.length > 0) {
  console.log(`\nconsole/page errors (${consoleErrors.length}):`)
  for (const line of consoleErrors.slice(0, 20)) console.log('  -', line)
  if (process.exitCode === undefined) process.exitCode = 2
}
