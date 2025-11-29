@echo off
chcp 65001 >nul
echo ========================================
echo    启动可视化MQTT服务器
echo ========================================
echo.
echo MQTT服务端口: 3333
echo Web可视化界面: http://127.0.0.1:2026
echo.
echo 按 Ctrl+C 停止服务
echo.

cd ..
node js\mqtt-server-visual.js

pause
