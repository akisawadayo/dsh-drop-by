/**
 * dsh-drop-by 的独立设置页（宿主半边自己挂的那一页）。
 *
 * ⚠ 纯 HTML + 内联脚本，不做 client 半边：
 *   这页只是改一个 json、按一下「立刻试一次」，放进用户界面包里反而要跟着 web 一起构建。
 *   DSH 设置里的那一页是另一份（lib/client.js），两边读写的是同一套 /dsh-drop-by/api 路由。
 */

/** 把值塞进 HTML 时挡一下引号和尖括号。 */
const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function renderPage({ route }) {
  const api = esc(route)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>鱼的QQ敲门 · dsh-drop-by</title>
<style>
  :root{
    --bg:#0e1116; --card:#161b23; --card2:#1c232d; --line:#2a3340;
    --fg:#e6edf3; --dim:#8b98a8; --acc:#4f9cf9; --ok:#3fb950; --warn:#d29922; --bad:#f85149;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:24px 18px 64px}
  h1{font-size:18px;margin:0 0 4px;font-weight:600}
  .sub{color:var(--dim);font-size:12.5px;margin-bottom:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px}
  .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
  .field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
  .field label{color:var(--dim);font-size:12.5px}
  input[type=number],input[type=text],textarea{
    background:var(--card2);border:1px solid var(--line);color:var(--fg);
    border-radius:8px;padding:7px 9px;font:inherit;outline:none;width:100%
  }
  input[type=number]{width:110px}
  textarea{min-height:104px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:13px}
  input:focus,textarea:focus{border-color:var(--acc)}
  .switch{display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer}
  .switch input{width:16px;height:16px;accent-color:var(--acc)}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line);color:var(--dim)}
  .pill.ok{color:var(--ok);border-color:#1f4526}
  .pill.warn{color:var(--warn);border-color:#4a3a11}
  .sessions{max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--card2)}
  .sess{display:flex;gap:9px;align-items:center;padding:7px 10px;border-bottom:1px solid #202834;cursor:pointer}
  .sess:last-child{border-bottom:0}
  .sess:hover{background:#212a36}
  .sess input{accent-color:var(--acc)}
  .dot{width:7px;height:7px;border-radius:50%;background:#3a4656;flex:none}
  .dot.on{background:var(--ok)}
  .sess .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sess .id{color:var(--dim);font-size:11.5px;font-family:ui-monospace,Consolas,monospace}
  button{background:var(--acc);color:#06101d;border:0;border-radius:9px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer}
  button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line);font-weight:500}
  button:hover{filter:brightness(1.08)}
  .log{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;max-height:320px;overflow:auto;background:var(--card2);border:1px solid var(--line);border-radius:8px;padding:10px}
  .log div{padding:2px 0;border-bottom:1px solid #1b222c;word-break:break-all}
  .log div:last-child{border-bottom:0}
  .log .t{color:var(--dim);margin-right:8px}
  .hint{color:var(--dim);font-size:12px;margin-top:6px}
  .toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#22303f;border:1px solid var(--line);
         padding:9px 16px;border-radius:999px;opacity:0;transition:.2s;pointer-events:none;font-size:13px}
  .toast.show{opacity:1}
  code{background:#222b36;padding:1px 5px;border-radius:5px;font-size:12.5px}
</style>
</head>
<body>
<div class="wrap">
  <h1>鱼的QQ敲门</h1>
  <div class="sub">到点了她自己开口。插件只负责叫她，说什么由 DSH 那一轮自己决定。</div>

  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <div>
        <span id="p-on" class="pill">总开关</span>
        <span id="p-dry" class="pill">演练</span>
        <span id="p-today" class="pill">今天 0 次</span>
      </div>
      <div>
        <button class="ghost" id="btn-refresh">刷新</button>
        <button class="ghost" id="btn-fire">立刻试一次</button>
        <button id="btn-save">保存</button>
      </div>
    </div>

    <label class="switch"><input type="checkbox" id="on"><span>总开关（关掉就完全不动）</span></label>
    <label class="switch"><input type="checkbox" id="dryRun"><span>演练模式（只记账、不真发 —— 先看几轮再关）</span></label>
    <label class="switch"><input type="checkbox" id="frame"><span>给念头包一层「这是你自己冒出来的」（建议开）</span></label>
  </div>

  <div class="card">
    <div class="field">
      <label>间隔模式</label>
      <div class="row">
        <label class="switch" style="margin:0"><input type="radio" name="mode" value="random"><span>随机（更像人）</span></label>
        <label class="switch" style="margin:0"><input type="radio" name="mode" value="fixed"><span>固定间隔</span></label>
      </div>
    </div>
    <div class="row">
      <div class="field"><label>固定：每多少分钟</label><input type="number" id="everyMinutes" min="1" max="10080"></div>
      <div class="field"><label>随机：下限（分钟）</label><input type="number" id="minMinutes" min="1" max="10080"></div>
      <div class="field"><label>随机：上限（分钟）</label><input type="number" id="maxMinutes" min="1" max="10080"></div>
    </div>
    <div class="hint">随机模式下每一轮都重新掷一次间隔，不会整点报到。</div>
  </div>

  <div class="card">
    <div class="field">
      <label>目标会话（勾谁，她就往谁说；不勾 = 自动挑一个活着的）</label>
      <div class="sessions" id="sessions"></div>
      <div class="hint">绿点 = 现在活着（能立刻开口）；灰点 = 只在盘上，得先打开那个会话。</div>
    </div>
  </div>

  <div class="card">
    <div class="field">
      <label>念头池（一行一条，每次随机挑一条；她读到之后会用自己的话讲）</label>
      <textarea id="lines" spellcheck="false"></textarea>
      <div class="hint">写得口语、短、留点空。别写成台词，写成她心里冒出来的一句话。</div>
    </div>
  </div>

  <div class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <div><span id="p-qq" class="pill">QQ 出口</span></div>
      <button class="ghost" id="btn-qq-test">发一条到我 QQ</button>
    </div>
    <label class="switch"><input type="checkbox" id="qqOn"><span>把话发到 QQ 私聊</span></label>
    <div class="row">
      <label class="switch" style="margin:0"><input type="radio" name="qqMode" value="reply"><span>发她这一轮真说的话（推荐）</span></label>
      <label class="switch" style="margin:0"><input type="radio" name="qqMode" value="line"><span>直接把念头发过去</span></label>
    </div>
    <div class="row" style="margin-top:10px">
      <div class="field" style="flex:1;min-width:220px"><label>OneBot ws 地址</label><input type="text" id="qqWsUrl" placeholder="ws://127.0.0.1:3001"></div>
      <div class="field"><label>access_token</label><input type="text" id="qqToken" placeholder="留空 = 不带"></div>
      <div class="field"><label>发给哪个 QQ</label><input type="text" id="qqTarget" placeholder="例如 123456789"></div>
    </div>
    <div class="hint">OneBot v11 的正向 ws 地址（不是 HTTP 接口）。NapCat / Lagrange / LLOneBot 都是正向 ws，端口照它们各自的配置填。</div>
  </div>

  <div class="card">
    <div class="row">
      <div class="field"><label>安静时段 起（点）</label><input type="number" id="quietFrom" min="0" max="23"></div>
      <div class="field"><label>安静时段 止（点）</label><input type="number" id="quietTo" min="0" max="23"></div>
      <div class="field"><label>每天最多几次</label><input type="number" id="dailyCap" min="0" max="96"></div>
      <div class="field"><label>冷却（分钟）</label><input type="number" id="cooldownMinutes" min="0" max="1440"></div>
      <div class="field"><label>启动先缓（分钟）</label><input type="number" id="warmupMinutes" min="0" max="1440"></div>
    </div>
    <div class="hint">起 = 止 表示不启用安静时段；每天最多几次填 0 = 今天一次都不发。</div>
  </div>

  <div class="card">
    <label style="color:var(--dim);font-size:12.5px">最近的记录</label>
    <div class="log" id="log" style="margin-top:8px"></div>
  </div>

  <div class="hint">配置文件：<code>~/.dsh/drop-by-config.json</code>　这页地址：<code>${api}</code></div>
</div>
<div class="toast" id="toast"></div>

<script>
const API = ${JSON.stringify(route)};
const $ = (id) => document.getElementById(id);
let cfg = null;
let sessions = [];

function toast(text){
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t.__h);
  t.__h = setTimeout(() => t.classList.remove('show'), 1800);
}

function explain(status){
  if (status === 404 || status === 405) return 'HTTP ' + status + ' —— 这一版宿主没有这个接口，重启一次 DSH 就好';
  return 'HTTP ' + status;
}

async function callGet(path){
  try {
    const r = await fetch(API + path, { cache: 'no-store' });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: explain(r.status) };
    try { return JSON.parse(text); } catch { return { ok: false, error: '宿主回的不是 JSON' }; }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

async function callPost(path, body){
  try {
    const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: explain(r.status) };
    try { return JSON.parse(text); } catch { return { ok: false, error: '宿主回的不是 JSON' }; }
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function fill(c, st, list){
  cfg = c; sessions = list;
  $('on').checked = !!c.on;
  $('dryRun').checked = !!c.dryRun;
  $('frame').checked = !!c.frame;
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = (r.value === c.mode);
  $('everyMinutes').value = c.everyMinutes;
  $('minMinutes').value = c.minMinutes;
  $('maxMinutes').value = c.maxMinutes;
  $('lines').value = (c.lines || []).join('\\n');
  $('quietFrom').value = c.quietFrom;
  $('quietTo').value = c.quietTo;
  $('dailyCap').value = c.dailyCap;
  $('cooldownMinutes').value = c.cooldownMinutes;
  $('warmupMinutes').value = (c.warmupMinutes === undefined ? 5 : c.warmupMinutes);

  $('qqOn').checked = !!c.qqOn;
  $('qqWsUrl').value = c.qqWsUrl || '';
  $('qqToken').value = c.qqToken || '';
  $('qqTarget').value = c.qqTarget || '';
  for (const r of document.querySelectorAll('input[name=qqMode]')) r.checked = (r.value === (c.qqMode || 'reply'));
  $('p-qq').textContent = c.qqOn ? ('QQ 出口 开 → ' + (c.qqTarget || '(没填号)')) : 'QQ 出口 关';
  $('p-qq').className = 'pill ' + (c.qqOn ? 'ok' : '');

  const box = $('sessions');
  box.innerHTML = '';
  const picked = new Set((c.targets || []).map((x) => String(x).replace(/^session-/, '')));
  if (!list.length) box.innerHTML = '<div class="sess"><span class="name" style="color:var(--dim)">现在一个会话都没扫到</span></div>';
  for (const s of list){
    const row = document.createElement('label');
    row.className = 'sess';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = s.id;
    cb.checked = picked.has(String(s.id).replace(/^session-/, ''));
    const dot = document.createElement('span');
    dot.className = 'dot' + (s.alive ? ' on' : '');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = s.title || '（还没起名）';
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = String(s.id).slice(-8);
    row.append(cb, dot, name, id);
    box.append(row);
  }

  $('p-on').textContent = c.on ? '总开关 开' : '总开关 关';
  $('p-on').className = 'pill ' + (c.on ? 'ok' : '');
  $('p-dry').textContent = c.dryRun ? '演练中（不发）' : '到点真发';
  $('p-dry').className = 'pill ' + (c.dryRun ? 'warn' : 'ok');
  $('p-today').textContent = '今天 ' + st.count + ' 次 / 上限 ' + c.dailyCap;

  const log = $('log');
  log.innerHTML = '';
  const rows = (window.__log || []);
  if (!rows.length) log.innerHTML = '<div><span class="t">—</span>还没有记录</div>';
  for (const r of rows){
    const d = document.createElement('div');
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = r.t;
    d.append(t, document.createTextNode(r.text));
    log.append(d);
  }
}

async function load(){
  const j = await callGet('/api/state');
  if (!j.ok) return toast('读不到设置：' + (j.error || '未知错误'));
  window.__log = j.log || [];
  fill(j.cfg, j.state, j.sessions || []);
}

function collect(){
  const mode = [...document.querySelectorAll('input[name=mode]')].find((x) => x.checked);
  const targets = [...document.querySelectorAll('#sessions input[type=checkbox]')].filter((x) => x.checked).map((x) => x.value);
  return {
    on: $('on').checked,
    dryRun: $('dryRun').checked,
    frame: $('frame').checked,
    mode: mode ? mode.value : 'random',
    everyMinutes: Number($('everyMinutes').value),
    minMinutes: Number($('minMinutes').value),
    maxMinutes: Number($('maxMinutes').value),
    targets,
    lines: $('lines').value.split('\\n'),
    quietFrom: Number($('quietFrom').value),
    quietTo: Number($('quietTo').value),
    dailyCap: Number($('dailyCap').value),
    cooldownMinutes: Number($('cooldownMinutes').value),
    warmupMinutes: Number($('warmupMinutes').value),
    qqOn: $('qqOn').checked,
    qqMode: (document.querySelector('input[name=qqMode]:checked') || {}).value || 'reply',
    qqWsUrl: $('qqWsUrl').value,
    qqToken: $('qqToken').value,
    qqTarget: $('qqTarget').value,
  };
}

$('btn-save').onclick = async () => {
  const j = await callPost('/api/save', collect());
  if (!j.ok) return toast('保存失败：' + (j.error || '未知错误'));
  toast('保存好了，间隔已重挂');
  await load();
};

$('btn-fire').onclick = async () => {
  toast('这就去叫她开口…');
  const j = await callPost('/api/fire', {});
  if (!j.ok) return toast('没发出去：' + (j.error || '未知错误'));
  await load();
  toast('这一轮记下来了，看下面的记录');
};

$('btn-qq-test').onclick = async () => {
  toast('先存一下再发…');
  const saved = await callPost('/api/save', collect());
  if (!saved.ok) return toast('保存失败：' + (saved.error || '未知错误'));
  const j = await callPost('/api/qq-test', {});
  if (!j.ok) return toast('没发出去：' + (j.error || '未知错误'));
  toast('发出去了，看看 QQ');
  await load();
};

$('btn-refresh').onclick = () => load().then(() => toast('刷过了'));

load().catch((e) => toast('读不到设置：' + (e && e.message ? e.message : e)));
</script>
</body>
</html>`
}
