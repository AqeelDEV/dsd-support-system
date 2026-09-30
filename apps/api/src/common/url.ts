/** The request path without its query string, which may carry search terms or tokens. */
export function requestPath(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}
