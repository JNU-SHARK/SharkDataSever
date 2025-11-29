@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 设置颜色
color 0A

:BANNER
cls
echo ===============================================================
echo               RoboMaster 2026 MQTT 服务器启动器
echo ===============================================================
echo.

:CHECK_NODE
echo [1/3] 检查 Node.js 环境...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    echo.
    echo 请先安装 Node.js:
    echo   下载地址: https://nodejs.org/
    echo   建议版本: v18.x 或更高
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [成功] Node.js 已安装: %NODE_VERSION%

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 npm
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [成功] npm 已安装: %NPM_VERSION%
echo.

:CHECK_DEPS
echo [2/3] 检查项目依赖...
if not exist "node_modules\" (
    echo [安装] 首次运行，正在安装依赖...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 依赖安装失败！
        pause
        exit /b 1
    )
    echo.
    echo [成功] 依赖安装完成
) else (
    echo [成功] 依赖已安装
)
echo.

:MENU
cls
echo ===============================================================
echo          RoboMaster 2026  自定义客户端模拟服务器启动器
echo ===============================================================
echo.
echo [3/3] 请选择要启动的服务:
echo.
echo   1. 启动 MQTT 可视化服务端 (端口 3333 MQTT, 2026 Web)
echo   2. 启动 UDP 视频流传输服务端 (端口 3334)
echo   3. 启动随机数据 MQTT 服务端 (端口 3333)
echo   4. 启动 UDP + MQTT 可视化服务端 (双窗口模式)
echo   5. 退出
echo.
echo ===============================================================
echo.
set /p choice=请输入选项 (1-5): 

if "%choice%"=="1" goto MQTT_VISUAL
if "%choice%"=="2" goto UDP_VIDEO
if "%choice%"=="3" goto MQTT_RANDOM
if "%choice%"=="4" goto DUAL_MODE
if "%choice%"=="5" goto END

echo.
echo [错误] 无效选项，请重新选择
timeout /t 2 >nul
goto MENU

:MQTT_VISUAL
cls
echo ===============================================================
echo    [启动] MQTT 可视化服务端
echo ===============================================================
echo.
echo MQTT 服务: mqtt://127.0.0.1:3333
echo Web 界面: http://127.0.0.1:2026
echo.
echo 按 Ctrl+C 停止服务
echo ===============================================================
echo.
node js\mqtt-server-visual.js
pause
goto MENU

:UDP_VIDEO
cls
echo ===============================================================
echo    [启动] UDP 视频流传输服务端
echo ===============================================================
echo.
echo UDP 监听端口: 3334
echo.
echo 按 Ctrl+C 停止服务
echo ===============================================================
echo.
node js\UDPserver.js
pause
goto MENU

:MQTT_RANDOM
cls
echo ===============================================================
echo    [启动] 随机数据 MQTT 服务端
echo ===============================================================
echo.
echo MQTT 服务: mqtt://127.0.0.1:3333
echo [注意] 与可视化服务端使用相同端口，不能同时运行
echo.
echo 按 Ctrl+C 停止服务
echo ===============================================================
echo.
node js\mqtt-server.js
pause
goto MENU
goto MENU

:DUAL_MODE
cls
echo ===============================================================
echo    [启动] 双服务模式 (UDP + MQTT 可视化)
echo ===============================================================
echo.
echo 即将打开两个窗口:
echo   窗口 1: MQTT 可视化服务 (端口 3333/2026)
echo   窗口 2: UDP 视频流服务 (端口 3334)
echo.
echo 关闭任一窗口即可停止对应服务
echo ===============================================================
echo.
pause

start "MQTT可视化服务" cmd /k "echo MQTT服务: mqtt://127.0.0.1:3333 & echo Web界面: http://127.0.0.1:2026 & echo. & node js\mqtt-server-visual.js"
timeout /t 2 >nul
start "UDP视频流服务" cmd /k "echo UDP监听端口: 3334 & echo. & node js\UDPserver.js"

echo.
echo [成功] 两个服务已在独立窗口中启动
echo.
timeout /t 3 >nul
goto MENU

:END
cls
echo.
echo 👋 感谢使用 RoboMaster MQTT 服务器
echo.
timeout /t 2 >nul
exit /b 0