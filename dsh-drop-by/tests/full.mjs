/**
 * 全路径测试：比 smoke.mjs 狠，把每道闸门和 QQ 转发都走一遍。
 * 跑法：node tests/full.mjs
 *
 * 不碰真宿主、不连真 QQ：
 *   - 假 ctx（agents / sessions / timer / webServer 都是假的）
 *   - 假 WebSocket（globalThis.WebSocket 换掉），能看见发出去的 OneBot 报文
 *   - DSH_HOME 指向临时目录，配置和状态都在里面
 */
// 强制用内置 WebSocket（测试里换成了假的），别去借宿主的 ws 包
process.env.DROPBY_NO_WS = '1'

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'dropby-full-'))
process.env.DSH_HOME = sandbox

// ---------- 假 WebSocket ----------
const sentFrames = []
let socketSeq = 0
const wsInstances = []
class FakeWs {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    this.id = ++socketSeq
    wsInstances.push(this)
    setTimeout(() => {
      this.readyState = 1
      this.emit('open', {})
    }, 0)
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type)
    if (list) this.listeners.set(type, list.filter((x) => x !== fn))
  }
  emit(type, ev) {
    for (const fn of (this.listeners.get(type) || []).slice()) fn(ev)
  }
  send(raw) {
    const req = JSON.parse(raw)
    sentFrames.push({ id: this.id, action: req.action, params: req.params })
    // 回自己的 echo
    setTimeout(() => {
      this.emit('message', {
        data: JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 1, nickname: 'fake' }, echo: req.echo }),
      })
    }, 0)
  }
  close() {
    this.readyState = 3
  }
}
globalThis.WebSocket = FakeWs

// ---------- 配置 ----------
const baseCfg = {
  on: true,
  dryRun: false,
  mode: 'fixed',
  everyMinutes: 60,
  minMinutes: 10,
  maxMinutes: 20,
  targets: [],
  lines: ['测试念头'],
  quietFrom: 0,
  quietTo: 0,
  dailyCap: 5,
  cooldownMinutes: 0,
  warmupMinutes: 0,
  frame: false,
  qqOn: true,
  qqWsUrl: 'ws://fake:3001',
  qqToken: 'tok',
  qqTarget: '10000001',
  qqMode: 'reply',
}
const cfgPath = join(sandbox, 'drop-by-config.json')
const writeCfg = (patch = {}) => writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, ...patch }, null, 2), 'utf8')

writeCfg()

// ---------- 假 ctx ----------
const routes = new Map()
const registeredTools = []
const timers = []
const followed = []
const handlers = {}
let flushCalls = 0

const fakeAgent = {
  id: 'session-test-0001',
  session: { id: 'session-test-0001' },
  followup: async (msg) => followed.push(msg),
}

const ctx = {
  logger: { info: () => {}, warn: () => {} },
  on: (name, fn) => {
    handlers[name] = fn
  },
  effect: (fn) => {
    const d = fn()
    return () => {
      if (typeof d === 'function') d()
    }
  },
  interval: (fn, ms) => {
    const entry = { fn, ms, stopped: false }
    timers.push(entry)
    return () => {
      entry.stopped = true
    }
  },
  agents: {
    list: () => [fakeAgent],
    get: (id) =>
      id === fakeAgent.id || id === fakeAgent.id.slice('session-'.length) ? fakeAgent : undefined,
  },
  sessions: {
    list: () => [],
    get: () => undefined,
    flush: async () => {
      flushCalls++
    },
  },
  webServer: {
    register: (r) => {
      routes.set(r.path, r)
      return () => routes.delete(r.path)
    },
  },
  tools: {
    register: (def) => {
      registeredTools.push(def)
      return () => {}
    },
  },
  get: () => undefined,
}

const { apply } = await import('../lib/host.js')
apply(ctx, {})

// ---------- 小工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const fireNow = async () => {
  const before = timers.length
  const t = timers[before - 1] || timers[0]
  await t.fn()
  await sleep(120)
}
const emit = async (type, data, id = 'session-test-0001') => {
  const fn = handlers['session/event']
  if (fn) fn({ id }, { type, data, time: Date.now() })
  await sleep(60)
}
const stateOf = async () => {
  let out = ''
  await routes.get('/dsh-drop-by/api/state').handler({ method: 'GET', headers: {} }, { writeHead: () => {}, end: (c) => (out += c) })
  return JSON.parse(out)
}
const lastLog = async () => {
  const s = await stateOf()
  return (s.log || []).map((r) => r.text)
}
const saveCfgViaApi = async (patch) => {
  let out = ''
  const body = JSON.stringify(patch)
  await routes.get('/dsh-drop-by/api/save').handler(
    { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from(body) } },
    { writeHead: () => {}, end: (c) => (out += c) },
  )
  await sleep(30)
  return JSON.parse(out)
}

const problems = []
const check = (cond, msg) => {
  if (!cond) problems.push(msg)
}

// ================= 1. 配置往返 =================
{
  const r = await saveCfgViaApi({ dailyCap: 7, quietFrom: 2, quietTo: 9 })
  check(r.ok, '1 保存失败')
  const s = await stateOf()
  check(s.cfg.dailyCap === 7, '1 dailyCap 没保存上')
  check(s.cfg.quietFrom === 2 && s.cfg.quietTo === 9, '1 安静时段没保存上')
  check(s.cfg.lines[0] === '测试念头', '1 不该把别的字段冲掉')
  check(await r.cfg.warmupMinutes === 0, '1 warmupMinutes 丢了')
  await saveCfgViaApi({ dailyCap: 5, quietFrom: 0, quietTo: 0 })
}

// ================= 2. 正常触发 =================
{
  const before = followed.length
  await fireNow()
  check(followed.length === before + 1, '2 正常路径没有 followup')
  const last = followed[followed.length - 1]
  check(last && last.role === 'user', '2 消息角色不是 user')
  check(last && last.source && last.source.kind === 'drop-by', '2 source.kind 不对')
  check(flushCalls > 0, '2 没有 flush')
}

// ================= 3. 抓回合 → 发 QQ（多行拆条） =================
{
  sentFrames.length = 0
  await emit('turn/start', { turn: 't1' })
  await emit('assistant/message', { message: { content: [{ type: 'text', text: '第一句\n第二句' }] } })
  await emit('turn/end', { turn: 't1', reason: { kind: 'done' } })
  await sleep(2200) // 两条之间有 0.6~1.3 秒的停顿，得等够
  const says = sentFrames.filter((f) => f.action === 'send_private_msg')
  check(says.length === 2, `3 应该发 2 条，实际 ${says.length}`)
  check(says[0] && says[0].params.message === '第一句', '3 第一条内容不对')
  check(says[1] && says[1].params.message === '第二句', '3 第二条内容不对')
  check(says[0] && says[0].params.user_id === 10000001, '3 user_id 不对')
}

// ================= 4. 没抓到 turn/start 就不发 =================
{
  sentFrames.length = 0
  await fireNow()
  await emit('turn/end', { turn: 't2', reason: { kind: 'done' } })
  await sleep(200)
  check(sentFrames.length === 0, '4 没有 turn/start 却发了 QQ')
  check((await lastLog()).some((x) => x.includes('没抓到这一轮的起点')), '4 没有给出原因')
}

// ================= 5. 冷却：你刚说过话就不打扰 =================
{
  await saveCfgViaApi({ cooldownMinutes: 60 })
  await emit('user/message', { source: { kind: 'user' }, content: [] })
  const before = followed.length
  await fireNow()
  check(followed.length === before, '5 冷却没拦住')
  check((await lastLog()).some((x) => x.includes('冷却')), '5 没有给出冷却原因')
  await saveCfgViaApi({ cooldownMinutes: 0 })
}

// ================= 6. 每日上限 =================
{
  await saveCfgViaApi({ dailyCap: 0 })
  const before = followed.length
  await fireNow()
  check(followed.length === before, '6 上限没拦住')
  check((await lastLog()).some((x) => x.includes('上限')), '6 没有给出上限原因')
  await saveCfgViaApi({ dailyCap: 5 })
}

// ================= 7. 安静时段 =================
{
  const h = new Date().getHours()
  await saveCfgViaApi({ quietFrom: h, quietTo: (h + 2) % 24 })
  const before = followed.length
  await fireNow()
  check(followed.length === before, '7 安静时段没拦住')
  check((await lastLog()).some((x) => x.includes('安静时段')), '7 没有给出安静时段原因')
  await saveCfgViaApi({ quietFrom: 0, quietTo: 0 })
}

// ================= 8. 总开关 =================
{
  await saveCfgViaApi({ on: false })
  const before = followed.length
  await fireNow()
  check(followed.length === before, '8 总开关没拦住')
  await saveCfgViaApi({ on: true })
}

// ================= 9. 演练模式 =================
{
  await saveCfgViaApi({ dryRun: true })
  const before = followed.length
  await fireNow()
  check(followed.length === before, '9 演练模式却真发了')
  check((await lastLog()).some((x) => x.includes('[演练]')), '9 没有记演练')
  await saveCfgViaApi({ dryRun: false })
}

// ================= 10. QQ 关掉就不发 =================
{
  await saveCfgViaApi({ qqOn: false })
  sentFrames.length = 0
  await fireNow()
  await emit('turn/start', { turn: 't3' })
  await emit('assistant/message', { message: { content: [{ type: 'text', text: '不该发出去' }] } })
  await emit('turn/end', { turn: 't3', reason: { kind: 'done' } })
  await sleep(300)
  check(sentFrames.length === 0, '10 QQ 关着却发了')
  await saveCfgViaApi({ qqOn: true })
}

// ================= 11. 这一轮全是工具、没说话 =================
{
  sentFrames.length = 0
  await fireNow()
  await emit('turn/start', { turn: 't4' })
  await emit('assistant/message', { message: { content: [{ type: 'tool-call', toolName: 'x' }] } })
  await emit('turn/end', { turn: 't4', reason: { kind: 'done' } })
  await sleep(300)
  check(sentFrames.length === 0, '11 没说话却发了 QQ')
  check((await lastLog()).some((x) => x.includes('没说出话')), '11 没有给出原因')
}

// ================= 12. 别的会话的事件不许串 =================
{
  sentFrames.length = 0
  await fireNow()
  await emit('turn/start', { turn: 't5' }, 'session-other-9999')
  await emit('assistant/message', { message: { content: [{ type: 'text', text: '别人的话' }] } }, 'session-other-9999')
  await emit('turn/end', { turn: 't5', reason: { kind: 'done' } }, 'session-other-9999')
  await sleep(300)
  check(sentFrames.length === 0, '12 把别的会话的话发到 QQ 了')
}

// ================= 13. 连接断了要能自己重连 =================
{
  sentFrames.length = 0
  const last = wsInstances[wsInstances.length - 1]
  check(Boolean(last), '13 之前一次都没建过连接')
  if (last) {
    last.readyState = 3
    last.emit('close', {})
  }
  await fireNow()
  await emit('turn/start', { turn: 't6' })
  await emit('assistant/message', { message: { content: [{ type: 'text', text: '重连后的话' }] } })
  await emit('turn/end', { turn: 't6', reason: { kind: 'done' } })
  await sleep(700)
  check(
    sentFrames.some((f) => f.params && f.params.message === '重连后的话'),
    '13 连接断掉之后没有重连，消息没发出去',
  )
  check(wsInstances.length > 1, '13 没有新建连接')
}

// ================= 14. 手动试一次不占当天的额度 =================
{
  const s1 = await stateOf()
  const before = s1.state.count
  let out = ''
  await routes.get('/dsh-drop-by/api/fire').handler(
    { method: 'POST', headers: {} },
    { writeHead: () => {}, end: (c) => (out += c) },
  )
  await sleep(200)
  const s2 = await stateOf()
  check(s2.state.count === before, `14 手动试一次不该计入额度（${before} -> ${s2.state.count}）`)
}

// ================= 15. 念头原文不能当成「说的话」发出去 =================
{
  sentFrames.length = 0
  await saveCfgViaApi({ qqOn: true, qqMode: 'reply', dryRun: false })
  await fireNow()
  await emit('turn/start', { turn: 't7' })
  await emit('assistant/message', { message: { content: [{ type: 'text', text: '测试念头\n喂，在吗' }] } })
  await emit('turn/end', { turn: 't7', reason: { kind: 'done' } })
  await sleep(900)
  const says15 = sentFrames.filter((f) => f.action === 'send_private_msg')
  check(says15.length === 1, `15 念头原文那行该被丢掉，只该发 1 条，实际 ${says15.length}`)
  check(says15[0] && says15[0].params.message === '喂，在吗', '15 发出去的内容不对：' + (says15[0] && says15[0].params.message))
}

// ================= 16. 她自己能往念头池里写 =================
{
  check(registeredTools.length === 1, `16 应该注册 1 个工具，实际 ${registeredTools.length}`)
  const tool = registeredTools[0]
  if (!tool) {
    check(false, '16 没有工具')
  } else {
    check(tool.name === 'drop_by_add_line', '16 工具名不对：' + tool.name)
    check(typeof tool.execute === 'function', '16 没有 execute')
    check(!!tool.output && typeof tool.output.render === 'function', '16 没有 output.render')

    const before = (await stateOf()).cfg.lines.length
    const r1 = await tool.execute({ text: '想问他今天累不累' })
    check(r1.ok === true, '16 加一句失败了')
    const after = (await stateOf()).cfg.lines
    check(after.length === before + 1, `16 池子应该多一句（${before} -> ${after.length}）`)
    check(after.includes('想问他今天累不累'), '16 加进去的那句没找到')

    // 重复加不该变多
    const r2 = await tool.execute({ text: '想问他今天累不累' })
    const again = (await stateOf()).cfg.lines
    check(again.length === after.length, '16 重复加了同一句，池子却变长了')
    check(r2.count === again.length, '16 返回的条数不对')

    // 空的不收
    const r3 = await tool.execute({ text: '   ' })
    check(r3.ok === false, '16 空白也该拒绝')

    // 上限 30
    for (let i = 0; i < 40; i++) await tool.execute({ text: '凑数念头 ' + i })
    const capped = (await stateOf()).cfg.lines
    check(capped.length <= 30, `16 池子没夹住上限，现在 ${capped.length} 句`)
    check(capped[capped.length - 1] === '凑数念头 39', '16 夹的时候应该留最新的')
  }
}

// ================= 17. 设置页那个「测一下她自己写念头」按钮 =================
{
  const callLineTest = async () => {
    let out = ''
    await routes.get('/dsh-drop-by/api/line-test').handler(
      { method: 'POST', headers: {} },
      { writeHead: () => {}, end: (c) => (out += c) },
    )
    return JSON.parse(out)
  }
  // 先把池子清干净（上一组把它塞到 30 句了，再加一句会被上限挤掉，看不出变化）
  await saveCfgViaApi({ lines: ['测试念头'] })
  const before = (await stateOf()).cfg.lines.length
  const r1 = await callLineTest()
  check(r1.ok === true, '17 按钮调用失败：' + (r1 && r1.error))
  check(r1.count === before + 1, `17 池子应该多一句（${before} -> ${r1.count}）`)
  check(r1.text === '（测试）想问问你在干嘛', '17 写进去的那句不对：' + r1.text)
  // 连点第二次：去重，不该再长
  const r2 = await callLineTest()
  check(r2.ok === true && r2.count === r1.count, '17 连点两次池子却变长了')
}

// ================= 18. P1 / P2 二选一，不能同时开 =================
{
  // 前面几组 fire 太多次，当天的额度（5）早用完了，先抬上去，不然这里根本发不出去
  await saveCfgViaApi({ dailyCap: 999, dryRun: false, qqOn: false, lineWriteMode: 'free' })
  await fireNow()
  const msgFree = followed[followed.length - 1]
  const textFree = String(msgFree.content[0].text)
  check(!textFree.includes('drop_by_add_line'), '18 P1 不该出现「记进念头池」的提醒')
  check(textFree.trim().length > 0, '18 P1 内容空的')

  await saveCfgViaApi({ lineWriteMode: 'nudge' })
  await fireNow()
  const msgNudge = followed[followed.length - 1]
  const textNudge = String(msgNudge.content[0].text)
  check(textNudge.includes('drop_by_add_line'), '18 P2 应该补上「记进念头池」的提醒')
  check(textNudge.trim().length > textFree.trim().length, '18 P2 应该比 P1 更长（多一段提醒）')

  // 互斥：存一个就是那个，不会两个都开
  const s1 = await stateOf()
  check(s1.cfg.lineWriteMode === 'nudge', '18 模式没存上：' + s1.cfg.lineWriteMode)
  await saveCfgViaApi({ lineWriteMode: 'free' })
  const s2 = await stateOf()
  check(s2.cfg.lineWriteMode === 'free', '18 切回 P1 失败：' + s2.cfg.lineWriteMode)
  await saveCfgViaApi({ qqOn: true, lineWriteMode: 'free' })
}

// ================= 19. 选了就固定用那个；不选就挑一个活着的 =================
{
  await saveCfgViaApi({ dailyCap: 999, dryRun: false, qqOn: false, targets: [fakeAgent.id] })
  const before19 = followed.length
  await fireNow()
  check(followed.length === before19 + 1, '19 选了会话却没发出去')

  await saveCfgViaApi({ targets: [] })
  const before20 = followed.length
  await fireNow()
  check(followed.length === before20 + 1, '19 不选时该挑一个活着的')

  await saveCfgViaApi({ targets: [fakeAgent.id] })
}
rmSync(sandbox, { recursive: true, force: true })

if (problems.length) {
  console.log('❌ 没过：')
  for (const p of problems) console.log('   - ' + p)
  process.exit(1)
}
console.log('✅ 全过：19 组（配置往返 / 正常触发 / 抓回复拆条发 QQ / 无起点不发 / 冷却 / 上限 / 安静 / 总开关 / 演练 / QQ 关 / 没说话 / 串会话 / 断线重连 / 手动不占额度 / 念头原文不转发 / 她往池子里写 / 按钮测她写念头 / P1P2 互斥 / 选目标）')
// 假 WebSocket 和定时器还挂着，不显式退出进程不会自己结束
process.exit(0)
