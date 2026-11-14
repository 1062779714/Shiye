@echo off
chcp 65001 >nul
title 拾页 · PagePick 本地助手一键安装

echo.
echo ========================================================
echo   拾页 · PagePick 电脑端本地助手注册程序 (v0.4.1)
echo ========================================================
echo 正在注册并配置浏览器权限...
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0native-host\install.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ 注册失败，请检查上方报错信息。
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================================
echo [高级备用选项] 助手已自动为官方固化扩展 ID 完成授权！
echo 如果您在 chrome://extensions 页面查看到其它自定义扩展 ID，
echo 可在此处粘贴并回车追加授权；若无特殊情况，直接按回车退出即可。
echo ========================================================
set /p customId="输入自定义扩展 ID (直接按回车完成): "
if not "%customId%"=="" (
    powershell -ExecutionPolicy Bypass -File "%~dp0native-host\install.ps1" -ExtensionId %customId%
)

echo.
echo 🎉 配置全部完成！请在浏览器中尽情使用。
pause
