/**
 * 网页半边冒烟：不碰真浏览器，用假的 window / react / slots 把 factory 跑一遍。
 * 跑法：node tests/client-smoke.mjs
 * 验的是：模块能加载、exports 里有 apply 和 inject、apply 会把 Section 注册到 settings.section 上。
 */

const problems = []
let loaded = null

// 假 ModuleLoader：把 factory 截下来
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      loaded = def
    },
  },
}

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useState: (v) => [v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
}

await import('../lib/client.js')

if (!loaded) {
  problems.push('模块没走 window.__ModuleLoader__.load')
} else {
  if (loaded.id !== 'dsh-drop-by') problems.push('模块 id 不是 dsh-drop-by：' + loaded.id)
  const mod = loaded.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error('client 不该 require(' + name + ')')
  })
  // factory 约定是 `return module.exports`，所以返回值本身就是 exports
  const ex = mod && mod.exports ? mod.exports : mod
  if (!ex || typeof ex !== 'object') problems.push('factory 没返回 exports')
  else {
    if (typeof ex.apply !== 'function') problems.push('exports.apply 不是函数')
    if (!Array.isArray(ex.inject) || ex.inject[0] !== 'slots') problems.push('exports.inject 不对')
  }

  let registered = null
  const fakeSlots = {
    inject(name, fn) {
      if (name !== 'settings.section') problems.push('inject 的槽位不对：' + name)
      fn()
    },
    register(def, component) {
      registered = { def, component }
    },
  }
  const ctx = {
    get: (name) => (name === 'slots' ? fakeSlots : undefined),
  }

  ex.apply(ctx)
  if (!registered) {
    problems.push('apply 没把 Section 注册上')
  } else {
    if (registered.def.name !== 'settings.section') problems.push('注册的槽位名不对')
    if (registered.def.id !== 'drop-by') problems.push('注册的 id 不对')
    if (typeof registered.def.label !== 'function' || typeof registered.def.label() !== 'string') problems.push('label 必须是返回字符串的函数')
    if (typeof registered.component !== 'function') problems.push('Section 不是函数组件')
  }
}

if (problems.length) {
  console.log('❌ 没过：')
  for (const p of problems) console.log('   - ' + p)
  process.exit(1)
}
console.log('✅ 网页半边全过：模块加载、exports.apply/inject、Section 注册到 settings.section')
