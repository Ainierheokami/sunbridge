// Version and updates of this install, for the settings page.
//   - git checkout (git clone): checking fetches the upstream branch and lists the commits this install is
//     behind; updating is a fast-forward `git pull`, then the bridge restarts (start.sh / start.bat reinstall
//     dependencies when package-lock.json changed). Local edits or local commits make it refuse: nothing of
//     the user's gets overwritten or merged.
//   - anything else (a downloaded archive, git missing): the latest commit on GitHub and where to download it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GIT_TIMEOUT_MS = 60000;
const LOG_LIMIT = 30;
const SEP = '\x1f';

function git(repoDir, args, timeout = GIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    // No prompts (credentials, ssh host keys): a web request can't answer them and would hang.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes', LC_ALL: 'C' };
    execFile('git', ['-C', repoDir, ...args], { env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || '').trim().split('\n').filter(Boolean).slice(-2).join(' ') || (error.killed ? '超时' : error.message);
        reject(Object.assign(new Error(detail), { code: error.code }));
      } else {
        resolve(String(stdout).trimEnd());
      }
    });
  });
}

function repositoryUrl(appDir) {
  try {
    const homepage = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).homepage;
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(homepage || '')) return homepage;
  } catch { /* fall through */ }
  return 'https://github.com/Ainierheokami/sunbridge';
}

const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

const parseLog = (text) => text ? text.split('\n').map((line) => {
  const [hash, date, subject] = line.split(SEP);
  return { hash, date, subject };
}) : [];

export function createUpdater({ appDir, version }) {
  const repoDir = path.resolve(appDir, '..');
  const repository = repositoryUrl(appDir);
  let lastCheck = null; // { at, result }
  let updating = false;

  // What is installed: git details when this is a checkout.
  async function current() {
    const base = { version, repository };
    try {
      // Only this repository: an archive unpacked inside some other checkout must not update that one.
      const top = path.resolve(await git(repoDir, ['rev-parse', '--show-toplevel'], 10000));
      if (!samePath(top, repoDir)) return { ...base, kind: 'archive' };
      const [head, branch, status] = await Promise.all([
        git(repoDir, ['log', '-1', `--format=%H${SEP}%cI${SEP}%s`], 10000),
        git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'], 10000),
        git(repoDir, ['status', '--porcelain', '--untracked-files=no'], 10000),
      ]);
      const upstream = await git(repoDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 10000).catch(() => null);
      return { ...base, kind: 'git', commit: parseLog(head)[0], branch, upstream, changedFiles: status ? status.split('\n').map((line) => line.slice(3)) : [] };
    } catch {
      return { ...base, kind: 'archive' };
    }
  }

  async function checkGit(info) {
    if (!info.upstream) return { ...info, state: 'no-upstream' };
    const remote = info.upstream.split('/')[0];
    await git(repoDir, ['fetch', '--quiet', remote]);
    const [ahead, behind] = (await git(repoDir, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])).split(/\s+/).map(Number);
    const commits = behind ? parseLog(await git(repoDir, ['log', `--max-count=${LOG_LIMIT}`, `--format=%H${SEP}%cI${SEP}%s`, 'HEAD..@{u}'])) : [];
    const state = !behind ? (ahead ? 'ahead' : 'up-to-date') : ahead ? 'diverged' : info.changedFiles.length ? 'dirty' : 'available';
    return { ...info, state, ahead, behind, commits };
  }

  async function checkArchive(info) {
    const [, owner, repo] = new URL(repository).pathname.split('/');
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=5`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sunbridge-update-check' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub 暂时限制了查询次数，请稍后再试' : `GitHub 返回 HTTP ${response.status}`);
    const commits = (await response.json()).map((item) => ({ hash: item.sha, date: item.commit?.committer?.date, subject: String(item.commit?.message || '').split('\n')[0] }));
    return { ...info, state: 'manual', commits, download: `${repository}/archive/refs/heads/main.zip` };
  }

  return {
    // The last check (without contacting anything), or just what is installed.
    async status() {
      return { ...(lastCheck?.result || await current()), checkedAt: lastCheck?.at || null, updating };
    },
    async check() {
      const info = await current();
      try {
        const result = info.kind === 'git' ? await checkGit(info) : await checkArchive(info);
        lastCheck = { at: new Date().toISOString(), result };
        return { ...result, checkedAt: lastCheck.at, updating };
      } catch (error) {
        throw Object.assign(new Error(`检查更新失败：${error.message}`), { code: 'UPDATE_CHECK_FAILED' });
      }
    },
    // Fast-forward to the upstream branch. Resolves with what changed; the caller restarts the bridge.
    async apply() {
      if (updating) throw Object.assign(new Error('正在更新，请稍候'), { code: 'UPDATE_BUSY' });
      updating = true;
      try {
        const info = await checkGit(await current().then((item) => {
          if (item.kind !== 'git') throw Object.assign(new Error('这个安装不是用 git 下载的，不能自动更新：请下载新版本覆盖程序文件（data 目录保留）'), { code: 'UPDATE_MANUAL' });
          return item;
        }));
        if (info.state === 'up-to-date' || info.state === 'ahead') throw Object.assign(new Error('已经是最新版本'), { code: 'UPDATE_NONE' });
        if (info.state === 'no-upstream') throw Object.assign(new Error(`分支 ${info.branch} 没有对应的远程分支，不能自动更新`), { code: 'UPDATE_MANUAL' });
        if (info.state === 'diverged') throw Object.assign(new Error(`本地有 ${info.ahead} 个远程没有的提交，自动更新不会合并它们：请在 ${repoDir} 手动处理`), { code: 'UPDATE_MANUAL' });
        if (info.state === 'dirty') throw Object.assign(new Error(`程序文件有本地修改（${info.changedFiles.slice(0, 5).join('、')}${info.changedFiles.length > 5 ? ' 等' : ''}），自动更新不会覆盖：请先手动处理`), { code: 'UPDATE_MANUAL' });
        const before = info.commit.hash;
        await git(repoDir, ['merge', '--ff-only', '--quiet', '@{u}']);
        const after = await git(repoDir, ['rev-parse', 'HEAD']);
        const changed = (await git(repoDir, ['diff', '--name-only', before, after])).split('\n').filter(Boolean);
        lastCheck = null;
        return { from: before, to: after, commits: info.commits.length, dependencies: changed.some((file) => /(^|\/)package(-lock)?\.json$/.test(file)) };
      } finally {
        updating = false;
      }
    },
  };
}
