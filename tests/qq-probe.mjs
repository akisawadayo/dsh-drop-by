/**
 * QQ 出口连通性测试（只问「我是谁」，不发消息）。
 * 跑法：node tests/qq-probe.mjs [wsUrl] [token]
 *   默认 ws://127.0.0.1:3001，token 和 QQ 号从 ~/.dsh/drop-by-config.json 取。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createQqOutlet } from '../lib/host.js'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
let saved = {}
try {
  saved = JSON.parse(readFileSync(join(home, 'drop-by-config.json'), 'utf8')) || {}
} catch {
  saved = {}
}

const cfg = {
  qqWsUrl: process.argv[2] || saved.qqWsUrl || 'ws://127.0.0.1:3001',
  qqToken: process.argv[3] || process.env.DROPBY_QQ_TOKEN || saved.qqToken || '',
  qqTarget: saved.qqTarget || '',
}

console.log('连接:', cfg.qqWsUrl, '| token:', cfg.qqToken ? '已填' : '（空）')

const outlet = createQqOutlet()
console.log(
  '鉴权方式:',
  outlet.mode() === 'header' ? 'Authorization 头（借到了宿主 profile 里的 ws 包）' : '?access_token=（宿主没有 ws 包，退回内置 WebSocket）',
)
try {
  const info = await outlet.probe(cfg)
  console.log('✅ 通上了，登录的是:', JSON.stringify(info))
  process.exitCode = 0
} catch (error) {
  console.log('❌ 没通:', String((error && error.message) || error))
  process.exitCode = 1
} finally {
  outlet.dispose()
}
process.exit(process.exitCode || 0)
