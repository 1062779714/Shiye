@echo off
chcp 65001 >nul
echo 正在注册拾页本地助手...
powershell -ExecutionPolicy Bypass -File "%~dp0native-host\install.ps1"
echo.
pause
