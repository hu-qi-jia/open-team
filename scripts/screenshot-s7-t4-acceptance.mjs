/**
 * S7/T4 专项截图：壳层/列表/主题/模式/模板卡族 utilities 化的明暗目检。
 *
 * 场景（dark + light 各一轮）：
 *  - t4-shell       主界面（chat-list 头像浅色描边 / 品牌行 / 底部工具行）
 *  - t4-quickform   快速建群表单展开（mode-option 底色 / radio 14px /
 *                   mode-help 行高 / template-row 分隔线 + ghost 按钮）
 *  - t4-launcher    minimized 后的 #window-launcher 特写（暗渐变圆钮 / 亮白底）
 *
 * 运行：node scripts/screenshot-s7-t4-acceptance.mjs（需先 npm run build）
 */
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const outDir = path.join(root, 'screenshots')
await mkdir(outDir, { recursive: true })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const userDataDir = await mkdtemp(path.join(tmpdir(), 'openteam-s7t4-'))
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

try {
  const swTarget = await browser.waitForTarget(target => target.type() === 'service_worker', { timeout: 30_000 })
  const extensionId = new URL(swTarget.url()).host
  console.log('extension id:', extensionId)

  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 })
    await page.goto(`chrome-extension://${extensionId}/team.html`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })

    await page.evaluate(async theme => {
      const now = Date.now()
      const chat = {
        id: 'chat-t4-1',
        name: 'T4 目检群',
        mode: 'collaborative',
        roleIds: [],
        messageIds: [],
        nextMessageSeq: 1,
        status: 'ready',
        createdAt: now - 3_600_000,
        updatedAt: now,
      }
      localStorage.setItem('openteam.theme', theme)
      localStorage.removeItem('openteam.shellGeometry')
      localStorage.removeItem('openteam.sidebar')
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
          settings: { language: 'zh-CN', externalModelOrder: [], externalModelsById: {} },
        },
      })
    }, theme)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })
    await sleep(2000)

    // ① 主界面：侧栏品牌行 + 群列表（chat-avatar 描边）+ 底部工具行
    await page.screenshot({ path: path.join(outDir, `s7t4-${theme}-shell.png`) })
    console.log(`saved screenshots/s7t4-${theme}-shell.png`)

    // ② 快速建群表单展开（mode 族 + template-row）
    await page.click('#quick-create-chat')
    await sleep(600)
    const formVisible = await page.evaluate(() => document.getElementById('create-chat-form') !== null)
    if (!formVisible) throw new Error('quick create form did not open')
    const form = await page.$('#create-chat-form')
    await form.screenshot({ path: path.join(outDir, `s7t4-${theme}-quickform.png`) })
    console.log(`saved screenshots/s7t4-${theme}-quickform.png`)
    // 收回表单（Esc 不一定生效，直接整页 reload 恢复初始态）
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app', { timeout: 15_000 })
    await sleep(1500)

    // ③ minimized → launcher 特写
    await page.click('#close-window')
    await sleep(600)
    const launcherEl = await page.$('#window-launcher')
    if (!launcherEl) throw new Error('window-launcher not found')
    const hidden = await page.evaluate(() => document.getElementById('window-launcher')?.hidden === true)
    if (hidden) throw new Error('window-launcher still hidden after minimize')
    await launcherEl.screenshot({ path: path.join(outDir, `s7t4-${theme}-launcher.png`) })
    console.log(`saved screenshots/s7t4-${theme}-launcher.png`)
    // 恢复窗口，准备下一主题
    await page.click('#window-launcher')
    await sleep(600)
    await page.close()
  }

  console.log('s7-t4 screenshots done')
} finally {
  await browser.close()
}
