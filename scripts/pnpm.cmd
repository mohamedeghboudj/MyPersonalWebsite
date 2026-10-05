@echo off
setlocal
set "PLATFORM_ROOT=%~dp0.."
set "PATH=%PLATFORM_ROOT%\scripts;%PLATFORM_ROOT%\.tools\node-v24.21.0-win-x64;%PATH%"
set "COREPACK_HOME=%PLATFORM_ROOT%\.cache\corepack"
"%PLATFORM_ROOT%\.tools\node-v24.21.0-win-x64\node.exe" "%PLATFORM_ROOT%\.tools\node_modules\corepack\dist\pnpm.js" %*
exit /b %errorlevel%
