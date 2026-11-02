# dsh-drop-by

到点了，她自己来找你说话。

不是定时往聊天框里贴一句固定台词，是**按你设的间隔往会话里送一条「她自己的念头」，让 DSH 自己开一轮** ——
人格、历史、工具、记忆全是她自己的，说什么由那一轮决定。插件只负责叫她开口。

---

## 前置

| 需要 | 说明 |
| --- | --- |
| DSH | 带 `agents` / `sessions` / `timer` / `webServer` 四个服务（当前 Desktop 0.2.x 都有） |
| Node 22+ | QQ 出口用内置 WebSocket；宿主半身在更老的版本上也能跑，只是 QQ 发不出去 |
| 一个开着的会话 | 会话全关掉，它没有地方说话 |
| OneBot v11 正向 ws | 可选。只有接 QQ 时才需要（NapCat / Lagrange / LLOneBot / SnowLuma 都行） |

### 已验证 / 未验证

- **验证过**：DSH Desktop `0.2.1-rc.3`、Node `24.21.0`、Windows 10、NapCat（正向 ws）
- **没验证**：macOS、Linux、其它 DSH 版本、其它 OneBot 实现
- 插件零依赖，不联网下载任何东西；跑不通多半是 DSH 版本差了一个服务或事件名，看 DSH 自己的 host 日志

细节见 [SHARING.md](SHARING.md)。

## 文件

```
lib/host.js        宿主半边：定时器、闸门、followup、QQ 出口、api 路由
lib/client.js      DSH 设置里的「鱼的QQ敲门」
lib/page.js        独立设置页 /dsh-drop-by
cordis.patch.yml   挂载声明
package.json       插件清单（含 dsh.client 声明）
install.mjs        跨平台安装器（推荐）
install.ps1        Windows 老办法
uninstall.ps1      卸载
tests/             smoke / client-smoke / full / edge / qq-probe
```

## 它怎么跑的

```
定时器（固定间隔 / 上下限随机）
   └─ 过闸门：总开关 → 刚起来缓 5 分钟 → 安静时段 → 每日上限 → 冷却（你刚说过话就不插嘴）
        └─ 挑目标会话（勾了就在勾的中挑，没勾就自动挑一个活着的）
             └─ agent.followup(一条 source.kind = "drop-by" 的 user 消息)
                  └─ DSH 开一轮 → 她用自己的话开口 → 落进这个会话
```

任一闸门不开：只记账，不发，不花 token。

## 装

```bash
node install.mjs          # 任何平台都行，推荐（Node 写的，不吃 PowerShell 的 BOM 坑）
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1   # Windows 老办法
```

脚本做的四件事：备份 profile 的 `package.json` / `cordis.patch.yml` → 加 link 依赖和 bundles 项 →
在 `profile/node_modules` 建 junction → 往 `cordis.patch.yml` 插一段 `insert`。

**它不重启、不关机、不碰正在跑的 DSH 进程。** 装完你自己挑时候重启 DSH 才会加载。

重启后有两个入口，都能用：

- **DSH 设置左边栏 →「鱼的QQ敲门」**（v0.4 起，网页半边 `lib/client.js`，不用记端口）
- `http://127.0.0.1:<DSH 端口>/dsh-drop-by`（宿主半边自己挂的独立页，端口每次重启会变）

## 卸

```powershell
powershell -ExecutionPolicy Bypass -File "<插件目录>/uninstall.ps1"
```

删 junction、摘掉依赖和 bundles 项、删 patch 段。`~/.dsh/drop-by-config.json` 留着，重装回来设置还在。
同样不重启 —— 重启 DSH 之后才真正下线。

## 她自己能写念头

插件注册了一个工具 `drop_by_add_line`。她在会话里想「下次找他聊什么」，可以直接把那句写进念头池：

```
drop_by_add_line({ text: "想问问他今天累不累" })
```

去重；池子最多留 30 句，超了把最老的挤掉。设置页里照样能手写、手改。

写不写由她自己判断，插件不强迫。想让她更常写，可以切到 P2：

| 模式 | 意思 |
| --- | --- |
| ree（P1，默认） | 她自己决定写不写，插件一句都不提 |
| 
udge（P2） | 每次开口时补一句「想到下次聊什么就记进来」 |

两个互斥，只能选一个。

以前池子只能你手动填，现在她自己能记。

## 设置

配置文件 `~/.dsh/drop-by-config.json`，也可以在设置页里改（改完自动重挂间隔，不用重启）。

| 键 | 意思 |
| --- | --- |
| `on` | 总开关 |
| `dryRun` | 演练：中了也只记账不发。**默认开着**，先看几轮再关 |
| `mode` | `random`（上下限之间随机）或 `fixed`（死板固定间隔） |
| `everyMinutes` | 固定模式每多少分钟 |
| `minMinutes` / `maxMinutes` | 随机模式的下限 / 上限 |
| `targets` | 目标会话 id 数组。空 = 自动挑一个活着的 |
| `lines` | 念头池，一行一条，每次随机挑 |
| `quietFrom` / `quietTo` | 安静时段（本地小时，含起不含止；两者相等 = 不启用） |
| `dailyCap` | 每天最多开口几次。**0 = 今天一次都不发** |
| `cooldownMinutes` | 你这么多分钟内说过话就不打扰你 |
| `warmupMinutes` | 启动后先缓几分钟才允许开口（防「一重启就蹦一句」）。0 = 不缓 |
| `frame` | 给念头包一层「这是你自己冒出来的」，强烈建议开 |

## 为什么这么写（踩过的坑）

- **必须 `agent.followup()`**：只有那样才是 DSH 自己的回合。插件里自己拼文字塞进会话 = 假开口，模型看不见。
- **`followup` 必须 await**：它 reject 一次就是未处理的 rejection，Node 22+ 直接当致命错误，整个宿主进程退出。
- **`source.kind` 不能写 `user`**：写了网页端会把这条当成你自己排队发的消息。
- **角色只能是 `user`**：`dsh-session` 里 `user/message` 事件跟 `developer` 角色是绑死校验的，填 developer 那一轮直接 error；
  「念头 vs 对方说的话」只能在文字里用一层框区分。
- **不写 `export const Config`**：插件装在 profile 的 `node_modules` 下，那里没有 `@deepseek-ai/schemastery`，
  import 失败会让整个插件加载不了。配置走自己的 json。
- **定时器用 `ctx.interval`**：插件卸载时 Cordis 自己收表，不用裸 `setInterval`。
- **会话 id 两种前缀都试**：`agents.get()` 有的带 `session-` 有的不带，猜错一次要排查半天。

## QQ 出口（v0.2）

到点 → 送念头进会话 → 等这一轮 `turn/end` → 把她这一轮最后说的话用 OneBot `send_private_msg`
发到你的 QQ 私聊。

| 键 | 意思 |
| --- | --- |
| `qqOn` | 开不开 QQ 出口（默认关） |
| `qqWsUrl` | OneBot ws 地址，本机 NapCat 是 `ws://127.0.0.1:3001` |
| `qqToken` | OneBot 的 access_token（接在 `?access_token=` 上） |
| `qqTarget` | 发给哪个 QQ 号 |
| `qqMode` | `reply` = 发她真说的话（推荐）；`line` = 直接把念头那句发过去 |

设置页上有个「发QQ消息测通路联通」的按钮，只测通路、不碰会话、不花 token。

实现上**没有依赖别的插件**：用 Node 自带的内置 WebSocket 直连 OneBot，每个请求带自己的 echo 认回包，
空闲两分钟自动断开。不 import `ws` —— 插件目录的模块解析链里没有那个包。

## 现在的边界

- QQ 出口只发**私聊**，不发群。
- 只在 `reply` 模式抓 `assistant/message`；如果这一轮全是工具调用、一句话没说，就不发。
- 抓回合靠 `turn/start` 对齐：没等到起点的回合宁可丢掉，也不把别人的话发过去。
- 只往会话里送念头，不替你说话、不自动回消息。

## 自测与救援

```powershell
node tests/smoke.mjs        # 宿主半边：路由、定时器、手动试一次
node tests/client-smoke.mjs # 网页半边：模块加载、Section 注册
node tests/full.mjs         # 全路径：14 组，含抓回复拆条发 QQ、冷却、上限、串会话、断线重连、手动不占额度
node tests/edge.mjs         # 边界：11 组，坏配置 / 坏状态 / followup 抛错 / 并发 / 坏地址
node tests/qq-probe.mjs     # 只问 OneBot「我是谁」，不发消息（需要 OneBot 正在跑）
```

> 作者本地还有一份排障脚本（查 BOM、查 profile、查接口清单），不随包发布。
> 它能自动修两样：BOM 一律剥掉；`package.json` 坏了从 `.bak-dropby-*` 恢复。它不重启、不关机。
