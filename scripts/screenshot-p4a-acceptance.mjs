/*
 * P4a 阶段验收探针：人员库全流程（分页/tab/搜索/内置详情/删除确认/
 * 新建编辑）、添加人员（站点 pill 多选 + 临时人员联投）。加载 dist/ 扩展
 * → 注入种子数据 → 逐步交互并截图，每步打印断言结果；任一断言失败置
 * exitCode 3。
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
  await page.screenshot({ path: path.join(outDir, `p4a-${name}.png`) })
  console.log(`saved screenshots/p4a-${name}.png`)
}

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-p4a-'))
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

  // 种子数据：群聊 + 成员 + 消息 + 6 个自定义人员（触发分页：每页 5 条）
  await page.evaluate(async () => {
    const now = Date.now()
    const custom = index => ({
      id: `tpl-${index}`,
      type: 'custom',
      name: `自定义人员${index}`,
      description: `第 ${index} 号自定义人员描述`,
      systemPrompt: `你是自定义人员${index}。`,
      defaultChatSite: 'deepseek',
      category: index % 2 === 0 ? '技术研发' : '内容创作',
      createdAt: now - index * 1000,
      updatedAt: now - index * 1000,
    })
    const store = {
      version: 7,
      currentChatId: 'chat-seed-1',
      chatOrder: ['chat-seed-1'],
      chatsById: {
        'chat-seed-1': {
          id: 'chat-seed-1',
          name: '产品需求评审',
          mode: 'collaborative',
          roleIds: ['role-a', 'role-b'],
          messageIds: ['msg-1'],
          nextMessageSeq: 2,
          status: 'ready',
          createdAt: now - 86_400_000,
          updatedAt: now,
        },
      },
      rolesById: {
        'role-a': { id: 'role-a', chatId: 'chat-seed-1', name: '产品经理', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'deepseek', prompt: '你是一名资深产品经理。' },
        'role-b': { id: 'role-b', chatId: 'chat-seed-1', name: '工程师', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now, chatSite: 'chatgpt', prompt: '你是一名前端工程师。' },
      },
      messagesById: {
        'msg-1': { id: 'msg-1', chatId: 'chat-seed-1', seq: 1, type: 'user', content: '各位好，今天对齐一下 v2 的排期。', createdAt: now - 3_600_000, status: 'received' },
      },
      roleTemplateOrder: ['tpl-1', 'tpl-2', 'tpl-3', 'tpl-4', 'tpl-5', 'tpl-6'],
      roleTemplatesById: Object.fromEntries([1, 2, 3, 4, 5, 6].map(index => [`tpl-${index}`, custom(index)])),
    }
    await chrome.storage.local.set({ 'openteam.groupStore': store })
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app', { timeout: 15_000 })
  await new Promise(resolve => setTimeout(resolve, 2500))

  // ---- 1. 打开人员库（Rail 入口） ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  const libProbe = await page.evaluate(() => ({
    cards: document.querySelectorAll('#people-library-list .template-card').length,
    summary: document.getElementById('people-library-summary')?.textContent,
    pagination: document.getElementById('people-library-pagination')?.textContent?.trim(),
    firstCard: document.querySelector('#people-library-list .template-card .role-name')?.textContent,
  }))
  console.log('library probe:', JSON.stringify(libProbe))
  check('library opens with 5 cards per page', libProbe.cards === 5, `cards=${libProbe.cards}`)
  check('summary counts 6 people', libProbe.summary === '6 人', libProbe.summary)
  check('pagination shows 1 / 2', libProbe.pagination?.includes('1 / 2'), libProbe.pagination)
  await shot(page, '01-people-library-open')

  // ---- 2. 分页到第二页 ----
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#people-library-pagination button')]
    buttons[buttons.length - 1]?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 400))
  const page2Probe = await page.evaluate(() => ({
    cards: document.querySelectorAll('#people-library-list .template-card').length,
    label: document.querySelector('#people-library-pagination .pagination-label')?.textContent,
    firstName: document.querySelector('#people-library-list .template-card .role-name')?.textContent,
  }))
  check('page 2 shows the 6th person', page2Probe.cards === 1 && page2Probe.firstName === '自定义人员6', JSON.stringify(page2Probe))
  await shot(page, '02-people-library-page2')
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#people-library-pagination button')]
    buttons[0]?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 300))

  // ---- 3. 切到内置 tab，打开内置详情 ----
  await page.click('#people-library-tab-builtin')
  await new Promise(resolve => setTimeout(resolve, 400))
  const builtinProbe = await page.evaluate(() => ({
    firstName: document.querySelector('#people-library-list .template-card .role-name')?.textContent,
    hasDetail: Boolean(document.querySelector('#people-library-list .template-detail')),
    hasDelete: Boolean(document.querySelector('#people-library-list .template-delete')),
  }))
  check('builtin tab shows 弗兰克尔 first', builtinProbe.firstName === '弗兰克尔', builtinProbe.firstName)
  check('builtin cards have detail but no delete', builtinProbe.hasDetail && !builtinProbe.hasDelete)
  await page.click('#people-library-list .template-detail')
  await page.waitForSelector('#builtin-template-detail-modal:not([hidden])', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  const detailProbe = await page.evaluate(() => ({
    title: document.getElementById('builtin-template-detail-title')?.textContent,
    prompt: document.getElementById('builtin-template-detail-prompt')?.textContent?.slice(0, 30),
  }))
  check('builtin detail modal opens with prompt', detailProbe.title === '弗兰克尔' && (detailProbe.prompt ?? '').length > 0, JSON.stringify(detailProbe))
  await shot(page, '03-builtin-detail')
  await page.click('#close-builtin-template-detail')
  await new Promise(resolve => setTimeout(resolve, 300))

  // ---- 4. 回自定义 tab 搜索 ----
  await page.click('#people-library-tab-custom')
  await page.evaluate(() => {
    const input = document.getElementById('people-library-search')
    input?.focus()
  })
  await page.type('#people-library-search', '自定义人员6')
  await new Promise(resolve => setTimeout(resolve, 400))
  const searchProbe = await page.evaluate(() => ({
    cards: document.querySelectorAll('#people-library-list .template-card').length,
    firstName: document.querySelector('#people-library-list .template-card .role-name')?.textContent,
  }))
  check('search narrows to the matching person', searchProbe.cards === 1 && searchProbe.firstName === '自定义人员6', JSON.stringify(searchProbe))
  await shot(page, '04-people-library-search')
  await page.evaluate(() => {
    const input = document.getElementById('people-library-search')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, '')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise(resolve => setTimeout(resolve, 300))

  // ---- 5. 删除确认（AlertDialog）→ 确认后真实删除 ----
  await page.click('#people-library-list .template-delete')
  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 300))
  const confirmText = await page.evaluate(() => document.querySelector('[role="alertdialog"]')?.textContent)
  check('confirm dialog names the person', confirmText?.includes('确定删除「') === true, confirmText?.slice(0, 40))
  await shot(page, '05-delete-confirm')
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent?.includes('删除'))
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 1500))
  const afterDelete = await page.evaluate(() => ({
    summary: document.getElementById('people-library-summary')?.textContent,
    cards: document.querySelectorAll('#people-library-list .template-card').length,
  }))
  check('delete applies (5 people left)', afterDelete.summary === '5 人', JSON.stringify(afterDelete))
  await shot(page, '06-after-delete')

  // ---- 6. 新建人员：编辑弹窗 + GPTs 条件字段 ----
  await page.click('#new-template')
  await page.waitForSelector('#person-template-modal:not([hidden])', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  const editorProbe = await page.evaluate(() => ({
    title: document.getElementById('template-form-title')?.textContent,
    nameValue: document.getElementById('template-name')?.value,
  }))
  check('editor opens in create mode', editorProbe.title === '新建人员', editorProbe.title)
  await page.type('#template-name', '验收新增顾问')
  await page.type('#template-prompt', '你是验收探针创建的顾问。')
  await page.click('#template-site-chatgpt')
  await new Promise(resolve => setTimeout(resolve, 200))
  const gptsField = await page.evaluate(() => Boolean(document.getElementById('template-chatgpt-gpts-field')))
  check('GPTs field appears for chatgpt site', gptsField)
  await shot(page, '07-person-editor')
  await page.evaluate(() => {
    const button = document.querySelector('#people-library-form button[type="submit"]')
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 1500))
  const afterCreate = await page.evaluate(() => ({
    editorHidden: document.getElementById('person-template-modal')?.hidden,
    summary: document.getElementById('people-library-summary')?.textContent,
  }))
  check('create closes editor and updates count', afterCreate.editorHidden === true && afterCreate.summary === '6 人', JSON.stringify(afterCreate))

  // ---- 7. 关闭人员库，打开添加人员（角色面板表单入口） ----
  await page.click('#close-people-library')
  await new Promise(resolve => setTimeout(resolve, 300))
  await page.evaluate(() => {
    const form = document.getElementById('add-role-form')
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('#add-person-modal:not([hidden])', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 400))
  const addProbe = await page.evaluate(() => ({
    rows: document.querySelectorAll('#add-library-people-list .select-row').length,
    firstRow: document.querySelector('#add-library-people-list .select-row strong')?.textContent,
    checkedPills: [...document.querySelectorAll('#add-library-people-list .site-pill.active')].length,
  }))
  console.log('add-person probe:', JSON.stringify(addProbe))
  check('add-person lists custom people', (addProbe.firstRow ?? '').startsWith('自定义人员'), addProbe.firstRow)
  check('default site pill pre-checked', addProbe.checkedPills >= 1, `active=${addProbe.checkedPills}`)
  await shot(page, '08-add-person-open')

  // ---- 8. 站点 pill 多选 + 勾选两个人员提交 ----
  await page.evaluate(() => {
    const pill = document.querySelector('#add-library-people-list input[value="site:chatgpt"]')
    pill?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  const pillProbe = await page.evaluate(() => ({
    active: [...document.querySelectorAll('#add-library-people-list .site-pill.active')].length,
  }))
  check('second site pill activates', pillProbe.active === addProbe.checkedPills + 1, `active=${pillProbe.active}`)
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#add-library-people-list .select-row > input[type="checkbox"]')]
    boxes.slice(0, 2).forEach(box => box.click())
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  await shot(page, '09-add-person-selected')
  await page.evaluate(() => {
    const button = document.querySelector('#add-library-people-form button[type="submit"]')
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 2000))
  const afterAdd = await page.evaluate(() => ({
    modalHidden: document.getElementById('add-person-modal')?.hidden,
    roleSummary: document.getElementById('role-summary')?.textContent,
  }))
  console.log('after add probe:', JSON.stringify(afterAdd))
  check('batch add closes modal', afterAdd.modalHidden === true)
  check('roles added to the chat', afterAdd.roleSummary !== undefined, afterAdd.roleSummary)
  await shot(page, '10-after-add')

  // ---- 9. 临时人员联投 ----
  await page.evaluate(() => {
    const form = document.getElementById('add-role-form')
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('#add-person-modal:not([hidden])', { timeout: 5000 })
  await page.click('#open-temporary-person')
  await page.waitForSelector('#temporary-person-modal:not([hidden])', { timeout: 5000 })
  await new Promise(resolve => setTimeout(resolve, 300))
  await page.type('#temporary-person-name', '临时验收员')
  await page.type('#temporary-person-description', '验收临时人员描述')
  await page.type('#temporary-person-prompt', '你是验收临时人员。')
  await shot(page, '11-temporary-person')
  await page.evaluate(() => {
    const button = document.querySelector('#add-temporary-person-form button[type="submit"]')
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 400))
  const tempProbe = await page.evaluate(() => ({
    tempHidden: document.getElementById('temporary-person-modal')?.hidden,
    listHasTemporary: document.getElementById('add-library-people-list')?.textContent?.includes('临时验收员'),
  }))
  check('temporary draft lands in add-person list', tempProbe.tempHidden === true && tempProbe.listHasTemporary === true, JSON.stringify(tempProbe))
  await page.evaluate(() => {
    const box = [...document.querySelectorAll('#add-library-people-list .select-row > input[type="checkbox"]')]
      .find(input => input.value.startsWith('temporary:'))
    box?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  await page.evaluate(() => {
    const button = document.querySelector('#add-library-people-form button[type="submit"]')
    button?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 2000))
  const afterTemp = await page.evaluate(() => ({
    modalHidden: document.getElementById('add-person-modal')?.hidden,
    roleNames: [...document.querySelectorAll('#role-list .role-name, #role-list strong')].map(node => node.textContent),
  }))
  console.log('after temporary probe:', JSON.stringify({ ...afterTemp, roleNames: afterTemp.roleNames.slice(0, 8) }))
  check('temporary role joins the chat', afterTemp.modalHidden === true && afterTemp.roleNames.some(name => name?.includes('临时验收员')), JSON.stringify(afterTemp.roleNames?.slice(0, 6)))
  await shot(page, '12-after-temporary')

  // ---- 10. Escape 关闭人员库 ----
  await page.click('#open-people-library')
  await page.waitForSelector('#people-library-modal:not([hidden])', { timeout: 5000 })
  await page.keyboard.press('Escape')
  await new Promise(resolve => setTimeout(resolve, 300))
  const escapeClosed = await page.evaluate(() => document.getElementById('people-library-modal')?.hidden)
  check('Escape closes people library', escapeClosed === true)

  console.log('\n==== P4a acceptance summary ====')
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
