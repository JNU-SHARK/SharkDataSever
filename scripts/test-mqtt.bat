@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════════════
echo 📡 MQTT 测试客户端
echo ═══════════════════════════════════════════════════════
echo.

echo 🔌 正在连接到 MQTT 服务器...
echo.
cd ..
node js\mqtt-server.js

pause
