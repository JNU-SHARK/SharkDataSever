# 矢量化传输模式使用指南

## 概述

矢量化传输模式是一种高效的图像边缘数据传输方式，相比传统的位图传输，可以极大地减少数据量。

## 工作原理

1. **LoG边缘检测**: 使用高斯拉普拉斯算子(Laplacian of Gaussian)检测图像边缘
2. **二值化**: 使用Otsu自动阈值法将边缘转为二值图
3. **线条提取**: 通过8-连通分量分析提取线条
4. **端点记录**: 只保存每条线段的起点和终点坐标
5. **压缩传输**: 传输线段端点而非完整位图

## 数据格式

### 矢量数据编码格式

```
[Header: 6字节]
  - width: 2字节 (uint16_t, 大端序) - 原始图像宽度
  - height: 2字节 (uint16_t, 大端序) - 原始图像高度  
  - lineCount: 2字节 (uint16_t, 大端序) - 线段数量

[Line Data: lineCount × 8字节]
每条线段 8 字节:
  - x1: 2字节 (uint16_t, 大端序) - 起点X坐标
  - y1: 2字节 (uint16_t, 大端序) - 起点Y坐标
  - x2: 2字节 (uint16_t, 大端序) - 终点X坐标
  - y2: 2字节 (uint16_t, 大端序) - 终点Y坐标
```

**总大小**: 6 + lineCount × 8 字节

### 压缩效果示例

对于320×240的图像:
- 原始JPEG (quality=80): ~15-25KB
- 位图传输(320×240×1): 76,800字节
- 矢量化传输(100条线段): 6 + 100×8 = **806字节** ✨

**压缩比**: ~95-99% (取决于图像复杂度)

## 使用方法

### 1. 前端配置

在自定义数据发送界面:

```javascript
// 选择通道模式
imageCompression.channel = 'vector';  // 📐 矢量化(LoG)
```

矢量化模式会自动:
- 强制使用LoG边缘检测算子
- 提取线段端点
- 显示提取的线段数量和数据大小

### 2. 数据解码 (C语言示例)

```c
#include <stdint.h>

typedef struct {
    uint16_t x1, y1, x2, y2;
} VectorLine;

typedef struct {
    uint16_t width;
    uint16_t height;
    uint16_t lineCount;
    VectorLine* lines;
} VectorImage;

// 解码矢量数据
VectorImage decode_vector_data(const uint8_t* data, size_t dataLen) {
    VectorImage img = {0};
    
    if (dataLen < 6) return img;
    
    // 解析头部 (大端序)
    img.width = (data[0] << 8) | data[1];
    img.height = (data[2] << 8) | data[3];
    img.lineCount = (data[4] << 8) | data[5];
    
    // 验证数据长度
    size_t expectedLen = 6 + img.lineCount * 8;
    if (dataLen < expectedLen) {
        img.lineCount = 0;
        return img;
    }
    
    // 分配线段数组
    img.lines = (VectorLine*)malloc(sizeof(VectorLine) * img.lineCount);
    
    // 解析线段数据
    const uint8_t* ptr = data + 6;
    for (int i = 0; i < img.lineCount; i++) {
        img.lines[i].x1 = (ptr[0] << 8) | ptr[1]; ptr += 2;
        img.lines[i].y1 = (ptr[0] << 8) | ptr[1]; ptr += 2;
        img.lines[i].x2 = (ptr[0] << 8) | ptr[1]; ptr += 2;
        img.lines[i].y2 = (ptr[0] << 8) | ptr[1]; ptr += 2;
    }
    
    return img;
}

// 渲染矢量图 (示例: 输出到屏幕缓冲区)
void render_vector_image(VectorImage* img, uint8_t* framebuffer, int fbWidth, int fbHeight) {
    for (int i = 0; i < img->lineCount; i++) {
        VectorLine* line = &img->lines[i];
        
        // Bresenham直线绘制算法
        int dx = abs(line->x2 - line->x1);
        int dy = abs(line->y2 - line->y1);
        int sx = line->x1 < line->x2 ? 1 : -1;
        int sy = line->y1 < line->y2 ? 1 : -1;
        int err = dx - dy;
        
        int x = line->x1, y = line->y1;
        
        while (1) {
            // 绘制像素 (边界检查)
            if (x >= 0 && x < fbWidth && y >= 0 && y < fbHeight) {
                framebuffer[y * fbWidth + x] = 255; // 白色
            }
            
            if (x == line->x2 && y == line->y2) break;
            
            int e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }
}
```

### 3. 数据解码 (Python示例)

```python
import struct
import numpy as np
from PIL import Image, ImageDraw

def decode_vector_data(data: bytes):
    """解码矢量数据"""
    if len(data) < 6:
        return None
    
    # 解析头部 (大端序)
    width, height, line_count = struct.unpack('>HHH', data[:6])
    
    # 验证长度
    expected_len = 6 + line_count * 8
    if len(data) < expected_len:
        return None
    
    # 解析线段
    lines = []
    offset = 6
    for i in range(line_count):
        x1, y1, x2, y2 = struct.unpack('>HHHH', data[offset:offset+8])
        lines.append((x1, y1, x2, y2))
        offset += 8
    
    return {
        'width': width,
        'height': height,
        'lines': lines
    }

def render_vector_image(vector_data, scale=1):
    """渲染矢量图为PIL图像"""
    width = vector_data['width'] * scale
    height = vector_data['height'] * scale
    
    img = Image.new('L', (width, height), 255)  # 白色背景
    draw = ImageDraw.Draw(img)
    
    for x1, y1, x2, y2 in vector_data['lines']:
        draw.line([x1*scale, y1*scale, x2*scale, y2*scale], fill=0, width=1)
    
    return img
```

## 适用场景

### ✅ 适合矢量化传输的场景:

- 边缘清晰的工程图纸
- 线条为主的示意图
- 二维码、条形码识别
- 简单的轮廓跟踪
- 路径规划显示
- 低带宽环境下的图像传输

### ❌ 不适合矢量化的场景:

- 自然场景照片
- 渐变丰富的图像
- 高细节纹理图像
- 需要保留颜色信息
- 复杂的边缘细节(线段数量会很大)

## 性能对比

| 模式 | 320×240图像 | 数据量 | 传输时间(50Hz) | 适用场景 |
|------|------------|--------|---------------|---------|
| RGB | 位图 | ~20KB | ~8.3秒 | 彩色图像 |
| 灰度 | 位图 | ~12KB | ~5秒 | 单色图像 |
| Binary | 位图 | ~76KB(原始) ~8KB(JPEG) | ~3.3秒 | 边缘检测 |
| **Vector** | **线段** | **0.8-3KB** | **<1秒** ✨ | **简单边缘** |

## 注意事项

1. **线段数量限制**: 
   - 单个ImageBlock最大120字节数据
   - 每条线段8字节
   - 头部6字节
   - 单包最多: (120-6)/8 = 14条线段
   - 超过14条线段需要分包传输

2. **坐标范围**:
   - 最大支持65535×65535像素
   - 建议控制在320×240以内

3. **精度**:
   - 线段端点为整数坐标
   - 丢失曲线的细节信息
   - 只保留连通分量的首尾端点

4. **实时性**:
   - 边缘检测和线段提取在浏览器端进行
   - 复杂图像可能需要100-300ms处理时间

## 调试技巧

### 查看提取的线段数量

浏览器控制台会显示:
```
🔍 矢量化完成: 提取 127 条线段
📐 矢量数据编码完成: 127条线段, 总大小=1022字节
```

### 验证数据格式

```c
// 快速验证头部
printf("Width: %d\n", (data[0] << 8) | data[1]);
printf("Height: %d\n", (data[2] << 8) | data[3]);
printf("Lines: %d\n", (data[4] << 8) | data[5]);
printf("Expected size: %d bytes\n", 6 + ((data[4] << 8) | data[5]) * 8);
```

## 扩展应用

### 1. 路径规划可视化

矢量化数据天然适合路径表示:
```c
// 将线段转为路径点
for (int i = 0; i < img.lineCount; i++) {
    path_add_waypoint(img.lines[i].x1, img.lines[i].y1);
    path_add_waypoint(img.lines[i].x2, img.lines[i].y2);
}
```

### 2. 障碍物检测

利用边缘信息构建障碍物地图:
```c
bool is_obstacle_near(int x, int y, VectorImage* img, int threshold) {
    for (int i = 0; i < img->lineCount; i++) {
        int dist = point_to_line_distance(x, y, &img->lines[i]);
        if (dist < threshold) return true;
    }
    return false;
}
```

### 3. 特征匹配

使用线段方向和长度作为特征:
```c
float line_angle(VectorLine* line) {
    return atan2(line->y2 - line->y1, line->x2 - line->x1);
}

float line_length(VectorLine* line) {
    int dx = line->x2 - line->x1;
    int dy = line->y2 - line->y1;
    return sqrt(dx*dx + dy*dy);
}
```

## 总结

矢量化传输模式通过提取图像边缘的线段端点，实现了高达95%以上的数据压缩率，特别适合低带宽环境下传输简单的边缘图像。结合RoboMaster裁判系统的自定义数据协议，可以实现快速、高效的视觉信息共享。
