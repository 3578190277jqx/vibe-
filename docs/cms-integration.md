# 第 4 步：章节文案动态化

当前页面包含七章（含第 2 步插入的产品展示），全部按稳定 key 接入 `GET /api/content`。HTML 默认标题、正文、序号和标签完整保留，静态页面也有可读内容。

## 加载与兜底

`index.html` 的独立模块入口导入 `site-content.js` 并调用 `void loadSiteContent()`；没有顶层 await，也没有把 CMS 请求加入 `world.js` 的加载进度或开场条件。三维模块与文案请求各自运行，接口等待时默认文字照常显示。

读取语言来自 `<html lang="zh-CN">`，请求 `/api/content?locale=zh-CN`，客户端设置 `cache: 'no-store'`，后端返回 `Cache-Control: no-store`。请求及响应体共享 5 秒超时；断网、非成功 HTTP 状态、JSON 损坏、语言不匹配或结构无效时保留默认内容，不抛出未处理的异常或显示世界错误框。刷新页面重新读取，不做后台轮询。

## 内容匹配与纯文本渲染

- 数据库 `chapter_key` 经接口映射为 `key`，对应 `.ch[data-key]`。前端遍历既有 HTML，不移动章节，不使用 `sortOrder` 排序。
- `eyebrow`、`title`、`body` 仅接受字符串；缺失、NULL 或错误类型不修改该字段。
- 标题中的真实 `\n`、`\r\n` 或 `\r` 转成 `<br>` 节点，其他字符以文本节点输出。
- `tags` 只接受全部为字符串的数组，生成 `<span>` 并设置 `textContent`；任一标签类型错误则整组保留默认值。
- 空字符串表示有意留空，空数组表示清空标签；与缺失字段不同。
- 不使用 `innerHTML`，HTML 标签和事件属性都按文字显示。
- 未知 key、损坏的章节记录被忽略；重复 key 采用第一条记录。缺失章节继续使用 HTML 内容。CMS 不能增加可播放场景或修改摄像机路径。
- 文案更新只替换对应文字节点；表单、指示器、交互绑定、章节淡入淡出保持原有行为。

## 初始化与运营编辑

`backend/content.json` 现与 HTML 的七章「序场 SCENEWORK」默认文案一致。配置好数据库后运行 `npm run db:seed`，仅插入缺失的 `(chapter_key, locale)`。

**已有数据库不会被覆盖。** 如果以前已导入 AETHER 六章文案，重新运行只会补 products；原六条内容及旧的 Portal 展示序号仍需运营在 Dashboard 按 key 修改。不要删库或自动覆盖运营数据来更新默认值。

运营可编辑 `eyebrow`、`title`、`body`、`tags`，保持 `chapter_key`、`locale` 稳定。`sort_order` 仅用于 Dashboard 列表。保存后刷新网页获取新文案，不需要重新发布前端；最终部署代理和 CDN 不得覆盖文案接口的 no-store 策略。

生产 PostgreSQL 示例（仅修改指定语言及章节）：

```sql
UPDATE site_content
SET title = E'让一个品牌\n成为一段体验',
    body = '新的章节正文。',
    tags = ARRAY['品牌官网', '交互网页']::TEXT[]
WHERE chapter_key = 'genesis' AND locale = 'zh-CN';
```

`updated_at` 由既有数据库触发器更新。本次未执行用户数据库迁移或覆盖已有文案。平台、在线 Dashboard 产品及生产部署继续待定。

## 部署与验证

新增 `site-content.js` 必须与其他前端模块一起部署，保持相对目录关系；不需要构建或额外依赖。Node 静态白名单已包含该模块。

`npm test` 包含请求契约、缓存选项、错误及超时，以及七章种子不覆盖运营修改的测试。浏览器验证涵盖实际数据库更新刷新、纯文本安全、字段兜底、无序返回不改变章节顺序、接口等待时开场、桌面与 375px 以及真实留资回归，结果记录在 `docs/backend-verification.md`。
