/**
 * 冒烟测试：不碰真宿主，用一个假的 ctx 把插件跑一遍。
 * 跑法：node tests/smoke.mjs
 * 验的是：路由挂上没、定时器挂上没、设置页能出、手动「试一次」真的会 followup。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 配置和状态都写到临时目录，别碰真的 ~/.dsh
const sandbox = mkdtempSync(join(tmpdir(), 'drop-by-test-'))
process.env.DSH_HOME = sandbox

const { apply } = await import('../lib/host.js')

const routes = new Map()
const timers = []
const followed = []
const logs = []

const fakeAgent = {
  id: 'session-11112222-3333-4444-5555-666677778888',
  session: { id: 'session-11112222-3333-4444-5555-666677778888' },
  followup: async (msg) => {
    followed.push(msg)
  },
}

const ctx = {
  logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
  on: () => {},
  effect: (fn) => {
    const dispose = fn()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  interval: (fn, ms) => {
    timers.push({ fn, ms })
    return () => {
      timers[timers.length - 1].stopped = true
    }
  },
  agents: {
    // ⚠ DSH 的 agents.list() 返回的是 agent 对象本身（自带 id / followup），不是 {id, agent} 包装
    list: () => [fakeAgent],
    get: (id) => (id === fakeAgent.id || id === fakeAgent.id.slice('session-'.length) ? fakeAgent : undefined),
  },
  sessions: { list: () => [], get: () => undefined, flush: async () => {} },
  webServer: {
    register: (r) => {
      routes.set(r.path, r)
      return () => routes.delete(r.path)
    },
  },
  get: () => undefined,
}

apply(ctx, {})

const problems = []
const need = ['/dsh-drop-by', '/dsh-drop-by/api/state', '/dsh-drop-by/api/save', '/dsh-drop-by/api/fire', '/dsh-drop-by/api/qq-test']
for (const p of need) if (!routes.has(p)) problems.push(`缺路由 ${p}`)
if (!timers.length) problems.push('没挂上定时器')
else if (!(timers[0].ms > 0)) problems.push('定时器间隔不合法')

// 走一遍「手动试一次」：真发（force），看 followup 有没有被叫到
const fire = routes.get('/dsh-drop-by/api/fire')
let body = ''
const req = { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() {} }
const res = {
  writeHead: () => {},
  end: (chunk) => {
    body += String(chunk || '')
  },
}
await fire.handler(req, res)
if (!followed.length) problems.push('手动试一次没有触发 followup')
else {
  const m = followed[0]
  if (m.role !== 'user') problems.push('消息角色不是 user')
  if (m.source && m.source.kind === 'user') problems.push('source.kind 不能是 user')
  if (!Array.isArray(m.content) || !m.content.length) problems.push('content 不是数组')
  if (typeof m.id !== 'string' || !m.id) problems.push('消息缺 id')
}
if (!body.includes('"ok":true')) problems.push('手动接口没回 ok')

// 设置页能出来
const pageRoute = routes.get('/dsh-drop-by')
let html = ''
await pageRoute.handler({ method: 'GET', headers: {} }, { writeHead: () => {}, end: (c) => (html += String(c || '')) })
if (!html.startsWith('<!doctype html>')) problems.push('设置页不是 html')
if (!html.includes('api/state')) problems.push('设置页没接 API')

// 定时器那一轮（演练模式，默认）不该真发
const before = followed.length
await timers[0].fn()
if (followed.length !== before) problems.push('演练模式下定时器竟然真发了')

rmSync(sandbox, { recursive: true, force: true })

if (problems.length) {
  console.log('❌ 没过：')
  for (const p of problems) console.log('   - ' + p)
  process.exit(1)
}
console.log('✅ 全过：路由 5 条、定时器 1 个、手动试一次真发了 1 条、演练模式没乱发')
