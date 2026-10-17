方案整体认可，但有条件。请按下面处理，然后输出**修订后的完整方案文档**（不要只给片段或 diff）。

---

## 一、平台选型章节整段挂起

Vercel + Supabase 官方这套先不要推进，也不要写进最终交付。

原因是受众在国内，而这两个官方服务在国内不可达：
- Vercel 官方 Knowledge Base 明确写着没有大陆节点、不保证大陆的可用性与性能；`*.vercel.app` 默认域名在国内被 DNS 污染，直接超时。
- Supabase 官方跑在 AWS 新加坡，国内 200–500ms 且经常超时。前端和数据库这两段都能忍，**数据库这段最致命**——页面能开，表单提交转圈然后失败，留资功能整个废掉。

这块标记为「待定」，等我确定部署路线后单独给你。

另外请补一条进方案，原方案完全没提：

> **面向国内必须做 ICP 备案。** 域名指向国内节点必须备案，个人可办，周期通常 1–3 周，属于排期的硬前置，需要提前启动。

---

## 二、确认前请先改这 2 处

这两处都是建表 SQL 一旦定稿、事后修改需要迁移数据的，所以要先改。

### 1. `rate_limits` 表：不要只存「最近请求时间」

只存一列时间戳，物理上做不出「滚动 60 秒最多 5 次」——那只能实现「距上次请求至少 N 秒」的冷却，或固定窗口。

而你同时又要求响应里带**实际剩余秒数**。滚动窗口下，剩余秒数取决于窗口内**最早那次命中**过期还剩多久，所以**必须保留历史命中时间**。

**你提出的两个要求是互相冲突的**，字段本身不够用。改成：

```sql
CREATE TABLE rate_limits (
  ip_hash    TEXT PRIMARY KEY,
  hits       BIGINT[] NOT NULL DEFAULT '{}',   -- 滚动窗口内的命中时间戳(ms)，保留最近 6 条即可
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

事务内顺序：读行 → 剔除 60 秒之前的命中 → 若剩余 ≥ 5 则拒绝并计算
`Retry-After = (最早那次命中 + 60000 - now) / 1000` → 否则 append 后写回。

如果你更倾向固定窗口（`window_start` + `hits_count`），也可以，但要**明确写出来并接受这两个代价**：① 窗口边界处可能瞬时放行 10 次（上一窗口末尾 5 次 + 下一窗口开头 5 次）；② `Retry-After` 只能给到当前窗口结束。

**请明确选一种，不要两种机制的要求混着写。**

### 2. `site_content` 表：不要用章节号当主键

章节号是**位置索引**。以后在第 3、4 章之间插入新章，后面所有索引后移一格，**CMS 里的文案会整体错位一章**。

而你第 9 节第 2 步的动作就是「增加第 7 个章节」——按索引存的话，执行到那一步必然踩。

改成稳定 slug：

```sql
CREATE TABLE site_content (
  chapter_key TEXT NOT NULL,        -- 'genesis' / 'shards' / 'flow' / 'orbit' / 'swarm' / 'portal'
  locale      TEXT NOT NULL DEFAULT 'zh-CN',
  sort_order  INT  NOT NULL,        -- 仅供后台列表展示，不参与定位
  eyebrow     TEXT,
  title       TEXT,                 -- 用 \n 表示分行
  body        TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chapter_key, locale)
);
```

**并请补一条硬约束写进方案**（原方案漏了，这条会直接导致线上错乱）：

> 章节顺序由 `world.js` 里的摄像机路径（`ANCHORS`）和文字窗口（`WINDOWS`）**按索引写死**，因此 **CMS 不得调整章节顺序**。`sort_order` 只用于后台列表展示；前端一律**按 `chapter_key` 匹配，绝不重排序**。否则会出现镜头已经飞到碎晶那一段、屏幕上却显示另一章文案的情况。

---

## 三、其余在下述位置实现时一并处理，不阻塞确认

- **限流事务里的行锁对首次请求无效**：`SELECT ... FOR UPDATE` 在行不存在时**不加锁**（没有行可锁），同一 IP 的前几个并发请求会都读到「无行」而全部放行——**恰好是最该拦住的首次突发**。请先 `INSERT ... ON CONFLICT (ip_hash) DO NOTHING` 确保行存在，再 `FOR UPDATE`；或改用 `pg_advisory_xact_lock(hashtext(ip_hash))`。
- **RLS 的定位请写清楚**：后端用 `postgres` 账号经 pooler 连接，该角色带 `BYPASSRLS` 属性，**RLS 对它完全无效**。真正的机制是「不建任何 permissive policy」＋「绝不把 anon key 发到前端」。RLS 属于**兜底**，不是接口防线。文档里不要写成「RLS 保护了接口」，否则以后有人会误以为改 policy 就等于改了权限。
- **`tags` 改用 `TEXT[]`**。若坚持用 TEXT 存 JSON 字符串，接口侧**必须 try/catch 解析**并降级，不能因为运营手改坏一个字段就让整页文案挂掉。
- **`GET /api/content` 显式返回 `Cache-Control: no-store`**，否则浏览器或 CDN 可能缓存，和「运营改完刷新页面即可生效」这条验收标准冲突。
- **限流表加 TTL 清理**：读写时顺手删过期行，或用 pg_cron 每天清 `updated_at < now() - interval '1 day'`。
- **部署准备补两个文件**：`package.json`（声明 `postgres`、`@vercel/node` 依赖）＋ `vercel.json`（`buildCommand` 置空、`outputDirectory` 指向静态目录）。注意 `index.html` 用 importmap 指向 `./vendor/...`，**静态输出必须保持原目录结构，不能把文件拍平**。
- **成本项补进方案**：Vercel Hobby 计划明确禁止商用（商用需 Pro，$20/月）；Supabase 免费版项目连续 7 天无活动会被自动暂停，留资站流量低时很容易踩到。

---

## 四、保持不变

以下全部照原方案，不要改动：

- 接口契约：`POST /api/leads` 返回 `201` / `200` / `422` / `429`；`GET /api/content?locale=zh-CN` 的结构
- 字段校验规则（含 `scrollDepth` 限定 0～1）、邮箱去空格＋转小写后校验与去重
- 处理顺序：**限流 → 校验 → 写库**
- 运营流程（首版用在线 Dashboard 当后台，不另做管理页）
- 验证与交付清单（含断网重试、恶意 HTML 纯文本显示、375px 回归）

提醒一处测试预期：因为限流先于校验执行，**连续输错 5 次邮箱后，第 6 次返回的是 429 而不是 422**，测试用例请按这个顺序断言。

---

## 五、前端部分不用你重做

前端已按上述契约改造：六个章节加了稳定 `data-key`（genesis/shards/flow/orbit/swarm/portal），表单会携带 `email` / `source` / `scrollDepth` / `chapter` / `referrer`，CMS 文案走纯文本渲染（标题按 `\n` 转 `<br>`，不使用 `innerHTML`），接口失败或字段缺失时沿用 HTML 默认文案。

**请你只负责后端。**

本地开发我用 Node 自带的 sqlite 先跑通全流程，**sqlite 只是本地开发用**，请确保你产出的 SQL 是 **Postgres 版本**（我会另附 Postgres 建表脚本），并且表结构、接口行为与上面完全一致，以便将来直接替换。
