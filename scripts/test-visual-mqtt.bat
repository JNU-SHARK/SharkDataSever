@echo off
chcp 65001 >nul
echo ========================================
echo    启动可视化MQTT测试客户端
echo ========================================
echo.
echo 请先确保MQTT服务器已启动！
echo 服务器启动脚本: start-visual-mqtt.bat
echo.
echo 本客户端将：
echo 1. 订阅所有下行消息（服务器发送）
echo 2. 定期发送上行消息（客户端发送）
echo 3. 在控制台显示收发的消息
echo.
echo 同时请打开浏览器访问: http://127.0.0.1:2026
echo 查看可视化界面
echo.
echo 按 Ctrl+C 停止客户端
echo.

cd ..
node js\test-visual-mqtt-client.js

pause
