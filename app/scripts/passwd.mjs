// Set or reset the web login: start.bat / start.sh -> "设置或重置登录密码" (or `start.bat passwd`).
// Must be run on the bridge machine; it revokes every existing login session.
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setCredentials, validatePassword, loadAuthState } from '../auth.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.SUNBRIDGE_DATA_DIR ? path.resolve(process.env.SUNBRIDGE_DATA_DIR) : path.join(ROOT, '..', 'data');

// Piped input (non-TTY): read lines from one shared reader so no line is dropped between prompts.
let lineReader = null;
async function nextLine() {
  lineReader ||= readline.createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  const { value, done } = await lineReader.next();
  if (done) throw new Error('输入已结束');
  return value.replace(/\r$/, '');
}

function ask(question, { hidden = false } = {}) {
  const { stdin, stdout } = process;
  if (!hidden && stdin.isTTY) {
    // Let readline draw the prompt itself: it redraws the current line on start, which would
    // erase anything written beforehand.
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    });
  }
  stdout.write(question);
  if (!stdin.isTTY) return nextLine();
  // Hidden TTY input: raw mode, nothing is echoed.
  return new Promise((resolve, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u0003') { finish(new Error('已取消')); return; }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const current = loadAuthState(DATA_DIR).user?.username;
  const username = (process.argv[2] || (await ask(`用户名 [${current || 'admin'}]: `)).trim() || current || 'admin');
  const password = await ask('新密码: ', { hidden: true });
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  if (password !== await ask('再输入一次: ', { hidden: true })) throw new Error('两次输入的密码不一致');
  await setCredentials(DATA_DIR, username, password);
  console.log(`已为 ${username} 设置密码，所有已登录的会话都已失效。`);
  process.exit(0);
} catch (error) {
  console.error(`设置失败：${error.message}`);
  process.exit(1);
}
