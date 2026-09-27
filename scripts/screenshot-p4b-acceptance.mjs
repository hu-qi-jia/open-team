/*
 * P4b 阶段验收探针：外部模型弹窗（Rail 入口 → 空态 → 新建 → 编辑 →
 * 删除确认 → Escape 关闭）。加载 dist/ 扩展 → 注入种子数据 → 逐步交互
 * 并截图；任一断言失败置 exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `p4b-${name}.png`) })
  console.log(`saved screenshots/p4b-${name}.png`)
}

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-p4b-'))
const browser = await puppeteer.launch({
  headless: true,
  userDataDir,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--no-first-run',
    '--no-default-browser-check',
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

  // 种子数据：一条群聊即可（外部模型从空配置开始）
  await page.evaluate(async () => {
    const now = Date.now()
    const store = {
      version: 7,
      currentChatId: 'chat-seed-1',
      chatOrder: ['chat-seed-1'],
      chatsById: {
        'chat-seed-1': {
          id: 'chat-seed-1',
          name: '产品需求评审',
          mode: 'collaborative',
          roleIds: [],
          messageIds: [],
          nextMessageSeq: 1,
          status: 'ready',
          createdAt: now - 86_400_000,
          updatedAt: now,
        },
      },
      rolesById: {},
      messagesById: {},
    }
    await chrome.storage.local.set({ 'openteam.groupStore': store })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await new Promise(resolve => setTimeout(resolve, 2500))

  // ---- 1. Rail 入口打开 → 空态 ----
  await page.click('#open-external-models')
  await page.waitForSelector('#external-models-modal:not([hidden])', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  const emptyProbe = await page.evaluate(() => ({
    list: document.getElementById('external-models-list')?.textContent?.trim(),
    focused: document.activeElement?.id,
  }))
  check('empty state shows 暂无外部模型', emptyProbe.list === '暂无外部模型', emptyProbe.list)
  check('name field focused on open', emptyProbe.focused === 'external-model-name', emptyProbe.focused)
  await shot(page, '01-external-models-empty')

  // ---- 2. 新建外部模型 ----
  await page.type('#external-model-name', '中转模型')
  await page.select('#external-model-format', 'anthropic')
  await page.type('#external-model-base-url', 'https://relay.example.com/v1')
  await page.type('#external-model-api-key', 'sk-relay-123')
  await page.type('#external-model-model-name', 'claude-sonnet')
  await shot(page, '02-external-models-filled')
  await page.evaluate(() => {
    document.querySelector('#external-model-form button[type="submit"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise(resolve => setTimeout(resolve, 1500))
  const createdProbe = await page.evaluate(() => ({
    card: document.querySelector('#external-models-list .template-card')?.textContent ?? '',
    formName: document.getElementById('external-model-name')?.value,
  }))
  check('created card lists name and format', createdProbe.card.includes('中转模型') && createdProbe.card.includes('Anthropic · claude-sonnet'), createdProbe.card.slice(0, 80))
  check('form resets after save', createdProbe.formName === '', createdProbe.formName)
  await shot(page, '03-external-models-created')

  // ---- 3. 编辑回填并改名 ----
  await page.click('.external-model-edit')
  await new Promise(resolve => setTimeout(resolve, 300))
  const editProbe = await page.evaluate(() => ({
    id: document.getElementById('external-model-id')?.value,
    name: document.getElementById('external-model-name')?.value,
  }))
  check('edit prefills the form', editProbe.id.length > 0 && editProbe.name === '中转模型', JSON.stringify(editProbe))
  await page.evaluate(() => {
    const input = document.getElementById('external-model-name')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.type('#external-model-name', '改名中转')
  await page.evaluate(() => {
    document.querySelector('#external-model-form button[type="submit"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise(resolve => setTimeout(resolve, 1500))
  const renamedProbe = await page.evaluate(() => document.querySelector('#external-models-list .template-card')?.textContent ?? '')
  check('rename applies to the card', renamedProbe.includes('改名中转'), renamedProbe.slice(0, 60))

  // ---- 4. 删除确认 ----
  await page.click('.external-model-delete')
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 300))
  await shot(page, '04-external-models-delete-confirm')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent === '删除')
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 1500))
  const afterDelete = await page.evaluate(() => ({
    list: document.getElementById('external-models-list')?.textContent?.trim(),
  }))
  check('delete returns to empty state', afterDelete.list === '暂无外部模型', afterDelete.list)
  await shot(page, '05-external-models-after-delete')

  // ---- 5. Escape 关闭 ----
  await page.keyboard.press('Escape')
  await new Promise(resolve => setTimeout(resolve, 300))
  const closed = await page.evaluate(() => document.getElementById('external-models-modal')?.hidden)
  check('Escape closes the modal', closed === true)

  console.log('\n==== P4b acceptance summary ====')
  if (failures.length > 0) {
    console.error(`FAILED checks (${failures.length}):`, failures.join(' | '))
    process.exitCode = 3
  } else {
    console.log('all checks passed')
  }
} finally {
  await browser.close()
}

if (consoleErrors.length > 0) {
  console.log(`\nconsole/page errors (${consoleErrors.length}):`)
  for (const line of consoleErrors.slice(0, 20)) console.log('  -', line)
  if (process.exitCode === undefined) process.exitCode = 2
}
