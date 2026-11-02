/**
 * ui-probe — drive the running GUI in headless Chrome and report what a user would
 * see, plus every console error and uncaught exception.
 *
 * Exists because this agent cannot see images: "the tab is missing" has to become
 * a measurement. Phase F reuses it to assert DOM geometry numerically.
 *
 * Usage:
 *   node scripts/ui-probe.mjs [--url URL] [--wait MS] [--click TEXT] [--eval EXPR]
 *                             [--steps '[{"click":"..."},{"type":"hi"},{"key":"Enter"}]']
 */
import puppeteer from 'puppeteer-core'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const URL_TO_OPEN = arg('url', 'http://127.0.0.1:3099')
const WAIT_MS = Number(arg('wait', '8000'))
const CLICK_TEXT = arg('click', '')
const EVAL_EXPR = arg('eval', '')
const STEPS = arg('steps', '')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const { join } = await import('node:path')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // Chrome runs inside the harness sandbox: its own sandbox conflicts, and it
  // cannot write crashpad dumps outside the workspace, so both are disabled.
  userDataDir: join(process.cwd(), '.cache', 'chrome-probe'),
  args: [
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
  ],
  defaultViewport: { width: 1440, height: 900 },
})

await sleep(600)
const page = await browser.newPage()
await sleep(400) // let the CDP frame tree settle before the first navigation
const logs = []
const exceptions = []
page.on('console', (m) => logs.push({ level: m.type(), text: m.text() }))
page.on('pageerror', (e) => exceptions.push(String(e?.stack ?? e)))
page.on('requestfailed', (r) => logs.push({ level: 'requestfailed', text: `${r.url()} — ${r.failure()?.errorText}` }))
page.on('response', (r) => { if (r.status() >= 400) logs.push({ level: 'http', text: `${r.status()} ${r.url()}` }) })

await page.goto(URL_TO_OPEN, { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(WAIT_MS)

const snapshot = () =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll('*')]
    const exact = (needle) => all.filter((n) => n.children.length === 0 && (n.innerText || '').trim() === needle).length
    return {
      title: document.title,
      url: location.href,
      studioPaneMounted: document.querySelectorAll('.dsh-studio-spike').length,
      studioTabNodes: exact('Studio'),
      chatTabNodes: exact('Chat'),
      buttons: all.filter((n) => n.tagName === 'BUTTON').map((n) => (n.innerText || '').trim()).filter(Boolean).slice(0, 15),
      bodyText: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 1200),
    }
  })

const clickText = async (text) => {
  const r = await page.evaluate((wanted) => {
    const lower = wanted.toLowerCase()
    const SEL = 'button, [role="button"], a, li, [role="treeitem"], [role="tab"], [role="option"], [role="menuitem"]'
    const nodes = [...document.querySelectorAll(SEL)]
    const hit = nodes.find((n) => (n.innerText || '').trim().toLowerCase() === lower)
      ?? nodes.find((n) => (n.innerText || '').trim().toLowerCase().includes(lower))
    if (!hit) return { found: false, candidates: nodes.map((n) => (n.innerText || '').trim()).filter(Boolean).slice(0, 20) }
    hit.click()
    return { found: true, text: (n = hit) => '' } && { found: true, text: (hit.innerText || '').trim() }
  }, text)
  console.log(`click "${text}" →`, JSON.stringify(r))
  return r
}

if (CLICK_TEXT) { await clickText(CLICK_TEXT); await sleep(3000) }

if (STEPS) {
  for (const step of JSON.parse(STEPS)) {
    if (step.click) { await clickText(step.click); await sleep(step.wait ?? 2500) }
    if (step.type) { await page.keyboard.type(step.type, { delay: 20 }); console.log(`typed "${step.type}"`); await sleep(step.wait ?? 1200) }
    if (step.key) { await page.keyboard.press(step.key); console.log(`pressed ${step.key}`); await sleep(step.wait ?? 3000) }
  }
}

const snap = await snapshot()
console.log('\n=== page ===')
console.log(JSON.stringify({
  title: snap.title,
  url: snap.url,
  studioPaneMounted: snap.studioPaneMounted,
  'exact-"Studio"-nodes': snap.studioTabNodes,
  'exact-"Chat"-nodes': snap.chatTabNodes,
  buttons: snap.buttons,
}, null, 2))

if (EVAL_EXPR) {
  try { console.log('\nEVAL →', JSON.stringify(await page.evaluate(EVAL_EXPR), null, 2)) }
  catch (e) { console.log('\nEVAL failed →', String(e).slice(0, 300)) }
}

const noisy = logs.filter((l) =>
  ['error', 'warning', 'requestfailed', 'http'].includes(l.level) ||
  /error|fail|unexpected|cannot|denied|not a function/i.test(l.text))
console.log('\n=== console (errors/warnings) ===')
if (noisy.length === 0) console.log('  (none)')
for (const l of noisy.slice(0, 25)) console.log(`  [${l.level}] ${l.text.slice(0, 400)}`)

console.log('\n=== uncaught exceptions ===')
if (exceptions.length === 0) console.log('  (none)')
for (const e of exceptions.slice(0, 8)) console.log(`  ${e.split('\n').slice(0, 8).join('\n  ')}`)

console.log('\n=== body text ===')
console.log(snap.bodyText || '(empty)')

await browser.close()
process.exit(0)
