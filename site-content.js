/* CMS 与三维入口独立：请求失败时保留 HTML 默认文案，不触发世界错误提示。 */
export async function fetchSiteContent({ locale = 'zh-CN', fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/content?locale=' + encodeURIComponent(locale), {
      method: 'GET', cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !Array.isArray(body.chapters) || (body.locale !== undefined && body.locale !== locale)) return null;
    return body.chapters;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function applySiteContent(root, chapters) {
  if (!Array.isArray(chapters)) return;
  const byKey = new Map();
  for (const row of chapters) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.key !== 'string' || byKey.has(row.key)) continue;
    byKey.set(row.key, row);
  }
  // 遍历既有 DOM，绝不按接口顺序或 sortOrder 排序、插入或移动章节。
  for (const section of root.querySelectorAll('.ch[data-key]')) {
    const row = byKey.get(section.dataset.key);
    if (!row) continue;
    for (const [field, selector] of [['eyebrow', '.ch-inner > .eyebrow'], ['body', '.ch-inner > p']]) {
      const element = section.querySelector(selector);
      if (element && typeof row[field] === 'string') element.textContent = row[field];
    }
    const title = section.querySelector('.ch-inner > h2');
    if (title && typeof row.title === 'string') {
      const nodes = [];
      for (const [i, line] of row.title.split(/\r\n|\n|\r/).entries()) {
        if (i > 0) nodes.push(root.createElement('br'));
        nodes.push(root.createTextNode(line));
      }
      title.replaceChildren(...nodes);
    }
    const tags = section.querySelector('.ch-inner > .tags');
    if (tags && Array.isArray(row.tags) && row.tags.every(tag => typeof tag === 'string')) {
      tags.replaceChildren(...row.tags.map(tag => {
        const span = root.createElement('span');
        span.textContent = tag;
        return span;
      }));
    }
  }
}

export async function loadSiteContent({ root = document, ...options } = {}) {
  try {
    const locale = root.documentElement.lang || 'zh-CN';
    const chapters = await fetchSiteContent({ locale, ...options });
    if (chapters === null) return false;
    applySiteContent(root, chapters);
    return true;
  } catch {
    return false;
  }
}
