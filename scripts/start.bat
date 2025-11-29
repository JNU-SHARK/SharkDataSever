@echo off
chcp 65001 >nul
echo ═══════════════════════════════════════════════════════
echo 🚀 SharkDataServer 一键启动脚本
echo ═══════════════════════════════════════════════════════
echo.

echo 📦 检查依赖...
if not exist "node_modules\" (
    echo ⚠️  未检测到 node_modules 文件夹
    echo 📥 正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成
    echo.
) else (
    echo ✅ 依赖已安装
    echo.
)

echo 🎬 启动服务器...
echo.
node server.js

pause
