@echo off
cd /d "%~dp0"
set "PATH=C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
"C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --port 5173 --strictPort
pause
