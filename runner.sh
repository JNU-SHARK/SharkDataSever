#!/bin/bash

# 设置颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
show_banner() {
    clear
    echo -e "${CYAN}===============================================================${NC}"
    echo -e "${GREEN}      RoboMaster 2026 自定义客户端模拟服务器启动器${NC}"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
}

# 检查 Node.js
check_node() {
    echo -e "${YELLOW}[1/3] 检查 Node.js 环境...${NC}"
    
    if command -v node >/dev/null 2>&1; then
        NODE_CMD=node
    elif command -v nodejs >/dev/null 2>&1; then
        NODE_CMD=nodejs
    else
        echo -e "${RED}❌ 错误: 未检测到 Node.js${NC}"
        echo ""
        echo "请先安装 Node.js:"
        echo "  Ubuntu/Debian: sudo apt install nodejs npm"
        echo "  CentOS/RHEL:   sudo yum install nodejs npm"
        echo "  macOS:         brew install node"
        echo "  或访问:        https://nodejs.org/"
        echo ""
        read -p "按任意键退出..." -n 1
        exit 1
    fi
    
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js 已安装: ${NODE_VERSION}${NC}"
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ 错误: 未检测到 npm${NC}"
        echo ""
        read -p "按任意键退出..." -n 1
        exit 1
    fi
    
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✅ npm 已安装: ${NPM_VERSION}${NC}"
    echo ""
}

# 检查依赖
check_deps() {
    echo -e "${YELLOW}[2/3] 检查项目依赖...${NC}"
    
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}📦 首次运行，正在安装依赖...${NC}"
        echo ""
        npm install
        
        if [ $? -ne 0 ]; then
            echo ""
            echo -e "${RED}❌ 依赖安装失败！${NC}"
            read -p "按任意键退出..." -n 1
            exit 1
        fi
        
        echo ""
        echo -e "${GREEN}✅ 依赖安装完成${NC}"
    else
        echo -e "${GREEN}✅ 依赖已安装${NC}"
    fi
    echo ""
}

# 主菜单
show_menu() {
    echo -e "${YELLOW}[3/3] 请选择要启动的服务:${NC}"
    echo ""
    echo "┌─────────────────────────────────────────────────────────┐"
    echo "│  1. 启动 MQTT 可视化服务端 (端口 3333 MQTT, 2026 Web)  │"
    echo "│  2. 启动 UDP 视频流传输服务端 (端口 3334)              │"
    echo "│  3. 启动随机数据 MQTT 服务端 (端口 3333)               │"
    echo "│  4. 启动 UDP + MQTT 可视化服务端 (双进程模式)          │"
    echo "│  5. 退出                                               │"
    echo "└─────────────────────────────────────────────────────────┘"
    echo ""
}

# MQTT 可视化服务
start_mqtt_visual() {
    clear
    echo -e "${CYAN}===============================================================${NC}"
    echo -e "${GREEN}   🌐 启动 MQTT 可视化服务端${NC}"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    echo "MQTT 服务: mqtt://127.0.0.1:3333"
    echo "Web 界面: http://127.0.0.1:2026"
    echo ""
    echo "按 Ctrl+C 停止服务"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    
    node js/mqtt-server-visual.js
    
    echo ""
    read -p "按任意键返回菜单..." -n 1
}

# UDP 视频流服务
start_udp_video() {
    clear
    echo -e "${CYAN}===============================================================${NC}"
    echo -e "${GREEN}   📹 启动 UDP 视频流传输服务端${NC}"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    echo "UDP 监听端口: 3334"
    echo ""
    echo "按 Ctrl+C 停止服务"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    
    node js/UDPserver.js
    
    echo ""
    read -p "按任意键返回菜单..." -n 1
}

# 随机数据 MQTT 服务
start_mqtt_random() {
    clear
    echo -e "${CYAN}===============================================================${NC}"
    echo -e "${GREEN}   🎲 启动随机数据 MQTT 服务端${NC}"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    echo "MQTT 服务: mqtt://127.0.0.1:3333"
    echo -e "${YELLOW}⚠️  注意: 与可视化服务端使用相同端口，不能同时运行${NC}"
    echo ""
    echo "按 Ctrl+C 停止服务"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    
    node js/mqtt-server.js
    
    echo ""
    read -p "按任意键返回菜单..." -n 1
}

# 双服务模式
start_dual_mode() {
    clear
    echo -e "${CYAN}===============================================================${NC}"
    echo -e "${GREEN}   🚀 启动双服务模式 (UDP + MQTT 可视化)${NC}"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    echo "即将启动两个后台进程:"
    echo "  进程 1: MQTT 可视化服务 (端口 3333/2026)"
    echo "  进程 2: UDP 视频流服务 (端口 3334)"
    echo ""
    echo "使用以下命令查看日志:"
    echo "  MQTT: tail -f mqtt-visual.log"
    echo "  UDP:  tail -f udp-video.log"
    echo ""
    echo "停止服务: 选择菜单选项停止或使用 pkill -f 'mqtt-server-visual\\|udp-video-streamer'"
    echo -e "${CYAN}===============================================================${NC}"
    echo ""
    read -p "按任意键开始启动..." -n 1
    echo ""
    
    # 启动 MQTT 可视化服务
    nohup node js/mqtt-server-visual.js > mqtt-visual.log 2>&1 &
    MQTT_PID=$!
    echo -e "${GREEN}✅ MQTT 可视化服务已启动 (PID: $MQTT_PID)${NC}"
    
    sleep 2
    
    # 启动 UDP 视频流服务
    nohup node js/UDPserver.js > udp-video.log 2>&1 &
    UDP_PID=$!
    echo -e "${GREEN}✅ UDP 视频流服务已启动 (PID: $UDP_PID)${NC}"
    
    echo ""
    echo "服务进程 ID:"
    echo "  MQTT: $MQTT_PID"
    echo "  UDP:  $UDP_PID"
    echo ""
    
    # 子菜单：管理双服务
    while true; do
        echo ""
        echo "双服务管理:"
        echo "  1. 查看 MQTT 日志"
        echo "  2. 查看 UDP 日志"
        echo "  3. 停止所有服务"
        echo "  4. 返回主菜单"
        echo ""
        read -p "请选择 (1-4): " dual_choice
        
        case $dual_choice in
            1)
                echo ""
                echo "========== MQTT 可视化服务日志 (最后 20 行) =========="
                tail -n 20 mqtt-visual.log 2>/dev/null || echo "日志文件不存在"
                ;;
            2)
                echo ""
                echo "========== UDP 视频流服务日志 (最后 20 行) =========="
                tail -n 20 udp-video.log 2>/dev/null || echo "日志文件不存在"
                ;;
            3)
                echo ""
                echo "正在停止所有服务..."
                kill $MQTT_PID 2>/dev/null && echo -e "${GREEN}✅ MQTT 服务已停止${NC}" || echo -e "${YELLOW}⚠️  MQTT 服务未运行${NC}"
                kill $UDP_PID 2>/dev/null && echo -e "${GREEN}✅ UDP 服务已停止${NC}" || echo -e "${YELLOW}⚠️  UDP 服务未运行${NC}"
                sleep 1
                break
                ;;
            4)
                echo ""
                echo -e "${YELLOW}⚠️  服务仍在后台运行！${NC}"
                echo "如需停止，请选择菜单选项或手动终止进程"
                break
                ;;
            *)
                echo -e "${RED}无效选项${NC}"
                ;;
        esac
    done
    
    echo ""
    read -p "按任意键返回主菜单..." -n 1
}

# 主程序
main() {
    show_banner
    check_node
    check_deps
    
    while true; do
        show_menu
        read -p "请输入选项 (1-5): " choice
        
        case $choice in
            1)
                start_mqtt_visual
                show_banner
                ;;
            2)
                start_udp_video
                show_banner
                ;;
            3)
                start_mqtt_random
                show_banner
                ;;
            4)
                start_dual_mode
                show_banner
                ;;
            5)
                clear
                echo ""
                echo -e "${GREEN}自定义客户端模拟服务器正在退出...${NC}"
                echo ""
                exit 0
                ;;
            *)
                echo ""
                echo -e "${RED}❌ 无效选项，请重新选择${NC}"
                sleep 2
                show_banner
                ;;
        esac
    done
}

# 运行主程序
main
