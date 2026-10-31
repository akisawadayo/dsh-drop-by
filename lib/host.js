/**
 * dsh-drop-by —— 到点了，她自己来找你说话。
 *
 * 干的事只有一件：**按你设的间隔，往「你正在用的那个会话」里送一条她自己的念头**，
 * 然后让 DSH 自己开一轮 —— 人格、历史、工具、记忆全是她自己的，她用自己的话跟你开口。
 * 插件不生成台词，只负责「叫她开口」。
 *
 * 定时器  →  过闸门（开关 / 安静时段 / 每日上限 / 冷却 / 你刚说过话）  →  agent.followup(一条 user 消息)
 *             └ 任一闸门不开：只记账，什么都不发，一分钱不花
 *
 * ⚠ 为什么必须走 agent.followup()：只有那样才是 DSH 自己的回合。
 *   在插件里自己拼一段文字塞进会话，是「假开口」—— 模型看不见，历史也不认。
 *
 * ⚠ 为什么 source.kind 不能写 'user'：网页端会把 kind === 'user' 的消息当成你自己打字排队的那条，
 *   于是「她先开口」会变成「你发了一条你没发过的消息」。
 *
 * ⚠ 为什么角色只能是 user：dsh-session 的 append 里 user/message 事件跟 developer 角色是绑死校验的，
 *   填 developer 这一轮 turn 直接 error。想改变「念头 vs 对方说的话」的读法，只能在文字里包一层框
 *   （见 FRAME），角色改不了。
 *
 * ⚠ 为什么不写 export const Config（schemastery）：插件装在 profile 的 node_modules 里，
 *   那个目录**没有** @deepseek-ai/schemastery，import 失败会让整个插件加载不了。
 *   配置一律走自己的 json 文件 + 自己的设置页。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { renderPage } from './page.js'

/** 插件对外名字，也是路由前缀、日志前缀、消息 source.kind。 */
export const name = 'drop-by'

/**
 * 需要宿主提供的服务。
 * ⚠ 'timer' 是 ctx.interval 的来源，插件卸载时 Cordis 自动收表。
 * ⚠ 'webServer' 只用来挂设置页；没有它插件仍能定时说话，只是没页面。
 */
export const inject = ['agents', 'sessions', 'timer', 'webServer']

/** 目录与文件。DSH_HOME 优先，跟宿主保持一致。 */
const HOME_DIR = process.env.DSH_HOME || join(homedir(), '.dsh')
const CFG_PATH = join(HOME_DIR, 'drop-by-config.json')
const STATE_PATH = join(HOME_DIR, 'drop-by-state.json')
const ROUTE = '/dsh-drop-by'
const SOURCE_KIND = 'drop-by'
const LOG_LIMIT = 60

/**
 * 版本号：从 package.json 读。
 * ⚠ 救援脚本拿它跟磁盘上的 package.json 比对 —— 对不上就说明「跑的还是改代码之前那份」，
 *   一眼看出要不要重启，不用猜。
 */
const VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
    return String(pkg.version || '?')
  } catch {
    return '?'
  }
})()

/**
 * 默认的「念头」。可以在设置页里改，一行一条，每次随机挑一条。
 * ⚠ 这些是**念头**不是台词：她读到之后会用自己的话讲出来，所以写得口语、短、留空。
 */
const DEFAULT_LINES = [
  '突然想跟他说句话',
  '好久没听见他说话了，去看看他在干嘛',
  '想跟他讲讲刚才看到的东西',
  '问问他吃饭了没有',
]

/** 全部设置的默认值（唯一一份真源）。 */
const DEFAULTS = {
  /** 总开关。关掉等于插件装了个寂寞。 */
  on: true,
  /** 演练模式：掷中了也只记账、不真发。第一次装建议先开着看几轮。 */
  dryRun: true,
  /** 'fixed' 死板固定间隔；'random' 每次在上下限之间随机（更像人）。 */
  mode: 'random',
  /** fixed 模式下每多少分钟一次。 */
  everyMinutes: 90,
  /** random 模式的下限（分钟）。 */
  minMinutes: 40,
  /** random 模式的上限（分钟）。 */
  maxMinutes: 140,
  /** 目标会话 id 列表。空 = 自动从活着的会话里挑一个。 */
  targets: [],
  /** 念头句子池。 */
  lines: DEFAULT_LINES.slice(),
  /** 安静时段（本地小时，含起不含止）。起 === 止 表示不启用。 */
  quietFrom: 1,
  quietTo: 8,
  /** 每天最多主动开口几次，防止把钱包烧穿。 */
  dailyCap: 4,
  /** 你这么多分钟内说过话，就不打扰你。0 = 不冷却。 */
  cooldownMinutes: 20,
  /** 启动后先缓多少分钟才允许第一次开口（免得一重启就蹦一句）。0 = 不缓。 */
  warmupMinutes: 5,
  /** 是否把念头包一层「这是你自己冒出来的」的框（强烈建议开）。 */
  frame: true,
  /** 企鹅出口：要不要把这一轮她真说的话发到你 QQ。默认关。 */
  qqOn: false,
  /** OneBot ws 地址（本机 NapCat 是正向 ws，不是 HTTP 口）。 */
  qqWsUrl: 'ws://127.0.0.1:3001',
  /** OneBot access_token；留空 = 不带。 */
  qqToken: '',
  /** 发给谁。 */
  qqTarget: '',
  /** 'reply' = 发她这一轮真说的话（推荐）；'line' = 直接把念头那句发过去。 */
  qqMode: 'reply',
}

/**
 * 念头外面那层框。
 * ⚠ 2026-10-24 同类插件踩过的坑：user 消息在模型眼里就是「对方说的话」，
 *   「好久没人跟我说话了」会被读成「用户说好久没人跟他说话了」，于是它顺着安慰你，
 *   而不是自己起个话头。角色换不了，那就把话说清。
 */
const FRAME =
  '（下面这句是**你自己心里冒出来的念头**，不是对方发来的消息。' +
  '顺着它去做就行，别把它当成他在跟你说话，也不用回应它。' +
  '想找他就用你自己的话开口，短一点，像在 QQ 上打字。）'

// ---------- 小工具 ----------

const clone = (v) => JSON.parse(JSON.stringify(v))
/**
 * 取整数并夹到区间里。
 * ⚠ null / undefined / 空串 一律当「没给」，返回 fallback ——
 *   前端传 Number('') 会得到 NaN，JSON 序列化后变 null，若不挡住就会被当成 0，
 *   于是「每天最多几次」会被悄悄改成 0（今天一次都不发）。
 */
const clampInt = (v, lo, hi, fallback) => {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}
const asBool = (v, fallback) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return fallback
}

/** 本地日期键 yyyy-mm-dd，用来做「今天发了几次」。 */
function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 本地时间 HH:mm:ss，日志和设置页都要看。 */
function clock(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 会话 id 后 8 位 —— 前面全是 session- 和 uuid 头，只有尾巴能区分。 */
function shortId(id) {
  const s = String(id)
  return s.length <= 8 ? s : '…' + s.slice(-8)
}

/** 同一会话的两种写法归一（带不带 session- 前缀）。 */
const sessionKey = (id) => String(id == null ? '' : id).replace(/^session-/, '')

// ---------- 配置读写 ----------

function ensureHome() {
  try {
    mkdirSync(HOME_DIR, { recursive: true })
  } catch {
    /* 目录已经在了，或者建不出来；后面读写会自己报 */
  }
}

/** 读配置：默认值 + 磁盘上的值，逐项夹紧。读不到就是默认值。 */
function readCfg() {
  let raw = {}
  try {
    raw = JSON.parse(readFileSync(CFG_PATH, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
  } catch {
    raw = {}
  }
  const cfg = {
    on: asBool(raw.on, DEFAULTS.on),
    dryRun: asBool(raw.dryRun, DEFAULTS.dryRun),
    mode: raw.mode === 'fixed' ? 'fixed' : raw.mode === 'random' ? 'random' : DEFAULTS.mode,
    everyMinutes: clampInt(raw.everyMinutes, 1, 10080, DEFAULTS.everyMinutes),
    minMinutes: clampInt(raw.minMinutes, 1, 10080, DEFAULTS.minMinutes),
    maxMinutes: clampInt(raw.maxMinutes, 1, 10080, DEFAULTS.maxMinutes),
    targets: Array.isArray(raw.targets) ? raw.targets.map((x) => String(x).trim()).filter(Boolean) : [],
    lines: Array.isArray(raw.lines) && raw.lines.map((x) => String(x).trim()).filter(Boolean).length
      ? raw.lines.map((x) => String(x)).filter((x) => x.trim())
      : DEFAULTS.lines.slice(),
    quietFrom: clampInt(raw.quietFrom, 0, 23, DEFAULTS.quietFrom),
    quietTo: clampInt(raw.quietTo, 0, 23, DEFAULTS.quietTo),
    dailyCap: clampInt(raw.dailyCap, 0, 96, DEFAULTS.dailyCap),
    cooldownMinutes: clampInt(raw.cooldownMinutes, 0, 1440, DEFAULTS.cooldownMinutes),
    warmupMinutes: clampInt(raw.warmupMinutes, 0, 1440, DEFAULTS.warmupMinutes),
    frame: asBool(raw.frame, DEFAULTS.frame),
    qqOn: asBool(raw.qqOn, DEFAULTS.qqOn),
    qqWsUrl: typeof raw.qqWsUrl === 'string' && raw.qqWsUrl.trim() ? raw.qqWsUrl.trim() : DEFAULTS.qqWsUrl,
    qqToken: typeof raw.qqToken === 'string' ? raw.qqToken : DEFAULTS.qqToken,
    qqTarget: typeof raw.qqTarget === 'string' && raw.qqTarget.trim()
      ? raw.qqTarget.trim()
      : String(raw.qqTarget || DEFAULTS.qqTarget).trim() || DEFAULTS.qqTarget,
    qqMode: raw.qqMode === 'line' ? 'line' : 'reply',
  }
  if (cfg.minMinutes > cfg.maxMinutes) {
    const t = cfg.minMinutes
    cfg.minMinutes = cfg.maxMinutes
    cfg.maxMinutes = t
  }
  return cfg
}

/** 原子写：先写 .tmp 再 rename，掉电不会留半截 json。 */
function writeJson(path, value) {
  ensureHome()
  const tmp = path + '.tmp'
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, path)
  } catch (error) {
    try {
      writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
    } catch {
      /* 真写不了就算了，调用方会看到异常 */
    }
    throw error
  }
}

/** 保存设置（只覆盖传进来的字段，其余保留）。 */
function saveCfg(patchValue) {
  const cur = readCfg()
  const next = { ...cur }
  const raw = patchValue && typeof patchValue === 'object' ? patchValue : {}
  if ('on' in raw) next.on = asBool(raw.on, cur.on)
  if ('dryRun' in raw) next.dryRun = asBool(raw.dryRun, cur.dryRun)
  if ('mode' in raw) next.mode = raw.mode === 'fixed' ? 'fixed' : 'random'
  if ('everyMinutes' in raw) next.everyMinutes = clampInt(raw.everyMinutes, 1, 10080, cur.everyMinutes)
  if ('minMinutes' in raw) next.minMinutes = clampInt(raw.minMinutes, 1, 10080, cur.minMinutes)
  if ('maxMinutes' in raw) next.maxMinutes = clampInt(raw.maxMinutes, 1, 10080, cur.maxMinutes)
  if ('targets' in raw) {
    next.targets = Array.isArray(raw.targets)
      ? raw.targets.map((x) => String(x).trim()).filter(Boolean)
      : []
  }
  if ('lines' in raw) {
    const lines = Array.isArray(raw.lines) ? raw.lines.map((x) => String(x)) : String(raw.lines || '').split(/\r?\n/)
    const kept = lines.map((x) => x.trim()).filter(Boolean)
    if (kept.length) next.lines = kept
  }
  if ('quietFrom' in raw) next.quietFrom = clampInt(raw.quietFrom, 0, 23, cur.quietFrom)
  if ('quietTo' in raw) next.quietTo = clampInt(raw.quietTo, 0, 23, cur.quietTo)
  if ('dailyCap' in raw) next.dailyCap = clampInt(raw.dailyCap, 0, 96, cur.dailyCap)
  if ('cooldownMinutes' in raw) next.cooldownMinutes = clampInt(raw.cooldownMinutes, 0, 1440, cur.cooldownMinutes)
  if ('warmupMinutes' in raw) next.warmupMinutes = clampInt(raw.warmupMinutes, 0, 1440, cur.warmupMinutes)
  if ('frame' in raw) next.frame = asBool(raw.frame, cur.frame)
  if ('qqOn' in raw) next.qqOn = asBool(raw.qqOn, cur.qqOn)
  if ('qqWsUrl' in raw) {
    const v = String(raw.qqWsUrl || '').trim()
    next.qqWsUrl = v || cur.qqWsUrl
  }
  if ('qqToken' in raw) next.qqToken = String(raw.qqToken == null ? '' : raw.qqToken)
  if ('qqTarget' in raw) {
    const v = String(raw.qqTarget == null ? '' : raw.qqTarget).trim()
    next.qqTarget = v || cur.qqTarget
  }
  if ('qqMode' in raw) next.qqMode = raw.qqMode === 'line' ? 'line' : 'reply'
  if (next.minMinutes > next.maxMinutes) {
    const t = next.minMinutes
    next.minMinutes = next.maxMinutes
    next.maxMinutes = t
  }
  writeJson(CFG_PATH, next)
  return next
}

/** 今天发了几次、上次什么时候发的。 */
function readState() {
  let raw = {}
  try {
    raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) || {}
  } catch {
    raw = {}
  }
  const today = dayKey()
  const count = raw.day === today ? clampInt(raw.count, 0, 1000, 0) : 0
  return { day: today, count, lastAt: Number(raw.lastAt) || 0 }
}

function writeState(state) {
  try {
    writeJson(STATE_PATH, state)
  } catch {
    /* 记不住就算了，别因为记账失败把定时器搞崩 */
  }
}

// ---------- 会话与 agent ----------

/** 活着的 agent 清单（id 两种口径都收）。 */
function liveAgents(ctx) {
  const out = []
  try {
    const list = typeof ctx.agents.list === 'function' ? ctx.agents.list() : []
    for (const a of list || []) {
      const id = String((a && (a.id || (a.session && a.session.id))) || '')
      if (id) out.push({ id, agent: a })
    }
  } catch {
    /* agents 服务不在：当成没有活着的会话 */
  }
  return out
}

/** 按 id 找活着的 agent：原样 → 去前缀 / 补前缀 → 在清单里比归一后的 id。 */
function findAgent(ctx, id) {
  const raw = String(id == null ? '' : id).trim()
  if (raw === '') return undefined
  const candidates = [raw]
  if (raw.startsWith('session-')) candidates.push(raw.slice('session-'.length))
  else candidates.push('session-' + raw)
  for (const one of candidates) {
    try {
      const a = ctx.agents.get(one)
      if (a) return a
    } catch {
      /* 查不动就当没找到 */
    }
  }
  const hit = liveAgents(ctx).find((x) => sessionKey(x.id) === sessionKey(raw))
  return hit ? hit.agent : undefined
}

/** 挑这一轮要说给谁听。挑不到返回 undefined。 */
function pickTarget(ctx, cfg) {
  const wanted = cfg.targets.filter(Boolean)
  if (wanted.length) {
    const alive = []
    for (const id of wanted) {
      const agent = findAgent(ctx, id)
      if (agent && typeof agent.followup === 'function') alive.push({ id, agent })
    }
    if (!alive.length) return undefined
    return alive[Math.floor(Math.random() * alive.length)]
  }
  const subs = subagentSessionKeys()
  const all = liveAgents(ctx).filter(
    (x) => x.agent && typeof x.agent.followup === 'function' && !subs.has(sessionKey(x.id)),
  )
  if (!all.length) return undefined
  return all[Math.floor(Math.random() * all.length)]
}

/** 手搓一条 user 消息（形状照 dsh-llm 的 createUserMessage 抄）。 */
function makeUserMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text) }],
    source: { kind: SOURCE_KIND },
  }
}

// ---------- QQ 出口（OneBot v11 正向 WebSocket） ----------
//
// 本机 NapCat 的 OneBot 是「正向 ws」服务端（127.0.0.1:3001），没有 HTTP 口，
// 所以这里用 Node 自带的内置 WebSocket 连上去发 send_private_msg。
// ⚠ 不 import 'ws'：插件装在 .dsh\plugins 下，模块解析链里没有那个包，
//   import 失败会让整个插件加载不了。Node 22+ 的 globalThis.WebSocket 够了。
// ⚠ 一根连接多个客户端没问题（world 的 qqNative 已经连着一条），
//   但别发心跳/别抢别人的 echo；每个请求自己带 echo 自己认。

/**
 * 尽量借宿主的 `ws` 包。
 * ⚠ 为什么：OneBot 的鉴权标准是 HTTP 头 `Authorization: Bearer <token>`，
 *   而 Node 内置的 WebSocket **不能发自定义头** —— 内置那条路只能把 token 塞进
 *   `?access_token=`（NapCat 认这个，但有些实现不认）。
 * 借得到就用头，借不到就退回内置 + query。
 * ⚠ 这里必须用 try 挨个找：插件装在 ~/.dsh/plugins 下，那里没有 ws，
 *   直接 import 会让整包加载失败。
 */
let wsImplCache
function loadWsImpl() {
  if (wsImplCache !== undefined) return wsImplCache
  // ⚠ 测试用开关：测试里换掉了 globalThis.WebSocket，必须确保不会又去借宿主的 ws 包，
  //   否则测试会真的去连一个假的地址。设 DROPBY_NO_WS=1 就强制用内置那条路。
  if (process.env.DROPBY_NO_WS === '1') {
    wsImplCache = null
    return null
  }
  const bases = []
  try {
    const profiles = join(HOME_DIR, 'profiles')
    for (const name of readdirSync(profiles)) bases.push(join(profiles, name, 'package.json'))
  } catch {
    /* 没有 profiles 目录就算 */
  }
  bases.push(join(process.cwd(), 'package.json'))
  for (const base of bases) {
    try {
      const req = createRequire(base)
      const mod = req('ws')
      if (mod && typeof mod.WebSocket === 'function') {
        wsImplCache = mod.WebSocket
        return wsImplCache
      }
    } catch {
      /* 这个位置没有 ws，换下一个 */
    }
  }
  wsImplCache = null
  return null
}

export function createQqOutlet() {
  let socket = null
  let connecting = null
  let idleTimer = null
  let seq = 0

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }
  /** 两分钟没动就断，别长期占着 NapCat 的客户端位。 */
  const armIdle = () => {
    clearIdle()
    idleTimer = setTimeout(() => {
      const s = socket
      socket = null
      try {
        if (s) s.close()
      } catch {
        /* 已经断了 */
      }
    }, 2 * 60_000)
  }

  /** ws 地址 + ?access_token=** */
  function endpoint(cfg) {
    const base = String(cfg.qqWsUrl || '').trim()
    if (!base) throw new Error('qqWsUrl 是空的')
    const token = String(cfg.qqToken || '').trim()
    if (!token) return base
    return base + (base.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token)
  }

  function ensure(cfg) {
    if (socket && socket.readyState === 1) return Promise.resolve(socket)
    if (connecting) return connecting
    const base = String(cfg.qqWsUrl || '').trim()
    if (!base) return Promise.reject(new Error('qqWsUrl 是空的'))
    // ⚠ Node 内置 WebSocket 居然接受 http:// 并且能连上 —— 不拦的话，填错协议也会“看起来正常”，
    //   出问题时没人知道是协议错了。这里直接拒绝，给一句人话。
    if (!/^wss?:\/\//i.test(base)) {
      return Promise.reject(new Error('qqWsUrl 要以 ws:// 或 wss:// 开头 —— 这里要的是 OneBot 的 ws 地址，不是 HTTP 接口'))
    }
    const token = String(cfg.qqToken || '').trim()
    const Impl = token ? loadWsImpl() : null // 有 ws 包就走 Authorization 头，没有就退回 query
    const url = Impl ? base : endpoint(cfg)
    connecting = new Promise((resolve, reject) => {
      let s
      try {
        s = Impl
          ? new Impl(url, { headers: { Authorization: 'Bearer ' + token } })
          : new WebSocket(url)
      } catch (error) {
        connecting = null
        return reject(error)
      }
      const timer = setTimeout(() => {
        try {
          s.close()
        } catch {
          /* 忽略 */
        }
        connecting = null
        reject(new Error('连 OneBot 超时（' + url.replace(/\?.*$/, '') + '）—— 检查地址端口、实现有没有开 ws 服务端'))
      }, 8000)
      s.addEventListener('open', () => {
        clearTimeout(timer)
        socket = s
        connecting = null
        armIdle()
        resolve(s)
      })
      s.addEventListener('close', () => {
        if (socket === s) socket = null
      })
      s.addEventListener('error', (event) => {
        if (socket) return
        clearTimeout(timer)
        connecting = null
        reject(
          new Error(
            '连 OneBot 失败：' +
              String((event && event.message) || 'error') +
              '（检查 token 对不对；有些实现只认 Authorization 头，内置 WebSocket 发不了头）',
          ),
        )
      })
    })
    return connecting
  }

  /** 一帧可能是 string（内置 WebSocket），也可能是 Buffer（ws 包）。 */
  function parseFrame(event) {
    try {
      const raw = event && event.data
      if (typeof raw === 'string') return JSON.parse(raw)
      if (raw && typeof raw === 'object' && 'byteLength' in raw) {
        return JSON.parse(Buffer.from(raw).toString('utf8'))
      }
      return null
    } catch {
      return null
    }
  }

  /** 发一条 OneBot 请求并等它自己的 echo 回包。 */
  function call(cfg, action, params) {
    return ensure(cfg).then(
      (s) =>
        new Promise((resolve, reject) => {
          const echo = 'drop-by-' + ++seq
          const finish = (fn, value) => {
            clearTimeout(timer)
            try {
              s.removeEventListener('message', onMessage)
            } catch {
              /* 连接已经关了 */
            }
            fn(value)
          }
          const timer = setTimeout(() => finish(reject, new Error('OneBot 等回包超时（' + action + '）')), 10000)
          function onMessage(event) {
            const j = parseFrame(event)
            if (!j || j.echo !== echo) return // 心跳、meta_event 之类，不是给我们的
            armIdle()
            if (j.status === 'ok' || j.retcode === 0) finish(resolve, j.data)
            else finish(reject, new Error(j.message || j.wording || 'retcode ' + j.retcode))
          }
          s.addEventListener('message', onMessage)
          try {
            s.send(JSON.stringify({ action, params, echo }))
          } catch (error) {
            finish(reject, error)
          }
        }),
    )
  }

  /** 往一个 QQ 号发私聊。 */
  async function say(cfg, text) {
    const clean = String(text == null ? '' : text).trim()
    if (!clean) throw new Error('要发的字是空的')
    const target = String(cfg.qqTarget || '').trim()
    if (!target) throw new Error('没填 qqTarget')
    return call(cfg, 'send_private_msg', {
      user_id: /^\d+$/.test(target) ? Number(target) : target,
      message: clean,
    })
  }

  /** 只连通一下、问问自己是谁（鉴权对不对一看就知道），不发消息。 */
  async function probe(cfg) {
    return call(cfg, 'get_login_info', {})
  }

  function dispose() {
    clearIdle()
    const s = socket
    socket = null
    try {
      if (s) s.close()
    } catch {
      /* 忽略 */
    }
  }

  return { say, probe, dispose, endpoint, mode: () => (loadWsImpl() ? 'header' : 'query') }
}

/** 从 assistant 消息里抠出纯文本（工具块、图片块都不要）。 */
function textOfMessage(message) {
  if (!message || !Array.isArray(message.content)) return ''
  const parts = []
  for (const block of message.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** QQ 上别带一堆 markdown 记号（手机看着乱）。 */
function tidyForQq(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 把一整段切成「一条一条」。
 * ⚠ 以前是一整段塞进一条 send_private_msg：换行还在，但 QQ 里就是一坨连着的文字，
 *   不像人在打字。现在按行拆，每行单独发一条，行间留一点停顿。
 */
function splitForQq(text) {
  return String(text || '')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 设置页要看的会话清单：活着的 + 盘上有标题的，去重，带标题。 */
function listSessions(ctx) {
  const rows = []
  const seen = new Set()
  const subs = subagentSessionKeys()
  const push = (id, title, alive) => {
    const key = sessionKey(id)
    if (!key || seen.has(key)) return
    if (subs.has(key)) return // 子智能体的会话不列出来，免得被误勾
    seen.add(key)
    rows.push({ id: String(id), title: String(title || ''), alive: Boolean(alive) })
  }

  // ① 活着的会话
  for (const x of liveAgents(ctx)) {
    let title = ''
    try {
      const svc = ctx.get('sessionTitle')
      const s = typeof ctx.sessions.get === 'function' ? ctx.sessions.get(x.id) : undefined
      if (svc && typeof svc.get === 'function' && s) {
        const snap = svc.get(s)
        if (snap && snap.title) title = String(snap.title)
      }
    } catch {
      /* 标题服务不在，走下面的兜底 */
    }
    push(x.id, title, true)
  }

  // ② 盘上的投影缓存（没打开的会话也能认出来）
  for (const one of diskSessions()) push(one.id, one.title, false)
  return rows
}

/** 从投影缓存里把会话标题抠出来（没打开的会话也在盘上）。 */
function diskSessions() {
  const out = []
  try {
    const dir = join(HOME_DIR, 'storages', 'session_projcache', 'sessions')
    if (!existsSync(dir)) return out
    for (const entry of readdirSync(dir)) {
      const file = String(entry)
      if (!file.endsWith('.json')) continue
      const id = file.slice(0, -5)
      try {
        const j = JSON.parse(readFileSync(join(dir, file), 'utf8'))
        const rows = (j && j.record && j.record.rows) || {}
        const sub = rows.subagent && rows.subagent.val && rows.subagent.val.identity
        if (sub) continue
        const title = rows.title && typeof rows.title.val === 'string' ? rows.title.val : ''
        out.push({ id, title })
      } catch {
        /* 坏文件跳过 */
      }
    }
  } catch {
    /* 目录不在就算了 */
  }
  return out
}

/**
 * 盘上那些「子智能体」的会话，归一后的 key。
 * ⚠ 自动挑目标时必须把它们排掉 —— 不然可能把念头塞进某个 subagent 的下属会话里，
 *   那边没人看，等于自言自语。缓存 30 秒，别每次都翻一遍磁盘。
 */
let subagentCache = { at: 0, keys: new Set() }
function subagentSessionKeys() {
  if (Date.now() - subagentCache.at < 30_000) return subagentCache.keys
  const keys = new Set()
  try {
    const dir = join(HOME_DIR, 'storages', 'session_projcache', 'sessions')
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir)) {
        const file = String(entry)
        if (!file.endsWith('.json')) continue
        try {
          const j = JSON.parse(readFileSync(join(dir, file), 'utf8'))
          const rows = (j && j.record && j.record.rows) || {}
          const sub = rows.subagent && rows.subagent.val && rows.subagent.val.identity
          if (sub) keys.add(sessionKey(file.slice(0, -5)))
        } catch {
          /* 坏文件跳过 */
        }
      }
    }
  } catch {
    /* 目录不在就算了 */
  }
  subagentCache = { at: Date.now(), keys }
  return keys
}

// ---------- 执行体 ----------

/**
 * 装一个「鱼的QQ敲门」的执行体。状态全关在闭包里，插件卸载时整块丢掉。
 */
function createRunner(ctx) {
  const logRows = []
  /** 会话 -> 你上次说话的时间（ms）。只看 user/message 且来源不是我们自己。 */
  const youSpokeAt = new Map()
  const startedAt = Date.now()
  let stopTimer = null
  let onTable = 0
  /** QQ 出口（懒连接，不发就不连）。 */
  const qqOutlet = createQqOutlet()
  /** 正在等的那一轮：等它说完，就把她说的话发到 QQ。 */
  let pending = null

  const remember = (text) => {
    const row = { t: clock(), text: String(text) }
    logRows.push(row)
    if (logRows.length > LOG_LIMIT) logRows.splice(0, logRows.length - LOG_LIMIT)
    try {
      ctx.logger.info('drop-by: ' + row.text)
    } catch {
      /* logger 不在就算了 */
    }
  }

  const inQuiet = (cfg, now) => {
    if (cfg.quietFrom === cfg.quietTo) return false
    const h = now.getHours()
    if (cfg.quietFrom < cfg.quietTo) return h >= cfg.quietFrom && h < cfg.quietTo
    return h >= cfg.quietFrom || h < cfg.quietTo // 跨午夜
  }

  const pickLine = (cfg) => cfg.lines[Math.floor(Math.random() * cfg.lines.length)] || ''

  const compose = (cfg, line) => (cfg.frame ? FRAME + String.fromCharCode(10) + line : line)

  /**
   * 一条一条发到 QQ：按行拆，行间停 0.6~1.3 秒，像人在打字。
   * ⚠ 一条失败就停，不硬发剩下的 —— 免得手机上出现半截话。
   */
  async function sendToQq(cfg, text) {
    const parts = splitForQq(tidyForQq(text))
    if (!parts.length) return remember('没东西可发（空，或者只有代码块）')
    for (let i = 0; i < parts.length; i++) {
      try {
        await qqOutlet.say(cfg, parts[i])
      } catch (error) {
        return remember(`QQ 第 ${i + 1}/${parts.length} 条没发出去：${String((error && error.message) || error)}`)
      }
      if (i < parts.length - 1) await sleep(600 + Math.random() * 700)
    }
    remember(`QQ 私聊 ${cfg.qqTarget} 收到 ${parts.length} 条：「${parts[0].slice(0, 16)}${parts[0].length > 16 ? '…' : ''}」`)
  }

  /** 真发一条。force = 手动按钮：绕过开关/安静/上限/冷却/演练。 */
  async function fire(reason, force = false) {
    const cfg = readCfg()
    const now = new Date()

    if (!force) {
      if (!cfg.on) return remember('总开关关着，这轮不发')
      if (cfg.warmupMinutes > 0 && Date.now() - startedAt < cfg.warmupMinutes * 60000) {
        return remember(`刚起来，先缓 ${cfg.warmupMinutes} 分钟（免得重启就蹦一句）`)
      }
      if (inQuiet(cfg, now)) {
        return remember(`安静时段 ${cfg.quietFrom} 点到 ${cfg.quietTo} 点，这轮不发`)
      }
      const st = readState()
      // ⚠ 0 表示「今天一次都不发」，不是「不限」。
      //   以前写成 `cfg.dailyCap > 0 && ...`，于是把上限填 0 会变成无限发，反直觉也不安全。
      if (st.count >= cfg.dailyCap) {
        return remember(`今天已经开口 ${st.count} 次（上限 ${cfg.dailyCap}），这轮不发`)
      }
    }

    const target = pickTarget(ctx, cfg)
    if (!target) return remember('没有活着的目标会话（会话没打开，或者填的 id 不对）')

    if (!force && cfg.cooldownMinutes > 0) {
      const last = youSpokeAt.get(sessionKey(target.id)) || 0
      if (last && Date.now() - last < cfg.cooldownMinutes * 60000) {
        const mins = ((Date.now() - last) / 60000).toFixed(1)
        return remember(`你 ${mins} 分钟前刚说过话（冷却 ${cfg.cooldownMinutes} 分钟），这轮不打扰`)
      }
    }

    const line = pickLine(cfg)
    if (!line) return remember('念头池是空的，这轮不发')
    const text = compose(cfg, line)

    if (!force && cfg.dryRun) {
      return remember(`[演练] 本来要对 ${shortId(target.id)} 说：「${line}」（${reason}）`)
    }

    try {
      // ⚠ 必须在 followup 之前把钩子挂好：followup 一返回，回合可能已经在跑了，
      //   晚一步就会漏掉 turn/start，抓回来的东西就不知道是谁的。
      const key = sessionKey(target.id)
      if (cfg.qqOn && cfg.qqMode === 'reply') {
        pending = { key, at: Date.now(), turn: null, texts: [] }
      } else {
        pending = null
      }

      await target.agent.followup(makeUserMessage(text))
      remember(`已开口 → ${shortId(target.id)}：「${line}」（${reason}）`)
      const st = readState()
      // ⚠ 手动「立刻试一次」不计进当天额度：额度是给自动节奏用的。
      //   不然点两次测试，当天的自动开口就被自己挤掉了，界面上还会出现「今天 5 次 / 上限 4」这种对不上的数。
      if (!force) writeState({ day: st.day, count: st.count + 1, lastAt: Date.now() })
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function' && target.agent.session) {
          await ctx.sessions.flush(target.agent.session)
        }
      } catch {
        /* 落盘没确认不影响已经说出去的话 */
      }

      // QQ 出口：line 模式直接把念头那句发过去；reply 模式等这一轮说完再发（见 onSessionEvent）
      if (cfg.qqOn && cfg.qqMode === 'line') {
        remember(`QQ 出口：把「${line}」直发 ${cfg.qqTarget}`)
        void sendToQq(cfg, line)
      } else if (cfg.qqOn) {
        remember(`QQ 出口：等她这一轮说完，再把她说的那句发到 ${cfg.qqTarget}`)
      }
    } catch (error) {
      pending = null
      // ⚠ 必须吞住：followup reject 一旦变成未处理的 rejection，Node 22+ 直接带走宿主进程
      remember(`followup 失败（这轮放弃）：${String((error && error.message) || error)}`)
    }
  }

  /** 这一轮的间隔（毫秒）。 */
  function nextDelayMs(cfg) {
    if (cfg.mode === 'fixed') return Math.max(1, cfg.everyMinutes) * 60000
    const lo = Math.max(1, Math.min(cfg.minMinutes, cfg.maxMinutes))
    const hi = Math.max(lo, cfg.maxMinutes)
    const minutes = lo + Math.random() * (hi - lo)
    return Math.max(60_000, Math.round(minutes * 60000))
  }

  /** 换表：先把旧表停掉，再按新间隔挂一块。 */
  function rearm() {
    if (stopTimer) {
      try {
        stopTimer()
      } catch {
        /* 停表失败无所谓，卸载时 Cordis 也会收走 */
      }
      stopTimer = null
    }
    if (typeof ctx.interval !== 'function') {
      remember('拿不到 timer 服务（ctx.interval 不在），定时开口不会跑，但设置页和手动按钮还能用')
      return
    }
    const cfg = readCfg()
    const delay = nextDelayMs(cfg)
    onTable = delay
    stopTimer = ctx.interval(() => {
      void fire('定时')
        .catch((error) => remember(`这一轮出错（已忽略）：${String((error && error.message) || error)}`))
        .finally(() => {
          try {
            const next = readCfg()
            // 随机模式每轮都要重算一次；固定模式只有改了数字才重挂
            if (next.mode === 'random' || Math.max(1, next.everyMinutes) * 60000 !== onTable) rearm()
          } catch {
            /* finally 里再抛就等于把宿主带走，吞掉 */
          }
        })
    }, delay)
  }

  function start() {
    const cfg = readCfg()
    rearm()
    remember(
      `装好了 v${VERSION}：${cfg.mode === 'fixed' ? `每 ${cfg.everyMinutes} 分钟` : `${cfg.minMinutes}~${cfg.maxMinutes} 分钟随机`}` +
        `｜安静 ${cfg.quietFrom}~${cfg.quietTo} 点｜每天最多 ${cfg.dailyCap} 次｜冷却 ${cfg.cooldownMinutes} 分钟` +
        `｜QQ 出口 ${cfg.qqOn ? (cfg.qqMode === 'reply' ? `开（发她说的话 → ${cfg.qqTarget}）` : `开（发念头 → ${cfg.qqTarget}）`) : '关'}` +
        `｜${cfg.dryRun ? '**演练中（只记账不发）**' : '演练已关（到点真发）'}`,
    )
  }

  function stop() {
    pending = null
    if (stopTimer) {
      try {
        stopTimer()
      } catch {
        /* 忽略 */
      }
      stopTimer = null
    }
    try {
      qqOutlet.dispose()
    } catch {
      /* 连接可能已经关了 */
    }
  }

  /**
   * 两件事都挂在同一个 session/event 上：
   *   ① 记你什么时候说过话（冷却闸门）
   *   ② 抓我们这一轮她自己说的话，等到 turn/end 再发到你 QQ
   */
  function onSessionEvent(session, event) {
    try {
      if (!event || typeof event.type !== 'string') return
      const id = session && (session.id || session.sessionId)

      // ① 冷却
      if (event.type === 'user/message') {
        const src = event.data && event.data.source
        if (!(src && src.kind === SOURCE_KIND) && id) {
          youSpokeAt.set(sessionKey(id), event.time || Date.now())
        }
      }

      // ② QQ 转发
      if (!pending || !id || sessionKey(id) !== pending.key) return
      if (Date.now() - pending.at > 10 * 60_000) {
        pending = null
        return remember('等了十分钟还没等到这一轮结束，QQ 就不发了')
      }
      if (event.type === 'turn/start') {
        pending.turn = event.data && event.data.turn !== undefined ? event.data.turn : 0
        return
      }
      if (event.type === 'assistant/message') {
        const said = textOfMessage(event.data && event.data.message)
        if (said) pending.texts.push(said)
        return
      }
      if (event.type !== 'turn/end') return

      const job = pending
      pending = null
      if (job.turn === null) {
        // 没等到 turn/start：可能抓到的是别人的回合，宁可不发
        return remember('没抓到这一轮的起点（turn/start），QQ 不发，免得把别人的话发过去')
      }
      const last = job.texts.filter(Boolean).pop()
      if (!last) return remember('这一轮她没说出话（可能全是工具调用），QQ 不发')
      const cfg = readCfg()
      if (!cfg.qqOn) return remember('QQ 出口这期间被关掉了，不发')
      if (!splitForQq(tidyForQq(last)).length) return remember('这一轮只有代码/空，QQ 不发')
      void sendToQq(cfg, last)
    } catch (error) {
      // 事件形状变了就少记一笔，别把宿主带走
      void error
    }
  }

  return { fire, start, stop, rearm, logRows, onSessionEvent, youSpokeAt, qqOutlet }
}

// ---------- 插件入口 ----------

export function apply(ctx, config) {
  void config
  const runner = createRunner(ctx)

  // 记你说话的时间（冷却闸门）
  try {
    ctx.on('session/event', (session, event) => runner.onSessionEvent(session, event))
  } catch (error) {
    runner.logRows.push({ t: clock(), text: `挂不上 session/event（冷却会失效）：${String((error && error.message) || error)}` })
  }

  // 起表
  try {
    runner.start()
  } catch (error) {
    runner.logRows.push({ t: clock(), text: `起表失败：${String((error && error.message) || error)}` })
  }

  // 卸载时收表
  try {
    ctx.effect(() => () => runner.stop())
  } catch {
    /* 老版本 cordis 没有 effect 就算了，Cordis 自己也会收 */
  }

  // ---------- 设置页 ----------
  const readBody = async (req) => {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 512 * 1024) break
    }
    try {
      return JSON.parse(body || '{}')
    } catch {
      return {}
    }
  }
  const sendJson = (res, value) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  const route = (path, handler) => {
    if (!ctx.webServer || typeof ctx.webServer.register !== 'function') return
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            sendJson(res, { ok: false, error: String((error && error.message) || error) })
          }
        },
      }),
    )
  }

  route(ROUTE, async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(renderPage({ route: ROUTE }))
  })

  route(ROUTE + '/api/state', async (req, res) => {
    sendJson(res, {
      ok: true,
      version: VERSION,
      cfg: readCfg(),
      defaults: clone(DEFAULTS),
      state: readState(),
      sessions: listSessions(ctx),
      log: runner.logRows.slice(-40).reverse(),
      now: { today: dayKey(), at: clock() },
    })
  })

  route(ROUTE + '/api/save', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '要用 POST' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, { ok: false, error: '不许跨站写' })
    const body = await readBody(req)
    const cfg = saveCfg(body)
    runner.rearm()
    runner.logRows.push({ t: clock(), text: '设置已保存，表已按新间隔重挂' })
    sendJson(res, { ok: true, cfg })
  })

  route(ROUTE + '/api/fire', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '要用 POST' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, { ok: false, error: '不许跨站写' })
    await runner.fire('手动', true)
    sendJson(res, { ok: true, log: runner.logRows.slice(-6).reverse() })
  })

  /** 只试 QQ 这条路：按一下，往 qqTarget 发一句固定的话。不碰会话、不花 token。 */
  route(ROUTE + '/api/qq-test', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '要用 POST' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, { ok: false, error: '不许跨站写' })
    const cfg = readCfg()
    if (!String(cfg.qqTarget || '').trim()) return sendJson(res, { ok: false, error: '还没填 qqTarget' })
    try {
      await runner.qqOutlet.say(cfg, 'QQ 出口测试：这条是从 dsh-drop-by 发出来的，通路正常。')
      sendJson(res, { ok: true, target: cfg.qqTarget, at: clock() })
    } catch (error) {
      sendJson(res, { ok: false, error: String((error && error.message) || error) })
    }
  })

  /**
   * 只问「你是谁」，不发消息。
   * 用来确认连上的到底是哪个实现（NapCat / Lagrange / LLOneBot…），顺便看鉴权通不通。
   */
  route(ROUTE + '/api/qq-probe', async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, { ok: false, error: '要用 POST' })
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendJson(res, { ok: false, error: '不许跨站写' })
    const cfg = readCfg()
    try {
      const info = await runner.qqOutlet.probe(cfg)
      sendJson(res, {
        ok: true,
        mode: runner.qqOutlet.mode(),
        user_id: info && info.user_id,
        nickname: info && info.nickname,
      })
    } catch (error) {
      sendJson(res, { ok: false, error: String((error && error.message) || error) })
    }
  })
}
