/*
 * W3-2 阶段验收探针：卡片迁移 shadcn Card 后的回归——
 * - RoleCard → Card（.role-card 锚类 + active 切换 + .role-avatar 保留）；
 * - PeopleLibrary/ExternalModels 卡 → Card + CardHeader/CardAction
 *   （.template-card 数量锚、按钮钩子类 ghost/destructive 保持）；
 * - .template-list align-content:start（少量卡片不整行拉伸）；
 * - 添加人员表单卡：Card 包 form，submit 仍 default w-full；
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
  await page.screenshot({ path: path.join(outDir, `w3-2-${name}.png`) })
  console.log(`saved screenshots/w3-2-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w3-2-'))
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

  await page.evaluate(async () => {
    const now = Date.now()
    const chat = {
      id: 'chat-seed-1',
      name: '产品需求评审',
      mode: 'collaborative',
      roleIds: ['role-pm', 'role-dev'],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'ready',
      createdAt: now - 86_400_000,
      updatedAt: now,
    }
    const roles = [
      { id: 'role-pm', chatId: chat.id, name: '产品', chatSite: 'chatgpt', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责需求拆解' },
      { id: 'role-dev', chatId: chat.id, name: '研发', chatSite: 'deepseek', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, description: '负责技术方案' },
    ]
    await chrome.storage.local.set({
      'openteam.groupStore': {
        version: 7,
        currentChatId: chat.id,
        chatOrder: [chat.id],
        chatsById: { [chat.id]: chat },
        rolesById: Object.fromEntries(roles.map(role => [role.id, role])),
        messagesById: {},
        orchestrationFlowsById: {},
        orchestrationRunsById: {},
        activeOrchestrationRunIdByChatId: {},
        settings: {
          externalModelOrder: ['external-model-1'],
          externalModelsById: {
            'external-model-1': { id: 'external-model-1', name: '本地模型', format: 'openai', baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', modelName: 'local-chat-model', createdAt: now, updatedAt: now },
          },
        },
      },
    })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await sleep(2000)

  const variantOf = (page, selector) => page.evaluate(sel => {
    const el = document.querySelector(sel)
    return el instanceof HTMLElement ? { variant: el.dataset.variant, size: el.dataset.size } : null
  }, selector)

  // ---- 人员库：Card 化卡片 ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(500)
  const libraryProbe = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#people-library-list .template-card')]
    return {
      count: cards.length,
      asCard: cards.filter(el => el.getAttribute('data-slot') === 'card').length,
      withTitle: cards.filter(el => el.querySelector('[data-slot="card-title"]')).length,
      withAction: cards.filter(el => el.querySelector('[data-slot="card-action"] .template-detail')).length,
    }
  })
  check('library cards are Card with title + action', libraryProbe.count >= 1
    && libraryProbe.count === libraryProbe.asCard
    && libraryProbe.count === libraryProbe.withTitle
    && libraryProbe.count === libraryProbe.withAction, JSON.stringify(libraryProbe))
  const alignProbe = await page.evaluate(() => getComputedStyle(document.getElementById('people-library-list')).alignContent)
  check('.template-list align-content: start', alignProbe === 'start', alignProbe)
  const detailVariant = await variantOf(page, '#people-library-list .template-detail')
  check('template-detail stays ghost sm', detailVariant?.variant === 'ghost' && detailVariant?.size === 'sm', JSON.stringify(detailVariant))
  await shot(page, '01-people-library-dark')
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)

  // ---- 外部模型：Card + CardAction 三钮 ----
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal', { timeout: 5000 })
  await sleep(400)
  const modelProbe = await page.evaluate(() => {
    const card = document.querySelector('#external-models-list .template-card')
    if (!card) return null
    const testBtn = card.querySelector('.external-model-test')
    const editBtn = card.querySelector('.external-model-edit')
    const deleteBtn = card.querySelector('.external-model-delete')
    return {
      asCard: card.getAttribute('data-slot') === 'card',
      baseUrlInContent: Boolean(card.querySelector('[data-slot="card-content"]')?.textContent.includes('api.example.test')),
      test: testBtn?.dataset.variant,
      edit: editBtn?.dataset.variant,
      del: deleteBtn?.dataset.variant,
    }
  })
  check('external model card is Card, baseUrl in content, ghost/ghost/destructive', modelProbe !== null
    && modelProbe.asCard && modelProbe.baseUrlInContent
    && modelProbe.test === 'ghost' && modelProbe.edit === 'ghost' && modelProbe.del === 'destructive', JSON.stringify(modelProbe))
  await shot(page, '02-external-models-dark')
  await page.evaluate(() => { document.getElementById('close-external-models')?.click() })
  await sleep(400)

  // ---- 成员抽屉：RoleCard + active 切换 + 表单卡 ----
  await page.click('#toggle-people-drawer')
  await sleep(500)
  const roleProbe = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.role-card')]
    return {
      count: cards.length,
      asCard: cards.filter(el => el.getAttribute('data-slot') === 'card').length,
      withAvatar: cards.filter(el => el.querySelector('.role-avatar')).length,
      activeCount: cards.filter(el => el.classList.contains('active')).length,
    }
  })
  check('role cards are Card with avatar, one active', roleProbe.count === 2
    && roleProbe.count === roleProbe.asCard
    && roleProbe.count === roleProbe.withAvatar
    && roleProbe.activeCount === 1, JSON.stringify(roleProbe))

  const cards = await page.$$('.role-card')
  await cards[1].click()
  await sleep(300)
  const activeAfter = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.role-card')]
    return { activeIndex: list.findIndex(el => el.classList.contains('active')) }
  })
  check('clicking second role card toggles active', activeAfter.activeIndex === 1, JSON.stringify(activeAfter))

  const formProbe = await page.evaluate(() => {
    const form = document.getElementById('add-role-form')
    const card = form?.closest('[data-slot="card"]')
    const submit = form?.querySelector('button[type="submit"]')
    return {
      formInCard: Boolean(card),
      submitVariant: submit?.dataset.variant,
      submitWidth: submit ? getComputedStyle(submit).width : null,
    }
  })
  check('add-role form inside Card, submit default full-width', formProbe.formInCard
    && formProbe.submitVariant === 'default'
    && Number.parseFloat(formProbe.submitWidth ?? '0') > 200, JSON.stringify(formProbe))
  await shot(page, '03-role-panel-dark')

  // ---- 浅色主题 ----
  // 注意：#theme-light / #open-people-library 均在抽屉外，点击会触发
  // RolePanel 的「抽屉外点关闭」（原行为保留），所以开库前/后需重开抽屉
  await page.click('#theme-light')
  await sleep(400)
  await page.click('#toggle-people-drawer')
  await sleep(400)
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal', { timeout: 5000 })
  await sleep(500)
  await shot(page, '04-people-library-light')
  await page.evaluate(() => { document.getElementById('close-people-library')?.click() })
  await sleep(400)
  await page.click('#toggle-people-drawer')
  await sleep(400)
  await shot(page, '05-role-panel-light')
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W3-2 acceptance summary ====')
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
