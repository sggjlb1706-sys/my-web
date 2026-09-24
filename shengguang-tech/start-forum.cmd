@echo off
cd /d "%~dp0"
set "NODE=C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" set "NODE=node"

if not exist "wrangler.jsonc" copy /y "wrangler.local.jsonc" "wrangler.jsonc" >nul
if not exist ".dev.vars" (
  echo Create .dev.vars from .dev.vars.example and set a new FORUM_BOOTSTRAP_KEY first.
  pause
  exit /b 1
)

"%NODE%" "node_modules\vite\bin\vite.js" build
if errorlevel 1 goto failed
"%NODE%" "node_modules\wrangler\bin\wrangler.js" pages dev dist --ip 127.0.0.1 --port 8788
if errorlevel 1 goto failed
exit /b 0

:failed
echo Forum server failed to start.
pause
exit /b 1
