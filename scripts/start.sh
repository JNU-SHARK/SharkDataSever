#!/bin/bash

# SharkDataServer 一键启动脚本 (Linux/macOS)
# 使用方法: chmod +x start.sh && ./start.sh

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的信息
print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🚀 SharkDataServer 一键启动脚本${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# 检查 Node.js 是否安装
check_nodejs() {
    if ! command -v node &> /dev/null; then
        print_error "未检测到 Node.js"
        print_info "请先安装 Node.js (建议版本 >= 14.0.0)"
        print_info "访问: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node -v)
    print_success "Node.js 已安装: $NODE_VERSION"
}

# 检查 npm 是否安装
check_npm() {
    if ! command -v npm &> /dev/null; then
        print_error "未检测到 npm"
        exit 1
    fi
    
    NPM_VERSION=$(npm -v)
    print_success "npm 已安装: $NPM_VERSION"
}

# 检查并安装依赖
check_dependencies() {
    echo ""
    print_info "检查依赖..."
    
    if [ ! -d "node_modules" ]; then
        print_warning "未检测到 node_modules 文件夹"
        print_info "正在安装依赖..."
        echo ""
        
        npm install
        
        if [ $? -ne 0 ]; then
            print_error "依赖安装失败"
            print_info "请尝试手动运行: npm install"
            exit 1
        fi
        
        print_success "依赖安装完成"
    else
        print_success "依赖已安装"
    fi
}

# 检查视频源文件
check_video_source() {
    echo ""
    print_info "检查视频源文件..."
    
    if [ ! -d "VideoSource" ]; then
        print_warning "VideoSource 文件夹不存在，正在创建..."
        mkdir -p VideoSource
    fi
    
    # 检查是否有视频文件
    VIDEO_COUNT=$(find VideoSource -type f \( -name "*.mp4" -o -name "*.avi" -o -name "*.mov" \) | wc -l)
    
    if [ $VIDEO_COUNT -eq 0 ]; then
        print_warning "VideoSource 文件夹中没有视频文件"
        print_info "请添加至少一个视频文件 (.mp4, .avi, .mov) 到 VideoSource 文件夹"
        print_info "继续启动可能会导致 UDP 视频流服务失败"
        echo ""
        read -p "是否继续？(y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_success "找到 $VIDEO_COUNT 个视频文件"
    fi
}

# 启动服务器
start_server() {
    echo ""
    print_info "启动服务器..."
    echo ""
    
    # 捕获 Ctrl+C
    trap 'echo ""; print_info "正在停止服务器..."; exit 0' INT TERM
    
    node server.js
}

# 主函数
main() {
    print_header
    
    # 检查环境
    check_nodejs
    check_npm
    
    # 检查依赖
    check_dependencies
    
    # 检查视频源
    check_video_source
    
    # 启动服务器
    start_server
}

# 运行主函数
main
