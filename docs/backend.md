# AETHER 后端使用说明

## 范围与运行条件

后端只提供留资和文案读取。没有后台登录、文案写入 HTTP 接口、邮件发送或供应商集成。运营通过最终部署路线提供的在线数据库 Dashboard 修改文案，数据库凭据只留在服务端。

Node.js 最低版本为 24。前端继续使用原生 ES Module、系统字体和本地 three.js 0.160.0，不需要构建或打包。启动服务仅按白名单提供 `index.html`、`style.css`、`world.js`、`world-layout.js`、`world-products.js` 和 `vendor/**/*.js`，不公开服务端源代码目录、文档、数据库或环境文件；原有相对路径保持不变。

## 本地运行（SQLite）

在项目根目录运行：

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

将生成的随机值写入 `.env` 的 `IP_HASH_SALT`，保留 `DATABASE_KIND=sqlite`、`NODE_ENV=development`，然后：

```powershell
npm run db:init
npm run db:seed
npm start
```

浏览器通过 `http://127.0.0.1:3000` 访问。默认数据库为 `.local/aether.sqlite`，已加入 Git 忽略。不要双击 HTML 用 `file://` 打开。不要以此 SQLite 配置作为生产部署。

启动时 SQLite 会创建缺失的开发表，但不会修改已有的不兼容字段。若已有用户维护的 SQLite 服务，请使用独立数据库文件先对照字段，不覆盖原文件。`db:seed` 每次只补齐不存在的 `(chapter_key, locale)`，不会覆盖运营修改。

## PostgreSQL 初始化与切换

在 `.env` 中设置：

```dotenv
DATABASE_KIND=postgres
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE
DATABASE_SSL=require
NODE_ENV=production
```

连接配置使用小连接池（每进程最多 2 个连接）、`prepare: false`、5 秒连接超时、5 秒 statement timeout、3 秒 lock timeout、5 秒空闲事务超时。启用 TLS 且验证证书；私有 CA 可通过 `DATABASE_CA_FILE` 指定 PEM 文件。禁止在生产关闭 TLS。仅本地测试数据库可使用 `DATABASE_SSL=disable`。

完整生产 SQL 在 `backend/sql/postgres.sql`，包含三张表、索引、文案更新时间触发器及 RLS。仅对全新数据库或 schema 显式执行：

```powershell
npm run db:init -- --confirm
npm run db:seed
npm start
```

初始化脚本用事务执行，已有同名表时失败，不自动迁移、不自动删表。启动服务也不会执行 PostgreSQL DDL。用户后续提供的建表脚本应先对照目标结构，不一致时应另写、审核迁移脚本。

生产字段保留 `BIGINT[]`、`TEXT[]`、`TIMESTAMPTZ`、`BIGSERIAL` 和唯一索引。SQLite 仅在适配层用 JSON 文本存数组，毫秒整数表示限流更新时间；不能将 SQLite SQL 当作生产 SQL。业务校验、窗口算法、接口响应由两种适配器共用。

不默认迁移本地测试留资到生产环境。

## 接口契约

### POST /api/leads

```json
{
  "email": "user@example.com",
  "source": "aether-landing",
  "scrollDepth": 0.87,
  "chapter": "portal",
  "referrer": "https://example.com/",
  "company_website": ""
}
```

| 情况 | 状态 | JSON |
| --- | --- | --- |
| 新建 | 201 | `{"ok":true,"id":123}` |
| 同邮箱、同来源重复 | 200 | `{"ok":true,"duplicate":true}` |
| 邮箱无效 | 422 | `{"ok":false,"error":"INVALID_EMAIL"}` |
| 其他字段无效 | 422 | `{"ok":false,"error":"INVALID_PAYLOAD"}` |
| 限流 | 429 | `{"ok":false,"error":"RATE_LIMITED","retryAfter":60}` |
| 非法 JSON | 400 | `{"ok":false,"error":"INVALID_JSON"}` |
| 请求体超过 16 KiB | 413 | `{"ok":false,"error":"PAYLOAD_TOO_LARGE"}` |
| 非 JSON Content-Type | 415 | `{"ok":false,"error":"UNSUPPORTED_MEDIA_TYPE"}` |
| 方法错误 | 405 | `{"ok":false,"error":"METHOD_NOT_ALLOWED"}` |
| 数据库故障或操作超时 | 503 | `{"ok":false,"error":"SERVICE_UNAVAILABLE"}` |

所有响应均为 JSON、`Cache-Control: no-store`。429 同时返回 `Retry-After` 秒数；405 返回 `Allow`。不会把数据库内部错误或连接串传给客户端。

处理顺序固定为 **限流 → 解析与校验 → 写库**。HTTP 方法及请求体大小为传输层保护；已知超大的请求体可直接拒绝，不进入业务。

邮箱必须为字符串，去首尾空格并转小写后校验，最长 254；source 省略时为 `aether-landing`，显式传入时为非空字符串，最长 64；scrollDepth 可省略，但提供时必须是 `[0,1]` 内的有限数值，不接受数字字符串或 null；chapter 可省略，提供时为最长 32 字符的字符串；referrer 可省略，提供时为字符串。可选字段“省略”和显式传 null 不等价。

`company_website` 为蜜罐，必须省略或为空字符串，非空或其他类型返回 422。后端不访问 referrer 地址。UA 从请求头读取，IP 哈希由服务端计算；请求体中的 ua、ip_hash 不参与写库。文本中的 NUL 会被拒绝，避免 PostgreSQL/SQLite 行为不同。

邮箱与来源的唯一索引负责并发去重：`INSERT ... ON CONFLICT (email, source) DO NOTHING RETURNING id`。只有明确命中该索引才视为重复；其他错误返回 503。

### 滚动窗口限流

每个 IP 哈希在 `rate_limits` 中一行，`hits BIGINT[]` 保存 Unix 毫秒历史，不使用固定窗口或请求冷却。

独立事务内先 `INSERT ... ON CONFLICT DO NOTHING` 确保行存在，再 `SELECT ... FOR UPDATE`。若 TTL 并发删除导致行不存在，重试确保行和加锁步骤，最多三次；失败则关闭放行路径，返回 503。

拿到行锁后使用数据库 `clock_timestamp()` 取毫秒时间，避免锁等待期间产生过时的窗口时间。保留 `hit > nowMs - 60000`，恰好 60 秒前的命中过期。

若有效命中已达到五条，则不追加命中，返回：

```text
max(1, ceil((最早命中毫秒 + 60000 - 当前毫秒) / 1000))
```

否则追加本次时间并写回。被限流的请求不延长等待，但会更新行的活动时间。限流事务先独立提交，校验失败、重复及写库失败不退回额度。

因此连续输错五次邮箱会得到五次 422，第六次返回 429。数据库故障不能绕过限流。

请求处理完成后执行独立 TTL 清理事务：每次最多删除 100 条 `updated_at` 超过一天的记录，PostgreSQL 使用 `FOR UPDATE SKIP LOCKED` 跳过活跃锁。清理失败只记脱敏事件，不改变已提交结果。没有流量时允许过期行暂存，后续请求继续回收。

### GET /api/content?locale=zh-CN

```json
{
  "locale": "zh-CN",
  "chapters": [
    {
      "key": "genesis",
      "sortOrder": 0,
      "eyebrow": "Chapter 01 — Genesis",
      "title": "世界从\n一颗核心开始",
      "body": "不用点击，不用导航。",
      "tags": ["实时三维", "滚动驱动", "零跳转"]
    }
  ]
}
```

locale 缺省为 zh-CN，精确查询，不自动回退其他语言；支持 2～3 字母语言及连字符子标记、最多 32 字符。不合法返回 422 INVALID_LOCALE。无记录返回 200 与空 chapters。NULL 文本字段不输出；空字符串和空标签数组作为明确的运营值返回。

`tags` 使用 PostgreSQL `TEXT[]`，直接输出为 JSON 字符串数组。SQLite 中损坏的标签 JSON 或非字符串数组会仅忽略该字段，不让整页文案失败。

所有成功、失败及方法错误响应明确带 `Cache-Control: no-store`，最终部署的 CDN、代理不得覆盖为可缓存。

## 运营规则与前端边界

数据库键为 `(chapter_key, locale)`。现有 key 为 genesis/shards/flow/orbit/swarm/portal，新章节可以增加新 key，不需要修改数据库枚举。

**CMS 不得改变章节顺序。** 摄像机路径 ANCHORS 和文字窗口 WINDOWS 按索引固定，前端必须按 key 匹配 DOM 的 data-key，不能按接口数组或 sortOrder 重排。sort_order 仅用于 Dashboard 列表。接口按 key 输出确定顺序，不承担场景编排职责。

运营只改 eyebrow、title、body、tags；不要改现有 chapter_key。标题用实际换行符分行；API 不生成 HTML。文案更新时间由数据库触发器维护，初始化脚本仅补缺失行。

现有前端负责 textContent 渲染、标题换行转 br、缺失字段或接口失败沿用 HTML 默认文案、提交中禁用按钮、成功/失败反馈以及重试。后端不会发送方案邮件；任何前端“会发邮件”的文案由用户在后续内容维护中自行确认。

当前工作区 HTML 已有 data-key，但 world.js 仍为演示提交，没有同步后的 SQLite 服务文件。本次不改这些前端文件；完整联调需要用户同步已经改造的版本。不能把浏览器中演示态“已收到”当作真实入库成功。

## 权限、IP 与日志

三张表均开启 RLS，不建匿名 permissive policy，并撤销 PUBLIC 表及线程序列权限。权限不依赖“不发匿名 key”这一点；不得向浏览器发放数据库连接串或访问 key。

RLS 不是 HTTP 接口防线。表所有者通常绕过 RLS，超级用户与带 BYPASSRLS 的角色也会绕过；通过连接池不会改变这一点。实际接口控制来自限流、校验、参数化 SQL、固定路由和凭据管理。参见 [PostgreSQL RLS 文档](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)。

运行账户和授权随部署路线确定。最小业务权限为 leads 的 INSERT/SELECT、leads_id_seq 的 USAGE、site_content 的 SELECT、rate_limits 的 SELECT/INSERT/UPDATE/DELETE；它还必须具有相应的 RLS 访问路径。不能仅给普通角色这些 GRANT 后就假定能通过无 policy 的 RLS。后续若采用受信 BYPASSRLS 角色，须在运维侧明确授权及约束网络访问，程序不会自动创建或提升角色。

本地默认从 socket 取 IP，忽略所有传入转发头。生产代理适配通过以下配置接入：

```dotenv
CLIENT_IP_HEADER=x-real-ip
TRUSTED_PROXY_IPS=127.0.0.1,::1
```

这只是配置语法示例，不是生产默认值。必须同时设置，并由最终部署方确认可信代理的精确源 IP。只有来自允许列表的 socket 才读取该头；该头必须由代理覆盖成单一合法 IP，不能原样透传用户内容或使用逗号分隔的 XFF 链。来自其他 socket 的头被忽略；可信代理缺少或给出非法头时返回 503，不降级成共享代理 IP。平台路线未定前保持两项为空。

IPv4、IPv6（含 IPv4-mapped IPv6）规范化后计算 `SHA-256(盐值 + IP)`，仅保存 64 位十六进制哈希。原始 IP 不进入应用数据库或应用日志。修改盐值会重置 IP 哈希关联及现有限流归属，应作为运维变更处理。

日志仅输出固定路由标签、状态、耗时以及脱敏清理错误代码。不输出邮箱、请求体、UA、原始 IP、数据库错误详情或连接串。基础设施访问日志与留存策略待部署时核实。

## 测试与上线前置

```powershell
npm test
```

默认套件执行真实 SQLite、HTTP、CLI、配置和窗口边界测试，不需要外部服务。

PostgreSQL 验证必须使用专用测试库，名字以 `_test` 结尾，且账户仅用于本地测试、具备临时 schema/角色创建权限：

```powershell
$env:TEST_DATABASE_URL = 'postgres://USER:PASSWORD@127.0.0.1:5432/aether_test'
npm run test:postgres
```

测试在随机命名 schema 中创建表，用多连接验证首次 20 个并发仅 5 个放行、并发去重、事务额度保留、TTL 跳锁、标签数组、触发器、普通角色 RLS 拒绝和 BYPASSRLS 绕过，以及 HTTP 422→429 和 no-store。结束后删除本次 schema 与测试角色，不修改 public 表。拒绝不以 `_test` 结尾的库名。不要给此命令生产凭据。

部署平台、数据库托管地域及在线 Dashboard 均待用户确定，没有供应商专用 SDK 或发布配置。国内上线需验证静态页面及留资接口的真实可达性、表单成功率、超时、数据库连接预算、套餐商用条款、费用、备份及闲置暂停规则。

大陆节点上线的 ICP 备案为硬前置。确定域名与接入商后提前启动；个人主体可申请，但主体与站点用途须符合接入商规则。排期预留 1～3 周及缓冲，不承诺时限；官方公布材料齐全时在二十个工作日内处理。参见 [工信部门备案说明](https://jxca.miit.gov.cn/bsfw/bszn/cjwt/art/2020/art_869445de6a9f40e98732195df440f99d.html)。

同步前端后再验收：真实成功与重复反馈、断网/超时/限流后的重试、恶意 HTML 纯文本显示、CMS 缺失兜底，以及桌面和 375px 的开场、滚动、章节跳转及表单操作。前端异常仅记录，不在本次范围改写。
