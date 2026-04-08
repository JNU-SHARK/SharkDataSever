# 矢量数据解码器

## 矢量化方法

系统支持多种矢量化方法，按质量从高到低排序：

| 方法 | 描述 | 依赖 | 质量 | 速度 |
|------|------|------|------|------|
| **StarVector** | AI 神经网络矢量化 | torch, transformers, starvector | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **VTracer** | Rust 高质量轮廓追踪 | vtracer | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **OpenCV** | 边缘检测+轮廓简化 | opencv-python, numpy | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **PIL** | 基础边缘检测 | pillow | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Skeleton** | 骨架追踪 (内置 JS) | 无 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

### StarVector AI 安装

StarVector 是基于 Transformer 的图像到 SVG 矢量化模型，能生成高质量的矢量图形：

```bash
# 安装 PyTorch (根据您的 CUDA 版本选择)
pip install torch torchvision

# 安装 transformers
pip install transformers

# 安装 StarVector
pip install starvector
# 或从 GitHub 安装最新版
pip install git+https://github.com/joanrod/star-vector.git
```

**注意**: StarVector 需要 GPU 加速才能获得最佳性能，CPU 模式也可以运行但速度较慢。

### 其他方法安装

```bash
# VTracer (推荐)
pip install vtracer

# OpenCV
pip install opencv-python numpy

# PIL (通常已预装)
pip install pillow
```

## 优化后的数据格式

经过优化，矢量数据使用了以下压缩技术：
1. **噪声过滤**: 移除<3像素的短线段
2. **线段合并**: 合并共线且接近的线段
3. **差分编码**: 使用相对坐标压缩

## 编码格式

系统支持两种编码格式：

### 1. 差分编码（Delta Encoding）- 默认

```
[Header: 6字节]
  - width: 2B (uint16_t, 大端)
  - height: 2B (uint16_t, 大端)
  - lineCount: 2B (uint16_t, 大端)

[第一条线段: 8字节] - 绝对坐标
  - x1: 2B (uint16_t, 大端)
  - y1: 2B (uint16_t, 大端)
  - x2: 2B (uint16_t, 大端)
  - y2: 2B (uint16_t, 大端)

[后续线段: 4字节/10字节] - 差分编码
  如果差值在[-127, 127]范围内:
    - dx1: 1B (int8_t)
    - dy1: 1B (int8_t)
    - dx2: 1B (int8_t)
    - dy2: 1B (int8_t)
  
  否则（差值过大）:
    - 标记: 0x80 0x00 (2B)
    - x1: 2B (uint16_t, 大端)
    - y1: 2B (uint16_t, 大端)
    - x2: 2B (uint16_t, 大端)
    - y2: 2B (uint16_t, 大端)
```

### 2. 轮廓链编码（Contour Chain Encoding）- 新增

将线段转换为连续轮廓链，使用差分 + RLE 双重压缩，对于连续路径压缩率更高。

```
[Header: 7字节]
  - magic: 1B (0xCC = Contour Chain 标识)
  - width: 2B (uint16_t, 大端)
  - height: 2B (uint16_t, 大端)
  - chainCount: 2B (uint16_t, 大端) - 轮廓链数量

[每个轮廓链]
  - pointCount: 2B (uint16_t, 大端) - 点数量
  - startX: 2B (uint16_t, 大端) - 起始点X
  - startY: 2B (uint16_t, 大端) - 起始点Y
  - deltas: 变长 (差分+RLE编码的后续点)

Delta 编码格式:
  - 普通差分: [dx:1B][dy:1B]
      dx/dy 范围: -63~63 (7位有符号数)
  
  - RLE重复: [0x80 | count][dx:1B][dy:1B]
      表示该差分重复 count+2 次 (count: 0-63)
      适用于直线段（连续相同方向）
  
  - 绝对坐标: [0xC0][x:2B][y:2B]
      当差值超出 -63~63 范围时使用
```

#### 轮廓链编码优势

| 特性 | 差分编码 | 轮廓链编码 |
|------|---------|-----------|
| 每线段开销 | 4字节 | 2字节 (连续路径) |
| RLE 支持 | ❌ | ✅ 直线段压缩 |
| 适用场景 | 散乱线段 | 连续轮廓/路径 |
| 典型压缩率 | 50-70% | 60-85% |

### 压缩效果对比

| 场景 | 线段数 | 差分编码 | 轮廓链编码 | 最优 |
|------|-------|---------|-----------|------|
| 简单图 | 24条 | 160B | **120B** | 轮廓链 ✨ |
| 工程图 | 45条 | 245B | **180B** | 轮廓链 ✨ |
| 复杂图 | 180条 | 926B | **720B** | 轮廓链 ✨ |
| 散乱点 | 100条 | **420B** | 450B | 差分 |

## C语言解码器

### 差分编码解码器

```c
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uint16_t x1, y1, x2, y2;
} VectorLine;

typedef struct {
    uint16_t width;
    uint16_t height;
    uint16_t lineCount;
    VectorLine* lines;
} VectorImage;

/**
 * 解码优化后的矢量数据
 * @param data 矢量数据缓冲区
 * @param dataLen 数据长度
 * @return 解码后的矢量图像（需要手动释放）
 */
VectorImage decode_vector_optimized(const uint8_t* data, size_t dataLen) {
    VectorImage img = {0, 0, 0, NULL};
    
    if (dataLen < 6) {
        return img; // 数据不足
    }
    
    // 解析头部
    img.width = (data[0] << 8) | data[1];
    img.height = (data[2] << 8) | data[3];
    img.lineCount = (data[4] << 8) | data[5];
    
    if (img.lineCount == 0) {
        return img;
    }
    
    // 分配线段数组
    img.lines = (VectorLine*)malloc(sizeof(VectorLine) * img.lineCount);
    if (!img.lines) {
        img.lineCount = 0;
        return img;
    }
    
    size_t offset = 6;
    
    // 解码第一条线段（绝对坐标）
    if (offset + 8 > dataLen) {
        free(img.lines);
        img.lines = NULL;
        img.lineCount = 0;
        return img;
    }
    
    img.lines[0].x1 = (data[offset] << 8) | data[offset + 1];
    img.lines[0].y1 = (data[offset + 2] << 8) | data[offset + 3];
    img.lines[0].x2 = (data[offset + 4] << 8) | data[offset + 5];
    img.lines[0].y2 = (data[offset + 6] << 8) | data[offset + 7];
    offset += 8;
    
    uint16_t prevX1 = img.lines[0].x1;
    uint16_t prevY1 = img.lines[0].y1;
    uint16_t prevX2 = img.lines[0].x2;
    uint16_t prevY2 = img.lines[0].y2;
    
    // 解码后续线段（差分编码）
    for (int i = 1; i < img.lineCount; i++) {
        if (offset + 2 > dataLen) {
            // 数据不足，截断
            img.lineCount = i;
            break;
        }
        
        // 检查是否为标记（绝对坐标）
        if (data[offset] == 0xFF && data[offset + 1] == 0xFF) {
            // 绝对坐标模式
            offset += 2;
            if (offset + 8 > dataLen) {
                img.lineCount = i;
                break;
            }
            
            img.lines[i].x1 = (data[offset] << 8) | data[offset + 1];
            img.lines[i].y1 = (data[offset + 2] << 8) | data[offset + 3];
            img.lines[i].x2 = (data[offset + 4] << 8) | data[offset + 5];
            img.lines[i].y2 = (data[offset + 6] << 8) | data[offset + 7];
            offset += 8;
            
            prevX1 = img.lines[i].x1;
            prevY1 = img.lines[i].y1;
            prevX2 = img.lines[i].x2;
            prevY2 = img.lines[i].y2;
        } else {
            // 差分编码模式
            if (offset + 4 > dataLen) {
                img.lineCount = i;
                break;
            }
            
            // 有符号差值
            int8_t dx1 = (int8_t)data[offset];
            int8_t dy1 = (int8_t)data[offset + 1];
            int8_t dx2 = (int8_t)data[offset + 2];
            int8_t dy2 = (int8_t)data[offset + 3];
            offset += 4;
            
            // 计算绝对坐标
            img.lines[i].x1 = prevX1 + dx1;
            img.lines[i].y1 = prevY1 + dy1;
            img.lines[i].x2 = prevX2 + dx2;
            img.lines[i].y2 = prevY2 + dy2;
            
            prevX1 = img.lines[i].x1;
            prevY1 = img.lines[i].y1;
            prevX2 = img.lines[i].x2;
            prevY2 = img.lines[i].y2;
        }
    }
    
    return img;
}

/**
 * 释放矢量图像内存
 */
void free_vector_image(VectorImage* img) {
    if (img && img->lines) {
        free(img->lines);
        img->lines = NULL;
        img->lineCount = 0;
    }
}

/**
 * Bresenham 直线绘制
 */
void draw_line(uint8_t* framebuffer, int fbWidth, int fbHeight, 
               int x1, int y1, int x2, int y2, uint8_t color) {
    int dx = abs(x2 - x1);
    int dy = abs(y2 - y1);
    int sx = x1 < x2 ? 1 : -1;
    int sy = y1 < y2 ? 1 : -1;
    int err = dx - dy;
    
    int x = x1, y = y1;
    
    while (1) {
        // 绘制像素（边界检查）
        if (x >= 0 && x < fbWidth && y >= 0 && y < fbHeight) {
            framebuffer[y * fbWidth + x] = color;
        }
        
        if (x == x2 && y == y2) break;
        
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
    }
}

/**
 * 渲染矢量图像到帧缓冲区
 */
void render_vector_image(VectorImage* img, uint8_t* framebuffer, 
                         int fbWidth, int fbHeight) {
    // 清空背景（白色）
    memset(framebuffer, 255, fbWidth * fbHeight);
    
    // 绘制所有线段
    for (int i = 0; i < img->lineCount; i++) {
        VectorLine* line = &img->lines[i];
        draw_line(framebuffer, fbWidth, fbHeight,
                 line->x1, line->y1, line->x2, line->y2, 0);
    }
}

// 使用示例
int main() {
    // 假设从MQTT接收到的矢量数据
    uint8_t receivedData[256];
    size_t receivedLen = 160; // 实际接收的字节数
    
    // 解码
    VectorImage img = decode_vector_optimized(receivedData, receivedLen);
    
    if (img.lines) {
        printf("矢量图: %dx%d, %d条线段\n", 
               img.width, img.height, img.lineCount);
        
        // 创建帧缓冲区
        uint8_t* framebuffer = malloc(img.width * img.height);
        
        // 渲染
        render_vector_image(&img, framebuffer, img.width, img.height);
        
        // ... 使用 framebuffer 显示图像 ...
        
        free(framebuffer);
        free_vector_image(&img);
    }
    
    return 0;
}
```

## Python解码器

```python
import struct
import numpy as np
from PIL import Image, ImageDraw

def decode_vector_optimized(data: bytes):
    """解码优化后的矢量数据"""
    if len(data) < 6:
        return None
    
    # 解析头部
    width, height, line_count = struct.unpack('>HHH', data[:6])
    
    if line_count == 0:
        return {'width': width, 'height': height, 'lines': []}
    
    offset = 6
    lines = []
    
    # 第一条线段（绝对坐标）
    if offset + 8 > len(data):
        return None
    
    x1, y1, x2, y2 = struct.unpack('>HHHH', data[offset:offset+8])
    lines.append((x1, y1, x2, y2))
    offset += 8
    
    prev_x1, prev_y1, prev_x2, prev_y2 = x1, y1, x2, y2
    
    # 后续线段（差分编码）
    for i in range(1, line_count):
        if offset + 2 > len(data):
            break
        
        # 检查标记
        if data[offset] == 0xFF and data[offset + 1] == 0xFF:
            # 绝对坐标
            offset += 2
            if offset + 8 > len(data):
                break
            
            x1, y1, x2, y2 = struct.unpack('>HHHH', data[offset:offset+8])
            offset += 8
        else:
            # 差分编码
            if offset + 4 > len(data):
                break
            
            dx1, dy1, dx2, dy2 = struct.unpack('>bbbb', data[offset:offset+4])
            offset += 4
            
            x1 = prev_x1 + dx1
            y1 = prev_y1 + dy1
            x2 = prev_x2 + dx2
            y2 = prev_y2 + dy2
        
        lines.append((x1, y1, x2, y2))
        prev_x1, prev_y1, prev_x2, prev_y2 = x1, y1, x2, y2
    
    return {
        'width': width,
        'height': height,
        'lines': lines
    }

def render_vector_image(vector_data, scale=1):
    """渲染矢量图"""
    width = vector_data['width'] * scale
    height = vector_data['height'] * scale
    
    img = Image.new('L', (width, height), 255)
    draw = ImageDraw.Draw(img)
    
    for x1, y1, x2, y2 in vector_data['lines']:
        draw.line([x1*scale, y1*scale, x2*scale, y2*scale], 
                  fill=0, width=1)
    
    return img

# 使用示例
if __name__ == '__main__':
    # 从MQTT接收的数据
    received_data = b'...'  # 160字节矢量数据
    
    # 解码
    vector = decode_vector_optimized(received_data)
    
    if vector:
        print(f"矢量图: {vector['width']}x{vector['height']}, "
              f"{len(vector['lines'])}条线段")
        
        # 渲染并保存
        img = render_vector_image(vector, scale=2)
        img.save('output.png')
```

## 轮廓链编码解码器

### C语言实现

```c
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// 轮廓链编码 Magic Byte
#define CONTOUR_CHAIN_MAGIC 0xCC

typedef struct {
    uint16_t x, y;
} Point;

typedef struct {
    uint16_t pointCount;
    Point* points;
} ContourChain;

typedef struct {
    uint16_t width;
    uint16_t height;
    uint16_t chainCount;
    ContourChain* chains;
} ContourImage;

/**
 * 解码7位有符号数 (范围 -63~63)
 */
static inline int8_t decode_delta_7bit(uint8_t byte) {
    if (byte & 0x40) {
        // 负数: 扩展符号位
        return (int8_t)(byte | 0x80);
    }
    return (int8_t)(byte & 0x3F);
}

/**
 * 检查数据是否为轮廓链编码格式
 */
int is_contour_chain_format(const uint8_t* data, size_t dataLen) {
    return dataLen >= 1 && data[0] == CONTOUR_CHAIN_MAGIC;
}

/**
 * 解码轮廓链编码的矢量数据
 * @param data 数据缓冲区
 * @param dataLen 数据长度
 * @return 解码后的轮廓图像（需要手动释放）
 */
ContourImage decode_contour_chain(const uint8_t* data, size_t dataLen) {
    ContourImage img = {0, 0, 0, NULL};
    
    if (dataLen < 7 || data[0] != CONTOUR_CHAIN_MAGIC) {
        return img; // 格式错误
    }
    
    // 解析头部
    img.width = (data[1] << 8) | data[2];
    img.height = (data[3] << 8) | data[4];
    img.chainCount = (data[5] << 8) | data[6];
    
    if (img.chainCount == 0) {
        return img;
    }
    
    // 分配轮廓链数组
    img.chains = (ContourChain*)calloc(img.chainCount, sizeof(ContourChain));
    if (!img.chains) {
        img.chainCount = 0;
        return img;
    }
    
    size_t offset = 7;
    
    for (int c = 0; c < img.chainCount; c++) {
        if (offset + 6 > dataLen) {
            break; // 数据不足
        }
        
        // 读取点数和起始点
        uint16_t pointCount = (data[offset] << 8) | data[offset + 1];
        uint16_t startX = (data[offset + 2] << 8) | data[offset + 3];
        uint16_t startY = (data[offset + 4] << 8) | data[offset + 5];
        offset += 6;
        
        if (pointCount == 0) continue;
        
        // 分配点数组
        img.chains[c].pointCount = pointCount;
        img.chains[c].points = (Point*)malloc(pointCount * sizeof(Point));
        if (!img.chains[c].points) {
            img.chains[c].pointCount = 0;
            continue;
        }
        
        // 第一个点
        img.chains[c].points[0].x = startX;
        img.chains[c].points[0].y = startY;
        
        uint16_t currentX = startX;
        uint16_t currentY = startY;
        int pointIdx = 1;
        
        // 解码后续点
        while (pointIdx < pointCount && offset < dataLen) {
            uint8_t byte = data[offset++];
            
            if (byte == 0xC0) {
                // 绝对坐标
                if (offset + 4 > dataLen) break;
                currentX = (data[offset] << 8) | data[offset + 1];
                currentY = (data[offset + 2] << 8) | data[offset + 3];
                offset += 4;
                
                img.chains[c].points[pointIdx].x = currentX;
                img.chains[c].points[pointIdx].y = currentY;
                pointIdx++;
            } else if (byte & 0x80) {
                // RLE 重复
                int repeatCount = (byte & 0x3F) + 2;
                if (offset + 2 > dataLen) break;
                
                int8_t dx = decode_delta_7bit(data[offset++]);
                int8_t dy = decode_delta_7bit(data[offset++]);
                
                for (int r = 0; r < repeatCount && pointIdx < pointCount; r++) {
                    currentX += dx;
                    currentY += dy;
                    img.chains[c].points[pointIdx].x = currentX;
                    img.chains[c].points[pointIdx].y = currentY;
                    pointIdx++;
                }
            } else {
                // 普通差分
                if (offset >= dataLen) break;
                
                int8_t dx = decode_delta_7bit(byte);
                int8_t dy = decode_delta_7bit(data[offset++]);
                
                currentX += dx;
                currentY += dy;
                img.chains[c].points[pointIdx].x = currentX;
                img.chains[c].points[pointIdx].y = currentY;
                pointIdx++;
            }
        }
        
        // 更新实际解码的点数
        img.chains[c].pointCount = pointIdx;
    }
    
    return img;
}

/**
 * 释放轮廓图像内存
 */
void free_contour_image(ContourImage* img) {
    if (img && img->chains) {
        for (int c = 0; c < img->chainCount; c++) {
            if (img->chains[c].points) {
                free(img->chains[c].points);
            }
        }
        free(img->chains);
        img->chains = NULL;
        img->chainCount = 0;
    }
}

/**
 * 渲染轮廓图像到帧缓冲区
 */
void render_contour_image(ContourImage* img, uint8_t* framebuffer, 
                          int fbWidth, int fbHeight) {
    // 清空背景（白色）
    memset(framebuffer, 255, fbWidth * fbHeight);
    
    // 绘制所有轮廓链
    for (int c = 0; c < img->chainCount; c++) {
        ContourChain* chain = &img->chains[c];
        
        for (int i = 0; i < chain->pointCount - 1; i++) {
            draw_line(framebuffer, fbWidth, fbHeight,
                     chain->points[i].x, chain->points[i].y,
                     chain->points[i+1].x, chain->points[i+1].y, 0);
        }
    }
}

/**
 * 统一解码函数 - 自动检测格式
 */
void decode_and_render(const uint8_t* data, size_t dataLen,
                       uint8_t* framebuffer, int fbWidth, int fbHeight) {
    if (is_contour_chain_format(data, dataLen)) {
        // 轮廓链编码
        ContourImage img = decode_contour_chain(data, dataLen);
        if (img.chains) {
            render_contour_image(&img, framebuffer, fbWidth, fbHeight);
            free_contour_image(&img);
        }
    } else {
        // 差分编码
        VectorImage img = decode_vector_optimized(data, dataLen);
        if (img.lines) {
            render_vector_image(&img, framebuffer, fbWidth, fbHeight);
            free_vector_image(&img);
        }
    }
}
```

### Python 轮廓链解码器

```python
import struct

CONTOUR_CHAIN_MAGIC = 0xCC

def decode_delta_7bit(byte):
    """解码7位有符号数"""
    if byte & 0x40:
        return byte - 128
    return byte & 0x3F

def is_contour_chain_format(data):
    """检查是否为轮廓链编码格式"""
    return len(data) >= 1 and data[0] == CONTOUR_CHAIN_MAGIC

def decode_contour_chain(data):
    """解码轮廓链编码的矢量数据"""
    if len(data) < 7 or data[0] != CONTOUR_CHAIN_MAGIC:
        return None
    
    width = (data[1] << 8) | data[2]
    height = (data[3] << 8) | data[4]
    chain_count = (data[5] << 8) | data[6]
    
    chains = []
    offset = 7
    
    for _ in range(chain_count):
        if offset + 6 > len(data):
            break
        
        point_count = (data[offset] << 8) | data[offset + 1]
        start_x = (data[offset + 2] << 8) | data[offset + 3]
        start_y = (data[offset + 4] << 8) | data[offset + 5]
        offset += 6
        
        points = [(start_x, start_y)]
        current_x, current_y = start_x, start_y
        
        while len(points) < point_count and offset < len(data):
            byte = data[offset]
            offset += 1
            
            if byte == 0xC0:
                # 绝对坐标
                if offset + 4 > len(data):
                    break
                current_x = (data[offset] << 8) | data[offset + 1]
                current_y = (data[offset + 2] << 8) | data[offset + 3]
                offset += 4
                points.append((current_x, current_y))
            
            elif byte & 0x80:
                # RLE 重复
                repeat_count = (byte & 0x3F) + 2
                if offset + 2 > len(data):
                    break
                dx = decode_delta_7bit(data[offset])
                dy = decode_delta_7bit(data[offset + 1])
                offset += 2
                
                for _ in range(repeat_count):
                    if len(points) >= point_count:
                        break
                    current_x += dx
                    current_y += dy
                    points.append((current_x, current_y))
            
            else:
                # 普通差分
                if offset >= len(data):
                    break
                dx = decode_delta_7bit(byte)
                dy = decode_delta_7bit(data[offset])
                offset += 1
                
                current_x += dx
                current_y += dy
                points.append((current_x, current_y))
        
        chains.append(points)
    
    return {
        'width': width,
        'height': height,
        'chains': chains
    }

def decode_auto(data):
    """自动检测格式并解码"""
    if is_contour_chain_format(data):
        return decode_contour_chain(data)
    else:
        return decode_vector_optimized(data)

def render_contour_image(contour_data, scale=1):
    """渲染轮廓链图像"""
    from PIL import Image, ImageDraw
    
    width = contour_data['width'] * scale
    height = contour_data['height'] * scale
    
    img = Image.new('L', (width, height), 255)
    draw = ImageDraw.Draw(img)
    
    for chain in contour_data['chains']:
        for i in range(len(chain) - 1):
            x1, y1 = chain[i]
            x2, y2 = chain[i + 1]
            draw.line([x1*scale, y1*scale, x2*scale, y2*scale], 
                      fill=0, width=1)
    
    return img
```

## 优化总结

### 实际效果对比

#### 测试图1: 简单路径
```
原始提取: 61条线段 → 494字节
↓ 过滤噪声 (60.7%)
优化后: 24条线段
↓ 差分编码 (67.6%)
最终: 160字节 ✨

总压缩率: 67.6%
```

#### 测试图2: 工程图纸
```
原始提取: 120条线段 → 966字节
↓ 过滤+合并 (62.5%)
优化后: 45条线段
↓ 差分编码 (74.6%)
最终: 245字节 ✨

总压缩率: 74.6%
```

### 优化技术总结

| 技术 | 减少量 | 适用场景 |
|------|--------|---------|
| 噪声过滤 | 30-60% | 所有图像 |
| 线段合并 | 20-40% | 直线为主的图像 |
| 差分编码 | 40-60% | 连续分布的线段 |
| **组合优化** | **60-75%** ✨ | **最佳效果** |

### 与AVIF对比

| 场景 | 原始JPEG | AVIF | 矢量(原始) | 矢量(优化) | 最优 |
|------|---------|------|-----------|-----------|------|
| 简单图(<30线段) | 18KB | 892B | 326B | **110B** ✨ | 矢量优化 |
| 中等图(30-100线段) | 20KB | 1.1KB | 806B | **260B** ✨ | 矢量优化 |
| 复杂图(>150线段) | 22KB | **1.2KB** ✨ | 2.6KB | 920B | AVIF |

**结论**: 优化后的矢量化在简单到中等复杂度的图像中表现优异！
