/*
 * W2-2 阶段验收探针：全站 shell/chat 按钮换 shadcn Button + legacy 清理——
 * - ChatHeader 五钮（恢复会话/编排/免@/成员/笔记）去掉 btn/drawer-summary 残留；
 * - 免@ 开关的 .manual-mention-toggle 钩子（::before 旋钮 + min-width）仍生效；
 * - ChatList ⋯ 菜单触发钮 asChild 包 Button ghost icon-xs，点击可开菜单；
 * - QuickCreateChat 新建钮 outline；RolePanel 登录/收起/添加人员；
 * - NotesPanel 关闭钮 ghost；删除 .btn/.modal 家族后无样式崩坏；
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
  await page.screenshot({ path: path.join(outDir, `w2-2-${name}.png`) })
  console.log(`saved screenshots/w2-2-${name}.png`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-w2-2-'))
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
        settings: {},
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

  // ---- ChatHeader 五钮：outline + 无 legacy 残留 ----
  const headerProbe = await page.evaluate(() => {
    const ids = ['restore-chat', 'open-orchestration', 'toggle-people-drawer', 'toggle-notes-panel']
    return ids.map(id => {
      const el = document.getElementById(id)
      if (!el) return { id, missing: true }
      return {
        id,
        variant: el.dataset.variant,
        size: el.dataset.size,
        legacyClasses: ['btn', 'drawer-summary'].filter(cls => el.classList.contains(cls)),
      }
    })
  })
  check('header buttons all shadcn outline/sm without legacy classes',
    headerProbe.every(btn => !btn.missing && btn.variant === 'outline' && btn.size === 'sm' && btn.legacyClasses.length === 0),
    JSON.stringify(headerProbe))

  // ---- 免@ 开关：钩子类 + ::before 旋钮仍生效 ----
  const mentionProbe = await page.evaluate(() => {
    const el = document.querySelector('.manual-mention-toggle')
    if (!el) return null
    const style = getComputedStyle(el)
    return {
      variant: el.dataset.variant,
      minWidth: style.minWidth,
      paddingLeft: style.paddingLeft,
      justifyContent: style.justifyContent,
      knobContent: getComputedStyle(el, '::before').content,
    }
  })
  check('免@ keeps manual-mention-toggle hook (min-width + knob)', mentionProbe !== null
    && mentionProbe.variant === 'outline'
    && mentionProbe.minWidth === '72px'
    && mentionProbe.knobContent === '""',
    JSON.stringify(mentionProbe))
  console.log('mention toggle computed:', JSON.stringify(mentionProbe))

  // ---- ChatList ⋯ 菜单：asChild Button ghost icon-xs，点击可开 ----
  // 注：Radix Slot 合并后 data-slot 取 Trigger 的 "dropdown-menu-trigger"，
  // 但 data-variant/data-size 仍来自 Button
  const menuTriggerProbe = await variantOf(page, '.chat-item [data-slot="dropdown-menu-trigger"]')
  check('chat list menu trigger is ghost icon-xs Button', menuTriggerProbe?.variant === 'ghost' && menuTriggerProbe?.size === 'icon-xs', JSON.stringify(menuTriggerProbe))
  await page.click('.chat-item [data-slot="dropdown-menu-trigger"]')
  await sleep(400)
  const menuOpen = await page.evaluate(() => Boolean(document.querySelector('[data-slot="dropdown-menu-content"]')))
  check('chat menu opens via asChild trigger', menuOpen)
  await shot(page, '01-chat-menu-dark')
  await page.keyboard.press('Escape')
  await sleep(300)

  // ---- QuickCreateChat 新建钮 ----
  const quickProbe = await page.evaluate(() => {
    const el = document.getElementById('quick-create-chat')
    if (!el) return null
    return { variant: el.dataset.variant, height: getComputedStyle(el).height }
  })
  check('quick-create-chat outline, compact 28px', quickProbe?.variant === 'outline' && quickProbe?.height === '28px', JSON.stringify(quickProbe))

  await shot(page, '02-main-dark')

  // ---- 成员抽屉（RolePanel）：登录 / 收起 / 添加人员 ----
  await page.click('#toggle-people-drawer')
  await sleep(500)
  const loginProbe = await variantOf(page, '#open-gemini-login')
  check('#open-gemini-login outline icon-sm', loginProbe?.variant === 'outline' && loginProbe?.size === 'icon-sm', JSON.stringify(loginProbe))
  const collapseProbe = await variantOf(page, '#close-people-drawer')
  check('#close-people-drawer outline sm', collapseProbe?.variant === 'outline' && collapseProbe?.size === 'sm', JSON.stringify(collapseProbe))
  const addProbe = await page.evaluate(() => {
    const el = document.querySelector('#add-role-form button[type="submit"]')
    if (!el) return null
    return { variant: el.dataset.variant, width: getComputedStyle(el).width }
  })
  check('add-role submit default sm full-width', addProbe?.variant === 'default' && Number.parseFloat(addProbe?.width ?? '0') > 200, JSON.stringify(addProbe))
  await shot(page, '03-role-panel-dark')
  await page.click('#close-people-drawer')
  await sleep(400)
  const drawerClosed = await page.evaluate(() => document.getElementById('toggle-people-drawer')?.getAttribute('aria-expanded') === 'false')
  check('close-people-drawer collapses drawer', drawerClosed)

  // ---- 笔记面板：关闭钮 ghost icon-sm 28px ----
  await page.click('#toggle-notes-panel')
  await sleep(500)
  const notesCloseProbe = await page.evaluate(() => {
    const el = document.getElementById('close-notes-panel')
    if (!el) return null
    return { variant: el.dataset.variant, size: el.dataset.size, height: getComputedStyle(el).height }
  })
  check('close-notes-panel ghost icon-sm 28px', notesCloseProbe?.variant === 'ghost' && notesCloseProbe?.size === 'icon-sm' && notesCloseProbe?.height === '28px', JSON.stringify(notesCloseProbe))
  await shot(page, '04-notes-dark')
  await page.click('#close-notes-panel')
  await sleep(300)

  // ---- 浅色主题 ----
  await page.click('#theme-light')
  await sleep(400)
  await page.click('#toggle-people-drawer')
  await sleep(500)
  await shot(page, '05-main-role-panel-light')
  await page.click('#theme-dark')
  await sleep(300)

  console.log('\n==== W2-2 acceptance summary ====')
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
