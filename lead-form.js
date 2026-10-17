/* 原生浏览器模块：所有成功反馈都必须来自 /api/leads 的确认。 */
export async function postLead(payload, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let body;
    try { body = await response.json(); }
    catch {
      return { state: controller.signal.aborted ? 'timeout' : 'unavailable' };
    }
    if (body?.ok === true) {
      if (response.status === 201 && Number.isSafeInteger(body.id) && body.id > 0) return { state: 'success' };
      if (response.status === 200 && body.duplicate === true) return { state: 'duplicate' };
    }
    if (body?.ok === false && response.status === 422) {
      if (body.error === 'INVALID_EMAIL') return { state: 'invalid-email' };
      if (body.error === 'INVALID_PAYLOAD') return { state: 'invalid-payload' };
    }
    if (response.status === 429 && body?.ok === false && body.error === 'RATE_LIMITED') {
      const seconds = body.retryAfter ?? Number(response.headers.get('Retry-After'));
      return { state: 'rate-limited', retryAfter: Number.isInteger(seconds) && seconds > 0 && seconds <= 60 ? seconds : 60 };
    }
    return { state: 'unavailable' };
  } catch {
    return { state: controller.signal.aborted ? 'timeout' : 'network-error' };
  } finally {
    clearTimeout(timer);
  }
}

export function bindLeadForm({ form, button, emailInput, note, trap, getProgress, fetchImpl, timeoutMs }) {
  if (!form || !button || !emailInput || !note) return;
  const defaultLabel = button.textContent;
  const defaultNote = note.textContent;
  let busy = false;
  let confirmedEmail = '';

  function feedback(message, state) {
    note.textContent = message;
    note.dataset.state = state;
  }

  emailInput.addEventListener('input', () => {
    if (busy) return;
    confirmedEmail = '';
    button.disabled = false;
    button.classList.remove('ok');
    button.textContent = defaultLabel;
    emailInput.removeAttribute('aria-invalid');
    feedback(defaultNote, 'idle');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || form.closest('[inert]')) return;
    const email = emailInput.value.trim().toLowerCase();
    if (email === confirmedEmail && confirmedEmail) return;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.setAttribute('aria-invalid', 'true');
      feedback('邮箱格式看起来不对，请检查后重试。', 'invalid-email');
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute('aria-invalid');
    const progress = getProgress();
    const payload = {
      email,
      source: 'aether-landing',
      scrollDepth: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0,
      chapter: form.closest('[data-key]')?.dataset.key ?? 'portal',
      referrer: form.ownerDocument.referrer,
      company_website: trap?.value ?? ''
    };
    busy = true;
    button.disabled = true;
    emailInput.disabled = true;
    button.textContent = '提交中…';
    form.setAttribute('aria-busy', 'true');
    feedback('正在保存，请稍候…', 'pending');
    try {
      const result = await postLead(payload, { fetchImpl, timeoutMs });
      if (result.state === 'success' || result.state === 'duplicate') {
        confirmedEmail = email;
        emailInput.value = email;
        button.textContent = result.state === 'success' ? '已收到 ✓' : '已记录 ✓';
        button.classList.add('ok');
        feedback(result.state === 'success' ? '邮箱已保存，谢谢你的关注。' : '这个邮箱已记录，无需重复提交。', result.state);
      } else {
        const messages = {
          'invalid-email': '邮箱格式未通过校验，请检查后重试。',
          'invalid-payload': '提交信息未通过校验，请检查或刷新页面后重试。',
          'rate-limited': `提交过于频繁，请在 ${result.retryAfter} 秒后重试。`,
          timeout: '提交超时，结果尚未确认。请重试；重复邮箱不会重复记录。',
          'network-error': '网络连接失败，请检查网络后重试。',
          unavailable: '提交服务暂不可用，请稍后重试。'
        };
        if (result.state === 'invalid-email') emailInput.setAttribute('aria-invalid', 'true');
        feedback(messages[result.state] ?? messages.unavailable, result.state);
      }
    } finally {
      busy = false;
      emailInput.disabled = false;
      button.disabled = Boolean(confirmedEmail);
      form.removeAttribute('aria-busy');
      if (!confirmedEmail) button.textContent = defaultLabel;
    }
  });
}
