/**
 * @param {string} value
 * @returns {string}
 */
export function validateLoopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Development daemon origin is invalid');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Development daemon origin must be an HTTP loopback origin');
  }
  return url.origin;
}
