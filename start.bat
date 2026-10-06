@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Sunbridge] Node.js not found. Install Node.js 18+ from https://nodejs.org/ and try again.
  echo [Sunbridge] 未找到 Node.js，请先安装 Node.js 18 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)
node "app\scripts\manage.mjs" %*
set "code=%errorlevel%"
if "%~1"=="" pause
exit /b %code%
