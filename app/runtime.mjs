// Node.js version policy: 22 is the oldest supported line; each LTS line has a minimum patch
// release with security fixes (2026-10 release: Brotli RCE, TLS hostname bypasses, …).
export const MIN_NODE_MAJOR = 22;
const PATCHED = { 22: [22, 23, 4], 24: [24, 22, 1], 26: [26, 12, 1] };
export const PATCHED_VERSIONS = Object.values(PATCHED).map((version) => `v${version.join('.')}`);

// { supported, secure, detail } for the running (or given) Node.js version.
export function nodeRuntimeStatus(version = process.versions.node) {
  const current = String(version).replace(/^v/, '').split('.').map(Number);
  const [major] = current;
  if (major < MIN_NODE_MAJOR) return { supported: false, secure: false, detail: `需要 Node.js ${MIN_NODE_MAJOR} 或更高版本，当前是 v${version}` };
  const latestLine = Math.max(...Object.keys(PATCHED).map(Number));
  if (major > latestLine) return { supported: true, secure: true, detail: null };
  const patched = PATCHED[major];
  if (!patched) return { supported: true, secure: false, detail: `Node.js ${major}.x 不是长期支持版本，已不再提供安全更新，建议升级到 ${PATCHED_VERSIONS.join(' / ')}` };
  const differs = patched.findIndex((part, index) => (current[index] || 0) !== part);
  return differs !== -1 && (current[differs] || 0) < patched[differs]
    ? { supported: true, secure: false, detail: `Node.js v${version} 有已公开的安全漏洞（含远程代码执行），请升级到 v${patched.join('.')} 或更高版本` }
    : { supported: true, secure: true, detail: null };
}
