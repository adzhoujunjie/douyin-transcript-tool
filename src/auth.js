import { config } from './config.js';

export function authStatus(_req, res) {
  res.json({ enabled: Boolean(config.appPassword) });
}

export function login(req, res) {
  if (!config.appPassword) {
    return res.json({ ok: true, enabled: false });
  }

  if (req.body?.password === config.appPassword) {
    return res.json({ ok: true, enabled: true });
  }

  return res.status(401).json({ ok: false, error: '访问密码不正确' });
}

export function requirePassword(req, res, next) {
  if (!config.appPassword) {
    return next();
  }

  const password = req.header('x-app-password') || req.body?.password || req.query?.password;
  if (password === config.appPassword) {
    return next();
  }

  return res.status(401).json({ ok: false, error: '请先输入正确访问密码' });
}
