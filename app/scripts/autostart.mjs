import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANAGER = fileURLToPath(new URL('manage.mjs', import.meta.url));
const APP_DIR = path.resolve(path.dirname(MANAGER), '..');
const UNIT = 'sunbridge-autostart.service';

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} 退出：${result.status ?? result.signal}`);
}

const encodePowerShell = (script) => Buffer.from(script, 'utf16le').toString('base64');
const powershellString = (value) => `'${value.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`;

function windowsAutostart(enable) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const action = encodePowerShell(`$ErrorActionPreference = 'Stop'\n& ${powershellString(process.execPath)} ${powershellString(MANAGER)} start\nexit $LASTEXITCODE`);
  const operation = enable ? String.raw`
$account = [System.Security.Principal.SecurityIdentifier]::new($ownerSid).Translate([System.Security.Principal.NTAccount]).Value
$action = New-ScheduledTaskAction -Execute ${powershellString(powershell)} -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${action}' -WorkingDirectory ${powershellString(APP_DIR)}
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT15S'
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Password -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$definition = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start Sunbridge at system boot'
$password = Read-Host -AsSecureString -Prompt "请输入 $account 的 Windows 账号密码（不是 PIN）"
if (!$password.Length) { exit 2 }
$passwordBuffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  Register-ScheduledTask -TaskName $task -TaskPath '\' -InputObject $definition -User $account -Password ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBuffer)) -Force | Out-Null
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer)
  $password.Dispose()
}
` : String.raw`
if (Get-ScheduledTask -TaskPath '\' | Where-Object { $_.TaskName -eq $task }) {
  Unregister-ScheduledTask -TaskName $task -TaskPath '\' -Confirm:$false
}
`;
  const worker = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $admin = [System.Security.Principal.WindowsPrincipal]::new($identity)
  if (!$admin.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw '需要 Windows 管理员权限。'
  }
  $task = 'Sunbridge-' + $ownerSid
  ${operation}
  exit 10
} catch {
  ${enable ? "[Console]::Error.WriteLine($_.Exception.Message)\n  $null = Read-Host '按回车返回 Sunbridge 菜单'" : ''}
  exit 1
}
`;
  const launcher = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $ownerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $worker = @'
${worker}
'@
  $payload = '$ownerSid = ' + "'" + $ownerSid + "'" + [Environment]::NewLine + $worker
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($payload))
  $workerProcess = Start-Process -FilePath ${powershellString(powershell)} -WorkingDirectory ${powershellString(path.dirname(powershell))} -ArgumentList ('-NoProfile ${enable ? '' : '-NonInteractive '}-EncodedCommand ' + $encoded) -Verb RunAs -WindowStyle ${enable ? 'Normal' : 'Hidden'} -Wait -PassThru
  switch ($workerProcess.ExitCode) {
    10 { exit 0 }
    2 { throw '未输入 Windows 账号密码，未安装自启。' }
    default { throw '自启操作未完成，请确认管理员授权${enable ? '和 Windows 账号密码' : ''}后重试。' }
  }
} catch {
  $cause = $_.Exception.GetBaseException()
  if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 1223) {
    [Console]::Error.WriteLine('已取消 Windows 管理员授权，自启设置未更改。')
  } else {
    [Console]::Error.WriteLine($_.Exception.Message)
  }
  exit 1
}
`;
  run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(launcher)], { timeout: 0 });
  return 'Windows 计划任务';
}

function linuxAutostart(enable) {
  const configHome = process.env.XDG_CONFIG_HOME;
  const unitDir = path.join(configHome && path.isAbsolute(configHome) ? configHome : path.join(os.homedir(), '.config'), 'systemd', 'user');
  const unitFile = path.join(unitDir, UNIT);
  const systemctl = (...args) => run('systemctl', ['--user', ...args]);
  if (enable || fs.existsSync(unitFile)) {
    try {
      systemctl('show', '--property=Version', '--value');
    } catch (error) {
      throw new Error(`需要可用的 systemd 用户会话，请以目标用户登录后运行（不要用 sudo）：${error.message}`);
    }
  }
  if (enable) {
    if ([APP_DIR, MANAGER, process.execPath].some((value) => /[\u0000-\u001F\u007F]/.test(value))) {
      throw new Error('Sunbridge 或 Node.js 路径不能包含控制字符。');
    }
    const escapeSpecifier = (value) => value.replaceAll('%', '%%');
    const execArgument = (value) => JSON.stringify(escapeSpecifier(value));
    const unit = [
      '[Unit]',
      'Description=Sunbridge',
      '',
      '[Service]',
      `WorkingDirectory=${escapeSpecifier(APP_DIR)}`,
      `ExecStart=:${execArgument(process.execPath)} ${execArgument(MANAGER)} start`,
      'Restart=on-failure',
      'RestartSec=5s',
      '',
      '[Install]',
      'WantedBy=default.target',
      '',
    ].join('\n');
    fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(unitFile, unit);
    systemctl('enable', UNIT);
  } else if (fs.existsSync(unitFile)) {
    systemctl('--no-reload', 'disable', UNIT);
    fs.rmSync(unitFile, { force: true });
    systemctl('daemon-reload');
  }
  return 'Linux systemd 用户服务';
}

export function configureAutostart(enable) {
  if (process.platform === 'win32') return windowsAutostart(enable);
  if (process.platform === 'linux') return linuxAutostart(enable);
  throw new Error('自启目前只支持 Windows 和使用 systemd 的 Linux。');
}
