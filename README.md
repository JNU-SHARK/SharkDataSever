# SharkDataServer - RoboMaster 2026 模拟服务器

> 用于 RoboMaster 2026 自定义客户端开发的 UDP 视频流和 MQTT 数据模拟服务器

[![Node.js](https://img.shields.io/badge/Node.js-v14+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-2.0.0-orange.svg)](package.json)

---

## 📚 目录

- [项目简介](#-项目简介)
- [快速开始](#-快速开始)
- [项目结构](#-项目结构)
- [服务说明](#-服务说明)
- [UDP 数据格式](#-udp-数据格式)
- [MQTT 协议说明](#-mqtt-协议说明)
- [使用示例](#-使用示例)
- [常见问题](#-常见问题)

---

## 🎯 项目简介

SharkDataServer 是一个完整的 RoboMaster 2026 赛事模拟服务器，提供以下功能：

- **UDP 视频流模拟** - 模拟比赛现场的 HEVC 格式视频流传输
- **MQTT 可视化服务** - 提供 Web 界面的 MQTT 消息收发和调试工具
- **协议标准化** - 严格遵循 Protocol Buffers v3 规范
- **开发友好** - 支持 Windows/Linux/Mac 跨平台运行

### 核心特性

✅ **双协议支持** - UDP (视频流) + MQTT (控制数据)  
✅ **可视化调试** - Web 界面实时查看和发送 MQTT 消息  
✅ **完整协议** - 覆盖 20+ 上行/下行消息类型  
✅ **即插即用** - 一键启动器，自动环境检测  

---

## 🚀 快速开始

### 前置要求

- **Node.js** >= 14.0.0 ([下载地址](https://nodejs.org/))
- **npm** (随 Node.js 自动安装)

### 安装步骤

**方法一：使用启动器（推荐）**

1. 下载项目到本地
2. 双击运行启动器：
   - **Windows**: `runner.bat`
   - **Linux/Mac**: `./runner.sh`
3. 启动器会自动：
   - 检测 Node.js 环境
   - 安装项目依赖
   - 提供交互式服务选择菜单

**方法二：手动安装**

```bash
# 1. 克隆项目
git clone https://github.com/tearncolour/SharkDataSever.git
cd SharkDataSever

# 2. 安装依赖
npm install

# 3. 启动服务
npm run mqtt-visual  # MQTT 可视化服务
# 或
npm run udp          # UDP 视频流服务
# 或
npm start            # 默认启动 UDP 服务
```

### 访问服务

启动成功后，访问：

- **MQTT Web 界面**: http://127.0.0.1:2026
- **MQTT 服务器**: mqtt://127.0.0.1:3333
- **UDP 监听端口**: 127.0.0.1:3334

---

## 📁 项目结构

```
SharkDataSever/
├── runner.bat                 # ⭐ Windows 启动器
├── runner.sh                  # ⭐ Linux/Mac 启动器
├── package.json               # 项目配置和依赖
├── .gitignore
│
├── docs/                      # 📚 文档目录
│   └── Protocol.md            # MQTT 协议详细说明（完整版）
│
├── js/                        # 💻 JavaScript 源代码
│   ├── README.md
│   ├── mqtt-server-visual.js      # MQTT 可视化服务（主服务）
│   ├── mqtt-server.js             # 随机数据 MQTT 服务
│   ├── UDPserver.js               # UDP 视频流服务（主服务）
│   ├── udp-video-streamer.js      # UDP 服务器备用版本
│   └── test-visual-mqtt-client.js # MQTT 测试客户端
│
├── scripts/                   # 🔧 辅助脚本
│   ├── README.md
│   ├── start.bat / start.sh           # 快速启动脚本
│   ├── test-mqtt.bat / test-mqtt.sh   # MQTT 连接测试
│   ├── test-udp.bat / test-udp.sh     # UDP 测试
│   ├── test-visual-mqtt.bat           # 可视化 MQTT 测试
│   └── install-and-run.sh             # 安装并运行（Linux/Mac）
│
├── proto/                     # 📦 Protocol Buffers 定义
│   ├── messages.proto             # Protobuf 消息定义
│   ├── messages.js                # 编译后的 JS 模块
│   └── messages.d.ts              # TypeScript 类型定义
│
├── VideoSource/               # 🎬 视频源文件
│   └── shark.h265                 # HEVC 格式测试视频
│
└── node_modules/              # 📦 Node.js 依赖包（自动生成）
```

### 关键文件说明

| 文件 | 用途 |
|------|------|
| `js/mqtt-server-visual.js` | **主要服务** - 提供 MQTT 服务器 + Web 可视化界面 |
| `js/UDPserver.js` | **UDP 服务** - 循环发送 HEVC 视频流 |
| `docs/Protocol.md` | **协议文档** - 详细的 MQTT 消息定义和说明 |
| `proto/messages.proto` | **协议定义** - Protobuf 消息结构源文件 |
| `runner.bat/sh` | **一键启动** - 自动化环境检测和服务启动 |

---

## 🔌 服务说明

### 1. MQTT 可视化服务（推荐）

**端口配置：**
- MQTT 端口: `3333`
- Web 界面: `2026`

**功能特性：**
- ✅ 实时 MQTT 消息收发
- ✅ 支持 20+ 消息类型（上行/下行）
- ✅ Web 界面可视化编辑和发送
- ✅ 自动消息序列化（Protobuf）
- ✅ 实时日志显示
- ✅ 支持自动发送（可配置频率）

**启动方式：**
```bash
# 使用启动器（推荐）
runner.bat        # Windows
./runner.sh       # Linux/Mac

# 或直接运行
npm run mqtt-visual
# 或
node js/mqtt-server-visual.js
```

**使用流程：**
1. 启动服务
2. 打开浏览器访问 http://127.0.0.1:2026
3. 在界面中选择要发送的消息类型
4. 填写字段数据
5. 点击"发送"或启用"自动发送"

---

### 2. UDP 视频流服务

**端口配置：**
- UDP 监听端口: `3334`

**功能特性：**
- ✅ 循环发送 HEVC (H.265) 格式视频流
- ✅ 支持分片传输（每帧多个 UDP 包）
- ✅ 包含帧序号、分片序号、总字节数
- ✅ 自动读取 `VideoSource/shark.h265` 文件

**启动方式：**
```bash
# 使用启动器
runner.bat → 选择 "2. 启动 UDP 视频流传输服务端"

# 或直接运行
npm run udp
# 或
node js/UDPserver.js
```

---

### 3. 随机数据 MQTT 服务

**端口配置：**
- MQTT 端口: `3333` ⚠️ （与可视化服务冲突，不可同时运行）

**功能特性：**
- ✅ 自动发送随机测试数据
- ✅ 用于压力测试和性能测试

**启动方式：**
```bash
runner.bat → 选择 "3. 启动随机数据 MQTT 服务端"
```

---

### 4. 双服务模式

同时启动 MQTT 可视化 + UDP 视频流服务，分别在两个独立窗口中运行。

**启动方式：**
```bash
runner.bat → 选择 "4. 启动双服务模式"
```

---

## 📡 UDP 数据格式

### UDP 包结构

每个 UDP 包由 **包头（8字节）** + **视频数据** 组成：

```
┌──────────────────────────────────────────────────────┐
│  包头 (8 bytes)            │  视频数据 (N bytes)    │
├────────┬────────┬───────────┼─────────────────────────┤
│ 帧编号 │ 分片号 │ 总字节数  │   HEVC 原始数据         │
│ 2 bytes│ 2 bytes│ 4 bytes   │   (分片后的部分)        │
└────────┴────────┴───────────┴─────────────────────────┘
```

### 字段说明

| 字段 | 类型 | 偏移 | 长度 | 说明 |
|------|------|------|------|------|
| 帧编号 | uint16 (BE) | 0 | 2 bytes | 当前帧序号（0-65535 循环） |
| 分片序号 | uint16 (BE) | 2 | 2 bytes | 当前分片在帧中的序号（从 0 开始） |
| 总字节数 | uint32 (BE) | 4 | 4 bytes | 该帧的总字节数 |
| 视频数据 | bytes | 8 | 变长 | HEVC 格式的视频原始数据分片 |

> **BE** = Big Endian（大端序）

### 分片策略

- **最大分片大小**: 1024 字节（视频数据部分）
- **完整包大小**: 1032 字节（8字节包头 + 1024字节数据）
- **分片逻辑**: 
  - 如果一帧 > 1024 字节，则分割成多个包
  - 最后一个包可能 < 1024 字节

### 接收端重组示例

```javascript
// UDP 包接收和重组示例
const frameBuffer = new Map(); // 存储帧数据

udpSocket.on('message', (msg, rinfo) => {
    // 解析包头
    const frameId = msg.readUInt16BE(0);      // 帧编号
    const chunkIndex = msg.readUInt16BE(2);   // 分片序号
    const totalBytes = msg.readUInt32BE(4);   // 总字节数
    const videoData = msg.slice(8);            // 视频数据
    
    // 存储分片
    if (!frameBuffer.has(frameId)) {
        frameBuffer.set(frameId, {
            chunks: [],
            totalBytes: totalBytes,
            receivedBytes: 0
        });
    }
    
    const frame = frameBuffer.get(frameId);
    frame.chunks[chunkIndex] = videoData;
    frame.receivedBytes += videoData.length;
    
    // 检查是否接收完整
    if (frame.receivedBytes === frame.totalBytes) {
        const completeFrame = Buffer.concat(frame.chunks);
        // 处理完整的 HEVC 帧
        decodeHEVCFrame(completeFrame);
        frameBuffer.delete(frameId);
    }
});
```

### 视频格式

- **编码格式**: HEVC (H.265)
- **文件扩展名**: `.h265` 或 `.hevc`
- **默认视频**: `VideoSource/shark.h265`
- **发送频率**: 约 30 FPS（可调整）

---

## 📨 MQTT 协议说明

### 协议基础

- **传输格式**: Protocol Buffers v3（二进制）
- **传输协议**: MQTT over TCP
- **服务器地址**: `127.0.0.1:3333` (开发环境)
- **Topic 命名**: 与 Protobuf Message 名称一致
- **QoS 等级**: 主要使用 QoS 1（至少一次送达）

### 消息分类

#### 📤 上行消息（客户端 → 服务器）

客户端发布（Publish）以下消息来控制机器人或发送指令：

| 消息类型 | Topic | 频率 | 说明 |
|---------|-------|------|------|
| `RemoteControl` | RemoteControl | 75Hz | 鼠标键盘输入 |
| `MapClickInfoNotify` | MapClickInfoNotify | 触发 | 地图点击标记 |
| `AssemblyCommand` | AssemblyCommand | 1Hz | 工程装配指令 |
| `RobotPerformanceSelectionCommand` | RobotPerformanceSelectionCommand | 1Hz | 性能体系选择 |
| `HeroDeployModeEventCommand` | HeroDeployModeEventCommand | 1Hz | 英雄部署模式 |
| `RuneActivateCommand` | RuneActivateCommand | 1Hz | 能量机关激活 |
| `DartCommand` | DartCommand | 1Hz | 飞镖控制 |
| `GuardCtrlCommand` | GuardCtrlCommand | 1Hz | 哨兵控制 |
| `CustomByteBlock` | CustomByteBlock | 50Hz | 自定义字节块 |

#### 📥 下行消息（服务器 → 客户端）

客户端订阅（Subscribe）以下消息来获取比赛状态：

| 消息类型 | Topic | 频率 | 说明 |
|---------|-------|------|------|
| `GameStatus` | GameStatus | 5Hz | 比赛状态（时间、阶段） |
| `GlobalStatistics` | GlobalStatistics | 1Hz | 全局统计数据 |
| `GlobalLogisticsStatus` | GlobalLogisticsStatus | 1Hz | 后勤信息 |
| `GlobalSpecialMechanism` | GlobalSpecialMechanism | 1Hz | 全局特殊机制 |
| `Event` | Event | 触发 | 全局事件通知 |
| `RobotInjuryStat` | RobotInjuryStat | 1Hz | 受伤统计 |
| `RobotRespawnStatus` | RobotRespawnStatus | 1Hz | 复活状态 |
| `RobotStaticStatus` | RobotStaticStatus | 1Hz | 固定属性 |
| `RobotDynamicStatus` | RobotDynamicStatus | 10Hz | 实时数据 |
| `DeployModeStatusSync` | DeployModeStatusSync | 1Hz | 部署模式状态 |
| `TechCoreMotionStateSync` | TechCoreMotionStateSync | 1Hz | 科技核心运动状态 |

### 消息示例

#### 示例 1: RemoteControl（遥控器输入）

**Protobuf 定义：**
```protobuf
message RemoteControl {
    int32 mouse_x = 1;              // 鼠标 X 轴速度
    int32 mouse_y = 2;              // 鼠标 Y 轴速度
    int32 mouse_z = 3;              // 鼠标滚轮
    bool left_button_down = 4;      // 左键状态
    bool right_button_down = 5;     // 右键状态
    uint32 keyboard_value = 6;      // 键盘位掩码
    bool mid_button_down = 7;       // 中键状态
    bytes data = 8;                 // 自定义数据（最多30字节）
}
```

**JavaScript 发送示例：**
```javascript
const mqtt = require('mqtt');
const protobuf = require('protobufjs');

// 加载 Protobuf 定义
const root = await protobuf.load('proto/messages.proto');
const RemoteControl = root.lookupType('RemoteControl');

// 连接 MQTT
const client = mqtt.connect('mqtt://127.0.0.1:3333');

client.on('connect', () => {
    // 创建消息
    const message = RemoteControl.create({
        mouse_x: 100,
        mouse_y: -50,
        mouse_z: 0,
        left_button_down: true,
        right_button_down: false,
        keyboard_value: 0x0001,  // W 键
        mid_button_down: false,
        data: Buffer.from([0x01, 0x02, 0x03])
    });
    
    // 序列化为二进制
    const buffer = RemoteControl.encode(message).finish();
    
    // 发布到 MQTT
    client.publish('RemoteControl', buffer, { qos: 1 });
});
```

#### 示例 2: GameStatus（比赛状态）

**Protobuf 定义：**
```protobuf
message GameStatus {
    uint32 game_type = 1;           // 比赛类型
    uint32 game_stage = 2;          // 比赛阶段
    uint32 remaining_time = 3;      // 剩余时间（秒）
    uint64 unix_time = 4;           // UNIX 时间戳
}
```

**JavaScript 接收示例：**
```javascript
const mqtt = require('mqtt');
const protobuf = require('protobufjs');

// 加载 Protobuf 定义
const root = await protobuf.load('proto/messages.proto');
const GameStatus = root.lookupType('GameStatus');

// 连接 MQTT
const client = mqtt.connect('mqtt://127.0.0.1:3333');

client.on('connect', () => {
    // 订阅消息
    client.subscribe('GameStatus', { qos: 1 });
});

client.on('message', (topic, message) => {
    if (topic === 'GameStatus') {
        // 反序列化
        const gameStatus = GameStatus.decode(message);
        
        console.log('比赛状态:', {
            类型: gameStatus.game_type,
            阶段: gameStatus.game_stage,
            剩余时间: gameStatus.remaining_time + '秒',
            时间戳: new Date(Number(gameStatus.unix_time) * 1000)
        });
    }
});
```

---

## 💡 使用示例

### 场景 1: 开发客户端控制程序

1. 启动 MQTT 可视化服务
```bash
runner.bat  # 选择 "1. 启动 MQTT 可视化服务端"
```

2. 打开浏览器访问 http://127.0.0.1:2026

3. 在 Web 界面测试发送 `RemoteControl` 消息

4. 在你的客户端程序中订阅消息：
```javascript
// 订阅所有下行消息
const topics = [
    'GameStatus',
    'GlobalStatistics',
    'RobotDynamicStatus',
    // ... 其他需要的消息
];

topics.forEach(topic => {
    client.subscribe(topic, { qos: 1 });
});
```

---

### 场景 2: 测试视频接收功能

1. 启动 UDP 视频流服务
```bash
runner.bat  # 选择 "2. 启动 UDP 视频流传输服务端"
```

2. 编写 UDP 接收程序：
```javascript
const dgram = require('dgram');
const server = dgram.createSocket('udp4');

const frameBuffer = new Map();

server.on('message', (msg, rinfo) => {
    const frameId = msg.readUInt16BE(0);
    const chunkIndex = msg.readUInt16BE(2);
    const totalBytes = msg.readUInt32BE(4);
    const videoData = msg.slice(8);
    
    console.log(`收到帧 ${frameId} 的第 ${chunkIndex} 个分片`);
    
    // 重组逻辑...
});

server.bind(3334, '127.0.0.1');
console.log('UDP 客户端监听 127.0.0.1:3334');
```

---

### 场景 3: 完整模拟环境

1. 启动双服务模式
```bash
runner.bat  # 选择 "4. 启动双服务模式"
```

2. 同时测试 MQTT 和 UDP 功能

3. 使用 Web 界面 (http://127.0.0.1:2026) 调试 MQTT 消息

4. 使用你的客户端程序接收 UDP 视频流

---

## ❓ 常见问题

### Q1: 启动器提示"未检测到 Node.js"

**A:** 请先安装 Node.js (>= 14.0.0)
- Windows: 下载 https://nodejs.org/ 并安装
- Linux: `sudo apt install nodejs npm` (Ubuntu/Debian)
- Mac: `brew install node` (需要 Homebrew)

安装后重启终端，运行 `node --version` 验证。

---

### Q2: MQTT 可视化服务和随机数据服务能同时运行吗？

**A:** 不能。两者都使用端口 3333，会冲突。

**解决方案：**
- 开发调试时使用"MQTT 可视化服务"（推荐）
- 压力测试时使用"随机数据服务"
- 或修改其中一个服务的端口号

---

### Q3: UDP 视频流没有数据？

**A:** 检查以下几点：

1. **视频文件是否存在**：确认 `VideoSource/shark.h265` 文件存在
2. **端口是否被占用**：
   ```bash
   # Windows
   netstat -ano | findstr 3334
   
   # Linux/Mac
   lsof -i :3334
   ```
3. **防火墙是否拦截**：临时关闭防火墙测试
4. **客户端地址是否正确**：确保监听 `127.0.0.1:3334`

---

### Q4: Web 界面打不开 (http://127.0.0.1:2026)

**A:** 

1. **确认服务已启动**：终端应显示"Web 界面: http://127.0.0.1:2026"
2. **检查端口占用**：
   ```bash
   # Windows
   netstat -ano | findstr 2026
   ```
3. **清除浏览器缓存**：按 Ctrl+Shift+Delete 清除缓存
4. **尝试其他浏览器**：Chrome、Firefox、Edge

---

### Q5: Protobuf 消息序列化失败？

**A:** 

1. **重新编译 Protobuf**：
   ```bash
   npm run proto
   ```
   这会重新生成 `proto/messages.js` 和 `proto/messages.d.ts`

2. **检查字段类型**：确保字段值符合 Protobuf 定义
   - `int32` 范围: -2,147,483,648 ~ 2,147,483,647
   - `uint32` 范围: 0 ~ 4,294,967,295
   - `bool`: true 或 false
   - `bytes`: Buffer 对象

---

### Q6: 如何修改视频源？

**A:** 

1. 准备 HEVC (H.265) 格式的视频文件
2. 将文件放入 `VideoSource/` 目录
3. 修改 `js/udp-video-streamer.js` 中的文件路径：
   ```javascript
   const videoPath = path.join(__dirname, '..', 'VideoSource', 'your-video.h265');
   ```
4. 重启 UDP 服务

---

### Q7: 如何调整消息发送频率？

**A:** 

**方法一：在 Web 界面调整**
1. 启动 MQTT 可视化服务
2. 打开 http://127.0.0.1:2026
3. 找到对应消息，勾选"自动发送"
4. 修改频率值（单位：Hz）

**方法二：修改代码**
1. 编辑 `js/mqtt-server-visual.js`
2. 找到 `messageDefaultFrequencies` 对象
3. 修改对应消息的频率值

---

### Q8: 如何查看完整的协议文档？

**A:** 

查看 `docs/Protocol.md` 文件，包含：
- 所有消息类型的详细字段说明
- 枚举值定义
- 频率和 QoS 要求
- 特殊机制说明

或访问 Protobuf 定义文件：`proto/messages.proto`

---

### Q9: 端口被占用怎么办？

**A:** 

**查找占用进程：**
```bash
# Windows
netstat -ano | findstr 3333   # MQTT
netstat -ano | findstr 2026   # Web
netstat -ano | findstr 3334   # UDP

# Linux/Mac
lsof -i :3333
lsof -i :2026
lsof -i :3334
```

**解决方案：**
1. 关闭占用端口的程序
2. 或修改服务器端口配置（不推荐，需同步修改客户端）

---

### Q10: 如何停止服务？

**A:** 

- **启动器启动的服务**：按 `Ctrl+C` 停止
- **双服务模式**：分别关闭两个窗口
- **后台运行的服务**：
  ```bash
  # Linux/Mac (如果使用了 nohup)
  ps aux | grep node
  kill <PID>
  ```

---

## 📞 技术支持

- **协议文档**: [docs/Protocol.md](docs/Protocol.md)
- **Protobuf 定义**: [proto/messages.proto](proto/messages.proto)
- **脚本说明**: [scripts/README.md](scripts/README.md)
- **代码说明**: [js/README.md](js/README.md)

---

## 📄 许可证

ISC License

---

## 👥 贡献者

**江南大学霞客湾校区 MeroT 制作**

---

## 🔄 更新日志

### v2.0.0 (2025-11-30)
- ✨ 新增 MQTT 可视化 Web 界面
- ✨ 重构项目结构（js/、scripts/ 目录）
- ✨ 添加跨平台启动器（runner.bat/sh）
- ✨ 完善协议文档和使用说明
- 🐛 修复 UDP 分片逻辑
- 🐛 修复端口配置问题

### v1.0.0
- 🎉 初始版本
- ✅ UDP 视频流传输
- ✅ MQTT 随机数据发送

---

**Happy Coding! 🚀**
