/**
 * 边界测试：专挑"会把人坑住"的输入。
 * 跑法：node tests/edge.mjs
 *
 * 验的是坏输入不把插件搞崩、配置夹紧、状态文件坏了能自愈、并发不出事。
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'dropby-edge-'))
process.env.DSH_HOME = sandbox

const sent = []
class FakeWs {
  constructor() {
    this.readyState = 0
    this.listeners = new Map()
    setTimeout(() => {
      this.readyState = 1
      this.emit('open', {})
    }, 0)
  }
  addEventListener(t, f) {
    if (!this.listeners.has(t)) this.listeners.set(t, [])
    this.listeners.get(t).push(f)
  }
  removeEventListener(t, f) {
    const l = this.listeners.get(t)
    if (l) this.listeners.set(t, l.filter((x) => x !== f))
  }
  emit(t, e) {
    for (const f of (this.listeners.get(t) || []).slice()) f(e)
  }
  send(raw) {
    const req = JSON.parse(raw)
    sent.push(req)
    setTimeout(() => this.emit('message', { data: JSON.stringify({ status: 'ok', retcode: 0, data: {}, echo: req.echo }) }), 0)
  }
  close() {
    this.readyState = 3
  }
}
globalThis.WebSocket = FakeWs

const cfgPath = join(sandbox, 'drop-by-config.json')
const statePath = join(sandbox, 'drop-by-state.json')
const writeRaw = (path, text) => writeFileSync(path, text, 'utf8')

// 先放一份「坏 JSON」，看插件起不起来
writeRaw(cfgPath, '{ "on": true, "dryRun": ') // 半截

const { apply, createQqOutlet } = await import('../lib/host.js')

const routes = new Map()
const timers = []
const handlers = {}
const followed = []
const logs = []
let failNext = false

const fakeAgent = {
  id: 'session-edge-0001',
  session: { id: 'session-edge-0001' },
  followup: async (m) => {
    if (failNext) {
      failNext = false
      throw new Error('模拟会话正忙')
    }
    followed.push(m)
  },
}

const ctx = {
  logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)) },
  on: (n, f) => (handlers[n] = f),
  effect: (f) => {
    const d = f()
    return () => typeof d === 'function' && d()
  },
  interval: (f) => {
    timers.push(f)
    return () => {}
  },
  agents: {
    list: () => [fakeAgent],
    // ⚠ 别写成永远返回 fakeAgent：那样「填了不存在的会话 id」这一组永远测不出来
    get: (id) => (id === fakeAgent.id || id === fakeAgent.id.slice('session-'.length) ? fakeAgent : undefined),
  },
  sessions: { list: () => [], get: () => undefined, flush: async () => {} },
  webServer: {
    register: (r) => {
      routes.set(r.path, r)
      return () => {}
    },
  },
  get: () => undefined,
}

apply(ctx, {})

const problems = []
const check = (cond, msg) => {
  if (!cond) problems.push(msg)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const call = async (path, body, method = 'POST') => {
  let out = ''
  const req = {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
  await routes.get(path).handler(req, { writeHead: () => {}, end: (c) => (out += c) })
  try {
    return JSON.parse(out)
  } catch {
    return { ok: false, error: 'not json: ' + out.slice(0, 60) }
  }
}
const state = () => call('/dsh-drop-by/api/state', undefined, 'GET')
const save = (patch) => call('/dsh-drop-by/api/save', patch)
const fireTimer = async () => {
  await timers[timers.length - 1]()
  await sleep(120)
}
const emit = (type, data, id = 'session-edge-0001') => {
  const f = handlers['session/event']
  if (f) f({ id }, { type, data, time: Date.now() })
}

// ===== 1. 配置是坏的半截 JSON：插件要能起来，回默认，且不把坏文件写回去 =====
{
  const s = await state()
  check(s.ok, '1 配置坏了 /api/state 就挂了')
  check(s.cfg.on === true && s.cfg.dryRun === true, '1 坏配置没退回默认值')
  check(readFileSync(cfgPath, 'utf8').includes('"dryRun": '), '1 竟然把坏文件覆盖了')
}

// ===== 2. 类型全错的值要被夹紧 =====
{
  const r = await save({
    dailyCap: 'abc',
    cooldownMinutes: -5,
    everyMinutes: 0,
    minMinutes: 100,
    maxMinutes: 10,
    warmupMinutes: 99999,
    quietFrom: 99,
    qqTarget: 123456,
    targets: 'not-an-array',
    lines: ['   ', ''],
  })
  check(r.ok, '2 保存失败')
  check(r.cfg.dailyCap === 4, '2 dailyCap 非数字没回默认（' + r.cfg.dailyCap + '）')
  check(r.cfg.cooldownMinutes === 0, '2 负数冷却没夹到 0（' + r.cfg.cooldownMinutes + '）')
  check(r.cfg.everyMinutes === 1, '2 everyMinutes 0 没夹到 1（' + r.cfg.everyMinutes + '）')
  check(r.cfg.minMinutes === 10 && r.cfg.maxMinutes === 100, '2 上下限没交换（' + r.cfg.minMinutes + '/' + r.cfg.maxMinutes + '）')
  check(r.cfg.warmupMinutes === 1440, '2 warmupMinutes 没夹住（' + r.cfg.warmupMinutes + '）')
  check(r.cfg.quietFrom === 23, '2 quietFrom 没夹到 23（' + r.cfg.quietFrom + '）')
  check(r.cfg.qqTarget === '123456', '2 数字型 qqTarget 没转成字符串（' + r.cfg.qqTarget + '）')
  check(Array.isArray(r.cfg.targets) && r.cfg.targets.length === 0, '2 targets 非数组没退回空')
  check(r.cfg.lines.length > 0, '2 全空白的 lines 应该退回默认')

  // 把上一行故意填坏的几项恢复回可用的值，否则后面每一组都会被预热/安静时段拦住
  await save({ warmupMinutes: 0, quietFrom: 0, quietTo: 0, cooldownMinutes: 0, dailyCap: 5, minMinutes: 10, maxMinutes: 20 })
}

// ===== 3. 状态文件坏了：计数归零，不崩 =====
{
  writeRaw(statePath, 'not json at all')
  const s = await state()
  check(s.state.count === 0, '3 坏状态文件没归零')
  check(s.ok, '3 坏状态文件把接口弄挂了')
}

// ===== 4. 目标会话填了不存在的 id =====
{
  await save({ targets: ['session-does-not-exist'], dryRun: true })
  const before = followed.length
  await fireTimer()
  check(followed.length === before, '4 给不存在的会话也发了')
  const log = (await state()).log.map((x) => x.text).join('\n')
  check(log.includes('没有活着的目标会话'), '4 没说明为什么没发')
  await save({ targets: [] })
}

// ===== 5. followup 抛错：不能把宿主带走，pending 要清干净 =====
{
  await save({ dryRun: false, qqOn: true })
  failNext = true
  await fireTimer()
  const log = (await state()).log.map((x) => x.text).join('\n')
  check(log.includes('followup 失败'), '5 没记 followup 失败')
  // pending 应该被清掉：下一轮 turn/end 不该发 QQ
  sent.length = 0
  emit('turn/end', { turn: 'ghost', reason: { kind: 'done' } })
  await sleep(300)
  check(sent.length === 0, '5 失败之后 pending 没清干净，仍然发了 QQ')
}

// ===== 6. 并发两次触发：不崩，至少发一次 =====
{
  const before = followed.length
  await Promise.all([fireTimer(), fireTimer()])
  check(followed.length > before, '6 并发火全都没发出去')
  check((await state()).ok, '6 并发之后接口挂了')
}

// ===== 7. QQ 地址填成 http://：要给出明确错误，不能崩 =====
{
  await save({ qqOn: true, qqWsUrl: 'http://127.0.0.1:3001', qqToken: 'x' })
  const q = createQqOutlet()
  let err = ''
  try {
    await q.probe({ qqWsUrl: 'http://127.0.0.1:3001', qqToken: 'x', qqTarget: '1' })
  } catch (e) {
    err = String((e && e.message) || e)
  }
  q.dispose()
  check(err.length > 0, '7 http:// 地址居然没报错')
  // 插件本体还活着
  check((await state()).ok, '7 试坏地址之后插件挂了')
  await save({ qqWsUrl: 'ws://127.0.0.1:3001' })
}

// ===== 8. token 里有特殊字符：要编码进 query，不能拼坏 =====
{
  const q = createQqOutlet()
  const url = q.endpoint({ qqWsUrl: 'ws://127.0.0.1:3001', qqToken: 'a b&c=d/#' })
  q.dispose()
  check(url.includes('access_token=a%20b%26c%3Dd%2F%23'), '8 token 没做 URL 编码：' + url)
}

// ===== 9. 跨午夜安静时段 =====
{
  const h = new Date().getHours()
  const from = (h + 23) % 24 // 覆盖到「现在」
  await save({ quietFrom: from, quietTo: (h + 1) % 24, dryRun: true })
  const before = followed.length
  await fireTimer()
  check(followed.length === before, '9 跨午夜安静时段没拦住')
  const log = (await state()).log.map((x) => x.text).join('\n')
  check(log.includes('安静时段'), '9 没说明安静时段')
  await save({ quietFrom: 1, quietTo: 8 })
}

// ===== 10. /api/save 收到烂 body 不能破坏配置 =====
{
  const before = (await state()).cfg.dailyCap
  await call('/dsh-drop-by/api/save', 'array-body-is-wrong')
  const after = (await state()).cfg.dailyCap
  check(before === after, '10 烂 body 把配置改了')
  check((await state()).ok, '10 烂 body 之后接口挂了')
}

// ===== 11. 手动 force 绕过演练，但仍然是「说一句」 =====
{
  await save({ dryRun: true, on: false, dailyCap: 0 })
  const before = followed.length
  await call('/dsh-drop-by/api/fire', {})
  await sleep(120)
  check(followed.length === before + 1, '11 手动试一次被演练/开关/上限挡住了')
  await save({ dryRun: true, on: true, dailyCap: 5 })
}

rmSync(sandbox, { recursive: true, force: true })

if (problems.length) {
  console.log('❌ 没过：')
  for (const p of problems) console.log('   - ' + p)
  process.exit(1)
}
console.log('✅ 边界 11 组全过：坏配置 / 类型夹紧 / 坏状态 / 假会话 / followup 失败 / 并发 / 坏地址 / token 编码 / 跨午夜 / 烂 body / force 绕过')
process.exit(0)
