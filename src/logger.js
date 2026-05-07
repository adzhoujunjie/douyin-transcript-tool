const SENSITIVE_KEYS = /(api[_-]?key|authorization|cookie|password|token|secret)/i;

function sanitizeString(value = '') {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9._\-]+/g, 'sk-[REDACTED]')
    .replace(/\/root\/[^\s"']+/g, '/root/[REDACTED]')
    .slice(0, 1200);
}

function sanitizeMeta(meta = {}) {
  const output = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (SENSITIVE_KEYS.test(key)) {
      output[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      output[key] = sanitizeString(value);
    } else if (value && typeof value === 'object') {
      output[key] = sanitizeMeta(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function logStep(step, status = 'info', meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    step,
    status,
    ...sanitizeMeta(meta)
  };
  const line = `[douyin-transcript] ${JSON.stringify(payload)}`;
  if (status === 'fail') console.error(line);
  else console.log(line);
}

export function summarizeError(error) {
  const message = typeof error === 'string' ? error : error?.message || String(error || '未知错误');
  return sanitizeString(message).replace(/\s+/g, ' ').trim();
}
