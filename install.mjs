#!/usr/bin/env node
/**
 * dsh-drop-by 安装器（跨平台，Node 写）
 *
 *   node install.mjs                    # 装到默认 profile（desktop）
 *   node install.mjs --profile default  # 换 profile
 *   node install.mjs --dsh-home <路径>  # 换 DSH_HOME（测的时候用）
 *   node install.mjs --dry-run          # 只说要干什么，不动文件
 *   node install.mjs --remove           # 卸载（删 link、摘依赖和 bundles、删 patch 段）
 *
 * 做的事和 install.ps1 一样，但**不依赖 PowerShell** ——
 * Windows 上 PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会往 json 里塞 BOM，
 * 而 Node 的 JSON.parse 读到 BOM 会直接让 DSH 在启动阶段崩掉（`Unexpected token '锘`）。
 * 这里全程用 Node 自己写文件，天然无 BOM。
 *
 * ⚠ 本脚本不重启、不关机。装完重启 DSH 才加载。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, lstatSync, unlinkSync, symlinkSync, renameSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_NAME = 'dsh-drop-by'

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const opt = { profile: 'desktop', dshHome: process.env.DSH_HOME || join(homedir(), '.dsh'), dryRun: false, remove: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--profile') opt.profile = argv[++i]
  else if (a === '--dsh-home') opt.dshHome = resolve(argv[++i])
  else if (a === '--dry-run') opt.dryRun = true
  else if (a === '--remove' || a === '-r') opt.remove = true
  else if (a === '--help' || a === '-h') {
    console.log('用法：node install.mjs [--profile desktop] [--dsh-home 路径] [--dry-run] [--remove]')
    process.exit(0)
  } else {
    console.error('不认识的参数：' + a)
    process.exit(2)
  }
}

const profileDir = join(opt.dshHome, 'profiles', opt.profile)
const pkgPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')
const linkPath = join(profileDir, 'node_modules', PACKAGE_NAME)

const say = (text) => console.log(text)
const die = (text) => {
  console.error('✗ ' + text)
  process.exit(1)
}

/** 原子写：先 tmp 再 rename，掉电不会留半截；utf8 不带 BOM。 */
function writeAtomic(path, text) {
  const tmp = path + '.tmp-install'
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// ---------- 前置检查 ----------
if (!existsSync(pkgPath)) {
  const profilesDir = join(opt.dshHome, 'profiles')
  let found = []
  try {
    found = readdirSync(profilesDir).filter((n) => existsSync(join(profilesDir, n, 'package.json')))
  } catch {
    /* 目录都没有 */
  }
  die(
    `找不到 ${pkgPath}\n` +
      (found.length ? `  现有的 profile：${found.join(', ')}\n  用 --profile <名字> 指定一个` : '  先启动一次 DSH，让它把 profile 建出来'),
  )
}
if (!existsSync(patchPath)) die(`找不到 ${patchPath}`)

say('插件目录 : ' + HERE)
say('profile  : ' + profileDir)
if (opt.dryRun) say('（干跑：不会改任何文件）')
say('')

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backup = (path) => {
  // ⚠ 备份名必须唯一：同一秒里重跑两次，后面的备份会盖掉前面那份「原件」
  let to = `${path}.bak-dropby-${stamp}`
  let n = 1
  while (existsSync(to)) to = `${path}.bak-dropby-${stamp}-${n++}`
  if (!opt.dryRun) writeAtomic(to, readFileSync(path, 'utf8'))
  say('已备份    : ' + basename(to))
}

// ---------- 卸载 ----------
if (opt.remove) {
  backup(pkgPath)
  backup(patchPath)

  // 1) link
  if (existsSync(linkPath) || isLink(linkPath)) {
    if (!opt.dryRun) unlinkSync(linkPath)
    say('link      : 已删除')
  } else {
    say('link      : 本来就不在')
  }

  // 2) package.json
  const pkg = readJson(pkgPath)
  let touched = false
  if (pkg.dependencies && PACKAGE_NAME in pkg.dependencies) {
    delete pkg.dependencies[PACKAGE_NAME]
    touched = true
    say('dependencies: 已移除')
  }
  const bundles = pkg.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)) {
    pkg.dsh.profile.bundles = bundles.filter((x) => x !== PACKAGE_NAME)
    touched = true
    say('bundles   : 已移除')
  }
  if (touched && !opt.dryRun) writeAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

  // 3) patch 段
  const text = readFileSync(patchPath, 'utf8')
  const stripped = text.replace(
    /\r?\n?#[^\n]*dsh-drop-by[^\n]*\r?\n- insert:\s*\r?\n\s*- id:\s*dsh-drop-by\s*\r?\n\s*name:\s*dsh-drop-by\s*\r?\n?/,
    '\n',
  ).replace(/\r?\n- insert:\s*\r?\n\s*- id:\s*dsh-drop-by\s*\r?\n\s*name:\s*dsh-drop-by\s*\r?\n?/, '\n')
  if (stripped !== text) {
    if (!opt.dryRun) writeAtomic(patchPath, stripped)
    say('patch     : 已删除 drop-by 段')
  } else {
    say('patch     : 没找到 drop-by 段（可能已经删过）')
  }

  say('')
  say(`卸完了。设置文件还在：${join(opt.dshHome, 'drop-by-config.json')}`)
  say('没有重启任何东西 —— 你自己重启 DSH 之后才真正下线。')
  process.exit(0)
}

// ---------- 安装 ----------
backup(pkgPath)
backup(patchPath)

// 1) package.json：依赖 + bundles
const pkg = readJson(pkgPath)
let changed = false

if (!pkg.dependencies || typeof pkg.dependencies !== 'object') {
  pkg.dependencies = {}
  changed = true
}
const wantSpec = 'link:' + HERE
if (pkg.dependencies[PACKAGE_NAME] !== wantSpec) {
  pkg.dependencies[PACKAGE_NAME] = wantSpec
  changed = true
  say('dependencies: ' + wantSpec)
} else {
  say('dependencies: 已经是这个指向，跳过')
}

if (!pkg.dsh || typeof pkg.dsh !== 'object') {
  pkg.dsh = {}
  changed = true
}
if (!pkg.dsh.profile || typeof pkg.dsh.profile !== 'object') {
  pkg.dsh.profile = {}
  changed = true
}
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
if (!bundles.includes(PACKAGE_NAME)) {
  pkg.dsh.profile.bundles = bundles.concat([PACKAGE_NAME])
  changed = true
  say('bundles   : 已加 ' + PACKAGE_NAME)
} else {
  say('bundles   : 已存在，跳过')
}

if (changed) {
  if (!opt.dryRun) writeAtomic(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  say('已写入    : ' + pkgPath)
} else {
  say('package.json: 没有要改的')
}

// 2) node_modules 下的 link
function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

if (isLink(linkPath)) {
  // Windows 的 junction 读出来是绝对路径；比对一下是不是已经指对了
  let target = ''
  try {
    target = resolve(readlinkTarget(linkPath))
  } catch {
    target = ''
  }
  if (target === resolve(HERE)) {
    say('link      : 已存在且指向本目录，跳过')
  } else {
    say('link      : 已存在但指向 ' + (target || '(读不到)') + '，重建')
    if (!opt.dryRun) {
      unlinkSync(linkPath)
      makeLink()
    }
  }
} else if (existsSync(linkPath)) {
  die(`${linkPath} 已经存在，而且不是 link（可能是真目录）。先把它挪走再装。`)
} else {
  makeLink()
}

function makeLink() {
  const parent = dirname(linkPath)
  if (!existsSync(parent) && !opt.dryRun) mkdirSync(parent, { recursive: true })
  if (opt.dryRun) {
    say('link      : 会建 -> ' + HERE)
    return
  }
  symlinkSync(HERE, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  say('link      : 已建 -> ' + HERE)
}

function readlinkTarget(path) {
  // Windows 的 junction 也能读出来（绝对路径）
  return readlinkSync(path)
}

// 3) cordis.patch.yml
const patchText = readFileSync(patchPath, 'utf8')
if (/name:\s*dsh-drop-by/.test(patchText)) {
  say('patch     : 已经有 drop-by 段，跳过')
} else {
  const block =
    '\n# ── dsh-drop-by：到点了她自己来找你说话（设置页 /dsh-drop-by）──\n' +
    '- insert:\n' +
    '    - id: dsh-drop-by\n' +
    '      name: dsh-drop-by\n'
  if (opt.dryRun) {
    say('patch     : 会追加 insert 段')
  } else {
    writeAtomic(patchPath, patchText.replace(/\s*$/, '\n') + block)
    say('patch     : 已插入 insert 段')
  }
}

say('')
say('装完了。现在没有重启任何东西 —— 你方便的时候自己重启 DSH 才会加载。')
say('重启后两个入口：DSH 设置左边栏「鱼的QQ敲门」，或者 http://127.0.0.1:<DSH 端口>/dsh-drop-by')
say('卸载：node install.mjs --remove')
