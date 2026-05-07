export const runtimeState = {
  lastDownloadError: null,
  lastAsrError: null
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
