# JS 目录

本目录包含所有 JavaScript 源代码文件。

## 📁 文件列表

### 🌐 主服务
- **mqtt-server-visual.js** - MQTT 可视化服务端（主要服务）
  - MQTT 端口: 3333
  - Web 界面: http://127.0.0.1:2026
  - 功能: 提供 MQTT 消息的可视化发送和接收界面

### 🚀 其他服务
- **UDPserver.js** - UDP 视频流传输服务端（主要 UDP 服务）
  - UDP 端口: 3334
  - 功能: 接收并处理 UDP 视频流数据

- **mqtt-server.js** - 随机数据 MQTT 服务端
  - MQTT 端口: 3333 ⚠️（与可视化服务相同，不可同时运行）
  - 功能: 自动发送随机测试数据

- **udp-video-streamer.js** - 备用 UDP 服务器
  - 功能: UDP 数据接收服务（备用）

### 🧪 测试工具
- **test-visual-mqtt-client.js** - 可视化 MQTT 客户端测试程序
  - 功能: 连接到 MQTT 服务器并发送测试消息

## 💡 使用说明

**推荐使用根目录下的启动器：**
- Windows: `runner.bat`
- Linux/Mac: `runner.sh`

**或直接运行：**
```bash
# 启动主服务（MQTT 可视化）
node js/mqtt-server-visual.js

# 启动 UDP 视频流服务
node js/UDPserver.js

# 启动随机数据 MQTT 服务
node js/mqtt-server.js
```

---
**江南大学霞客湾校区 MeroT 制作**
