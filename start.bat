@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM Change admin1234 below to set the admin password.
set ADMIN_PASSWORD=user1234
start "" http://localhost:3000/admin
node server.js
pause
