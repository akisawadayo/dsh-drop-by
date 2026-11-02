// DSH「鱼的QQ敲门」—— 网页半边
//
// 只干一件事：在 **DSH 设置**左边栏加一项「鱼的QQ敲门」，把 drop-by 的全部设置摆出来，
// 外加三个安全按钮（保存 / 立刻试一次 / 发QQ消息测通路联通）和一份最近记录。
//
// ⚠ 这里**不碰会话、不发消息**，只是往宿主那几条 /dsh-drop-by/* 路由上读写。
//   真正的定时和 followup 都在宿主半边（lib/host.js），这样只有一份逻辑。
// ⚠ 槽位名 'settings.section' 跟 dsh-speak-up / dsh-fish-memory 用的是同一个，
//   在这台机器上已经跑通了，照抄。
window.__ModuleLoader__.load({
  id: 'dsh-drop-by',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React
    const inject = ['slots']

    const B = '/dsh-drop-by'
    /**
     * ⚠ 别把「宿主没回话」当成一种错误就去猜 —— 先看状态码。
     *   最常见的其实是：网页半边是新的，宿主那半边还是旧版（没重启），路由根本不存在。
     */
    const get = async (p) => {
      try {
        const r = await fetch(B + p, { cache: 'no-store' })
        const text = await r.text()
        if (!r.ok) return { ok: false, error: explainStatus(r.status) }
        try {
          return JSON.parse(text)
        } catch {
          return { ok: false, error: '宿主回的不是 JSON：' + text.slice(0, 80) }
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
    const post = async (p, body) => {
      try {
        const r = await fetch(B + p, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        })
        const text = await r.text()
        if (!r.ok) return { ok: false, error: explainStatus(r.status) }
        try {
          return JSON.parse(text)
        } catch {
          return { ok: false, error: '宿主回的不是 JSON：' + text.slice(0, 80) }
        }
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
    }
    function explainStatus(status) {
      if (status === 404 || status === 405) {
        return 'HTTP ' + status + ' —— 这一版宿主没有这个接口。八成是只更新了网页那一半，重启一次 DSH 就好。'
      }
      return 'HTTP ' + status
    }

    // 样式一律贴着 DSH 的主题变量走，换皮肤、换深浅色都跟着变
    const S = {
      wrap: { maxWidth: 780, color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: 4 },
      title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px' },
      intro: { color: 'var(--dsw-alias-label-tertiary)', margin: '2px 0 8px', fontSize: 13, lineHeight: '20px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 10,
        padding: '12px 14px',
        marginTop: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      groupTitle: { fontSize: 13, fontWeight: 600, lineHeight: '20px', marginBottom: 8 },
      row: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '8px 20px',
        padding: '8px 0',
        borderBottom: '.5px solid var(--dsw-alias-border-l2)',
        flexWrap: 'wrap',
      },
      rowLast: { borderBottom: 'none' },
      labelBox: { flex: '1 1 200px', minWidth: 180 },
      label: { fontSize: 13, lineHeight: '19px' },
      hint: { color: 'var(--dsw-alias-label-tertiary)', marginTop: 3, fontSize: 11.5, lineHeight: '17px' },
      input: {
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12.5,
        height: 30,
        padding: '0 9px',
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
      },
      num: {
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12.5,
        height: 30,
        padding: '0 9px',
        outline: 'none',
        width: 96,
      },
      box: {
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12.5,
        padding: '8px 9px',
        outline: 'none',
        width: '100%',
        minHeight: 92,
        resize: 'vertical',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
      },
      list: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        maxHeight: 200,
        overflow: 'auto',
        width: '100%',
      },
      item: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '.5px solid var(--dsw-alias-border-l2)', cursor: 'pointer' },
      dot: { width: 7, height: 7, borderRadius: 999, background: 'var(--dsw-alias-border-l2)', flex: 'none' },
      dotOn: { width: 7, height: 7, borderRadius: 999, background: 'var(--dsw-alias-state-success-primary, #3fb950)', flex: 'none' },
      itemName: { flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      itemId: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace,Menlo,monospace' },
      actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '.5px solid var(--dsw-alias-border-l2)' },
      btn: {
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        border: 'none',
        borderRadius: 6,
        fontSize: 12.5,
        height: 30,
        padding: '0 14px',
        cursor: 'pointer',
      },
      btn2: {
        background: 'transparent',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: 6,
        fontSize: 12.5,
        height: 30,
        padding: '0 12px',
        cursor: 'pointer',
      },
      logBox: {
        fontFamily: 'ui-monospace,Menlo,monospace',
        fontSize: 11.5,
        lineHeight: '17px',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'rgba(127,127,127,.08)',
        borderRadius: 8,
        padding: '10px 12px',
        maxHeight: 220,
        overflow: 'auto',
        marginTop: 8,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
      err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, marginTop: 8, whiteSpace: 'pre-line' },
      ok: { color: 'var(--dsw-alias-state-success-primary, #3fb950)', fontSize: 12, marginTop: 8 },
      switch: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 180 },
    }

    function Row(props) {
      const last = props.last
      return h(
        'div',
        { style: last ? { ...S.row, ...S.rowLast } : S.row },
        h('div', { style: S.labelBox }, h('div', { style: S.label }, props.label), props.hint ? h('div', { style: S.hint }, props.hint) : null),
        h('div', { style: props.wide ? { flex: '1 1 100%' } : { flex: '0 0 auto' } }, props.children),
      )
    }

    function Section() {
      const [cfg, setCfg] = useState(null)
      const [sessions, setSessions] = useState([])
      const [log, setLog] = useState([])
      const [st, setSt] = useState(null)
      const [msg, setMsg] = useState('')
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const [who, setWho] = useState(null)

      const load = useCallback(async () => {
        const j = await get('/api/state')
        if (!j || !j.ok) {
          setErr('读不到设置：' + ((j && j.error) || '未知错误'))
          return
        }
        setErr('')
        setCfg(j.cfg)
        setSessions(j.sessions || [])
        setLog(j.log || [])
        setSt(j.state || null)
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }))
      const toggleTarget = (id) => {
        const key = (x) => String(x).replace(/^session-/, '')
        const now = (cfg.targets || []).filter((x) => key(x) !== key(id))
        const was = (cfg.targets || []).some((x) => key(x) === key(id))
        set('targets', was ? now : now.concat([id]))
      }

      const save = async () => {
        setBusy(true)
        setErr('')
        const j = await post('/api/save', cfg)
        setBusy(false)
        if (!j || !j.ok) return setErr('保存失败：' + ((j && j.error) || '未知错误'))
        setCfg(j.cfg)
        setMsg('保存好了，间隔已按新设置重挂')
        load()
      }

      const fire = async () => {
        setBusy(true)
        setErr('')
        const j = await post('/api/fire', {})
        setBusy(false)
        if (!j || !j.ok) return setErr('没发出去：' + ((j && j.error) || '未知错误'))
        setMsg('这一轮记下来了，看下面的记录')
        load()
      }

      const qqTest = async () => {
        setBusy(true)
        setErr('')
        const saved = await post('/api/save', cfg)
        if (!saved || !saved.ok) {
          setBusy(false)
          return setErr('先保存失败：' + ((saved && saved.error) || '未知错误'))
        }
        const j = await post('/api/qq-test', {})
        setBusy(false)
        if (!j || !j.ok) return setErr('QQ 没发出去：' + ((j && j.error) || '未知错误'))
        setMsg('发出去一条了，看看手机')
        load()
      }

      /** 只问「你是谁」，不发消息。换个 OneBot 实现之后先按这个。 */
      const probeQq = async () => {        setBusy(true)
        setErr('')
        setWho(null)
        const saved = await post('/api/save', cfg)
        if (!saved || !saved.ok) {
          setBusy(false)
          return setErr('先保存失败：' + ((saved && saved.error) || '未知错误'))
        }
        const j = await post('/api/qq-probe', {})
        setBusy(false)
        if (!j || !j.ok) return setErr('连不上：' + ((j && j.error) || '未知错误'))
        setWho(j)
      }

      /** 真的走一遍她那个工具，往念头池里写一句测试念头（验证工具确实注册上了）。 */
      const lineTest = async () => {
        setBusy(true)
        setErr('')
        const j = await post('/api/line-test', {})
        setBusy(false)
        if (!j || !j.ok) return setErr('没写成：' + ((j && j.error) || '未知错误'))
        setMsg(`她自己写了一句「${j.text}」，念头池现在 ${j.count} 句`)
        load()
      }

      if (!cfg) {
        return h(
          'div',
          { style: S.wrap },
          h('h3', { style: S.title }, '鱼的QQ敲门'),
          err ? h('div', { style: S.err }, err) : h('div', { style: S.intro }, '加载中…'),
        )
      }

      const modeRadio = (value, text) =>
        h(
          'label',
          { style: S.switch },
          h('input', { type: 'radio', name: 'dropby-mode', checked: cfg.mode === value, onChange: () => set('mode', value) }),
          h('span', { style: { fontSize: 12.5 } }, text),
        )

      const qqModeRadio = (value, text) =>
        h(
          'label',
          { style: S.switch },
          h('input', { type: 'radio', name: 'dropby-qqmode', checked: cfg.qqMode === value, onChange: () => set('qqMode', value) }),
          h('span', { style: { fontSize: 12.5 } }, text),
        )

      const targets = cfg.targets || []
      const isPicked = (id) => targets.some((x) => String(x).replace(/^session-/, '') === String(id).replace(/^session-/, ''))

      return h(
        'div',
        { style: S.wrap },
        h('h3', { style: S.title }, '鱼的QQ敲门'),
        h(
          'p',
          { style: S.intro },
          '到点了她自己开口。插件只负责叫她 —— 说什么由 DSH 那一轮自己决定。',
        ),

        // —— 总开关 ——
        h(
          'div',
          { style: S.card },
          h('div', { style: S.groupTitle }, '开关'),
          h(
            'label',
            { style: { ...S.switch, padding: '4px 0' } },
            h('input', { type: 'checkbox', checked: !!cfg.on, onChange: (e) => set('on', e.target.checked) }),
            h('span', { style: { fontSize: 12.5 } }, '总开关（关掉就完全不动）'),
          ),
          h(
            'label',
            { style: { ...S.switch, padding: '4px 0' } },
            h('input', { type: 'checkbox', checked: !!cfg.dryRun, onChange: (e) => set('dryRun', e.target.checked) }),
            h('span', { style: { fontSize: 12.5 } }, '演练模式（只记账、不真发 —— 先看几轮再关）'),
          ),
          h(
            'label',
            { style: { ...S.switch, padding: '4px 0' } },
            h('input', { type: 'checkbox', checked: !!cfg.frame, onChange: (e) => set('frame', e.target.checked) }),
            h('span', { style: { fontSize: 12.5 } }, '给念头包一层「这是你自己冒出来的」（建议开）'),
          ),
        ),

        // —— 间隔 ——
        h(
          'div',
          { style: S.card },
          h('div', { style: S.groupTitle }, '节奏'),
          h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', paddingBottom: 6 } }, modeRadio('random', '随机（更像人）'), modeRadio('fixed', '固定间隔')),
          h(
            Row,
            { label: '固定：每多少分钟', hint: '只在「固定间隔」时生效' },
            h('input', { type: 'number', style: S.num, value: cfg.everyMinutes, min: 1, max: 10080, onChange: (e) => set('everyMinutes', Number(e.target.value)) }),
          ),
          h(
            Row,
            { label: '随机：下限 / 上限（分钟）', hint: '每一轮都重新掷一次，不会整点报到' },
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h('input', { type: 'number', style: S.num, value: cfg.minMinutes, min: 1, max: 10080, onChange: (e) => set('minMinutes', Number(e.target.value)) }),
              h('input', { type: 'number', style: S.num, value: cfg.maxMinutes, min: 1, max: 10080, onChange: (e) => set('maxMinutes', Number(e.target.value)) }),
            ),
          ),
          h(
            Row,
            { label: '安静时段（点）', hint: '起 = 止 表示不启用；跨午夜也行' },
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h('input', { type: 'number', style: S.num, value: cfg.quietFrom, min: 0, max: 23, onChange: (e) => set('quietFrom', Number(e.target.value)) }),
              h('input', { type: 'number', style: S.num, value: cfg.quietTo, min: 0, max: 23, onChange: (e) => set('quietTo', Number(e.target.value)) }),
            ),
          ),
          h(
            Row,
            { label: '每天最多几次', hint: '到点最多说几次；0 = 今天一次都不说' },
            h('input', { type: 'number', style: S.num, value: cfg.dailyCap, min: 0, max: 96, onChange: (e) => set('dailyCap', Number(e.target.value)) }),
          ),
          h(
            Row,
            { label: '冷却（分钟）', hint: '你刚说过话就别插嘴；0 = 不冷却', last: true },
            h('input', { type: 'number', style: S.num, value: cfg.cooldownMinutes, min: 0, max: 1440, onChange: (e) => set('cooldownMinutes', Number(e.target.value)) }),
          ),
        ),

        // —— 目标会话 ——
        h(
          'div',
          { style: S.card },
          h('div', { style: S.groupTitle }, '说给谁听'),
          h('div', { style: S.hint, marginBottom: 6 }, '选一个，就固定往那里说；一个都不选，就随机挑一个活着的。绿点是现在活着的。'),
          h(
            'div',
            { style: S.list },
            sessions.length
              ? sessions.map((s) =>
                  h(
                    'label',
                    { key: s.id, style: S.item },
                    h('input', { type: 'radio', name: 'target-pick', checked: isPicked(s.id), onChange: () => set('targets', [s.id]) }),
                    h('span', { style: s.alive ? S.dotOn : S.dot }),
                    h('span', { style: S.itemName }, s.title || '（还没起名）'),
                    h('span', { style: S.itemId }, String(s.id).slice(-8)),
                  ),
                )
              : h('div', { style: { ...S.item, cursor: 'default', color: 'var(--dsw-alias-label-tertiary)' } }, '现在一个会话都没扫到'),
          ),
        ),

        // —— 念头池 ——
        h(
          'div',
          { style: S.card },
          h('div', { style: S.groupTitle }, '念头池'),
          h('div', { style: S.hint, marginBottom: 6 }, '一行一条，每次随机挑一条。写成她心里冒出来的一句话，别写成台词。她自己也能用工具往里写（最多留 30 句）。'),
          h('textarea', {
            style: S.box,
            value: (cfg.lines || []).join('\n'),
            spellCheck: false,
            onChange: (e) => set('lines', e.target.value.split('\n')),
          }),
          h('div', { style: { ...S.hint, marginTop: 10, marginBottom: 4 } }, '她往池子里写东西的方式（二选一，互斥）'),
          h(
            'div',
            { style: { display: 'flex', gap: 18, flexWrap: 'wrap' } },
            h(
              'label',
              { style: S.switch },
              h('input', { type: 'radio', name: 'dwl', checked: cfg.lineWriteMode !== 'nudge', onChange: () => set('lineWriteMode', 'free') }),
              h('span', { style: { fontSize: 12.5 } }, '她自己决定写不写，插件不提醒'),
            ),
            h(
              'label',
              { style: S.switch },
              h('input', { type: 'radio', name: 'dwl', checked: cfg.lineWriteMode === 'nudge', onChange: () => set('lineWriteMode', 'nudge') }),
              h('span', { style: { fontSize: 12.5 } }, '插件提醒她写念头池'),
            ),
          ),
        ),

        // —— QQ 出口 ——
        h(
          'div',
          { style: S.card },
          h('div', { style: S.groupTitle }, 'QQ 出口'),
          h('div', { style: S.hint, marginBottom: 6 }, '到点之后，把她这一轮真说的话一条一条发到你 QQ 私聊。'),
          h(
            'label',
            { style: { ...S.switch, padding: '4px 0' } },
            h('input', { type: 'checkbox', checked: !!cfg.qqOn, onChange: (e) => set('qqOn', e.target.checked) }),
            h('span', { style: { fontSize: 12.5 } }, '把话发到 QQ 私聊'),
          ),
          h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap', paddingBottom: 6 } }, qqModeRadio('reply', '发她这一轮真说的话（推荐）'), qqModeRadio('line', '直接把念头发过去')),
          h(Row, { label: 'OneBot ws 地址', hint: 'OneBot v11 的正向 ws 地址（不是 HTTP 接口）。NapCat / Lagrange / LLOneBot 都是正向 ws，端口照它们各自的配置填。' }, h('input', { style: S.input, value: cfg.qqWsUrl || '', onChange: (e) => set('qqWsUrl', e.target.value) })),
          h(Row, { label: 'access_token', hint: 'OneBot 的鉴权令牌，留空 = 不带。不是 QQ 密码。' }, h('input', { style: S.input, value: cfg.qqToken || '', onChange: (e) => set('qqToken', e.target.value) })),
          h(Row, { label: '发给哪个 QQ', hint: '', last: true }, h('input', { style: S.input, value: cfg.qqTarget || '', onChange: (e) => set('qqTarget', e.target.value) })),
          h(
            'div',
            { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' } },
            h('button', { style: S.btn2, disabled: busy, onClick: probeQq }, '测一下连通'),
            who
              ? h(
                  'span',
                  { style: S.ok },
                  '✅ 连上了：' + (who.nickname || '(没名字)') + '（' + (who.user_id || '?') + '）｜鉴权走' + (who.mode === 'header' ? 'Authorization 头' : ' ?access_token='),
                )
              : null,
          ),
        ),

        // —— 动作 ——
        h(
          'div',
          { style: S.actions },
          h('button', { style: S.btn, disabled: busy, onClick: save }, busy ? '处理中…' : '保存'),
          h('button', { style: S.btn2, disabled: busy, onClick: fire }, '立刻试一次'),
          h('button', { style: S.btn2, disabled: busy, onClick: qqTest }, '发QQ消息测通路联通'),
          h('button', { style: S.btn2, disabled: busy, onClick: lineTest }, '测一下她自己写念头'),
          h('button', { style: S.btn2, disabled: busy, onClick: load }, '刷新'),
        ),
        msg ? h('div', { style: S.ok }, msg) : null,
        err ? h('div', { style: S.err }, err) : null,

        // —— 记录 ——
        h(
          'div',
          { style: S.card },
          h('div', { style: S.groupTitle }, '最近的记录' + (st ? '（今天 ' + st.count + ' 次 / 上限 ' + cfg.dailyCap + '）' : '')),
          log.length
            ? h('div', { style: S.logBox }, log.map((r) => r.t + '  ' + r.text).join('\n'))
            : h('div', { style: S.hint }, '还没有记录'),
        ),
      )
    }

    /** 挂到「设置」左边栏。 */
    const apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register({ name: 'settings.section', id: 'drop-by', order: 54, label: () => '鱼的QQ敲门' }, Section),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
