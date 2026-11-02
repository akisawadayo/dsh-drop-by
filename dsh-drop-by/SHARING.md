# 分享给别人，他们需要什么

这份是「别人装之前得知道的事」。宿主半边是纯 Node，没有原生依赖、不联网下载东西，
所以门槛主要卡在 **DSH 版本** 和 **QQ 那一侧**。

---

## 一、最低要求

| 项 | 要求 | 不满足会怎样 |
| --- | --- | --- |
| DSH | 带 `agents` / `sessions` / `timer` / `webServer` 四个服务的版本（当前的 Desktop 0.2.x 都有） | 插件加载直接报错，四个服务少一个都起不来 |
| Node | 22 以上 | 宿主半边照跑，但 QQ 出口发不出去（`globalThis.WebSocket` 是 22 才稳的） |
| 平台 | Windows / macOS / Linux 都行 | 宿主半边纯 JS，没有 .node 原生模块 |
| 磁盘 | `~/.dsh`（或 `DSH_HOME`）可写 | 存不了设置和「今天说了几次」 |

## 二、必须有的东西

1. **一个活着的会话。** 插件是靠 `ctx.agents.get(id)` 拿到 agent 再 `followup` 的。
   DSH 里一个会话都没打开，它永远只会记一句「没有活着的目标会话」。
2. **能装第三方 bundle 的 profile。** 插件靠 `cordis.patch.yml` 里那段 `insert` 挂上去。
3. 别把 `drop-by-config.json` 写成带 BOM 的（见第六节第 1 条，这条最容易出人命）。

## 三、QQ 出口（可选，不要也能用）

不要 QQ 出口，它就只是在会话里说话，跟 DSH 自带的一样。

要 QQ 出口的话，对方需要：

- 一个 **OneBot v11 实现**，而且必须是 **正向 WebSocket**（NapCat / Lagrange / LLOneBot / Shamrock / SnowLuma 都行）
- 三项配置：ws 地址（如 `ws://127.0.0.1:3001`）、`access_token`、目标 QQ 号
- 目标 QQ 在那一侧得是能私聊的人
- **不需要 HTTP 口** —— 本机 NapCat 是正向 ws，没有 HTTP 口，插件走的是 ws
- 端口不是 3001 的话，设置页里改掉
- 对方的 QQ 号要写纯数字

**鉴权两种都支持**（这决定了换实现会不会踩坑）：

- 能从宿主的 profile 借到 `ws` 包 → 走标准 `Authorization: Bearer <token>` 头
- 借不到 → 退回 Node 内置 WebSocket，把 token 塞进 `?access_token=`（NapCat 认这个）

两种在 NapCat 上都实测通了。对方换实现后如果连不上，先跑 `node tests/qq-probe.mjs`，
它会告诉你连的是谁、用哪种鉴权。

**不支持的**：

- OneBot v11 的 **HTTP 接口**（插件只走 ws，没做 HTTP 客户端）
- **反向 WebSocket**（那是实现来连你；这里插件是客户端，要连它）
- QQ 官方机器人 API（那是另一套协议，不是 OneBot）

## 四、换掉人格插件 / 换掉 QQ 后端，还能不能跑

### 人格插件是什么都行

插件不认任何具体的人格插件 —— 代码里对 `world`、`dsh-world` 一个字都没有（只有注释里举例）。
它只做一件事：往一个会话里 `followup` 一条 user 消息，然后 DSH 自己开一轮。

**所以「她是谁」由那个会话自己的配置决定**：`AGENTS.md`、agent preset、world 的 `persona.md`、
乃至你自己拼的系统提示，哪套生效就用哪套。没有 world 也照样说话，只是——

- 没有「家会话」这个概念了，目标会话要在设置里自己勾
- `sessionTitle` 服务可能不在，列表里有些会话会显示「（还没起名）」（它还有一条读盘兜底）

### QQ 后端只要是 OneBot v11 正向 ws 就行

插件是 **ws 客户端**，去连你的 OneBot。所以必须是「正向 WebSocket」，反向 ws 那一套不行。

具体认这几样，别的都不碰：

| 用到的 | 要求 |
| --- | --- |
| 连接方向 | 正向 ws（插件主动连），反向 ws 不支持 |
| 鉴权 | `?access_token=<token>` 拼在 ws 地址上；不设 token 也行 |
| 发消息 | `send_private_msg`，参数 `user_id` + 字符串 `message` |
| 回包 | `status: "ok"` 或 `retcode: 0`；失败时读 `message` / `wording` |
| 自检 | 只额外用了一次 `get_login_info`（自检和「发一条测试」之前） |

按这个口径能用的：**NapCat、Lagrange.OneBot、LLOneBot、OpenShamrock**，老的 go-cqhttp 也行。
不行的：mirai-api-http（不是 OneBot 标准）、只认 `Authorization` header 不认 query 的实现
（本地回环就别设 token）。

端口不是 3001 就在设置里改地址，比如 `ws://127.0.0.1:6700`。

### 完全不要 QQ 呢

也行。关掉 QQ 出口，它就只在会话里说话 —— 跟 DSH 自带的一模一样，只是会自己开口。

## 五、它认死哪些宿主内部 API（版本敏感）

DSH 还是 rc 阶段，这些随时可能改。装了不动、或者升级后不出话，先看这几条：

| 用到的 | 在哪用 | 变了之后的症状 |
| --- | --- | --- |
| `ctx.agents.get(id)` / `agents.list()` / `agent.followup(msg)` | 找会话、送念头 | 永远「没有活着的目标会话」 |
| `ctx.sessions.flush(session)` | 落盘确认 | 只是少一次确认，不影响 |
| `ctx.interval(fn, ms)` | 定时 | 只记一句「拿不到 timer 服务」 |
| `ctx.on('session/event', …)` + `user/message` / `turn/start` / `assistant/message` / `turn/end` | 冷却、抓回复 | 冷却失效；QQ 只发得出念头，抓不到回复 |
| `ctx.webServer.register({ kind:'exact', path, handler })` | 设置页 | 独立页 404，DSH 设置里那页还在 |
| 前端槽位 `settings.section` | 设置页 | DSH 设置里不出现「鱼的QQ敲门」，别的都正常 |

升级后先跑一遍 `tests/` 里的测试和 `node tests/qq-probe.mjs`，能看出是不是还接得上。

## 六、怎么装

**Windows（有 PowerShell）**

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

**任何平台（推荐，Node 写的不吃 PowerShell 的坑）**

```bash
node install.mjs
```

**手动三步**

1. profile 的 `package.json`：`dependencies` 加 `"dsh-drop-by": "link:<插件路径>"`，`dsh.profile.bundles` 加 `"dsh-drop-by"`
2. `profile/node_modules/dsh-drop-by` 指到插件目录（Windows 用 junction，Linux/macOS 用 symlink）
3. profile 的 `cordis.patch.yml` 末尾加：

```yaml
- insert:
    - id: dsh-drop-by
      name: dsh-drop-by
```

装完 **重启 DSH** 才加载。重启后两个入口：设置左边栏「鱼的QQ敲门」，或者 `http://127.0.0.1:<端口>/dsh-drop-by`。

**从 npm 装**（先发到 npm，而且你那套 DSH 得带命令行 `dsh`；**桌面版没有这个入口**，用上面的 `node install.mjs` 或手动三步）

```bash
dsh plugin --profile desktop add dsh-drop-by
```

## 七、别人一定会踩的坑（都是真踩过的）

1. **BOM。** Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会给 `package.json` 加 UTF-8 BOM，
   DSH 启动时 `JSON.parse` 读到 BOM 直接抛 `Unexpected token '锘`，host 在 startup 阶段崩，反复起不来。
   装的时候一定要写成**无 BOM** 的 UTF-8（`install.mjs` 就是干这个的）。
2. **`.ps1` 文件本身要带 BOM。** 不带的话 5.1 按 GBK 读中文注释，语法都过不去。
3. **`followup` 必须 await。** 它 reject 一次就是未处理的 rejection，Node 22+ 当致命错误，宿主进程直接退出。
4. **`source.kind` 不能写 `user`。** 写了网页端会把这条当成对方自己打字排队的那条。
5. **角色只能是 user。** 写 `developer`，`dsh-session` 的校验会让那一轮 turn 直接 error。
6. **不要 `import 'ws'`。** 插件装在 `profile/node_modules` 或 `~/.dsh/plugins` 下，
   解析不到那个包，import 失败会让整个插件加载不了。QQ 出口用的是 Node 内置 WebSocket。
7. **不要声明 `export const Config`（schemastery）。** 同样解析不到，整包加载失败。配置走自己的 json。
8. **会话 id 带不带 `session-` 前缀，两个口径都有。** 比较前要先归一，不然永远对不上。
9. **安静时段按本机时区算。** 跨时区的人会觉得「怎么半夜发」——让他们自己改起止点。
10. **每次触发都是一整轮完整 turn，是真花钱的。** 默认值别设得太勤；新装默认 `dryRun: true` 就是这个原因。

## 八、发布建议

- `package.json` 的 `files` 要带上 `lib/`、`cordis.patch.yml`、`README.md` 和两个安装脚本
- 版本号老实升，方便判断「跑的是不是这一版」
- 发出去前自己跑一遍：`node tests/smoke.mjs`、`node tests/client-smoke.mjs`
- README 里写清「默认演练模式」，别让人以为装了就会自动发消息
- 想说清楚依赖边界，就贴第四节的表
