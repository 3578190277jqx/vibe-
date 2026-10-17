# 第 3 步：留资表单接入

原第六章 Portal 在插入产品章后位于第七章。表单按稳定 key `portal` 上报，不依赖章节序号。后台保存线索，不自动发送邮件。

## 文件与后端入口

- `backend/http.js`：`createHandler()`，处理 `/api/leads` 和 `/api/content`，可交给原生 Node HTTP 服务或后续部署适配层。
- `backend/domain.js`：邮箱归一化、字段校验、IP 哈希与滚动窗口计算。
- `backend/stores/postgres.js`：生产 PostgreSQL 限流事务、唯一索引去重和查询。
- `backend/sql/postgres.sql`：完整 PostgreSQL 建表、索引、触发器及 RLS 定义，不自动迁移已有表。
- `backend/stores/sqlite.js`、`backend/sql/sqlite.sql`：仅供本地开发。
- `lead-form.js`：无额外依赖的客户端请求与表单状态处理。部署时必须与 `world.js` 一起保留。

接口沿用 201 新增、200 重复、422 无效、429 限流；其余传输或服务器故障明确反馈失败。处理顺序仍是限流 → 校验 → 写库。生产平台和托管数据库均待定。

## world.js 完整表单替换块

导入区增加：

```js
import { bindLeadForm } from './lead-form.js';
```

旧演示表单 IIFE 整段已替换为以下完整代码，不再保留定时假成功：

```js
/* 留资表单：portal 稳定 key；成功/重复必须由后端确认，失败保留邮箱并可重试。 */
bindLeadForm({
  form: document.getElementById('ctaForm'),
  button: document.getElementById('ctaBtn'),
  emailInput: document.getElementById('ctaEmail'),
  note: document.getElementById('ctaNote'),
  trap: document.getElementById('ctaTrap'),
  getProgress: () => smoothP
});
```

现有 `updateChapters()` 的 `.cta-actions` 更新同时设置 `x.inert = !act`，HTML 默认给该容器加 `inert`，防止章节未显示时误触透明输入或通过 Tab 聚焦。页面进入 Portal 文字窗口时自动解除。

## 请求内容与页面反馈

每次提交捕获当时的滚动进度，发送：

```json
{
  "email": "jobs@example.com",
  "source": "aether-landing",
  "scrollDepth": 1,
  "chapter": "portal",
  "referrer": "",
  "company_website": ""
}
```

`email` 去首尾空格并转小写；`scrollDepth` 是 `[0,1]` 数值；`referrer` 取 `document.referrer`，允许为空。蜜罐未填时为空，IP 和 UA 由后端处理，不由浏览器上传。

| 状态 | 页面行为 |
| --- | --- |
| 提交中 | 禁用按钮及邮箱，标记 aria-busy，防止并发重复提交 |
| 201 且有效 id | 按钮“已收到 ✓”，沿用绿色成功样式 |
| 200 且 duplicate | 按钮“已记录 ✓”，提示无需重复提交 |
| 422 | 指明邮箱或提交信息未通过校验，恢复按钮 |
| 429 | 提示后端返回的实际剩余秒数，恢复按钮，服务器继续执行限流 |
| 离线或 503 | 提示失败，保留邮箱并恢复按钮 |
| 超过 10 秒 | 中止等待，提示结果未确认；可重试，唯一索引防止重复记录 |
| 返回 HTML 或其他不符合契约的成功响应 | 反馈服务暂不可用，不误报成功 |

成功后修改邮箱会恢复正常提交状态。反馈全部通过 `textContent` 更新，保留 `role="status"` 与 `aria-live="polite"`。

## 本地运行与核验

按 `docs/backend.md` 创建 `.env`、填入随机 `IP_HASH_SALT`，运行 `npm ci`、`npm run db:init`、`npm start`。经 `http://127.0.0.1:3000` 打开页面，进入最后一章提交。文案种子不是留资运行的前置，不需要为本次表单核验覆盖 CMS。

默认留资写入 `.local/aether.sqlite`。使用本地 SQLite 工具查看 `leads`：同来源邮箱去重，chapter 应为 portal，scroll_depth 接近 1，ip_hash 应为 64 位十六进制，不存原始 IP。开发库与生产库分开，测试留资不默认迁移。

`npm test` 运行本地一致性测试；专用真实 PostgreSQL 测试运行方式见 `docs/backend.md`。浏览器验证结果见 `docs/backend-verification.md`。
