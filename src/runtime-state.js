export const runtimeState = {
  lastDownloadError: null,
  lastAsrError: null,
  lastLinkResolve: null
};

export function rememberDownloadError(error) {
  runtimeState.lastDownloadError = {
    at: new Date().toISOString(),
    ...error
  };
}

export function rememberAsrError(error) {
  runtimeState.lastAsrError = {
    at: new Date().toISOString(),
    ...error
  };
}

export function rememberLinkResolve(resolveDiagnostics) {
  runtimeState.lastLinkResolve = {
    at: new Date().toISOString(),
    inputText: resolveDiagnostics.inputText || '',
    extractedUrl: resolveDiagnostics.extractedUrl || '',
    finalUrl: resolveDiagnostics.finalUrl || '',
    apiSuccess: Boolean(resolveDiagnostics.apiSuccess ?? resolveDiagnostics.api?.success),
    ytdlpSuccess: Boolean(resolveDiagnostics.ytdlpSuccess ?? resolveDiagnostics.ytdlp?.success),
    playwrightSuccess: Boolean(resolveDiagnostics.playwrightSuccess ?? resolveDiagnostics.playwright?.success),
    apiDetail: resolveDiagnostics.api?.detail || '',
    ytdlpDetail: resolveDiagnostics.ytdlp?.detail || '',
    playwrightDetail: resolveDiagnostics.playwright?.detail || '',
    errors: resolveDiagnostics.errors || [],
    finalFailureReason: resolveDiagnostics.finalFailureReason || ''
  };
}
