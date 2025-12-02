# 图片块协议使用说明

## 概述

本SDK支持在自定义数据块中传输图片数据，采用**双模式发送机制**：
- **有图片模式**：发送包含ImageBlock字段的完整帧（仍满足150字节要求）
- **无图片模式**：发送仅包含其他数据字段的纯数据帧（仍满足150字节要求）

## 协议设计

### 1. ImageBlock 结构（128字节）

ImageBlock 嵌入在外层自定义数据块协议中，**复用外层的 SOF 和 CRC16 保护**，避免冗余校验：

```c
typedef struct {
    uint8_t cmd_type;         // 命令类型 (0x02=数据块, 0x03=结束帧)
    uint16_t img_id;          // 图片ID (唯一标识)
    uint16_t block_idx;       // 当前块索引 (从0开始)
    uint16_t total_block;     // 总块数
    uint8_t data_len;         // 有效数据长度 (1-120, 其余填0)
    uint8_t data[120];        // 数据块 (120字节)
} ImageBlock_t;  // 总计 128 字节
```

**优化说明：**
- ✅ 移除了独立的 SOF (0xA5) - 外层协议已提供
- ✅ 移除了独立的 CRC16 - 外层协议的 CRC16 保护整个 150 字节
- ✅ 节省 3 字节空间 (从 131→128 字节)
- ✅ 伴随数据可用空间增加到 **22 字节** (150 - 128)

### 2. 双模式发送函数

#### 模式A：包含图片（CustomDataWithImage_Pack）
```c
// 填充伴随数据（如温度、速度等）
CustomDataWithImage_t data = {0};
data.temperature = 36.5;
data.speed = 120;

// 填充图片块（使用 ImageBlock_Fill 而不是 ImageBlock_Pack）
ImageBlock_Fill(&data.image_block, 
                img_id, block_idx, total_blocks, 
                img_buffer, data_len, is_end);

// 打包发送（包含所有字段 + ImageBlock，满足150字节）
CustomDataWithImage_Write(&data);
uint8_t *frame = CustomDataWithImage_Pack(seq);
HAL_UART_Transmit(&huart1, frame, CustomData_GetFrameSize(), 100);
```

#### 模式B：不含图片（CustomData_Pack）
```c
// 填充数据结构（仅普通数据字段）
CustomData_t data = {0};
data.temperature = 36.5;
data.speed = 120;
// 无 image_block 字段

// 打包发送（仅其他字段，满足150字节）
CustomData_Write(&data);
uint8_t *frame = CustomData_Pack(seq);
HAL_UART_Transmit(&huart1, frame, CustomData_GetFrameSize(), 100);
```

**关键变化：**
- 函数名更新：`CustomData_PackWithImage` → `CustomDataWithImage_Pack`
- 函数名更新：`CustomData_PackWithoutImage` → `CustomData_Pack`
- ImageBlock 函数：`ImageBlock_Pack` → `ImageBlock_Fill` (不再计算 CRC)
- 结构体分离：`CustomData_t` (无图片) 和 `CustomDataWithImage_t` (含图片)

## Proto文件定义

Proto文件包含完整的字段定义（包括ImageBlock），客户端会根据实际数据自动匹配：

```protobuf
syntax = "proto3";

// 图片块协议消息定义 (128字节，无独立SOF和CRC)
message ImageBlock {
    fixed32 cmd_type = 1;      // 命令类型 (1B)
    fixed32 img_id = 2;        // 图片ID (2B)
    fixed32 block_idx = 3;     // 当前块索引 (2B)
    fixed32 total_block = 4;   // 总块数 (2B)
    fixed32 data_len = 5;      // 有效数据长度 (1B)
    bytes data = 6;            // 数据块 (120B)
}

message CustomByteBlock {
    float temperature = 1;
    uint32 speed = 2;
    ImageBlock image_block = 3;  // 可选字段
    bytes _padding = 4;  // 填充到150字节
}
```

### Protobuf动态解析特性
- ✅ **字段缺失兼容**：如果某个字段未填充（全0），Protobuf会使用默认值
- ✅ **可选语义**：ImageBlock字段可以存在也可以不存在
- ✅ **客户端自动匹配**：解析器会根据实际数据动态匹配字段

## 使用场景

### 场景1：发送图片流
```c
// 分块发送图片
for (int i = 0; i < total_blocks; i++) {
    CustomDataWithImage_t data = {0};
    data.temperature = get_temperature();  // 同时发送传感器数据
    
    ImageBlock_Fill(&data.image_block, 
                    img_id, i, total_blocks,
                    img_buffer + i * 120, 
                    (i == total_blocks - 1) ? last_len : 120,
                    (i == total_blocks - 1));
    
    CustomDataWithImage_Write(&data);
    uint8_t *frame = CustomDataWithImage_Pack(seq++);
    send_uart(frame, CustomData_GetFrameSize());
    delay_ms(10);
}
```

### 场景2：仅发送传感器数据
```c
// 无图片时使用CustomData_Pack
CustomData_t data = {0};
data.temperature = get_temperature();
data.speed = get_speed();

CustomData_Write(&data);
uint8_t *frame = CustomData_Pack(seq++);
send_uart(frame, CustomData_GetFrameSize());
```

## 优势

1. **灵活性**：根据需要动态选择是否发送图片
2. **协议统一**：两种模式都满足150字节要求
3. **Proto兼容**：客户端无需修改，自动适配
4. **内存优化**：`CustomData_t` 不包含 ImageBlock，节省 128 字节静态内存
5. **消除冗余**：移除 ImageBlock 独立的 SOF 和 CRC，节省 3 字节，依赖外层保护
4. **DMA友好**：固定131字节的ImageBlock结构，适合DMA接收
5. **带宽优化**：无图片时不占用ImageBlock的131字节空间

## 注意事项

1. **函数选择**：
   - 有图片数据时调用 `CustomData_PackWithImage()`
   - 无图片数据时调用 `CustomData_PackWithoutImage()`

2. **150字节保证**：
   - 两种模式都严格遵守150字节数据段要求
   - PackWithoutImage会将ImageBlock位置填充为0

3. **CRC校验**：
   - ImageBlock内部有自己的CRC16（针对131字节帧）
   - 整个CustomData帧也有CRC16（针对159字节帧）

4. **客户端解析**：
   - 客户端使用完整的Proto定义
   - 如果ImageBlock全为0，Protobuf会将其视为未设置
   - 应用层可以通过检查img_id或cmd_type判断是否有有效图片数据

## 示例：完整的图片传输流程

```c
// 1. 准备发送图片
uint8_t image_buffer[10000];  // 假设图片10KB
uint16_t img_size = 10000;
uint16_t img_id = get_unique_id();
uint16_t total_blocks = (img_size + 119) / 120;

// 2. 分块发送
for (uint16_t i = 0; i < total_blocks; i++) {
    CustomData_t data = {0};
    
    // 填充传感器数据（可选）
    data.temperature = get_temperature();
    
    // 计算当前块的数据长度
    uint16_t offset = i * 120;
    uint8_t len = (i == total_blocks - 1) ? (img_size - offset) : 120;
    
    // 打包图片块
    ImageBlock_Pack(&data.image_data, 
                    img_id, i, total_blocks,
                    image_buffer + offset, len,
                    (i == total_blocks - 1));
    
    // 发送（使用PackWithImage）
    CustomData_Write(&data);
    uint8_t *frame = CustomData_PackWithImage(seq++);
    HAL_UART_Transmit(&huart1, frame, CustomData_GetFrameSize(), 100);
    
    delay_ms(10);  // 防止缓冲区溢出
}

// 3. 发送结束帧
CustomData_t end_data = {0};
ImageBlock_Pack(&end_data.image_data, 
                img_id, total_blocks, total_blocks,
                NULL, 0, 1);  // is_end = 1

CustomData_Write(&end_data);
uint8_t *end_frame = CustomData_PackWithImage(seq++);
HAL_UART_Transmit(&huart1, end_frame, CustomData_GetFrameSize(), 100);
```

## 常见问题

**Q: 为什么要分成两个Pack函数？**  
A: 因为ImageBlock占用131字节，当没有图片时，如果也发送ImageBlock会浪费带宽。两个函数允许灵活选择。

**Q: Proto文件中包含ImageBlock，客户端会不会解析错误？**  
A: 不会。Protobuf的可选字段特性允许字段缺失。PackWithoutImage发送的帧中ImageBlock位置全为0，客户端会将其视为未设置。

**Q: 如何在客户端判断是否有有效图片？**  
A: 检查ImageBlock的关键字段：
```javascript
if (data.image_data && data.image_data.img_id !== 0) {
    // 有有效图片数据
}
```

**Q: 两个Pack函数的帧长度一样吗？**  
A: 是的，都是159字节（帧头5B + CMD_ID 2B + 数据150B + CRC16 2B）。

**Q: PackWithoutImage是否会导致150字节不足？**  
A: 不会。生成时已经考虑了_padding字段，确保总是150字节。
