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
- [自定义数据块 SDK](#-自定义数据块-sdk)
- [ImageBlock 图片传输协议](#-imageblock-图片传输协议)
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
✅ **SDK 生成** - 自动生成 STM32/ARM 嵌入式 C SDK  
✅ **图片传输** - 支持 ImageBlock 协议，128 字节高效图片分块传输  

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
│   ├── Protocol.md            # MQTT 协议详细说明（完整版）
│   ├── ImageBlock_Usage.md    # 图片块协议使用指南
│   └── ImageBlock_UI_Guide.md # 图片块 UI 配置说明
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
├── frontend/                  # 🎨 前端配置界面
│   ├── src/
│   │   └── components/
│   │       └── CustomDataConfig.ts   # 自定义数据块配置组件
│   ├── dist/                         # 编译输出目录
│   └── tsconfig.json                 # TypeScript 配置
│
├── sdk/                       # 🔧 生成的 C SDK 输出目录
│   ├── <配置名>/
│   │   ├── custom_data.h             # 数据结构定义
│   │   ├── custom_data.c             # 函数实现
│   │   └── messages.proto            # Proto 定义文件
│   └── ...
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
- ✅ 自动读取 `VideoSource`中的文件

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
- **文件扩展名**: 支持主流格式自动识别并转码HEVC
- **默认视频**: `VideoSource中的视频`
- **发送频率**: 自适应视频帧率发送

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

## 🛠️ 自定义数据块 SDK

### 功能概述

本系统提供**可视化配置界面**和**自动 SDK 生成**功能，用于快速创建符合 RoboMaster 协议的自定义数据块。

**核心优势：**
- ✅ **零代码配置** - Web 界面拖拽式配置，无需手写代码
- ✅ **自动生成** - 生成 C/Proto 代码，包含完整的打包、校验和 CRC 计算
- ✅ **双结构设计** - 自动区分含图片和不含图片的数据结构，优化内存占用
- ✅ **类型安全** - 自动生成类型定义和校验函数
- ✅ **150字节保证** - 自动计算并验证数据大小，确保符合协议要求

### 使用流程

#### 1. 启动 MQTT 可视化服务

```bash
# Windows
runner.bat  # 选择 "1. 启动 MQTT 可视化服务端"

# Linux/Mac
./runner.sh
```

访问 http://127.0.0.1:2026，在界面上方找到"自定义数据块配置"选项卡。

#### 2. 配置数据字段

**支持的数据类型：**
| 类型 | 大小 | 说明 | 示例 |
|------|------|------|------|
| `uint8` | 1B | 无符号 8 位整数 | 0-255 |
| `int8` | 1B | 有符号 8 位整数 | -128~127 |
| `uint16` | 2B | 无符号 16 位整数 | 0-65535 |
| `int16` | 2B | 有符号 16 位整数 | -32768~32767 |
| `uint32` | 4B | 无符号 32 位整数 | 温度、速度 |
| `int32` | 4B | 有符号 32 位整数 | 位置坐标 |
| `float` | 4B | 单精度浮点数 | 36.5 |
| `double` | 8B | 双精度浮点数 | 高精度测量 |
| `bytes` | 自定义 | 字节数组 | 原始数据 |
| `image_block` | 128B | 图片块协议 | 图片传输 |

**配置示例：**
```
配置名称: 步兵
字段列表:
  - 名称: temperature, 类型: float
  - 名称: speed, 类型: uint32
  - 名称: position_x, 类型: int32
  - 名称: position_y, 类型: int32
  - 名称: image_block, 类型: image_block (可选)
```

#### 3. 生成 SDK

点击"生成 SDK"按钮，系统会自动生成：

```
sdk/步兵/
├── custom_data.h          # 数据结构定义
├── custom_data.c          # 函数实现
└── messages.proto         # Protobuf 定义
```

#### 4. 使用生成的 SDK

**无图片模式（纯数据）：**
```c
#include "custom_data.h"

// 定义数据
CustomData_t data = {0};
data.temperature = 36.5f;
data.speed = 120;
data.position_x = 1000;
data.position_y = -500;

// 打包发送（159字节完整帧）
CustomData_Write(&data);
uint8_t *frame = CustomData_Pack(seq++);
HAL_UART_Transmit(&huart1, frame, 159, 100);
```

**有图片模式：**
```c
#include "custom_data.h"

// 定义含图片的数据
CustomDataWithImage_t data = {0};
data.temperature = 36.5f;
data.speed = 120;

// 填充图片块（128字节）
ImageBlock_Fill(&data.image_block, 
                img_id, block_idx, total_blocks,
                img_buffer, data_len, is_end);

// 打包发送（159字节完整帧）
CustomDataWithImage_Write(&data);
uint8_t *frame = CustomDataWithImage_Pack(seq++);
HAL_UART_Transmit(&huart1, frame, 159, 100);
```

### 生成代码特性

生成的 C SDK 包含以下功能：

1. **自动 CRC 计算** - 内置 CRC8 (DNP) 和 CRC16 (XMODEM) 查找表
2. **帧结构封装** - 自动添加 SOF (0xA5)、CMD_ID (0x0302)、序列号、CRC16
3. **内存优化** - 使用静态缓冲区，避免动态分配
4. **双结构支持** - `CustomData_t` (不含图片) 和 `CustomDataWithImage_t` (含图片)
5. **字节序处理** - 自动处理大小端转换
6. **完整注释** - 中文注释，易于理解和维护

---

## 🖼️ ImageBlock 图片传输协议

### 协议设计

ImageBlock 是嵌入在自定义数据块中的图片分块传输协议，**复用外层的 SOF 和 CRC16 保护**，消除冗余校验。

**结构定义（128 字节）：**
```c
typedef struct {
    uint8_t cmd_type;         // 命令类型 (0x02=数据块, 0x03=结束帧)
    uint16_t img_id;          // 图片ID (唯一标识)
    uint16_t block_idx;       // 当前块索引 (从0开始)
    uint16_t total_block;     // 总块数
    uint8_t data_len;         // 有效数据长度 (1-120字节)
    uint8_t data[120];        // 数据块 (不足部分填0)
} ImageBlock_t;  // 总计 128 字节
```

**设计优势：**
- ✅ **消除冗余** - 移除独立的 SOF 和 CRC16，从 131B 优化到 128B
- ✅ **节省空间** - 伴随数据可用空间增加到 **22 字节** (150 - 128)
- ✅ **分层保护** - 依赖外层协议的完整性校验
- ✅ **定长设计** - 适合 DMA 接收，无需动态内存分配

### 传输流程

**1. 图片分块**
```c
// 假设图片大小为 5000 字节
uint16_t total_blocks = (image_size + 119) / 120;  // 向上取整
uint16_t img_id = generate_unique_id();            // 生成唯一ID

for (uint16_t i = 0; i < total_blocks; i++) {
    uint8_t data_len = (i == total_blocks - 1) 
                       ? (image_size % 120) 
                       : 120;
    
    CustomDataWithImage_t data = {0};
    data.temperature = get_temperature();  // 伴随数据
    
    ImageBlock_Fill(&data.image_block,
                    img_id, i, total_blocks,
                    image_buffer + i * 120, data_len, 
                    (i == total_blocks - 1));  // 最后一块设置结束标志
    
    CustomDataWithImage_Write(&data);
    uint8_t *frame = CustomDataWithImage_Pack(seq++);
    send_uart(frame, 159);
    delay_ms(10);  // 避免拥塞
}
```

**2. 客户端重组**
```javascript
// Protobuf 定义
message ImageBlock {
    fixed32 cmd_type = 1;      // 1B
    fixed32 img_id = 2;        // 2B
    fixed32 block_idx = 3;     // 2B
    fixed32 total_block = 4;   // 2B
    fixed32 data_len = 5;      // 1B
    bytes data = 6;            // 120B
}

// 接收和重组
const imageBuffers = new Map();

client.on('message', (topic, message) => {
    const customData = CustomByteBlock.decode(message);
    
    if (customData.image_block) {
        const block = customData.image_block;
        const imgId = block.img_id;
        
        if (!imageBuffers.has(imgId)) {
            imageBuffers.set(imgId, {
                blocks: new Array(block.total_block),
                received: 0
            });
        }
        
        const imgData = imageBuffers.get(imgId);
        imgData.blocks[block.block_idx] = Buffer.from(block.data).slice(0, block.data_len);
        imgData.received++;
        
        // 检查是否接收完整
        if (imgData.received === block.total_block || block.cmd_type === 0x03) {
            const completeImage = Buffer.concat(imgData.blocks);
            saveImage(imgId, completeImage);
            imageBuffers.delete(imgId);
        }
    }
});
```

### 伴随数据配置

在配置界面中，当选择 `image_block` 类型时，会显示**独立的伴随数据配置面板**：

**可用空间：22 字节**（150 - 128）

**示例配置：**
```
图片块伴随数据:
  - temperature (float, 4B)   - 当前温度
  - speed (uint16, 2B)        - 当前速度
  - status (uint8, 1B)        - 状态标志
总计: 7 字节 / 22 字节
```

**生成的结构：**
```c
// 不含图片的数据结构（纯数据）
typedef struct {
    float temperature;
    uint16_t speed;
    uint8_t status;
    uint8_t _padding[143];  // 填充到 150 字节
} CustomData_t;

// 含图片的数据结构
typedef struct {
    float temperature;      // 伴随数据
    uint16_t speed;
    uint8_t status;
    ImageBlock_t image_block;  // 128 字节
    uint8_t _padding[15];   // 填充到 150 字节
} CustomDataWithImage_t;
```

### 完整文档

详细使用说明请参考：
- **协议文档**: [docs/ImageBlock_Usage.md](docs/ImageBlock_Usage.md)
- **UI 配置**: [docs/ImageBlock_UI_Guide.md](docs/ImageBlock_UI_Guide.md)

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

### 场景 4: 生成自定义数据块 SDK

1. 启动 MQTT 可视化服务
```bash
runner.bat  # 选择 "1. 启动 MQTT 可视化服务端"
```

2. 访问 http://127.0.0.1:2026，切换到"自定义数据块配置"选项卡

3. 配置数据字段：
```
配置名称: 哨兵
字段:
  - name: temperature, type: float
  - name: yaw_angle, type: int16
  - name: pitch_angle, type: int16
  - name: ammo_count, type: uint16
  - name: image_block, type: image_block
```

4. 点击"生成 SDK"，在 `sdk/哨兵/` 目录获取生成的代码

5. 在 STM32 项目中使用：
```c
#include "custom_data.h"

// 发送传感器数据（无图片）
void send_sensor_data(void) {
    CustomData_t data = {0};
    data.temperature = get_temperature();
    data.yaw_angle = get_yaw();
    data.pitch_angle = get_pitch();
    data.ammo_count = get_ammo();
    
    CustomData_Write(&data);
    uint8_t *frame = CustomData_Pack(seq++);
    HAL_UART_Transmit(&huart1, frame, 159, 100);
}

// 发送图片数据
void send_image_with_data(uint8_t *img_buf, uint32_t img_size) {
    uint16_t total_blocks = (img_size + 119) / 120;
    uint16_t img_id = generate_image_id();
    
    for (uint16_t i = 0; i < total_blocks; i++) {
        CustomDataWithImage_t data = {0};
        data.temperature = get_temperature();
        data.yaw_angle = get_yaw();
        data.pitch_angle = get_pitch();
        data.ammo_count = get_ammo();
        
        uint8_t len = (i == total_blocks - 1) 
                      ? (img_size % 120) : 120;
        
        ImageBlock_Fill(&data.image_block,
                        img_id, i, total_blocks,
                        img_buf + i * 120, len,
                        (i == total_blocks - 1));
        
        CustomDataWithImage_Write(&data);
        uint8_t *frame = CustomDataWithImage_Pack(seq++);
        HAL_UART_Transmit(&huart1, frame, 159, 100);
        HAL_Delay(10);
    }
}
```

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

1. **视频文件是否存在**：确认 `VideoSource` 文件夹下有视频存在
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

1. 准备主流格式的视频文件
2. 将文件放入 `VideoSource/` 目录
3. 重启 UDP 服务

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

### Q11: 自定义数据块超过 150 字节怎么办？

**A:** 

系统会**自动校验**并阻止超过 150 字节的配置：

1. **实时计算**：界面会实时显示已用空间
2. **自动提示**：超过限制时显示红色警告
3. **优化建议**：
   - 使用更小的数据类型（如 `uint8` 代替 `uint32`）
   - 移除不必要的字段
   - 使用 `image_block` 时注意伴随数据限制（最多 22 字节）

**示例：**
```
❌ 错误配置（超过 150 字节）:
- data1: bytes[100]
- data2: bytes[60]
总计: 160 字节 > 150 字节 限制

✅ 正确配置:
- data1: bytes[100]
- data2: bytes[40]
- extra: uint32
总计: 144 字节 < 150 字节
```

---

### Q12: 生成的 SDK 代码在哪里？

**A:** 

生成的代码位于 `sdk/<配置名>/` 目录：

```
sdk/
├── 步兵/
│   ├── custom_data.h
│   ├── custom_data.c
│   └── messages.proto
├── 哨兵/
│   ├── custom_data.h
│   ├── custom_data.c
│   └── messages.proto
└── ...
```

**使用方法：**
1. 将 `custom_data.h` 和 `custom_data.c` 复制到 STM32 项目
2. 在代码中 `#include "custom_data.h"`
3. 调用 `CustomData_Pack()` 或 `CustomDataWithImage_Pack()` 函数

---

### Q13: ImageBlock 和普通字段有什么区别？

**A:** 

**ImageBlock (128 字节固定大小)：**
- ✅ 专用于图片分块传输
- ✅ 自动生成 `CustomDataWithImage_t` 结构
- ✅ 包含分块元数据（img_id、block_idx、total_block 等）
- ✅ 可配置伴随数据（最多 22 字节）

**普通字段：**
- ✅ 用于传感器数据、状态信息等
- ✅ 灵活配置大小和类型
- ✅ 最多可用 150 字节

**推荐配置：**
```
含图片配置:
  - image_block (128B)
  - temperature (4B)
  - speed (2B)
  总计: 134B / 150B

纯数据配置:
  - temperature (4B)
  - speed (4B)
  - position_x (4B)
  - position_y (4B)
  - sensor_data: bytes[100]
  总计: 116B / 150B
```

---

### Q14: 如何更新已生成的 SDK？

**A:** 

1. **修改配置**：在 Web 界面修改字段
2. **重新生成**：点击"生成 SDK"按钮
3. **覆盖文件**：系统会自动覆盖 `sdk/<配置名>/` 目录下的文件
4. **更新项目**：将新生成的 `.h` 和 `.c` 文件复制到 STM32 项目

**注意事项：**
- ⚠️ 修改字段顺序会影响数据解析
- ⚠️ 建议保持字段名和类型一致
- ⚠️ 重大修改时建议创建新配置名

---

### Q15: TypeScript 编译失败怎么办？

**A:** 

如果修改了 `frontend/src/components/CustomDataConfig.ts`：

```bash
# 重新编译
npx tsc

# 或使用 watch 模式（自动编译）
npx tsc --watch
```

**常见错误：**
1. **语法错误**：检查 TypeScript 语法
2. **类型错误**：确保变量类型正确
3. **模块找不到**：运行 `npm install` 安装依赖

---

## 📞 技术支持

- **协议文档**: [docs/Protocol.md](docs/Protocol.md)
- **ImageBlock 使用指南**: [docs/ImageBlock_Usage.md](docs/ImageBlock_Usage.md)
- **ImageBlock UI 说明**: [docs/ImageBlock_UI_Guide.md](docs/ImageBlock_UI_Guide.md)
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

### v2.1.0 (2025-12-02)
- ✨ **新增自定义数据块 SDK 生成功能**
  - Web 可视化配置界面
  - 自动生成 C/Proto 代码
  - 支持 10+ 数据类型
- ✨ **新增 ImageBlock 图片传输协议**
  - 128 字节优化设计（移除冗余 SOF 和 CRC）
  - 双结构支持（CustomData_t / CustomDataWithImage_t）
  - 22 字节伴随数据空间
  - 独立配置面板
- ✨ **内存优化**
  - 分离含图片和不含图片的数据结构
  - 节省 128 字节静态内存（无图片时）
- 📚 **完善文档**
  - ImageBlock 使用指南
  - ImageBlock UI 配置说明
  - 更新 README

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
