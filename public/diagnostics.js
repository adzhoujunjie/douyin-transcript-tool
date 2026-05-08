const state = { password: localStorage.getItem('douyinTranscriptPassword') || '' };
const $ = (id) => document.getElementById(id);
function authHeaders() { return state.password ? { 'x-app-password': state.password } : {}; }
function escapeHtml(value = '') { return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function boolText(value) { return value ? '是' : '否'; }
function jsonText(value) { return JSON.stringify(value || null, null, 2); }
function render(diag) {
  const rows = [
    ['服务正常运行', boolText(diag.service.ok)],
    ['当前端口', diag.service.port],
    ['当前解析通道 DOUYIN_RESOLVER_PROVIDER', diag.resolver.provider],
    ['DOUYIN_RESOLVER_API_URL 是否配置', `${boolText(diag.resolver.apiUrlConfigured)} ${diag.resolver.apiUrlDomain || ''}`],
    ['DOUYIN_RESOLVER_METHOD', diag.resolver.method],
    ['DOUYIN_RESOLVER_URL_FIELD', diag.resolver.urlField],
    ['DOUYIN_RESOLVER_RESPONSE_VIDEO_FIELD 是否配置', boolText(diag.resolver.responseVideoFieldConfigured)],
    ['ffmpeg 是否安装', boolText(diag.binaries?.ffmpeg?.ok ?? diag.dependencies.ffmpegInstalled)],
    ['ffmpeg 路径', diag.binaries?.ffmpeg?.path || diag.dependencies.ffmpegPath || '未检测到'],
    ['ffmpeg 版本', diag.binaries?.ffmpeg?.version || diag.dependencies.ffmpegVersion || '未检测到'],
    ['ffprobe 是否安装', boolText(diag.binaries?.ffprobe?.ok ?? diag.dependencies.ffprobeInstalled)],
    ['ffprobe 路径', diag.binaries?.ffprobe?.path || diag.dependencies.ffprobePath || '未检测到'],
    ['ffprobe 版本', diag.binaries?.ffprobe?.version || diag.dependencies.ffprobeVersion || '未检测到'],
    ['环境变量 FFMPEG_PATH', diag.env?.FFMPEG_PATH || '未配置'],
    ['环境变量 FFPROBE_PATH', diag.env?.FFPROBE_PATH || '未配置'],
    ['yt-dlp 是否安装', boolText(diag.binaries?.ytDlp?.ok ?? diag.dependencies.ytDlpInstalled)],
    ['yt-dlp 版本', diag.binaries?.ytDlp?.version || diag.dependencies.ytDlpVersion || '未检测到'],
    ['Playwright 是否安装', boolText(diag.dependencies.playwrightInstalled)],
    ['Chromium 是否可用', `${boolText(diag.dependencies.chromiumUsable)} ${diag.dependencies.chromiumError || ''}`],
    ['DOUYIN_COOKIES_FILE 是否配置', boolText(diag.douyin.cookiesFileConfigured)],
    ['DOUYIN_COOKIES_FILE 文件是否存在', boolText(diag.douyin.cookiesFileExists)],
    ['ASR_PROVIDER', diag.asr.provider],
    ['ASR_BASE_URL 是否配置', `${boolText(diag.asr.baseUrlConfigured)} ${diag.asr.baseUrlDomain || ''}`],
    ['ASR_MODEL', diag.asr.model || '未配置'],
    ['OPENAI_BASE_URL 是否配置', `${boolText(diag.openai.baseUrlConfigured)} ${diag.openai.baseUrlDomain || ''}`],
    ['OPENAI_MODEL', diag.openai.model || '未配置'],
    ['uploads 目录可写', boolText(diag.writable.uploads)],
    ['downloads 目录可写', boolText(diag.writable.downloads)],
    ['tmp 目录可写', boolText(diag.writable.tmp)],
    ['tmp/downloads 目录可写', boolText(diag.writable.tmpDownloads)],
    ['最近一次链接解析链路', jsonText(diag.recentErrors.lastLinkResolve)],
    ['最近一次链接下载错误摘要', jsonText(diag.recentErrors.lastDownloadError)],
    ['最近一次 ASR 错误摘要', jsonText(diag.recentErrors.lastAsrError)]
  ];
  $('diagnosticsContent').innerHTML = rows.map(([k, v]) => `<div class="diag-key">${escapeHtml(k)}</div><div class="diag-value">${escapeHtml(v)}</div>`).join('');
}
async function loadDiagnostics() {
  $('diagnosticsStatus').textContent = '正在加载...';
  const res = await fetch('/api/diagnostics', { headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { $('passwordBox').classList.remove('hidden'); $('diagnosticsStatus').textContent = data.error || '需要访问密码'; return; }
  if (!res.ok) throw new Error(data.error || '诊断加载失败');
  const diag = data.diagnostics || data; $('passwordBox').classList.add('hidden'); render(diag); $('diagnosticsStatus').textContent = `更新时间：${diag.service?.timestamp || diag.timestamp}`;
}
$('diagnosticsPasswordForm').addEventListener('submit', async (e) => { e.preventDefault(); state.password = $('diagnosticsPassword').value; localStorage.setItem('douyinTranscriptPassword', state.password); try { await loadDiagnostics(); } catch (err) { $('diagnosticsPasswordError').textContent = err.message; } });
$('reloadButton').addEventListener('click', () => loadDiagnostics().catch((err) => { $('diagnosticsStatus').textContent = err.message; }));
loadDiagnostics().catch((err) => { $('diagnosticsStatus').textContent = err.message; });
