#!/bin/bash

# MQTT 测试客户端脚本 (Linux/macOS)
# 使用方法: chmod +x test-mqtt.sh && ./test-mqtt.sh

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 打印带颜色的信息
print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}📡 MQTT 测试客户端${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# 检查 Node.js
check_nodejs() {
    if ! command -v node &> /dev/null; then
        print_error "未检测到 Node.js"
        exit 1
    fi
}

# 检查依赖
check_dependencies() {
    if [ ! -d "node_modules" ]; then
        print_error "请先运行 ./start.sh 安装依赖"
        exit 1
    fi
}

# 主函数
main() {
    print_header
    
    check_nodejs
    check_dependencies
    
    print_info "正在连接到 MQTT 服务器..."
    echo ""
    
    # 捕获 Ctrl+C
    trap 'echo ""; print_info "正在关闭客户端..."; exit 0' INT TERM
    
    node test-mqtt-client.js
}

# 运行主函数
main
