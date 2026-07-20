@echo off
setlocal
cd /d "%~dp0"
node tools\apply-v17-90-l195.mjs
if errorlevel 1 exit /b 1
echo.
echo L195 wurde eingebaut. Jetzt Prisma, TypeScript und Build pruefen.
endlocal
