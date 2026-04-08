const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

// 矢量化优化库
let potrace = null;
let simplify = null;
try {
    potrace = require('potrace');
    simplify = require('simplify-js');
    console.log('✅ 矢量化优化库加载成功 (potrace, simplify-js)');
} catch (e) {
    console.warn('⚠️ 矢量化优化库未安装，使用基础RLE编码');
}

// ============ 矢量编码工具函数 ============

/**
 * 差分编码 (Delta Encoding) - 原有编码方式
 * 格式: [w:2][h:2][count:2] + [first line:8] + [delta lines:4 or absolute:10]
 */
function encodeDelta(lines, w, h) {
    const buffer = [];
    buffer.push(w >> 8, w & 0xFF);
    buffer.push(h >> 8, h & 0xFF);
    buffer.push((lines.length >> 8) & 0xFF, lines.length & 0xFF);
    
    if (lines.length > 0) {
        const first = lines[0];
        buffer.push(first.x1 >> 8, first.x1 & 0xFF, first.y1 >> 8, first.y1 & 0xFF);
        buffer.push(first.x2 >> 8, first.x2 & 0xFF, first.y2 >> 8, first.y2 & 0xFF);
        
        let prevX1 = first.x1, prevY1 = first.y1;
        let prevX2 = first.x2, prevY2 = first.y2;
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const dx1 = line.x1 - prevX1, dy1 = line.y1 - prevY1;
            const dx2 = line.x2 - prevX2, dy2 = line.y2 - prevY2;
            
            if (dx1 >= -127 && dx1 <= 127 && dy1 >= -127 && dy1 <= 127 &&
                dx2 >= -127 && dx2 <= 127 && dy2 >= -127 && dy2 <= 127) {
                buffer.push(dx1 & 0xFF, dy1 & 0xFF, dx2 & 0xFF, dy2 & 0xFF);
            } else {
                buffer.push(0x80, 0x00);
                buffer.push(line.x1 >> 8, line.x1 & 0xFF, line.y1 >> 8, line.y1 & 0xFF);
                buffer.push(line.x2 >> 8, line.x2 & 0xFF, line.y2 >> 8, line.y2 & 0xFF);
            }
            prevX1 = line.x1; prevY1 = line.y1;
            prevX2 = line.x2; prevY2 = line.y2;
        }
    }
    
    return Buffer.from(buffer);
}

/**
 * 轮廓链编码 (Contour Chain Encoding) - 差分+RLE
 * 将线段转换为连续轮廓链，使用差分和行程编码
 * 
 * 格式:
 * [Header: 7字节]
 *   - magic: 1B (0xCC = Contour Chain)
 *   - width: 2B (uint16_t, 大端)
 *   - height: 2B (uint16_t, 大端)
 *   - chainCount: 2B (uint16_t, 大端)
 * 
 * [每个轮廓链]
 *   - pointCount: 2B (uint16_t, 大端)
 *   - startX: 2B (uint16_t, 大端)
 *   - startY: 2B (uint16_t, 大端)
 *   - deltas: 变长 (差分+RLE编码)
 * 
 * Delta 编码格式:
 *   - 普通差分: [dx:1B][dy:1B] (范围-63~63)
 *   - RLE重复: [0x80 | count][dx:1B][dy:1B] (重复count+2次, count 0-63)
 *   - 绝对坐标: [0xC0][x:2B][y:2B] (差值超出范围时)
 */
function encodeContourChain(lines, w, h) {
    // 步骤1: 将线段转换为轮廓链
    const chains = linesToChains(lines);
    
    const buffer = [];
    // Header
    buffer.push(0xCC); // Magic byte for Contour Chain
    buffer.push(w >> 8, w & 0xFF);
    buffer.push(h >> 8, h & 0xFF);
    buffer.push((chains.length >> 8) & 0xFF, chains.length & 0xFF);
    
    // 编码每个轮廓链
    for (const chain of chains) {
        if (chain.length < 2) continue;
        
        // 点数
        buffer.push((chain.length >> 8) & 0xFF, chain.length & 0xFF);
        // 起始点 (绝对坐标)
        buffer.push(chain[0].x >> 8, chain[0].x & 0xFF);
        buffer.push(chain[0].y >> 8, chain[0].y & 0xFF);
        
        // 计算差分序列
        const deltas = [];
        for (let i = 1; i < chain.length; i++) {
            const dx = chain[i].x - chain[i-1].x;
            const dy = chain[i].y - chain[i-1].y;
            deltas.push({ dx, dy });
        }
        
        // 差分+RLE编码
        let i = 0;
        while (i < deltas.length) {
            const { dx, dy } = deltas[i];
            
            // 检查是否需要绝对坐标
            if (dx < -63 || dx > 63 || dy < -63 || dy > 63) {
                // 绝对坐标模式
                buffer.push(0xC0);
                const absX = chain[i + 1].x;
                const absY = chain[i + 1].y;
                buffer.push(absX >> 8, absX & 0xFF);
                buffer.push(absY >> 8, absY & 0xFF);
                i++;
                continue;
            }
            
            // 计算连续相同差分的数量 (RLE)
            let repeatCount = 0;
            while (i + repeatCount + 1 < deltas.length && repeatCount < 63) {
                const next = deltas[i + repeatCount + 1];
                if (next.dx === dx && next.dy === dy) {
                    repeatCount++;
                } else {
                    break;
                }
            }
            
            if (repeatCount >= 2) {
                // RLE编码: 重复3次及以上才值得
                // [0x80 | repeatCount][dx][dy] 表示该差分重复 repeatCount+2 次
                buffer.push(0x80 | repeatCount);
                buffer.push(dx & 0x7F);  // 7位有符号
                buffer.push(dy & 0x7F);
                i += repeatCount + 1;
            } else {
                // 普通差分编码
                buffer.push(dx & 0x7F);
                buffer.push(dy & 0x7F);
                i++;
            }
        }
    }
    
    return Buffer.from(buffer);
}

/**
 * 将线段列表转换为连续轮廓链
 * 尝试将首尾相连的线段合并为一条链
 */
function linesToChains(lines) {
    if (lines.length === 0) return [];
    
    // 创建点的邻接表
    const pointMap = new Map();
    
    const getKey = (x, y) => `${x},${y}`;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const key1 = getKey(line.x1, line.y1);
        const key2 = getKey(line.x2, line.y2);
        
        if (!pointMap.has(key1)) pointMap.set(key1, []);
        if (!pointMap.has(key2)) pointMap.set(key2, []);
        
        pointMap.get(key1).push({ x: line.x2, y: line.y2, lineIdx: i });
        pointMap.get(key2).push({ x: line.x1, y: line.y1, lineIdx: i });
    }
    
    const usedLines = new Set();
    const chains = [];
    
    for (let i = 0; i < lines.length; i++) {
        if (usedLines.has(i)) continue;
        
        const chain = [];
        const line = lines[i];
        chain.push({ x: line.x1, y: line.y1 });
        chain.push({ x: line.x2, y: line.y2 });
        usedLines.add(i);
        
        // 向前延伸
        let currentKey = getKey(line.x2, line.y2);
        while (true) {
            const neighbors = pointMap.get(currentKey) || [];
            let found = false;
            for (const neighbor of neighbors) {
                if (!usedLines.has(neighbor.lineIdx)) {
                    chain.push({ x: neighbor.x, y: neighbor.y });
                    usedLines.add(neighbor.lineIdx);
                    currentKey = getKey(neighbor.x, neighbor.y);
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }
        
        // 向后延伸
        currentKey = getKey(line.x1, line.y1);
        while (true) {
            const neighbors = pointMap.get(currentKey) || [];
            let found = false;
            for (const neighbor of neighbors) {
                if (!usedLines.has(neighbor.lineIdx)) {
                    chain.unshift({ x: neighbor.x, y: neighbor.y });
                    usedLines.add(neighbor.lineIdx);
                    currentKey = getKey(neighbor.x, neighbor.y);
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }
        
        chains.push(chain);
    }
    
    return chains;
}

// ============ 矢量线段优化函数 ============

/**
 * 合并相近且方向相似的线段，减少碎片
 * @param {Array} lines - 线段数组 [{x1,y1,x2,y2}, ...]
 * @param {number} distThreshold - 端点距离阈值（像素）
 * @param {number} angleThreshold - 角度差异阈值（度）
 * @returns {Array} 合并后的线段数组
 */
function mergeNearbyLines(lines, distThreshold = 3, angleThreshold = 15) {
    if (lines.length < 2) return lines;
    
    // 计算线段角度 (0-180度)
    const getAngle = (l) => {
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle < 0) angle += 180;
        return angle;
    };
    
    // 计算两点距离
    const dist = (x1, y1, x2, y2) => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    
    // 计算角度差 (考虑 0-180 循环)
    const angleDiff = (a1, a2) => {
        let diff = Math.abs(a1 - a2);
        if (diff > 90) diff = 180 - diff;
        return diff;
    };
    
    const merged = [];
    const used = new Set();
    
    for (let i = 0; i < lines.length; i++) {
        if (used.has(i)) continue;
        
        let current = { ...lines[i] };
        let currentAngle = getAngle(current);
        used.add(i);
        
        // 尝试合并相邻线段
        let changed = true;
        while (changed) {
            changed = false;
            
            for (let j = 0; j < lines.length; j++) {
                if (used.has(j)) continue;
                
                const candidate = lines[j];
                const candAngle = getAngle(candidate);
                
                // 检查角度是否相近
                if (angleDiff(currentAngle, candAngle) > angleThreshold) continue;
                
                // 检查端点是否相近 (4种组合)
                const d1 = dist(current.x2, current.y2, candidate.x1, candidate.y1); // 当前终点 -> 候选起点
                const d2 = dist(current.x2, current.y2, candidate.x2, candidate.y2); // 当前终点 -> 候选终点
                const d3 = dist(current.x1, current.y1, candidate.x1, candidate.y1); // 当前起点 -> 候选起点
                const d4 = dist(current.x1, current.y1, candidate.x2, candidate.y2); // 当前起点 -> 候选终点
                
                if (d1 <= distThreshold) {
                    // 延长: current.end -> candidate.end
                    current.x2 = candidate.x2;
                    current.y2 = candidate.y2;
                    used.add(j);
                    changed = true;
                } else if (d2 <= distThreshold) {
                    // 延长: current.end -> candidate.start
                    current.x2 = candidate.x1;
                    current.y2 = candidate.y1;
                    used.add(j);
                    changed = true;
                } else if (d3 <= distThreshold) {
                    // 延长: candidate.end -> current.start (反向)
                    current.x1 = candidate.x2;
                    current.y1 = candidate.y2;
                    used.add(j);
                    changed = true;
                } else if (d4 <= distThreshold) {
                    // 延长: candidate.start -> current.start
                    current.x1 = candidate.x1;
                    current.y1 = candidate.y1;
                    used.add(j);
                    changed = true;
                }
            }
        }
        
        merged.push(current);
    }
    
    return merged;
}

// ============ Freeman 解码预览函数 ============

/**
 * 解码 Freeman 链码数据，用于生成真实预览
 * @param {Buffer} buffer - Freeman 编码数据
 * @param {number} originalW - 原始宽度
 * @param {number} originalH - 原始高度
 * @returns {Object|null} { contours: [[{x,y},...], ...] }
 */
function decodeFreemanForPreview(buffer, originalW, originalH) {
    if (!buffer || buffer.length < 4) return null;
    if (buffer[0] !== 0xFD) return null;
    
    const w_stored = buffer[1];
    const h_stored = buffer[2];
    const contourCount = buffer[3];
    
    if (contourCount === 0) return { contours: [] };
    
    // 方向向量 (与编码 getFreemanCode 一致，图像坐标系)
    // 方向: 0=上, 1=右上, 2=右, 3=右下, 4=下, 5=左下, 6=左, 7=左上
    const dx = [0, 1, 1, 1, 0, -1, -1, -1];
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
    
    // 坐标还原比例 (与编码时一致)
    const scaleX = originalW > 1 ? (originalW - 1) / 255 : 1;
    const scaleY = originalH > 1 ? (originalH - 1) / 255 : 1;
    
    const contours = [];
    let offset = 4;
    
    for (let c = 0; c < contourCount && offset + 3 <= buffer.length; c++) {
        // 读取轮廓头部
        const startX_norm = buffer[offset++];
        const startY_norm = buffer[offset++];
        const dataLen = buffer[offset++];
        
        if (offset + dataLen > buffer.length) break;
        
        // 解压缩数据 (4位打包)
        const compressedData = buffer.slice(offset, offset + dataLen);
        offset += dataLen;
        
        // 还原起始坐标
        const startX = Math.round(startX_norm * scaleX);
        const startY = Math.round(startY_norm * scaleY);
        
        // 解包4位数据
        const packed = [];
        for (let i = 0; i < compressedData.length; i++) {
            packed.push((compressedData[i] >> 4) & 0x0F);
            packed.push(compressedData[i] & 0x0F);
        }
        
        // RLE解码: 值<8直接输出; 值>=8表示 [重复标记, 被重复的值]
        const diffCodes = [];
        let i = 0;
        while (i < packed.length) {
            const v = packed[i];
            if (v >= 8 && i + 1 < packed.length) {
                // RLE: 重复 (v - 8 + 2) 次
                const count = v - 8 + 2;
                const value = packed[i + 1];
                for (let j = 0; j < count; j++) {
                    diffCodes.push(value);
                }
                i += 2;
            } else {
                // 直接值
                diffCodes.push(v);
                i++;
            }
        }
        
        if (diffCodes.length === 0) continue;
        
        // 差分解码 -> 原始方向码
        // diffCodes[0] 是第一个原始方向，后面是差分
        const directions = [diffCodes[0]];
        for (let j = 1; j < diffCodes.length; j++) {
            const prevDir = directions[j - 1];
            const dir = (prevDir + diffCodes[j]) % 8;
            directions.push(dir);
        }
        
        // 根据方向码重建轮廓点
        const contour = [{ x: startX, y: startY }];
        let cx = startX, cy = startY;
        
        for (const dir of directions) {
            cx += dx[dir];
            cy += dy[dir];
            contour.push({ x: cx, y: cy });
        }
        
        contours.push(contour);
    }
    
    return { contours };
}

// ============ 二值图像编码工具函数 ============

/**
 * 边缘像素坐标编码 (简单可靠版)
 * 
 * 不使用复杂的轮廓追踪，直接编码所有边缘像素坐标
 * 使用行扫描 + 差分编码 + zlib压缩
 * 
 * 格式:
 * [Header: 5字节]
 *   - magic: 0xFE (Edge Pixels)
 *   - w: 2B (宽度)
 *   - h: 2B (高度)
 * [Data: zlib压缩的像素坐标]
 */
function encodeFreemanChain(binaryData, w, h) {
    const zlib = require('zlib');
    
    // 收集所有边缘像素坐标 (按行扫描)
    const pixels = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (binaryData[y * w + x]) {
                pixels.push(x, y);
            }
        }
    }
    
    if (pixels.length === 0) {
        return Buffer.from([0xFE, w >> 8, w & 0xFF, h >> 8, h & 0xFF, 0, 0]);
    }
    
    // 差分编码 (相邻像素坐标差值通常很小)
    const diffData = [pixels[0], pixels[1]]; // 第一个点绝对坐标
    for (let i = 2; i < pixels.length; i += 2) {
        // x差分 (相对上一个点)
        const dx = pixels[i] - pixels[i - 2];
        const dy = pixels[i + 1] - pixels[i - 1];
        // 转为有符号字节 (-128 ~ 127)
        diffData.push(((dx + 128) & 0xFF));
        diffData.push(((dy + 128) & 0xFF));
    }
    
    // zlib 压缩
    const compressed = zlib.deflateSync(Buffer.from(diffData), { level: 9 });
    
    // 组装
    const buffer = Buffer.alloc(7 + compressed.length);
    buffer[0] = 0xFE; // Magic byte
    buffer[1] = w >> 8;
    buffer[2] = w & 0xFF;
    buffer[3] = h >> 8;
    buffer[4] = h & 0xFF;
    buffer[5] = (pixels.length / 2) >> 8;  // 像素数量高字节
    buffer[6] = (pixels.length / 2) & 0xFF; // 像素数量低字节
    compressed.copy(buffer, 7);
    
    return buffer;
}

/**
 * 解码边缘像素用于预览
 */
function decodeFreemanForPreview(buffer, originalW, originalH) {
    if (!buffer || buffer.length < 7) return null;
    if (buffer[0] !== 0xFE) return null;
    
    const zlib = require('zlib');
    
    const w = (buffer[1] << 8) | buffer[2];
    const h = (buffer[3] << 8) | buffer[4];
    const pixelCount = (buffer[5] << 8) | buffer[6];
    
    if (pixelCount === 0) return { pixels: [] };
    
    try {
        // 解压
        const compressed = buffer.slice(7);
        const diffData = zlib.inflateSync(compressed);
        
        // 差分解码
        const pixels = [];
        let x = diffData[0];
        let y = diffData[1];
        pixels.push({ x, y });
        
        for (let i = 2; i < diffData.length; i += 2) {
            const dx = diffData[i] - 128;
            const dy = diffData[i + 1] - 128;
            x += dx;
            y += dy;
            pixels.push({ x, y });
        }
        
        return { pixels };
    } catch (e) {
        return null;
    }
}

/**
 * Douglas-Peucker 轮廓简化算法
 */
function douglasPeuckerSimplify(points, epsilon) {
    if (points.length <= 2) return points;
    
    // 找到距离首尾连线最远的点
    let maxDist = 0;
    let maxIdx = 0;
    const start = points[0];
    const end = points[points.length - 1];
    
    for (let i = 1; i < points.length - 1; i++) {
        const dist = pointToLineDistance(points[i], start, end);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }
    
    // 如果最大距离大于阈值，递归简化
    if (maxDist > epsilon) {
        const left = douglasPeuckerSimplify(points.slice(0, maxIdx + 1), epsilon);
        const right = douglasPeuckerSimplify(points.slice(maxIdx), epsilon);
        return left.slice(0, -1).concat(right);
    } else {
        return [start, end];
    }
}

/**
 * 点到线段距离
 */
function pointToLineDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;
    
    if (lenSq === 0) {
        return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    }
    
    const t = Math.max(0, Math.min(1, 
        ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq));
    
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    
    return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}

/**
 * 行程编码 (RLE) - 压缩连续相同值
 * 输出格式: 值<8时直接输出; 重复>=2次时输出 [8+count-2, value]
 */
function rleEncode(codes) {
    const result = [];
    let i = 0;
    
    while (i < codes.length) {
        const value = codes[i];
        let count = 1;
        
        // 统计连续相同值
        while (i + count < codes.length && codes[i + count] === value && count < 9) {
            count++;
        }
        
        if (count >= 3) {
            // RLE: 使用特殊标记 (8-15 表示重复 2-9 次)
            result.push(8 + count - 2); // 8=重复2次, 9=重复3次, ...
            result.push(value);
            i += count;
        } else {
            // 直接输出
            result.push(value);
            i++;
        }
    }
    
    return result;
}

/**
 * 3位打包压缩 - 将4位值(0-15)打包
 * 每2个值打包为1字节 (高4位+低4位)
 */
function packBits3(codes) {
    const result = [];
    
    for (let i = 0; i < codes.length; i += 2) {
        const high = codes[i] & 0x0F;
        const low = (i + 1 < codes.length) ? (codes[i + 1] & 0x0F) : 0;
        result.push((high << 4) | low);
    }
    
    return result;
}

/**
 * 获取 Freeman 8方向链码 (图像坐标系: Y向下为正)
 * 方向编码:
 *   7 0 1
 *   6 P 2
 *   5 4 3
 */
function getFreemanCode(dx, dy) {
    const ndx = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    const ndy = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
    
    // 图像坐标系 (Y向下为正)
    const dirMap = {
        '0,-1': 0,  // 上
        '1,-1': 1,  // 右上
        '1,0': 2,   // 右
        '1,1': 3,   // 右下
        '0,1': 4,   // 下
        '-1,1': 5,  // 左下
        '-1,0': 6,  // 左
        '-1,-1': 7  // 左上
    };
    
    return dirMap[`${ndx},${ndy}`] ?? 0;
}

/**
 * 从二值图像提取轮廓点序列 (Moore边界追踪算法)
 * 只提取外轮廓，过滤小轮廓
 */
function extractContours(binaryData, w, h) {
    const visited = new Uint8Array(w * h);  // 已访问的边界点
    const contours = [];
    
    // 8邻域偏移 (顺时针方向，从上开始)
    // 方向: 0=上, 1=右上, 2=右, 3=右下, 4=下, 5=左下, 6=左, 7=左上
    const dx8 = [0, 1, 1, 1, 0, -1, -1, -1];
    const dy8 = [-1, -1, 0, 1, 1, 1, 0, -1];
    
    // 扫描寻找轮廓起点 (从左到右，从上到下)
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            
            // 跳过背景点和已访问点
            if (!binaryData[idx] || visited[idx]) continue;
            
            // 检查是否是轮廓起点：前景点且左边是背景（或在左边界）
            const leftIdx = idx - 1;
            const isContourStart = (x === 0 || !binaryData[leftIdx]);
            
            if (!isContourStart) continue;
            
            // Moore 边界追踪
            const contour = [];
            let cx = x, cy = y;
            let startX = x, startY = y;
            let backtrackDir = 6;  // 从左边开始（因为左边是背景）
            let maxSteps = w * h * 2;
            let steps = 0;
            
            do {
                contour.push({ x: cx, y: cy });
                visited[cy * w + cx] = 1;
                
                // 从回溯方向的下一个方向开始顺时针搜索
                let searchStart = (backtrackDir + 1) % 8;
                let found = false;
                
                for (let d = 0; d < 8; d++) {
                    const dir = (searchStart + d) % 8;
                    const nx = cx + dx8[dir];
                    const ny = cy + dy8[dir];
                    
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const nidx = ny * w + nx;
                        if (binaryData[nidx]) {
                            // 找到下一个前景点
                            backtrackDir = (dir + 4) % 8;  // 记录回溯方向（反方向）
                            cx = nx;
                            cy = ny;
                            found = true;
                            break;
                        }
                    }
                }
                
                if (!found) break;  // 孤立点
                steps++;
                
                // 检查是否回到起点（闭合轮廓）
                if (cx === startX && cy === startY) break;
                
            } while (steps < maxSteps);
            
            // 过滤太小的轮廓（噪声，至少10个点）
            if (contour.length >= 10) {
                contours.push(contour);
            }
        }
    }
    
    // 按轮廓大小排序，只保留较大的轮廓
    contours.sort((a, b) => b.length - a.length);
    
    // 限制最多30个轮廓
    return contours.slice(0, 30);
}

/**
 * RLE 行程编码二值图像
 * 格式: [w:2][h:2] + RLE数据
 */
function encodeRLE(binaryData, w, h) {
    const buffer = [];
    buffer.push(0xBB); // Magic byte for Binary RLE
    buffer.push(w >> 8, w & 0xFF);
    buffer.push(h >> 8, h & 0xFF);
    
    let currentBit = 0;
    let runLength = 0;
    
    for (let i = 0; i < binaryData.length; i++) {
        const bit = binaryData[i] ? 1 : 0;
        
        if (bit === currentBit && runLength < 255) {
            runLength++;
        } else {
            if (runLength > 0 || i > 0) {
                buffer.push(runLength);
            }
            currentBit = bit;
            runLength = 1;
        }
    }
    
    // 最后一段
    if (runLength > 0) {
        buffer.push(runLength);
    }
    
    return Buffer.from(buffer);
}

// ZSTD 压缩器 (懒加载)
let zstdCompressor = null;
async function getZstdCompressor() {
    if (!zstdCompressor) {
        try {
            const { init, compress } = require('@bokuweb/zstd-wasm');
            await init();
            zstdCompressor = compress;
        } catch (e) {
            console.warn('ZSTD 加载失败，使用 zlib 替代:', e.message);
            zstdCompressor = null;
        }
    }
    return zstdCompressor;
}

/**
 * 原始位图编码 (每8像素1字节 + ZSTD/zlib压缩)
 * 格式: [0xB0/0xB1, w_hi, w_lo, h_hi, h_lo, ...压缩的位图数据]
 * 0xB0 = zlib压缩, 0xB1 = ZSTD压缩
 */
async function encodeRawBitmap(binaryData, w, h) {
    const zlib = require('zlib');
    
    // 先打包成位图
    const bitmapData = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x += 8) {
            let byte = 0;
            for (let b = 0; b < 8 && x + b < w; b++) {
                if (binaryData[y * w + x + b]) {
                    byte |= (1 << (7 - b));
                }
            }
            bitmapData.push(byte);
        }
    }
    
    const bitmapBuffer = Buffer.from(bitmapData);
    
    // 尝试 ZSTD 压缩
    const zstdCompress = await getZstdCompressor();
    let compressed;
    let magic = 0xB0;
    
    if (zstdCompress) {
        try {
            // ZSTD 压缩 (level 19 = 最高压缩)
            const zstdResult = zstdCompress(bitmapBuffer, 19);
            compressed = Buffer.from(zstdResult);
            magic = 0xB1; // ZSTD 标记
        } catch (e) {
            // ZSTD 失败，回退到 zlib
            compressed = zlib.deflateSync(bitmapBuffer, { level: 9 });
        }
    } else {
        // zlib 压缩
        compressed = zlib.deflateSync(bitmapBuffer, { level: 9 });
    }
    
    // 组装: header + 压缩数据
    const buffer = Buffer.alloc(5 + compressed.length);
    buffer[0] = magic;
    buffer[1] = w >> 8;
    buffer[2] = w & 0xFF;
    buffer[3] = h >> 8;
    buffer[4] = h & 0xFF;
    compressed.copy(buffer, 5);
    
    return buffer;
}

class VisualMQTTServer {
    constructor(mqttPort = 3333, httpPort = 2026, host = '127.0.0.1') {
        this.mqttPort = mqttPort;
        this.httpPort = httpPort;
        this.host = host;
        this.mqttServer = null;
        this.httpServer = null;
        this.protoRoot = null;
        
        // 消息分类
        this.serverMessageNames = []; // 下行消息（服务器->客户端）
        this.clientMessageNames = []; // 上行消息（客户端->服务器）
        
        // 消息元数据（包含注释信息）
        this.messageMetadata = {};
        
        // 接收到的上行消息历史
        this.receivedMessages = [];
        this.maxHistorySize = 100;
        
        // 下行消息配置
        this.downlinkConfigs = {};
    // 每条消息的自动发送定时器映射
    this.autoPublishers = {};
        
        // 根据 Protocol.md 定义的状态映射
        this.statusMappings = {
            // 比赛阶段
            current_stage: [
                { value: 0, label: '未开始' },
                { value: 1, label: '准备阶段' },
                { value: 2, label: '自检阶段' },
                { value: 3, label: '倒计时' },
                { value: 4, label: '比赛中' },
                { value: 5, label: '结算中' }
            ],
            // 基地状态
            base_status: [
                { value: 0, label: '无敌' },
                { value: 1, label: '解除无敌护甲未展开' },
                { value: 2, label: '解除无敌护甲展开' }
            ],
            // 前哨站状态
            outpost_status: [
                { value: 0, label: '无敌' },
                { value: 1, label: '存活转' },
                { value: 2, label: '存活停' },
                { value: 3, label: '毁不可建' },
                { value: 4, label: '毁可建' }
            ],
            // 连接状态
            connection_state: [
                { value: 0, label: '未连接' },
                { value: 1, label: '连接' }
            ],
            // 上场状态
            field_state: [
                { value: 0, label: '已上场' },
                { value: 1, label: '未上场' }
            ],
            // 存活状态
            alive_state: [
                { value: 0, label: '未知' },
                { value: 1, label: '存活' },
                { value: 2, label: '战亡' }
            ],
            // 模块状态 (通用)
            power_manager: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            rfid: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            light_strip: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            small_shooter: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            big_shooter: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            uwb: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            armor: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            video_transmission: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            capacitor: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            main_controller: [{ value: 0, label: '离线' }, { value: 1, label: '在线' }],
            // 处罚类型
            penalty_type: [
                { value: 1, label: '黄牌' },
                { value: 2, label: '双方黄牌' },
                { value: 3, label: '红牌' },
                { value: 4, label: '超功率' },
                { value: 5, label: '超热量' },
                { value: 6, label: '超射速' }
            ],
            // 飞镖目标
            target_id: [
                { value: 1, label: '前哨站' },
                { value: 2, label: '基地固定目标' },
                { value: 3, label: '基地随机固定目标' },
                { value: 4, label: '基地随机移动目标' },
                { value: 5, label: '基地末端移动目标' }
            ],
            // 空中支援指令
            command_id: [
                { value: 1, label: '免费呼叫' },
                { value: 2, label: '花费金币呼叫' },
                { value: 3, label: '中断' }
            ],
            // Buff类型
            buff_type: [
                { value: 1, label: '攻击增益' },
                { value: 2, label: '防御增益' },
                { value: 3, label: '冷却增益' },
                { value: 4, label: '功率增益' },
                { value: 5, label: '回血增益' },
                { value: 6, label: '发弹增益' },
                { value: 7, label: '地形跨越增益' }
            ],
            // 能量机关状态
            rune_status: [
                { value: 1, label: '未激活' },
                { value: 2, label: '正在激活' },
                { value: 3, label: '已激活' }
            ],
            // 科技核心状态
            core_status: [
                { value: 1, label: '未进入装配状态' },
                { value: 2, label: '进入装配状态' },
                { value: 3, label: '已选择装配难度' },
                { value: 4, label: '装配中' },
                { value: 5, label: '装配完成' },
                { value: 6, label: '已确认装配,科技核心移动中' }
            ],
            // 部署模式状态 (DeployModeStatusSync的status字段)
            deploy_mode_status: [
                { value: 0, label: '未部署' },
                { value: 1, label: '已部署' }
            ],
            // 部署模式
            deploy_status: [
                { value: 0, label: '未部署' },
                { value: 1, label: '已部署' }
            ],
            // 空中支援状态
            airsupport_status: [
                { value: 0, label: '未进行空中支援' },
                { value: 1, label: '正在空中支援' },
                { value: 2, label: '空中支援被锁定' }
            ],
            // 哨兵姿态
            posture_id: [
                { value: 1, label: '进攻姿态' },
                { value: 2, label: '防御姿态' },
                { value: 3, label: '移动姿态' }
            ],
            intention: [
                { value: 1, label: '攻击' },
                { value: 2, label: '防守' },
                { value: 3, label: '移动' }
            ],
            // 装配操作
            operation: [
                { value: 1, label: '确认装配' },
                { value: 2, label: '取消装配' }
            ],
            // 性能体系
            shooter: [
                { value: 1, label: '冷却优先' },
                { value: 2, label: '爆发优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            chassis: [
                { value: 1, label: '血量优先' },
                { value: 2, label: '功率优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            performance_system_shooter: [
                { value: 1, label: '冷却优先' },
                { value: 2, label: '爆发优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            performance_system_chassis: [
                { value: 1, label: '血量优先' },
                { value: 2, label: '功率优先' },
                { value: 3, label: '英雄近战优先' },
                { value: 4, label: '英雄远程优先' }
            ],
            // 地图点击发送范围
            is_send_all: [
                { value: 0, label: '指定客户端' },
                { value: 1, label: '除哨兵' },
                { value: 2, label: '包含哨兵' }
            ],
            // 标记模式
            mode: [
                { value: 1, label: '地图' },
                { value: 2, label: '对方机器人' }
            ],
            // 标记类型
            type: [
                { value: 1, label: '攻击' },
                { value: 2, label: '防御' },
                { value: 3, label: '警戒' },
                { value: 4, label: '自定义' }
            ],
            // 英雄部署模式指令
            hero_deploy_mode: [
                { value: 0, label: '退出' },
                { value: 1, label: '进入' }
            ],
            // 能量机关激活
            activate: [
                { value: 0, label: '否' },
                { value: 1, label: '开启' }
            ],
            // 结果码
            result_code: [
                { value: 0, label: '成功' },
                { value: 1, label: '失败' }
            ],
            // 机制ID
            mechanism_id: [
                { value: 1, label: '己方堡垒被占领' },
                { value: 2, label: '对方堡垒被占领' }
            ],
            // 是否高亮
            is_high_light: [
                { value: 0, label: '否' },
                { value: 1, label: '是' }
            ]
        };
        
        // 消息名称友好显示映射
        this.messageDisplayNames = {
            GlobalUnitStatus: '全局单位状态',
            GameStatus: '比赛状态',
            GlobalLogisticsStatus: '全局后勤状态',
            GlobalSpecialMechanism: '全局特殊机制',
            Event: '事件通知',
            RobotInjuryStat: '机器人受伤统计',
            RobotRespawnStatus: '机器人复活状态',
            RobotStaticStatus: '机器人静态状态',
            RobotDynamicStatus: '机器人动态状态',
            RobotModuleStatus: '机器人模块状态',
            RobotPosition: '机器人位置',
            Buff: 'Buff 信息',
            PenaltyInfo: '判罚信息',
            RobotPathPlanInfo: '哨兵轨迹规划',
            RaderInfoToClient: '雷达位置信息',
            CustomByteBlock: '自定义数据块',
            TechCoreMotionStateSync: '科技核心运动状态',
            RobotPerformanceSelectionSync: '性能体系状态',
            DeployModeStatus: '部署模式状态',
            RuneStatusSync: '能量机关状态',
            SentinelStatusSync: '哨兵状态',
            DartSelectTargetStatusSync: '飞镖目标选择状态',
            GuardCtrlResult: '哨兵控制结果',
            AirSupportStatusSync: '空中支援状态'
        };

        // 每条消息默认频率 (Hz) - 依据 Protocol.md
        this.messageDefaultFrequencies = {
            GameStatus: 5, // 5Hz
            GlobalUnitStatus: 1, // 1Hz
            GlobalLogisticsStatus: 1, // 1Hz
            GlobalSpecialMechanism: 1, // 1Hz
            RobotInjuryStat: 1, // 1Hz
            RobotRespawnStatus: 1, // 1Hz
            RobotStaticStatus: 1, // 1Hz
            RobotDynamicStatus: 10, // 10Hz
            RobotModuleStatus: 1, // 1Hz
            RobotPosition: 1, // 1Hz
            Buff: 1, // 1Hz
            PenaltyInfo: 1, // trigger
            RobotPathPlanInfo: 1, // 1Hz
            RaderInfoToClient: 1, // 1Hz
            CustomByteBlock: 50, // 50Hz
            TechCoreMotionStateSync: 1, // 1Hz
            RobotPerformanceSelectionSync: 1, // 1Hz
            DeployModeStatusSync: 1, // 1Hz
            RuneStatusSync: 1, // 1Hz
            SentinelStatusSync: 1, // 1Hz
            DartSelectTargetStatusSync: 1, // 1Hz
            GuardCtrlResult: 1, // 1Hz
            AirSupportStatusSync: 1 // 1Hz
        };
        
        // 自动发送配置
        this.autoPublishInterval = null;
        this.autoPublishEnabled = false;
        this.autoPublishIntervalMs = 3000;
    }

    async loadProto() {
        try {
            const protoPath = path.join(__dirname, '..', 'proto', 'messages.proto');
            const protoText = fs.readFileSync(protoPath, 'utf8');
            
            // 清理并解析proto
            const protoTextSanitized = protoText.replace(/^\s*package\s+\S+;\s*$/gm, '');
            const parsed = protobuf.parse(protoTextSanitized);
            this.protoRoot = parsed.root;
            
            // 解析消息和注释
            this.parseProtoMessages(protoText);
            
            console.log('✅ Protobuf 定义加载成功');
            console.log(`📤 下行消息 (服务器->客户端): ${this.serverMessageNames.length} 个`);
            console.log(`📥 上行消息 (客户端->服务器): ${this.clientMessageNames.length} 个`);
            
            return true;
        } catch (error) {
            console.error('❌ Protobuf 加载失败:', error.message);
            return false;
        }
    }

    parseProtoMessages(protoText) {
        const lines = protoText.split(/\r?\n/);
        
        // 找到两个package的位置
        const upIndex = lines.findIndex(l => /^\s*package\s+rm_client_up\s*;/.test(l));
        const downIndex = lines.findIndex(l => /^\s*package\s+rm_client_down\s*;/.test(l));
        
        // 解析上行消息（客户端->服务器）
        if (upIndex !== -1) {
            const endIdx = downIndex !== -1 ? downIndex : lines.length;
            this.parseMessageBlock(lines, upIndex + 1, endIdx, 'client');
        }
        
        // 解析下行消息（服务器->客户端）
        if (downIndex !== -1) {
            this.parseMessageBlock(lines, downIndex + 1, lines.length, 'server');
        }
    }

    parseMessageBlock(lines, startIdx, endIdx, type) {
    let currentMessage = null;
    let currentField = null;
    let messageComments = [];
    let fieldComments = [];
        
        for (let i = startIdx; i < endIdx; i++) {
            const line = lines[i].trim();
            
            // 收集注释（区分消息注释和字段注释）
            if (line.startsWith('//')) {
                const comment = line.replace(/^\/\/\s*/, '');
                if (!currentMessage) {
                    // 消息级注释（在 message 声明之前）
                    messageComments.push(comment);
                } else {
                    // 字段注释（在消息内部，作用于下一行字段）
                    fieldComments.push(comment);
                }
                continue;
            }
            
            // 解析消息定义
            const msgMatch = line.match(/^\s*message\s+([A-Za-z0-9_]+)\s*\{/);
            if (msgMatch) {
                currentMessage = msgMatch[1];
                
                if (type === 'server') {
                    this.serverMessageNames.push(currentMessage);
                } else {
                    this.clientMessageNames.push(currentMessage);
                }
                
                // 清理消息描述：移除序号和重复的消息名
                let cleanedDescription = messageComments.join(' ');
                // 移除 "2.2.X MessageName" 格式
                cleanedDescription = cleanedDescription.replace(/^\d+\.\d+\.\d+\s+\w+\s*/, '');
                // 移除 "用途:" 前缀（保留用途内容）
                cleanedDescription = cleanedDescription.replace(/^用途:\s*/, '');
                
                // 生成友好的显示名称：优先使用 messageDisplayNames 映射（Protocol.md），否则使用清理后的描述或消息名
                const displayName = this.messageDisplayNames[currentMessage] || this.messageDisplayNames[cleanedDescription] || cleanedDescription || currentMessage;

                this.messageMetadata[currentMessage] = {
                    type: type,
                    description: cleanedDescription,
                    displayName: displayName,
                    fields: {},
                    comments: [...messageComments],
                    enumComments: {}  // 存储字段的枚举注释
                };
                
                messageComments = [];
                fieldComments = [];
                continue;
            }
            
            // 解析字段
            if (currentMessage) {
                const fieldMatch = line.match(/^\s*(repeated\s+)?(\w+)\s+(\w+)\s*=\s*(\d+)(?:\s*\[([^\]]+)\])?;(?:\s*\/\/\s*(.*))?/);
                if (fieldMatch) {
                    const [, repeated, fieldType, fieldName, fieldNumber, options, comment] = fieldMatch;
                    
                    // 检查之前的注释中是否有枚举定义
                    let enumComment = null;
                    for (const fc of fieldComments) {
                        if (fc.includes(fieldName) && fc.includes('枚举')) {
                            enumComment = fc;
                            break;
                        }
                    }
                    
                    const fieldDesc = fieldComments.filter(fc => !fc.includes('枚举')).join(' ') || comment || '';
                    
                    this.messageMetadata[currentMessage].fields[fieldName] = {
                        type: fieldType,
                        repeated: !!repeated,
                        number: parseInt(fieldNumber),
                        options: options || '',
                        comment: comment || '',
                        description: fieldDesc,
                        enumComment: enumComment  // 保存枚举注释
                    };
                    
                    // 如果有枚举注释，也存储到消息的enumComments中
                    if (enumComment) {
                        this.messageMetadata[currentMessage].enumComments[fieldName] = enumComment;
                    }
                    
                    fieldComments = [];
                }
                
                // 消息结束
                if (line === '}') {
                    currentMessage = null;
                    fieldComments = [];
                }
            }
        }
    }

    async loadCustomProto() {
        try {
            const fs = require('fs');
            const path = require('path');
            const sdkDir = path.join(__dirname, '..', 'sdk');
            let protoPath = path.join(sdkDir, 'default', 'custom_data.proto');
            
            // If default doesn't exist, try to find any other
            if (!fs.existsSync(protoPath)) {
                if (fs.existsSync(sdkDir)) {
                    const dirs = fs.readdirSync(sdkDir).filter(f => {
                        try {
                            return fs.statSync(path.join(sdkDir, f)).isDirectory() && f !== 'configs' && f !== 'versions';
                        } catch (e) { return false; }
                    });
                    if (dirs.length > 0) {
                        const dirPath = path.join(sdkDir, dirs[0]);
                        protoPath = path.join(dirPath, 'custom_data.proto');
                        if (!fs.existsSync(protoPath)) {
                            // 尝试查找同名proto文件
                            const dirName = dirs[0];
                            const namedProtoPath = path.join(dirPath, `${dirName}.proto`);
                            if (fs.existsSync(namedProtoPath)) {
                                protoPath = namedProtoPath;
                            }
                        }
                    }
                }
            }
            
            if (fs.existsSync(protoPath)) {
                const protoText = fs.readFileSync(protoPath, 'utf8');
                const parsed = protobuf.parse(protoText);
                this.customProtoRoot = parsed.root;
                console.log(`✅ 自定义 Proto 加载成功: ${protoPath}`);
            } else {
                console.log('⚠️ 未找到自定义 Proto 文件，将无法解析 CustomByteBlock 内部数据');
            }
        } catch (e) {
            console.error('加载自定义 Proto 失败:', e.message);
        }
    }

    async startMQTT() {
        return new Promise((resolve, reject) => {
            this.mqttServer = net.createServer(aedes.handle);

            this.mqttServer.on('error', (err) => {
                console.error(`❌ MQTT 服务器错误: ${err.message}`);
                reject(err);
            });

            // 监听客户端连接
            aedes.on('client', (client) => {
                console.log(`📱 MQTT 客户端已连接: ${client.id}`);
            });

            // 监听客户端断开
            aedes.on('clientDisconnect', (client) => {
                console.log(`📴 MQTT 客户端已断开: ${client.id}`);
            });

            // 监听订阅
            aedes.on('subscribe', (subscriptions, client) => {
                console.log(`📌 客户端 ${client.id} 订阅:`, subscriptions.map(s => s.topic).join(', '));
            });

            // 监听客户端发布的消息
            aedes.on('publish', async (packet, client) => {
                if (!client) return;
                
                const topic = packet.topic;
                
                // 尝试解析消息
                for (const msgName of this.clientMessageNames) {
                    if (topic.includes(msgName) || topic === msgName) {
                        try {
                            const MessageType = this.protoRoot.lookupType(msgName);
                            const decoded = MessageType.decode(packet.payload);
                            const obj = MessageType.toObject(decoded, { 
                                longs: String, 
                                enums: String, 
                                bytes: String,
                                defaults: true
                            });
                            
                            // CustomByteBlock 特殊处理：尝试解析内部数据
                            if (msgName === 'CustomByteBlock' && this.customProtoRoot) {
                                try {
                                    const CustomType = this.customProtoRoot.lookupType('CustomByteBlock');
                                    let rawData = decoded.data;
                                    if (!Buffer.isBuffer(rawData) && obj.data) {
                                        rawData = Buffer.from(obj.data, 'base64');
                                    }
                                    
                                    if (rawData && rawData.length > 0) {
                                        const customDecoded = CustomType.decode(rawData);
                                        const customObj = CustomType.toObject(customDecoded, {
                                            longs: String, 
                                            enums: String, 
                                            bytes: String,
                                            defaults: true
                                        });
                                        obj.customData = customObj;
                                    }
                                } catch (innerErr) {
                                    // console.warn('⚠️ 解析 CustomByteBlock 内部数据失败:', innerErr.message);
                                }
                            }
                            
                            // 解析字段的实际含义
                            const parsedData = this.parseFieldValues(msgName, obj);
                            
                            // 保存到历史记录
                            this.receivedMessages.unshift({
                                timestamp: new Date().toISOString(),
                                clientId: client.id,
                                topic: topic,
                                messageType: msgName,
                                data: obj,
                                parsedData: parsedData  // 添加解析后的数据
                            });
                            
                            // 限制历史记录大小
                            if (this.receivedMessages.length > this.maxHistorySize) {
                                this.receivedMessages = this.receivedMessages.slice(0, this.maxHistorySize);
                            }
                            
                            console.log(`📥 收到上行消息 - 客户端: ${client.id}, 类型: ${msgName}`);
                            
                        } catch (err) {
                            console.error(`❌ 解析消息失败 (${msgName}):`, err.message);
                        }
                        break;
                    }
                }
            });

            this.mqttServer.listen(this.mqttPort, this.host, () => {
                console.log(`✅ MQTT 服务已启动 - mqtt://${this.host}:${this.mqttPort}`);
                resolve();
            });
        });
    }

    startHTTP() {
        this.httpServer = http.createServer((req, res) => {
            // 设置CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            const url = new URL(req.url, `http://${req.headers.host}`);
            
            // 路由处理
            if (url.pathname === '/' || url.pathname === '/index.html') {
                this.serveHTML(res);
            } else if (url.pathname === '/api/messages') {
                this.handleGetMessages(res);
            } else if (url.pathname === '/api/uplink-history') {
                this.handleGetUplinkHistory(res);
            } else if (url.pathname === '/api/publish' && req.method === 'POST') {
                this.handlePublish(req, res);
            } else if (url.pathname === '/api/auto-publish' && req.method === 'POST') {
                this.handleAutoPublish(req, res);
            } else if (url.pathname === '/api/save-proto' && req.method === 'POST') {
                this.handleSaveProto(req, res);
            } else if (url.pathname === '/api/save-c' && req.method === 'POST') {
                this.handleSaveC(req, res);
            } else if (url.pathname === '/api/save-config' && req.method === 'POST') {
                this.handleSaveConfig(req, res);
            } else if (url.pathname === '/api/list-configs' && req.method === 'GET') {
                this.handleListConfigs(req, res);
            } else if (url.pathname === '/api/available-configs' && req.method === 'GET') {
                this.handleAvailableConfigs(req, res);
            } else if (url.pathname === '/api/load-config' && req.method === 'GET') {
                this.handleLoadConfig(req, res);
            } else if (url.pathname === '/api/delete-config' && req.method === 'POST') {
                this.handleDeleteConfig(req, res);
            } else if (url.pathname === '/api/load-proto' && req.method === 'GET') {
                this.handleLoadProto(req, res);
            } else if (url.pathname === '/api/generate-proto' && req.method === 'POST') {
                this.handleGenerateProto(req, res);
            } else if (url.pathname === '/api/generate-c-sdk' && req.method === 'POST') {
                this.handleGenerateCSDK(req, res);
            } else if (url.pathname === '/api/compress-image' && req.method === 'POST') {
                this.handleCompressImage(req, res);
            } else if (url.pathname === '/lib/vue.global.prod.js') {
                const filePath = path.join(__dirname, 'lib', 'vue.global.prod.js');
                fs.readFile(filePath, (err, content) => {
                    if (err) {
                        res.writeHead(500);
                        res.end('Error loading Vue.js');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/javascript' });
                        res.end(content);
                    }
                });
            } else if (url.pathname.startsWith('/js/')) {
                // Serve compiled JS files
                const filePath = path.join(__dirname, '..', 'frontend', 'public', url.pathname);
                fs.readFile(filePath, (err, content) => {
                    if (err) {
                        console.error(`File not found: ${filePath}`);
                        res.writeHead(404);
                        res.end('Not Found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/javascript' });
                        res.end(content);
                    }
                });
            } else if (url.pathname.startsWith('/css/')) {
                // Serve CSS files
                const filePath = path.join(__dirname, '..', 'frontend', 'public', url.pathname);
                fs.readFile(filePath, (err, content) => {
                    if (err) {
                        console.error(`File not found: ${filePath}`);
                        res.writeHead(404);
                        res.end('Not Found');
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/css' });
                        res.end(content);
                    }
                });
            } else if (url.pathname === '/favicon.ico') {
                res.writeHead(204);
                res.end();
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.httpServer.listen(this.httpPort, this.host, () => {
            console.log(`✅ Web 可视化界面已启动 - http://${this.host}:${this.httpPort}`);
            console.log(`🌐 请在浏览器中打开: http://${this.host}:${this.httpPort}`);
        });
    }

    serveHTML(res) {
        const html = this.generateHTML();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    }

    handleGetMessages(res) {
        const response = {
            serverMessages: this.serverMessageNames.map(name => ({
                name: name,
                metadata: this.messageMetadata[name]
            })),
            clientMessages: this.clientMessageNames.map(name => ({
                name: name,
                metadata: this.messageMetadata[name]
            })),
            statusMappings: this.statusMappings  // 添加状态映射
            , messageDefaultFrequencies: this.messageDefaultFrequencies,
            autoPublishers: Object.keys(this.autoPublishers)
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
    }

    handleGetUplinkHistory(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.receivedMessages));
    }

    handlePublish(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { messageType, data, topic, customConfigName } = JSON.parse(body);
                
                // 获取消息类型
                const MessageType = this.protoRoot.lookupType(messageType);
                
                // 转换数据
                let convertedData = this.convertKeysToCamel(data);
                
                // CustomByteBlock 特殊处理：需要先编码内部数据
                if (messageType === 'CustomByteBlock') {
                    let innerBuffer = null;
                    
                    // 1. 尝试使用 Raw C Struct 编码 (模拟 MCU 发送的 150 字节)
                    if (customConfigName) {
                        innerBuffer = this.encodeCustomDataRaw(convertedData, customConfigName);
                    }
                    
                    // 2. 如果 Raw 编码失败（例如没找到配置），尝试回退到 Proto 编码（旧逻辑）
                    if (!innerBuffer && this.customProtoRoot) {
                        try {
                            const CustomType = this.customProtoRoot.lookupType('CustomByteBlock');
                            const errMsg = CustomType.verify(convertedData);
                            if (!errMsg) {
                                const innerMessage = CustomType.create(convertedData);
                                innerBuffer = CustomType.encode(innerMessage).finish();
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                    
                    // 如果成功编码了内部数据，将其作为 data 字段
                    if (innerBuffer) {
                        convertedData = { data: innerBuffer };
                    }
                }
                
                // 验证数据
                const errMsg = MessageType.verify(convertedData);
                if (errMsg) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `数据验证失败: ${errMsg}` }));
                    return;
                }
                
                // 创建并编码消息
                const message = MessageType.create(convertedData);
                const buffer = MessageType.encode(message).finish();
                
                // 发布到MQTT
                const publishTopic = topic || messageType;
                
                // 打印完整的 MQTT 发送数据 (含 Protobuf 封装)
                if (messageType === 'CustomByteBlock') {
                    console.log('');
                    console.log('╔══════════════════════════════════════════════════════════════╗');
                    console.log('║           📡 MQTT 完整发送数据 (含 Protobuf 封装)            ║');
                    console.log('╠══════════════════════════════════════════════════════════════╣');
                    console.log(`║ Topic: ${publishTopic.padEnd(54)}║`);
                    console.log(`║ 总大小: ${buffer.length} 字节 (Protobuf头 + 150字节原始数据)`.padEnd(63) + '║');
                    console.log('╠══════════════════════════════════════════════════════════════╣');
                    console.log('║ 完整 Hex Dump:                                               ║');
                    console.log('╟──────────────────────────────────────────────────────────────╢');
                    
                    // 按行显示，每行 16 字节
                    for (let i = 0; i < buffer.length; i += 16) {
                        const line = buffer.slice(i, Math.min(i + 16, buffer.length));
                        const hex = Array.from(line).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                        const ascii = Array.from(line).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
                        const addr = i.toString(16).padStart(4, '0').toUpperCase();
                        console.log(`║ ${addr}: ${hex.padEnd(48)}| ${ascii.padEnd(16)} ║`);
                    }
                    
                    console.log('╠══════════════════════════════════════════════════════════════╣');
                    console.log('║ 结构分析:                                                    ║');
                    console.log(`║   [0x0000-0x0002] Protobuf 头 (字段号+类型+长度)             ║`);
                    console.log(`║   [0x0003-0x0098] 150字节原始数据 (raw_data)                 ║`);
                    console.log('╚══════════════════════════════════════════════════════════════╝');
                    console.log('');
                }
                
                aedes.publish({
                    topic: publishTopic,
                    payload: buffer,
                    qos: 0,
                    retain: false
                }, (err) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } else {
                        console.log(`📤 手动发送下行消息 - 类型: ${messageType}, 大小: ${buffer.length} 字节`);
                            // 保存为自动发送模板
                            this.downlinkConfigs[messageType] = convertedData;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: true, 
                            topic: publishTopic,
                            size: buffer.length 
                        }));
                    }
                });
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleAutoPublish(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { messageType, enabled, intervalMs, topic, data, customConfigName } = JSON.parse(body);
                
                if (!messageType) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'messageType is required' }));
                    return;
                }
                
                if (enabled) {
                    // store template data for this message
                    if (data) {
                        let convertedData = this.convertKeysToCamel(data);
                        
                        // CustomByteBlock 特殊处理：需要先编码内部数据
                        if (messageType === 'CustomByteBlock') {
                            let innerBuffer = null;
                            
                            // 尝试使用 Raw C Struct 编码 (模拟 MCU 发送的 150 字节)
                            if (customConfigName) {
                                innerBuffer = this.encodeCustomDataRaw(convertedData, customConfigName);
                            }
                            
                            // 如果 Raw 编码失败（例如没找到配置），尝试回退到 Proto 编码（旧逻辑）
                            if (!innerBuffer && this.customProtoRoot) {
                                try {
                                    const CustomType = this.customProtoRoot.lookupType('CustomByteBlock');
                                    const errMsg = CustomType.verify(convertedData);
                                    if (!errMsg) {
                                        const innerMessage = CustomType.create(convertedData);
                                        innerBuffer = CustomType.encode(innerMessage).finish();
                                    }
                                } catch (e) {}
                            }
                            
                            if (innerBuffer) {
                                convertedData = { data: innerBuffer };
                            }
                        }
                        
                        this.downlinkConfigs[messageType] = convertedData;
                    }
                    this.startAutoPublishForMessage(messageType, intervalMs || this.messageDefaultFrequencies[messageType], topic);
                } else {
                    this.stopAutoPublishForMessage(messageType);
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true,
                    messageType: messageType,
                    enabled: !!this.autoPublishers[messageType],
                    intervalMs: this.autoPublishers[messageType]?.intervalMs || 0
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleSaveProto(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { content, configName } = JSON.parse(body);
                
                if (!content) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'content is required' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                
                // 根据配置名称创建文件夹
                let dir, relativePath, safeName;
                if (configName) {
                    safeName = configName.replace(/[<>:"/\\|?*]/g, '_');
                    dir = path.join(__dirname, '..', 'sdk', safeName);
                    relativePath = `sdk/${safeName}`;
                } else {
                    dir = path.join(__dirname, '..', 'sdk', 'default');
                    relativePath = 'sdk/default';
                }
                
                const fileName = configName ? `${safeName}.proto` : 'custom_data.proto';
                const filePath = path.join(dir, fileName);
                
                // 创建目录
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // 写入文件
                fs.writeFileSync(filePath, content, 'utf8');
                
                console.log(`📝 已保存 Proto 文件 [${configName || '默认'}]: ${filePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    path: `${relativePath}/${fileName}`
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleSaveC(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { hContent, cContent, configName } = JSON.parse(body);
                
                if (!hContent || !cContent) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'hContent and cContent are required' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                
                // 根据配置名称创建文件夹
                let dir;
                let relativePath;
                if (configName) {
                    // 清理配置名称，移除非法文件名字符
                    const safeName = configName.replace(/[<>:"/\\|?*]/g, '_');
                    dir = path.join(__dirname, '..', 'sdk', safeName);
                    relativePath = `sdk/${safeName}`;
                } else {
                    dir = path.join(__dirname, '..', 'sdk', 'default');
                    relativePath = 'sdk/default';
                }
                
                const hFilePath = path.join(dir, 'custom_data.h');
                const cFilePath = path.join(dir, 'custom_data.c');
                
                // 创建目录
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // 写入 .h 文件
                fs.writeFileSync(hFilePath, hContent, 'utf8');
                
                // 写入 .c 文件
                fs.writeFileSync(cFilePath, cContent, 'utf8');
                
                console.log(`📝 已保存 C SDK 文件 [${configName || '默认'}]:`);
                console.log(`   - ${hFilePath}`);
                console.log(`   - ${cFilePath}`);
                
                // 使用 Web 方案进行语法检查
                const syntaxCheck = this.checkCSyntax(hContent, cContent);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    hPath: `${relativePath}/custom_data.h`,
                    cPath: `${relativePath}/custom_data.c`,
                    syntaxCheck: syntaxCheck
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleSaveConfig(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { name, description, items, totalSize, imageCompanionFields } = JSON.parse(body);
                
                if (!name || !items || items.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'name and items are required' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                const dir = path.join(__dirname, '..', 'sdk', 'configs');
                
                // 创建目录
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // 分离字段类型
                const imageBlockField = items.find(i => i.type === 'ImageBlock' || i.type === 'image_block');
                const pureDataFields = items.filter(i => i.type !== 'ImageBlock' && i.type !== 'image_block');
                const companionFieldNames = imageCompanionFields || [];
                const companionFields = companionFieldNames.map(fn => items.find(i => i.name === fn)).filter(Boolean);
                
                // 计算各模式大小
                const pureDataSize = 1 + pureDataFields.reduce((sum, f) => sum + this.getTypeSize(f.type), 0); // 1 byte mode + fields
                const imageDataSize = 1 + companionFields.reduce((sum, f) => sum + this.getTypeSize(f.type), 0) + 128; // 1 byte mode + companion + ImageBlock(128)
                
                // 生成XML内容
                const timestamp = new Date().toISOString();
                let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
                xmlContent += '<!--\n';
                xmlContent += '  CustomDataBlock 配置文件\n';
                xmlContent += '  \n';
                xmlContent += '  数据帧总大小: 150 字节 (固定)\n';
                xmlContent += '  传输模式由第一个字节决定:\n';
                xmlContent += '    0x00 = 纯数据模式 (Pure Data Mode)\n';
                xmlContent += '    0x01 = 图片传输模式 (Image Data Mode)\n';
                xmlContent += '-->\n';
                xmlContent += '<CustomDataBlockConfig>\n';
                xmlContent += `  <Metadata>\n`;
                xmlContent += `    <Name>${this.escapeXml(name)}</Name>\n`;
                xmlContent += `    <Description>${this.escapeXml(description || '')}</Description>\n`;
                xmlContent += `    <CreatedAt>${timestamp}</CreatedAt>\n`;
                xmlContent += `    <FrameSize unit="bytes">150</FrameSize>\n`;
                xmlContent += `  </Metadata>\n\n`;
                
                // ========== 纯数据模式 ==========
                xmlContent += `  <!-- ═══════════════════════════════════════════════════════════ -->\n`;
                xmlContent += `  <!-- 模式 0x00: 纯数据模式 (Pure Data Mode)                      -->\n`;
                xmlContent += `  <!-- 帧结构: [Mode:1B] [DataFields:${pureDataSize-1}B] [Padding:${150-pureDataSize}B]       -->\n`;
                xmlContent += `  <!-- ═══════════════════════════════════════════════════════════ -->\n`;
                xmlContent += `  <PureDataMode>\n`;
                xmlContent += `    <ModeValue>0x00</ModeValue>\n`;
                xmlContent += `    <UsedBytes>${pureDataSize}</UsedBytes>\n`;
                xmlContent += `    <Layout>\n`;
                xmlContent += `      <!-- 偏移 0x0000: 模式字节 -->\n`;
                xmlContent += `      <Mode offset="0x0000" size="1">0x00</Mode>\n`;
                
                let offset = 1;
                pureDataFields.forEach((item, index) => {
                    const size = this.getTypeSize(item.type);
                    xmlContent += `      <!-- 偏移 0x${offset.toString(16).padStart(4, '0')}: ${item.name} -->\n`;
                    xmlContent += `      <Field index="${index + 1}" offset="0x${offset.toString(16).padStart(4, '0')}">\n`;
                    xmlContent += `        <Name>${this.escapeXml(item.name)}</Name>\n`;
                    xmlContent += `        <Type>${this.escapeXml(item.type)}</Type>\n`;
                    xmlContent += `        <Size unit="bytes">${size}</Size>\n`;
                    if (item.arraySize !== undefined && item.arraySize > 1) {
                        xmlContent += `        <ArraySize>${item.arraySize}</ArraySize>\n`;
                    }
                    if (item.min !== undefined || item.max !== undefined) {
                        xmlContent += `        <Range min="${item.min ?? 'null'}" max="${item.max ?? 'null'}" />\n`;
                    }
                    xmlContent += `      </Field>\n`;
                    offset += size;
                });
                
                if (offset < 150) {
                    xmlContent += `      <!-- 偏移 0x${offset.toString(16).padStart(4, '0')}-0x0095: 填充字节 -->\n`;
                    xmlContent += `      <Padding offset="0x${offset.toString(16).padStart(4, '0')}" size="${150 - offset}" />\n`;
                }
                
                xmlContent += `    </Layout>\n`;
                xmlContent += `  </PureDataMode>\n\n`;
                
                // ========== 图片传输模式 ==========
                if (imageBlockField) {
                    xmlContent += `  <!-- ═══════════════════════════════════════════════════════════ -->\n`;
                    xmlContent += `  <!-- 模式 0x01: 图片传输模式 (Image Data Mode)                   -->\n`;
                    xmlContent += `  <!-- 帧结构: [Mode:1B] [Companion:${imageDataSize-129}B] [ImageBlock:128B] [Pad:${150-imageDataSize}B] -->\n`;
                    xmlContent += `  <!-- ═══════════════════════════════════════════════════════════ -->\n`;
                    xmlContent += `  <ImageDataMode>\n`;
                    xmlContent += `    <ModeValue>0x01</ModeValue>\n`;
                    xmlContent += `    <UsedBytes>${imageDataSize}</UsedBytes>\n`;
                    xmlContent += `    <Layout>\n`;
                    xmlContent += `      <!-- 偏移 0x0000: 模式字节 -->\n`;
                    xmlContent += `      <Mode offset="0x0000" size="1">0x01</Mode>\n`;
                    
                    offset = 1;
                    
                    // 伴随字段
                    if (companionFields.length > 0) {
                        xmlContent += `      <!-- ─── 伴随数据字段 (Companion Fields) ─── -->\n`;
                        companionFields.forEach((item, index) => {
                            const size = this.getTypeSize(item.type);
                            xmlContent += `      <CompanionField index="${index + 1}" offset="0x${offset.toString(16).padStart(4, '0')}">\n`;
                            xmlContent += `        <Name>${this.escapeXml(item.name)}</Name>\n`;
                            xmlContent += `        <Type>${this.escapeXml(item.type)}</Type>\n`;
                            xmlContent += `        <Size unit="bytes">${size}</Size>\n`;
                            xmlContent += `      </CompanionField>\n`;
                            offset += size;
                        });
                    }
                    
                    // ImageBlock 结构
                    xmlContent += `      <!-- ─── ImageBlock 结构 (128 字节) ─── -->\n`;
                    xmlContent += `      <ImageBlock offset="0x${offset.toString(16).padStart(4, '0')}" size="128">\n`;
                    xmlContent += `        <Name>${this.escapeXml(imageBlockField.name)}</Name>\n`;
                    xmlContent += `        <Structure>\n`;
                    xmlContent += `          <Field name="cmd_type"   offset="+0x00" type="uint8_t"  size="1" desc="命令类型: 0x02=数据块, 0x03=结束帧" />\n`;
                    xmlContent += `          <Field name="img_id"     offset="+0x01" type="uint16_t" size="2" desc="图片ID (小端序)" />\n`;
                    xmlContent += `          <Field name="block_idx"  offset="+0x03" type="uint16_t" size="2" desc="当前块索引" />\n`;
                    xmlContent += `          <Field name="total_block" offset="+0x05" type="uint16_t" size="2" desc="总块数" />\n`;
                    xmlContent += `          <Field name="data_len"   offset="+0x07" type="uint8_t"  size="1" desc="有效数据长度 (0-120)" />\n`;
                    xmlContent += `          <Field name="data"       offset="+0x08" type="uint8_t[120]" size="120" desc="图片数据块" />\n`;
                    xmlContent += `        </Structure>\n`;
                    xmlContent += `      </ImageBlock>\n`;
                    
                    offset += 128;
                    if (offset < 150) {
                        xmlContent += `      <!-- 偏移 0x${offset.toString(16).padStart(4, '0')}-0x0095: 填充字节 -->\n`;
                        xmlContent += `      <Padding offset="0x${offset.toString(16).padStart(4, '0')}" size="${150 - offset}" />\n`;
                    }
                    
                    xmlContent += `    </Layout>\n`;
                    xmlContent += `  </ImageDataMode>\n\n`;
                }
                
                // ========== 原始字段列表 (向后兼容) ==========
                xmlContent += `  <!-- ═══════════════════════════════════════════════════════════ -->\n`;
                xmlContent += `  <!-- 字段定义列表 (向后兼容)                                      -->\n`;
                xmlContent += `  <!-- ═══════════════════════════════════════════════════════════ -->\n`;
                if (companionFieldNames.length > 0) {
                    xmlContent += `  <ImageCompanionFields>\n`;
                    companionFieldNames.forEach(fieldName => {
                        xmlContent += `    <Field>${this.escapeXml(fieldName)}</Field>\n`;
                    });
                    xmlContent += `  </ImageCompanionFields>\n`;
                }

                xmlContent += `  <Fields count="${items.length}">\n`;
                
                items.forEach((item, index) => {
                    xmlContent += `    <Field index="${index + 1}">\n`;
                    xmlContent += `      <Name>${this.escapeXml(item.name)}</Name>\n`;
                    xmlContent += `      <Type>${this.escapeXml(item.type)}</Type>\n`;
                    if (item.arraySize !== undefined) {
                        xmlContent += `      <ArraySize>${item.arraySize}</ArraySize>\n`;
                    }
                    xmlContent += `      <Size unit="bytes">${this.getTypeSize(item.type)}</Size>\n`;
                    if (item.min !== undefined || item.max !== undefined) {
                        xmlContent += `      <Range>\n`;
                        xmlContent += `        <Min>${item.min !== undefined ? item.min : 'null'}</Min>\n`;
                        xmlContent += `        <Max>${item.max !== undefined ? item.max : 'null'}</Max>\n`;
                        xmlContent += `      </Range>\n`;
                    }
                    xmlContent += `    </Field>\n`;
                });
                
                xmlContent += `  </Fields>\n`;
                xmlContent += '</CustomDataBlockConfig>\n';
                
                // 保存文件
                const fileName = `${name}.xml`;
                const filePath = path.join(dir, fileName);
                fs.writeFileSync(filePath, xmlContent, 'utf8');
                
                console.log(`📝 已保存配置: ${filePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    path: `sdk/configs/${fileName}`
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleListConfigs(req, res) {
        try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.join(__dirname, '..', 'sdk', 'configs');
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
            const configs = [];
            
            files.forEach(file => {
                try {
                    const filePath = path.join(dir, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    
                    // 简单解析XML获取元数据
                    const nameMatch = content.match(/<Name>(.*?)<\/Name>/);
                    const descMatch = content.match(/<Description>(.*?)<\/Description>/);
                    const timeMatch = content.match(/<CreatedAt>(.*?)<\/CreatedAt>/);
                    
                    // 解析 PureDataMode 和 ImageDataMode 的 UsedBytes
                    const pureMatch = content.match(/<PureDataMode>[\s\S]*?<UsedBytes>(\d+)<\/UsedBytes>/);
                    const imageMatch = content.match(/<ImageDataMode>[\s\S]*?<UsedBytes>(\d+)<\/UsedBytes>/);
                    
                    const pureDataSize = pureMatch ? parseInt(pureMatch[1]) : 0;
                    const imageDataSize = imageMatch ? parseInt(imageMatch[1]) : 0;
                    
                    // 检查是否有 ImageBlock
                    const hasImageBlock = content.includes('<Type>ImageBlock</Type>') || content.includes('<Type>image_block</Type>');
                    
                    if (nameMatch) {
                        configs.push({
                            name: nameMatch[1],
                            description: descMatch ? descMatch[1] : '',
                            pureDataSize,
                            imageDataSize,
                            hasImageBlock,
                            createdAt: timeMatch ? new Date(timeMatch[1]).toLocaleString('zh-CN') : ''
                        });
                    }
                } catch (err) {
                    console.error(`解析配置文件 ${file} 失败:`, err.message);
                }
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, configs }));
            
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }

    // 返回可用配置名称列表(简化版)
    handleAvailableConfigs(req, res) {
        try {
            const fs = require('fs');
            const path = require('path');
            const dir = path.join(__dirname, '..', 'sdk', 'configs');
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
            const configs = files.map(f => {
                // 从文件内容中读取配置名称和大小信息
                try {
                    const content = fs.readFileSync(path.join(dir, f), 'utf8');
                    const nameMatch = content.match(/<Name>(.*?)<\/Name>/);
                    const name = nameMatch ? nameMatch[1] : f.replace('.xml', '');
                    
                    // 解析 PureDataMode 和 ImageDataMode 的 UsedBytes
                    const pureMatch = content.match(/<PureDataMode>[\s\S]*?<UsedBytes>(\d+)<\/UsedBytes>/);
                    const imageMatch = content.match(/<ImageDataMode>[\s\S]*?<UsedBytes>(\d+)<\/UsedBytes>/);
                    
                    const pureDataSize = pureMatch ? parseInt(pureMatch[1]) : 0;
                    const imageDataSize = imageMatch ? parseInt(imageMatch[1]) : 0;
                    
                    // 检查是否有 ImageBlock
                    const hasImageBlock = content.includes('<Type>ImageBlock</Type>') || content.includes('<Type>image_block</Type>');
                    
                    return {
                        name,
                        pureDataSize,
                        imageDataSize,
                        hasImageBlock
                    };
                } catch (err) {
                    return {
                        name: f.replace('.xml', ''),
                        pureDataSize: 0,
                        imageDataSize: 0,
                        hasImageBlock: false
                    };
                }
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, configs }));
            
        } catch (error) {
            console.error('获取配置列表失败:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message, configs: [] }));
        }
    }

    handleLoadConfig(req, res) {
        try {
            const url = require('url');
            const queryParams = url.parse(req.url, true).query;
            const name = queryParams.name;
            
            if (!name) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'name is required' }));
                return;
            }
            
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '..', 'sdk', 'configs', `${name}.xml`);
            
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '配置不存在' }));
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            
            // 解析XML
            const nameMatch = content.match(/<Name>(.*?)<\/Name>/);
            const descMatch = content.match(/<Description>(.*?)<\/Description>/);
            
            // 解析字段
            const fieldsBlock = content.match(/<Fields[^>]*>([\s\S]*?)<\/Fields>/)?.[1] || '';
            const fieldMatches = [...fieldsBlock.matchAll(/<Field[^>]*>([\s\S]*?)<\/Field>/g)];
            
            const items = fieldMatches.map(match => {
                const fieldContent = match[1];
                const itemName = fieldContent.match(/<Name>(.*?)<\/Name>/)?.[1] || '';
                const itemType = fieldContent.match(/<Type>(.*?)<\/Type>/)?.[1] || '';
                const arraySizeMatch = fieldContent.match(/<ArraySize>(.*?)<\/ArraySize>/);
                const minMatch = fieldContent.match(/<Min>(.*?)<\/Min>/);
                const maxMatch = fieldContent.match(/<Max>(.*?)<\/Max>/);
                
                const item = { name: itemName, type: itemType };
                if (arraySizeMatch) item.arraySize = parseInt(arraySizeMatch[1]);
                else item.arraySize = 1;
                if (minMatch && minMatch[1] !== 'null') item.min = parseFloat(minMatch[1]);
                if (maxMatch && maxMatch[1] !== 'null') item.max = parseFloat(maxMatch[1]);
                
                return item;
            });

            // 解析图片伴随字段
            const companionBlock = content.match(/<ImageCompanionFields>([\s\S]*?)<\/ImageCompanionFields>/)?.[1] || '';
            const imageCompanionFields = [...companionBlock.matchAll(/<Field>(.*?)<\/Field>/g)].map(m => m[1]);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                config: {
                    name: nameMatch ? nameMatch[1] : name,
                    description: descMatch ? descMatch[1] : '',
                    items,
                    imageCompanionFields
                }
            }));
            
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }

    handleDeleteConfig(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { name } = JSON.parse(body);
                
                if (!name) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'name is required' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                const filePath = path.join(__dirname, '..', 'sdk', 'configs', `${name}.xml`);
                
                if (!fs.existsSync(filePath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: '配置不存在' }));
                    return;
                }
                
                fs.unlinkSync(filePath);
                console.log(`🗑️ 已删除配置: ${filePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    handleLoadProto(req, res) {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const configName = url.searchParams.get('name');
            
            const fs = require('fs');
            const path = require('path');
            
            let filePath;
            if (configName) {
                const safeName = configName.replace(/[<>:"/\\|?*]/g, '_');
                filePath = path.join(__dirname, '..', 'sdk', safeName, `${safeName}.proto`);
                if (!fs.existsSync(filePath)) {
                    filePath = path.join(__dirname, '..', 'sdk', safeName, 'custom_data.proto');
                }
            } else {
                filePath = path.join(__dirname, '..', 'sdk', 'default', 'custom_data.proto');
            }
            
            if (!fs.existsSync(filePath)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Proto文件不存在' }));
                return;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                content: content,
                path: filePath
            }));
            
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    }

    handleGenerateProto(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // 兼容两种格式: {name, items} 或 {configName, dataItems}
                const name = data.name || data.configName;
                const items = data.items || data.dataItems;
                
                if (!name || !items || !Array.isArray(items)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '缺少必要参数: name/configName 和 items/dataItems' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
                const sdkDir = path.join(__dirname, '..', 'sdk', safeName);
                
                // 创建目录
                if (!fs.existsSync(sdkDir)) {
                    fs.mkdirSync(sdkDir, { recursive: true });
                }
                
                // 生成 Proto 内容 - 只包含一个 150 字节的原始二进制数据字段
                let protoContent = `syntax = "proto3";\n\n`;
                protoContent += `package custom_data;\n\n`;
                protoContent += `/**\n`;
                protoContent += ` * 自定义数据块消息\n`;
                protoContent += ` * 包含 150 字节的原始二进制数据，与裁判系统自定义数据块格式一致\n`;
                protoContent += ` * \n`;
                protoContent += ` * 数据结构 (${safeName}):\n`;
                
                // 类型大小映射
                const typeSizes = {
                    'bool': 1,
                    'int8': 1, 'uint8': 1, 'int8_t': 1, 'uint8_t': 1,
                    'int16': 2, 'uint16': 2, 'int16_t': 2, 'uint16_t': 2,
                    'int32': 4, 'uint32': 4, 'int32_t': 4, 'uint32_t': 4,
                    'int64': 8, 'uint64': 8,
                    'float': 4, 'double': 8,
                    'ImageBlock': 128, 'image_block': 128,
                };
                
                // 添加字段说明注释
                let offset = 0;
                items.forEach(item => {
                    const typeSize = typeSizes[item.type] || item.size || 0;
                    const arraySize = item.arraySize || 1;
                    const totalSize = typeSize * arraySize;
                    const arrayNote = arraySize > 1 ? `[${arraySize}]` : '';
                    protoContent += ` *   - ${item.name}: ${item.type}${arrayNote} (offset: ${offset}, size: ${totalSize}B)\n`;
                    offset += totalSize;
                });
                protoContent += ` * 总数据大小: ${offset} 字节 (填充至 150 字节)\n`;
                protoContent += ` */\n`;
                protoContent += `message CustomByteBlock {\n`;
                protoContent += `    // 150 字节原始二进制数据\n`;
                protoContent += `    bytes raw_data = 1;\n`;
                protoContent += `}\n`;
                
                // 保存文件
                const protoPath = path.join(sdkDir, `${safeName}.proto`);
                fs.writeFileSync(protoPath, protoContent);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    path: protoPath,
                    filePath: protoPath,  // 兼容 CustomDataConfig.js
                    content: protoContent
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    }

    handleGenerateCSDK(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                // 兼容两种格式: {name, items} 或 {configName, dataItems}
                const configName = data.name || data.configName;
                const items = data.items || data.dataItems || [];
                const imageCompanionFields = data.imageCompanionFields || [];
                
                if (!configName || !Array.isArray(items)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '缺少必要参数: name/configName 和 items/dataItems' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                const safeName = configName.replace(/[<>:"/\\|?*]/g, '_');
                const sdkDir = path.join(__dirname, '..', 'sdk', safeName);
                
                // 创建目录
                if (!fs.existsSync(sdkDir)) {
                    fs.mkdirSync(sdkDir, { recursive: true });
                }

                // 类型大小映射
                const typeSizes = {
                    'bool': 1,
                    'uint8': 1, 'int8': 1,
                    'uint16': 2, 'int16': 2,
                    'uint32': 4, 'int32': 4,
                    'float': 4,
                    'double': 8,
                    'image_block': 128,
                    'bytes': 0  // 动态大小
                };

                // 辅助函数：判断是否为图片块类型（兼容多种格式）
                const isImageBlockType = (type) => {
                    const normalizedType = (type || '').toLowerCase().replace(/[_-]/g, '');
                    return normalizedType === 'imageblock' || normalizedType === 'image_block';
                };

                const getTypeSize = (type, size) => {
                    if (type === 'bytes') return size || 0;
                    if (isImageBlockType(type)) return 128;
                    return typeSizes[type] || 0;
                };

                // 计算是否有image_block（兼容 ImageBlock, image_block 等格式）
                const hasImageBlock = items.some(item => isImageBlockType(item.type));
                
                // 计算非图片字段大小
                const nonImageSize = items.reduce((sum, item) => {
                    if (isImageBlockType(item.type)) return sum;
                    return sum + getTypeSize(item.type, item.size);
                }, 0);

                // 计算图片伴随字段大小
                const imageBlockCompanionSize = imageCompanionFields.reduce((sum, field) => {
                    const item = items.find(i => i.name === field);
                    if (item) return sum + getTypeSize(item.type, item.size);
                    return sum;
                }, 0);

                const totalSize = items.reduce((sum, item) => {
                    if (isImageBlockType(item.type)) return sum;
                    return sum + getTypeSize(item.type, item.size);
                }, 0);

                // ========== 生成 .h 文件 ==========
                let hContent = '/**\n';
                hContent += ' * @file custom_data.h\n';
                hContent += ' * @brief 自定义数据块 SDK - 适用于 STM32/ARM 架构单片机\n';
                hContent += ' * @note 串口协议：帧头(5B) + CMD_ID(2B) + 数据(nB) + 帧尾(2B CRC16)\n';
                hContent += ' * @date ' + new Date().toLocaleString('zh-CN') + '\n';
                hContent += ` * @size ${totalSize} Bytes\n`;
                hContent += ' */\n\n';
                hContent += '#ifndef CUSTOM_DATA_H\n';
                hContent += '#define CUSTOM_DATA_H\n\n';
                hContent += '#include <stdint.h>\n';
                hContent += '#include <string.h>\n\n';
                hContent += '#ifdef __cplusplus\n';
                hContent += 'extern "C" {\n';
                hContent += '#endif\n\n';
                
                // 协议常量定义
                hContent += '/* 串口协议常量 */\n';
                hContent += '#define CUSTOM_DATA_SOF         0xA5      // 帧头起始符\n';
                hContent += '#define CUSTOM_DATA_CMD_ID      0x0310    // 命令ID (自定义数据)\n';
                hContent += '#define CUSTOM_DATA_ACTUAL_SIZE ' + totalSize + '       // 实际数据长度\n';
                hContent += '#define CUSTOM_DATA_SIZE        150       // 裁判系统要求固定150字节\n';
                hContent += '#define CUSTOM_DATA_FRAME_SIZE  (5 + 2 + CUSTOM_DATA_SIZE + 2) // 总帧长度\n\n';
                
                if (hasImageBlock) {
                    hContent += '/* 图片块协议常量 */\n';
                    hContent += '#define IMAGE_BLOCK_CMD_DATA    0x02      // 数据块类型\n';
                    hContent += '#define IMAGE_BLOCK_CMD_END     0x03      // 结束帧类型\n';
                    hContent += '#define IMAGE_BLOCK_DATA_SIZE   120       // 每块数据大小\n';
                    hContent += '#define IMAGE_BLOCK_SIZE        128       // ImageBlock结构大小\n\n';
                    
                    hContent += '/**\n';
                    hContent += ' * @brief 图片块协议结构 (128字节)\n';
                    hContent += ' * @note 嵌入在150字节自定义数据块中，由外层协议提供SOF和CRC16保护\n';
                    hContent += ' */\n';
                    hContent += '#pragma pack(push, 1)\n';
                    hContent += 'typedef struct {\n';
                    hContent += '    uint8_t cmd_type;         // 命令类型 (0x02=数据块, 0x03=结束帧)\n';
                    hContent += '    uint16_t img_id;          // 图片ID (唯一标识)\n';
                    hContent += '    uint16_t block_idx;       // 当前块索引 (从0开始)\n';
                    hContent += '    uint16_t total_block;     // 总块数\n';
                    hContent += '    uint8_t data_len;         // 有效数据长度 (1-120, 其余填0)\n';
                    hContent += '    uint8_t data[IMAGE_BLOCK_DATA_SIZE];  // 数据块 (120字节)\n';
                    hContent += '} ImageBlock_t;\n';
                    hContent += '#pragma pack(pop)\n\n';
                }
                
                // C类型映射函数
                const getCType = (type) => {
                    const typeMap = {
                        'uint8': 'uint8_t',
                        'int8': 'int8_t',
                        'uint16': 'uint16_t',
                        'int16': 'int16_t',
                        'uint32': 'uint32_t',
                        'int32': 'int32_t',
                        'float': 'float',
                        'double': 'double',
                        'bool': 'uint8_t',
                        // 兼容已带 _t 后缀的类型
                        'uint8_t': 'uint8_t',
                        'int8_t': 'int8_t',
                        'uint16_t': 'uint16_t',
                        'int16_t': 'int16_t',
                        'uint32_t': 'uint32_t',
                        'int32_t': 'int32_t'
                    };
                    // 图片块类型特殊处理
                    if (isImageBlockType(type)) {
                        return 'ImageBlock_t';
                    }
                    return typeMap[type] || type;
                };

                // 数据结构定义
                if (hasImageBlock) {
                    // 1. 纯数据结构（不含图片）
                    hContent += '/**\n';
                    hContent += ' * @brief 纯数据结构（不含图片块）\n';
                    hContent += ' * @note 用于无图片传输场景，节省内存\n';
                    hContent += ` * @size ${nonImageSize + 1} Bytes (1B类型 + ${nonImageSize}B数据)\n`;
                    hContent += ' */\n';
                    hContent += '#pragma pack(push, 1)\n';
                    hContent += 'typedef struct {\n';
                    hContent += '    uint8_t packet_type; // 0x00: 纯数据\n';
                    
                    items.filter(item => !isImageBlockType(item.type)).forEach(item => {
                        let cType = getCType(item.type);
                        let arraySize = '';
                        
                        if (item.type === 'bytes') {
                            cType = 'uint8_t';
                            arraySize = `[${item.size || 1}]`;
                        }
                        
                        let comment = '';
                        if (item.type === 'bytes' && item.size) {
                            comment = ` // ${item.size} bytes`;
                        } else if (item.min !== undefined || item.max !== undefined) {
                            comment = ` // 范围: [${item.min ?? '-∞'}, ${item.max ?? '+∞'}]`;
                        }
                        
                        hContent += `    ${cType} ${item.name}${arraySize};${comment}\n`;
                    });
                    
                    hContent += '} CustomData_t;\n';
                    hContent += '#pragma pack(pop)\n\n';
                    
                    // 2. 含图片的数据结构
                    hContent += '/**\n';
                    hContent += ' * @brief 含图片的数据结构\n';
                    hContent += ' * @note 用于图片传输场景，包含图片块和伴随数据\n';
                    hContent += ` * @size ${imageBlockCompanionSize + 128 + 1} Bytes (1B类型 + ${imageBlockCompanionSize}B伴随数据 + 128B图片)\n`;
                    hContent += ' */\n';
                    hContent += '#pragma pack(push, 1)\n';
                    hContent += 'typedef struct {\n';
                    hContent += '    uint8_t packet_type; // 0x01: 含图片数据\n';
                    
                    // 先添加图片伴随字段
                    imageCompanionFields.forEach(fieldName => {
                        const item = items.find(i => i.name === fieldName);
                        if (item && item.type !== 'image_block') {
                            let cType = getCType(item.type);
                            let arraySize = '';
                            
                            if (item.type === 'bytes') {
                                cType = 'uint8_t';
                                arraySize = `[${item.size || 1}]`;
                            }
                            
                            let comment = ' // 图片伴随数据';
                            if (item.type === 'bytes' && item.size) {
                                comment = ` // ${item.size} bytes (伴随数据)`;
                            } else if (item.min !== undefined || item.max !== undefined) {
                                comment = ` // 范围: [${item.min ?? '-∞'}, ${item.max ?? '+∞'}] (伴随数据)`;
                            }
                            
                            hContent += `    ${cType} ${item.name}${arraySize};${comment}\n`;
                        }
                    });
                    
                    // 再添加图片块字段
                    const imageField = items.find(item => isImageBlockType(item.type));
                    if (imageField) {
                        hContent += `    ImageBlock_t ${imageField.name}; // 图片块 (128B)\n`;
                    }
                    
                    hContent += '} CustomDataWithImage_t;\n';
                    hContent += '#pragma pack(pop)\n\n';
                    
                } else {
                    // 没有图片块，只生成一个结构体
                    hContent += '/**\n';
                    hContent += ' * @brief 自定义数据块\n';
                    hContent += ' * @note 用于参数传递\n';
                    hContent += ` * @size ${totalSize} Bytes\n`;
                    hContent += ' */\n';
                    hContent += '#pragma pack(push, 1)\n';
                    hContent += 'typedef struct {\n';
                    
                    items.forEach(item => {
                        // 跳过图片块类型（理论上这个分支不会有图片块，但做个保护）
                        if (isImageBlockType(item.type)) return;
                        
                        let cType = getCType(item.type);
                        let arraySize = '';
                        
                        if (item.type === 'bytes') {
                            cType = 'uint8_t';
                            arraySize = `[${item.size || 1}]`;
                        }
                        
                        let comment = '';
                        if (item.type === 'bytes' && item.size) {
                            comment = ` // ${item.size} bytes`;
                        } else if (item.min !== undefined || item.max !== undefined) {
                            comment = ` // 范围: [${item.min ?? '-∞'}, ${item.max ?? '+∞'}]`;
                        }
                        
                        hContent += `    ${cType} ${item.name}${arraySize};${comment}\n`;
                    });
                    
                    hContent += '} CustomData_t;\n';
                    hContent += '#pragma pack(pop)\n\n';
                }
                
                // 函数声明
                if (hasImageBlock) {
                    hContent += '/* ========== 纯数据传输函数 ========== */\n\n';
                    hContent += '/**\n';
                    hContent += ' * @brief 写入纯数据（不含图片）\n';
                    hContent += ' * @param data 数据结构指针\n';
                    hContent += ' */\n';
                    hContent += 'void CustomData_Write(const CustomData_t *data);\n\n';
                    
                    hContent += '/**\n';
                    hContent += ' * @brief 打包纯数据帧\n';
                    hContent += ' * @param seq 包序号\n';
                    hContent += ' * @return 打包好的数据指针（159字节）\n';
                    hContent += ' */\n';
                    hContent += 'uint8_t* CustomData_Pack(uint8_t seq);\n\n';
                    
                    hContent += '/* ========== 含图片传输函数 ========== */\n\n';
                    hContent += '/**\n';
                    hContent += ' * @brief 写入含图片的数据\n';
                    hContent += ' * @param data 含图片的数据结构指针\n';
                    hContent += ' */\n';
                    hContent += 'void CustomDataWithImage_Write(const CustomDataWithImage_t *data);\n\n';
                    
                    hContent += '/**\n';
                    hContent += ' * @brief 打包含图片的数据帧\n';
                    hContent += ' * @param seq 包序号\n';
                    hContent += ' * @return 打包好的数据指针（159字节）\n';
                    hContent += ' */\n';
                    hContent += 'uint8_t* CustomDataWithImage_Pack(uint8_t seq);\n\n';
                } else {
                    hContent += '/**\n';
                    hContent += ' * @brief 高效写入自定义数据（内联函数）\n';
                    hContent += ' * @param data 数据结构指针\n';
                    hContent += ' */\n';
                    hContent += 'void CustomData_Write(const CustomData_t *data);\n\n';
                    
                    hContent += '/**\n';
                    hContent += ' * @brief 打包数据帧\n';
                    hContent += ' * @param seq 包序号\n';
                    hContent += ' * @return 打包好的数据指针（159字节）\n';
                    hContent += ' */\n';
                    hContent += 'uint8_t* CustomData_Pack(uint8_t seq);\n\n';
                }
                
                hContent += '/**\n';
                hContent += ' * @brief 获取打包后的帧长度\n';
                hContent += ' * @return 帧长度（字节）\n';
                hContent += ' */\n';
                hContent += 'static inline uint16_t CustomData_GetFrameSize(void) {\n';
                hContent += '    return CUSTOM_DATA_FRAME_SIZE;\n';
                hContent += '}\n\n';
                
                if (hasImageBlock) {
                    hContent += '/* 图片块协议辅助函数 */\n\n';
                    hContent += '/**\n';
                    hContent += ' * @brief 填充图片数据块\n';
                    hContent += ' * @param block 图片块结构指针\n';
                    hContent += ' * @param img_id 图片ID\n';
                    hContent += ' * @param block_idx 当前块索引\n';
                    hContent += ' * @param total_block 总块数\n';
                    hContent += ' * @param data 数据指针\n';
                    hContent += ' * @param data_len 数据长度 (1-120)\n';
                    hContent += ' * @param is_end 是否为结束帧\n';
                    hContent += ' * @note 不包含CRC计算，由外层CustomDataWithImage_Pack统一处理\n';
                    hContent += ' */\n';
                    hContent += 'void ImageBlock_Fill(ImageBlock_t *block, uint16_t img_id, uint16_t block_idx, uint16_t total_block, const uint8_t *data, uint8_t data_len, uint8_t is_end);\n\n';
                }
                
                hContent += '#ifdef __cplusplus\n';
                hContent += '}\n';
                hContent += '#endif\n\n';
                hContent += '#endif // CUSTOM_DATA_H\n';
                
                // ========== 生成 .c 文件 ==========
                let cContent = '/**\n';
                cContent += ' * @file custom_data.c\n';
                cContent += ' * @brief 自定义数据块 SDK 实现\n';
                cContent += ' */\n\n';
                cContent += '#include "custom_data.h"\n\n';
                
                // 内部存储结构（不对外暴露）
                cContent += '/* 内部数据存储（静态私有） */\n';
                cContent += 'static CustomData_t s_custom_data = {0};\n';
                if (hasImageBlock) {
                    cContent += 'static CustomDataWithImage_t s_custom_data_with_image = {0};\n';
                }
                cContent += 'static uint8_t s_data_buffer[CUSTOM_DATA_SIZE] = {0};  // 150字节数据缓冲区\n';
                cContent += 'static uint8_t s_frame_buffer[CUSTOM_DATA_FRAME_SIZE] = {0};\n\n';
                
                // CRC 计算函数
                cContent += '/* CRC8 校验表 (DNP算法) */\n';
                cContent += 'static const uint8_t crc8_table[256] = {\n';
                cContent += '    0x00, 0x5E, 0xBC, 0xE2, 0x61, 0x3F, 0xDD, 0x83,\n';
                cContent += '    0xC2, 0x9C, 0x7E, 0x20, 0xA3, 0xFD, 0x1F, 0x41,\n';
                cContent += '    0x9D, 0xC3, 0x21, 0x7F, 0xFC, 0xA2, 0x40, 0x1E,\n';
                cContent += '    0x5F, 0x01, 0xE3, 0xBD, 0x3E, 0x60, 0x82, 0xDC,\n';
                cContent += '    0x23, 0x7D, 0x9F, 0xC1, 0x42, 0x1C, 0xFE, 0xA0,\n';
                cContent += '    0xE1, 0xBF, 0x5D, 0x03, 0x80, 0xDE, 0x3C, 0x62,\n';
                cContent += '    0xBE, 0xE0, 0x02, 0x5C, 0xDF, 0x81, 0x63, 0x3D,\n';
                cContent += '    0x7C, 0x22, 0xC0, 0x9E, 0x1D, 0x43, 0xA1, 0xFF,\n';
                cContent += '    0x46, 0x18, 0xFA, 0xA4, 0x27, 0x79, 0x9B, 0xC5,\n';
                cContent += '    0x84, 0xDA, 0x38, 0x66, 0xE5, 0xBB, 0x59, 0x07,\n';
                cContent += '    0xDB, 0x85, 0x67, 0x39, 0xBA, 0xE4, 0x06, 0x58,\n';
                cContent += '    0x19, 0x47, 0xA5, 0xFB, 0x78, 0x26, 0xC4, 0x9A,\n';
                cContent += '    0x65, 0x3B, 0xD9, 0x87, 0x04, 0x5A, 0xB8, 0xE6,\n';
                cContent += '    0xA7, 0xF9, 0x1B, 0x45, 0xC6, 0x98, 0x7A, 0x24,\n';
                cContent += '    0xF8, 0xA6, 0x44, 0x1A, 0x99, 0xC7, 0x25, 0x7B,\n';
                cContent += '    0x3A, 0x64, 0x86, 0xD8, 0x5B, 0x05, 0xE7, 0xB9,\n';
                cContent += '    0x8C, 0xD2, 0x30, 0x6E, 0xED, 0xB3, 0x51, 0x0F,\n';
                cContent += '    0x4E, 0x10, 0xF2, 0xAC, 0x2F, 0x71, 0x93, 0xCD,\n';
                cContent += '    0x11, 0x4F, 0xAD, 0xF3, 0x70, 0x2E, 0xCC, 0x92,\n';
                cContent += '    0xD3, 0x8D, 0x6F, 0x31, 0xB2, 0xEC, 0x0E, 0x50,\n';
                cContent += '    0xAF, 0xF1, 0x13, 0x4D, 0xCE, 0x90, 0x72, 0x2C,\n';
                cContent += '    0x6D, 0x33, 0xD1, 0x8F, 0x0C, 0x52, 0xB0, 0xEE,\n';
                cContent += '    0x32, 0x6C, 0x8E, 0xD0, 0x53, 0x0D, 0xEF, 0xB1,\n';
                cContent += '    0xF0, 0xAE, 0x4C, 0x12, 0x91, 0xCF, 0x2D, 0x73,\n';
                cContent += '    0xCA, 0x94, 0x76, 0x28, 0xAB, 0xF5, 0x17, 0x49,\n';
                cContent += '    0x08, 0x56, 0xB4, 0xEA, 0x69, 0x37, 0xD5, 0x8B,\n';
                cContent += '    0x57, 0x09, 0xEB, 0xB5, 0x36, 0x68, 0x8A, 0xD4,\n';
                cContent += '    0x95, 0xCB, 0x29, 0x77, 0xF4, 0xAA, 0x48, 0x16,\n';
                cContent += '    0xE9, 0xB7, 0x55, 0x0B, 0x88, 0xD6, 0x34, 0x6A,\n';
                cContent += '    0x2B, 0x75, 0x97, 0xC9, 0x4A, 0x14, 0xF6, 0xA8,\n';
                cContent += '    0x74, 0x2A, 0xC8, 0x96, 0x15, 0x4B, 0xA9, 0xF7,\n';
                cContent += '    0xB6, 0xE8, 0x0A, 0x54, 0xD7, 0x89, 0x6B, 0x35\n';
                cContent += '};\n\n';
                
                cContent += '/* CRC16 校验表 (XMODEM算法) */\n';
                cContent += 'static const uint16_t crc16_table[256] = {\n';
                cContent += '    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50A5, 0x60C6, 0x70E7,\n';
                cContent += '    0x8108, 0x9129, 0xA14A, 0xB16B, 0xC18C, 0xD1AD, 0xE1CE, 0xF1EF,\n';
                cContent += '    0x1231, 0x0210, 0x3273, 0x2252, 0x52B5, 0x4294, 0x72F7, 0x62D6,\n';
                cContent += '    0x9339, 0x8318, 0xB37B, 0xA35A, 0xD3BD, 0xC39C, 0xF3FF, 0xE3DE,\n';
                cContent += '    0x2462, 0x3443, 0x0420, 0x1401, 0x64E6, 0x74C7, 0x44A4, 0x5485,\n';
                cContent += '    0xA56A, 0xB54B, 0x8528, 0x9509, 0xE5EE, 0xF5CF, 0xC5AC, 0xD58D,\n';
                cContent += '    0x3653, 0x2672, 0x1611, 0x0630, 0x76D7, 0x66F6, 0x5695, 0x46B4,\n';
                cContent += '    0xB75B, 0xA77A, 0x9719, 0x8738, 0xF7DF, 0xE7FE, 0xD79D, 0xC7BC,\n';
                cContent += '    0x48C4, 0x58E5, 0x6886, 0x78A7, 0x0840, 0x1861, 0x2802, 0x3823,\n';
                cContent += '    0xC9CC, 0xD9ED, 0xE98E, 0xF9AF, 0x8948, 0x9969, 0xA90A, 0xB92B,\n';
                cContent += '    0x5AF5, 0x4AD4, 0x7AB7, 0x6A96, 0x1A71, 0x0A50, 0x3A33, 0x2A12,\n';
                cContent += '    0xDBFD, 0xCBDC, 0xFBBF, 0xEB9E, 0x9B79, 0x8B58, 0xBB3B, 0xAB1A,\n';
                cContent += '    0x6CA6, 0x7C87, 0x4CE4, 0x5CC5, 0x2C22, 0x3C03, 0x0C60, 0x1C41,\n';
                cContent += '    0xEDAE, 0xFD8F, 0xCDEC, 0xDDCD, 0xAD2A, 0xBD0B, 0x8D68, 0x9D49,\n';
                cContent += '    0x7E97, 0x6EB6, 0x5ED5, 0x4EF4, 0x3E13, 0x2E32, 0x1E51, 0x0E70,\n';
                cContent += '    0xFF9F, 0xEFBE, 0xDFDD, 0xCFFC, 0xBF1B, 0xAF3A, 0x9F59, 0x8F78,\n';
                cContent += '    0x9188, 0x81A9, 0xB1CA, 0xA1EB, 0xD10C, 0xC12D, 0xF14E, 0xE16F,\n';
                cContent += '    0x1080, 0x00A1, 0x30C2, 0x20E3, 0x5004, 0x4025, 0x7046, 0x6067,\n';
                cContent += '    0x83B9, 0x9398, 0xA3FB, 0xB3DA, 0xC33D, 0xD31C, 0xE37F, 0xF35E,\n';
                cContent += '    0x02B1, 0x1290, 0x22F3, 0x32D2, 0x4235, 0x5214, 0x6277, 0x7256,\n';
                cContent += '    0xB5EA, 0xA5CB, 0x95A8, 0x8589, 0xF56E, 0xE54F, 0xD52C, 0xC50D,\n';
                cContent += '    0x34E2, 0x24C3, 0x14A0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,\n';
                cContent += '    0xA7DB, 0xB7FA, 0x8799, 0x97B8, 0xE75F, 0xF77E, 0xC71D, 0xD73C,\n';
                cContent += '    0x26D3, 0x36F2, 0x0691, 0x16B0, 0x6657, 0x7676, 0x4615, 0x5634,\n';
                cContent += '    0xD94C, 0xC96D, 0xF90E, 0xE92F, 0x99C8, 0x89E9, 0xB98A, 0xA9AB,\n';
                cContent += '    0x5844, 0x4865, 0x7806, 0x6827, 0x18C0, 0x08E1, 0x3882, 0x28A3,\n';
                cContent += '    0xCB7D, 0xDB5C, 0xEB3F, 0xFB1E, 0x8BF9, 0x9BD8, 0xABBB, 0xBB9A,\n';
                cContent += '    0x4A75, 0x5A54, 0x6A37, 0x7A16, 0x0AF1, 0x1AD0, 0x2AB3, 0x3A92,\n';
                cContent += '    0xFD2E, 0xED0F, 0xDD6C, 0xCD4D, 0xBDAA, 0xAD8B, 0x9DE8, 0x8DC9,\n';
                cContent += '    0x7C26, 0x6C07, 0x5C64, 0x4C45, 0x3CA2, 0x2C83, 0x1CE0, 0x0CC1,\n';
                cContent += '    0xEF1F, 0xFF3E, 0xCF5D, 0xDF7C, 0xAF9B, 0xBFBA, 0x8FD9, 0x9FF8,\n';
                cContent += '    0x6E17, 0x7E36, 0x4E55, 0x5E74, 0x2E93, 0x3EB2, 0x0ED1, 0x1EF0\n';
                cContent += '};\n\n';
                
                cContent += '/**\n';
                cContent += ' * @brief 计算CRC8校验值 (DNP算法)\n';
                cContent += ' * @param data 数据指针\n';
                cContent += ' * @param len 数据长度\n';
                cContent += ' * @return CRC8校验值\n';
                cContent += ' */\n';
                cContent += 'static uint8_t calc_crc8(const uint8_t *data, uint16_t len) {\n';
                cContent += '    uint8_t crc = 0x00;\n';
                cContent += '    while (len--) {\n';
                cContent += '        crc = crc8_table[crc ^ (*data++)];\n';
                cContent += '    }\n';
                cContent += '    return crc;\n';
                cContent += '}\n\n';
                
                cContent += '/**\n';
                cContent += ' * @brief 计算CRC16校验值 (XMODEM算法)\n';
                cContent += ' * @param data 数据指针\n';
                cContent += ' * @param len 数据长度\n';
                cContent += ' * @return CRC16校验值\n';
                cContent += ' */\n';
                cContent += 'static uint16_t calc_crc16(const uint8_t *data, uint16_t len) {\n';
                cContent += '    uint16_t crc = 0x0000;  // XMODEM初始值为0x0000\n';
                cContent += '    while (len--) {\n';
                cContent += '        crc = (crc << 8) ^ crc16_table[((crc >> 8) ^ (*data++)) & 0xFF];\n';
                cContent += '    }\n';
                cContent += '    return crc;\n';
                cContent += '}\n\n';
                
                // 函数实现
                if (hasImageBlock) {
                    cContent += '/**\n';
                    cContent += ' * @brief 写入纯数据（不含图片）\n';
                    cContent += ' */\n';
                    cContent += 'void CustomData_Write(const CustomData_t *data) {\n';
                    cContent += '    if (data) {\n';
                    cContent += '        memcpy(&s_custom_data, data, sizeof(CustomData_t));\n';
                    cContent += '    }\n';
                    cContent += '}\n\n';
                    
                    cContent += '/**\n';
                    cContent += ' * @brief 写入含图片的数据\n';
                    cContent += ' */\n';
                    cContent += 'void CustomDataWithImage_Write(const CustomDataWithImage_t *data) {\n';
                    cContent += '    if (data) {\n';
                    cContent += '        memcpy(&s_custom_data_with_image, data, sizeof(CustomDataWithImage_t));\n';
                    cContent += '    }\n';
                    cContent += '}\n\n';
                    
                    cContent += '/**\n';
                    cContent += ' * @brief 打包纯数据帧（不含图片）\n';
                    cContent += ' */\n';
                    cContent += 'uint8_t* CustomData_Pack(uint8_t seq) {\n';
                    cContent += '    uint16_t data_len = CUSTOM_DATA_SIZE;\n';
                    cContent += '    uint16_t cmd_id = CUSTOM_DATA_CMD_ID;\n';
                    cContent += '    uint8_t *p = s_frame_buffer;\n';
                    cContent += '    \n';
                    cContent += '    // 帧头 (5 bytes)\n';
                    cContent += '    *p++ = CUSTOM_DATA_SOF;\n';
                    cContent += '    *p++ = (uint8_t)(data_len & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((data_len >> 8) & 0xFF);\n';
                    cContent += '    *p++ = seq;\n';
                    cContent += '    *p++ = calc_crc8(s_frame_buffer, 4);\n';
                    cContent += '    \n';
                    cContent += '    // CMD_ID (2 bytes)\n';
                    cContent += '    *p++ = (uint8_t)(cmd_id & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((cmd_id >> 8) & 0xFF);\n';
                    cContent += '    \n';
                    cContent += '    // 数据段 (150 bytes) - 仅纯数据\n';
                    cContent += '    s_custom_data.packet_type = 0x00;\n';
                    cContent += '    memset(s_data_buffer, 0, CUSTOM_DATA_SIZE);\n';
                    cContent += `    memcpy(s_data_buffer, &s_custom_data, sizeof(CustomData_t));\n`;
                    cContent += '    memcpy(p, s_data_buffer, CUSTOM_DATA_SIZE);\n';
                    cContent += '    p += CUSTOM_DATA_SIZE;\n';
                    cContent += '    \n';
                    cContent += '    // 帧尾 CRC16 (2 bytes)\n';
                    cContent += '    uint16_t frame_crc = calc_crc16(s_frame_buffer, p - s_frame_buffer);\n';
                    cContent += '    *p++ = (uint8_t)(frame_crc & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((frame_crc >> 8) & 0xFF);\n';
                    cContent += '    \n';
                    cContent += '    return s_frame_buffer;\n';
                    cContent += '}\n\n';
                    
                    cContent += '/**\n';
                    cContent += ' * @brief 打包含图片的数据帧\n';
                    cContent += ' */\n';
                    cContent += 'uint8_t* CustomDataWithImage_Pack(uint8_t seq) {\n';
                    cContent += '    uint16_t data_len = CUSTOM_DATA_SIZE;\n';
                    cContent += '    uint16_t cmd_id = CUSTOM_DATA_CMD_ID;\n';
                    cContent += '    uint8_t *p = s_frame_buffer;\n';
                    cContent += '    \n';
                    cContent += '    // 帧头 (5 bytes)\n';
                    cContent += '    *p++ = CUSTOM_DATA_SOF;\n';
                    cContent += '    *p++ = (uint8_t)(data_len & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((data_len >> 8) & 0xFF);\n';
                    cContent += '    *p++ = seq;\n';
                    cContent += '    *p++ = calc_crc8(s_frame_buffer, 4);\n';
                    cContent += '    \n';
                    cContent += '    // CMD_ID (2 bytes)\n';
                    cContent += '    *p++ = (uint8_t)(cmd_id & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((cmd_id >> 8) & 0xFF);\n';
                    cContent += '    \n';
                    cContent += '    // 数据段 (150 bytes) - 包含图片和伴随数据\n';
                    cContent += '    s_custom_data_with_image.packet_type = 0x01;\n';
                    cContent += '    memset(s_data_buffer, 0, CUSTOM_DATA_SIZE);\n';
                    cContent += `    memcpy(s_data_buffer, &s_custom_data_with_image, sizeof(CustomDataWithImage_t));\n`;
                    cContent += '    memcpy(p, s_data_buffer, CUSTOM_DATA_SIZE);\n';
                    cContent += '    p += CUSTOM_DATA_SIZE;\n';
                    cContent += '    \n';
                    cContent += '    // 帧尾 CRC16 (2 bytes)\n';
                    cContent += '    uint16_t frame_crc = calc_crc16(s_frame_buffer, p - s_frame_buffer);\n';
                    cContent += '    *p++ = (uint8_t)(frame_crc & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((frame_crc >> 8) & 0xFF);\n';
                    cContent += '    \n';
                    cContent += '    return s_frame_buffer;\n';
                    cContent += '}\n';
                    
                    cContent += '\n/* ========== 图片块协议函数实现 ========== */\n\n';
                    
                    cContent += '/**\n';
                    cContent += ' * @brief 填充图片数据块\n';
                    cContent += ' * @note 不计算CRC，由外层协议统一保护\n';
                    cContent += ' */\n';
                    cContent += 'void ImageBlock_Fill(ImageBlock_t *block, uint16_t img_id, uint16_t block_idx, uint16_t total_block, const uint8_t *data, uint8_t data_len, uint8_t is_end) {\n';
                    cContent += '    if (block == NULL) return;\n';
                    cContent += '    if (data_len > IMAGE_BLOCK_DATA_SIZE) data_len = IMAGE_BLOCK_DATA_SIZE;\n';
                    cContent += '    \n';
                    cContent += '    // 填充字段\n';
                    cContent += '    block->cmd_type = is_end ? IMAGE_BLOCK_CMD_END : IMAGE_BLOCK_CMD_DATA;\n';
                    cContent += '    block->img_id = img_id;\n';
                    cContent += '    block->block_idx = block_idx;\n';
                    cContent += '    block->total_block = total_block;\n';
                    cContent += '    block->data_len = data_len;\n';
                    cContent += '    \n';
                    cContent += '    // 复制数据并补零\n';
                    cContent += '    memset(block->data, 0, IMAGE_BLOCK_DATA_SIZE);\n';
                    cContent += '    if (data != NULL && data_len > 0) {\n';
                    cContent += '        memcpy(block->data, data, data_len);\n';
                    cContent += '    }\n';
                    cContent += '}\n';
                } else {
                    cContent += '/**\n';
                    cContent += ' * @brief 写入数据到内部缓冲区\n';
                    cContent += ' */\n';
                    cContent += 'void CustomData_Write(const CustomData_t *data) {\n';
                    cContent += '    if (data) {\n';
                    cContent += '        memcpy(&s_custom_data, data, sizeof(CustomData_t));\n';
                    cContent += '    }\n';
                    cContent += '}\n\n';
                    
                    cContent += '/**\n';
                    cContent += ' * @brief 打包数据帧\n';
                    cContent += ' */\n';
                    cContent += 'uint8_t* CustomData_Pack(uint8_t seq) {\n';
                    cContent += '    uint16_t data_len = CUSTOM_DATA_SIZE;\n';
                    cContent += '    uint16_t cmd_id = CUSTOM_DATA_CMD_ID;\n';
                    cContent += '    uint8_t *p = s_frame_buffer;\n';
                    cContent += '    \n';
                    cContent += '    // 帧头 (5 bytes)\n';
                    cContent += '    *p++ = CUSTOM_DATA_SOF;\n';
                    cContent += '    *p++ = (uint8_t)(data_len & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((data_len >> 8) & 0xFF);\n';
                    cContent += '    *p++ = seq;\n';
                    cContent += '    *p++ = calc_crc8(s_frame_buffer, 4);\n';
                    cContent += '    \n';
                    cContent += '    // CMD_ID (2 bytes)\n';
                    cContent += '    *p++ = (uint8_t)(cmd_id & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((cmd_id >> 8) & 0xFF);\n';
                    cContent += '    \n';
                    cContent += '    // 数据段 (150 bytes)\n';
                    cContent += '    memset(s_data_buffer, 0, CUSTOM_DATA_SIZE);\n';
                    cContent += '    memcpy(s_data_buffer, &s_custom_data, CUSTOM_DATA_ACTUAL_SIZE);\n';
                    cContent += '    memcpy(p, s_data_buffer, CUSTOM_DATA_SIZE);\n';
                    cContent += '    p += CUSTOM_DATA_SIZE;\n';
                    cContent += '    \n';
                    cContent += '    // 帧尾 CRC16 (2 bytes)\n';
                    cContent += '    uint16_t frame_crc = calc_crc16(s_frame_buffer, p - s_frame_buffer);\n';
                    cContent += '    *p++ = (uint8_t)(frame_crc & 0xFF);\n';
                    cContent += '    *p++ = (uint8_t)((frame_crc >> 8) & 0xFF);\n';
                    cContent += '    \n';
                    cContent += '    return s_frame_buffer;\n';
                    cContent += '}\n';
                }
                
                // 保存文件
                const hFilePath = path.join(sdkDir, 'custom_data.h');
                const cFilePath = path.join(sdkDir, 'custom_data.c');
                fs.writeFileSync(hFilePath, hContent, 'utf8');
                fs.writeFileSync(cFilePath, cContent, 'utf8');
                
                console.log(`📝 已生成 C SDK 文件 [${configName}]:`);
                console.log(`   - ${hFilePath}`);
                console.log(`   - ${cFilePath}`);
                
                // 使用 Web 方案进行语法检查
                const syntaxCheck = this.checkCSyntax(hContent, cContent);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    hFile: `sdk/${safeName}/custom_data.h`,
                    cFile: `sdk/${safeName}/custom_data.c`,
                    syntaxCheck: syntaxCheck
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    }

    async handleCompressImage(req, res) {
        let body = [];
        req.on('data', chunk => body.push(chunk));
        req.on('end', async () => {
            try {
                const data = JSON.parse(Buffer.concat(body).toString());
                const { imageData, format, quality, maxWidth, maxHeight, channel, edgeOperator, vectorSimplify, vectorMethod, vectorEncoding, binaryEncoding } = data;
                
                if (!imageData) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: '缺少图片数据' }));
                    return;
                }
                
                // 解码 Base64 图片
                const inputBuffer = Buffer.from(imageData, 'base64');
                
                let sharp;
                try {
                    sharp = require('sharp');
                } catch (e) {
                    // sharp 未安装，返回错误提示
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: 'sharp 库未安装，请运行: npm install sharp',
                        fallback: true
                    }));
                    return;
                }
                
                // 创建 sharp 实例
                let image = sharp(inputBuffer);
                
                // 获取图片信息
                const metadata = await image.metadata();
                
                // 计算缩放尺寸
                let width = metadata.width;
                let height = metadata.height;
                const maxW = maxWidth || 320;
                const maxH = maxHeight || 320;
                
                if (width > maxW || height > maxH) {
                    if (width / height > maxW / maxH) {
                        height = Math.round(height * maxW / width);
                        width = maxW;
                    } else {
                        width = Math.round(width * maxH / height);
                        height = maxH;
                    }
                    image = image.resize(width, height);
                }
                
                // 通道处理
                const channelMode = channel || 'rgb';
                
                if (channelMode === 'grayscale') {
                    // 转为灰度
                    image = image.grayscale();
                } else if (channelMode === 'vector') {
                    // ========== 矢量化处理 ==========
                    const method = vectorMethod || 'skeleton';
                    
                    if (method === 'starvector' || method === 'vtracer') {
                        // ========== Python 矢量化 (StarVector / VTracer / PIL fallback) ==========
                        try {
                            const { spawn } = require('child_process');
                            const path = require('path');
                            
                            // 获取原始图像数据
                            const imageBuffer = await image.png().toBuffer();
                            const w = width, h = height;
                            
                            // 调用 Python 脚本
                            const scriptPath = path.join(__dirname, '..', 'scripts', 'starvector_convert.py');
                            const simplifyLevel = vectorSimplify || 3;
                            // 直接传递方法名: starvector 使用 AI, vtracer 使用 vtracer, 其他使用 auto
                            const pyMethod = method;
                            // 阈值: quality 1-100 -> threshold 250-50 (quality越高，边缘越多)
                            const threshold = Math.round(250 - (quality || 50) * 2);
                            
                            const result = await new Promise((resolve, reject) => {
                                const pythonProcess = spawn('python3', [
                                    scriptPath, 
                                    '--mode', 'lines',
                                    '--simplify', String(simplifyLevel),
                                    '--method', pyMethod,
                                    '--threshold', String(threshold)
                                ]);
                                let stdout = '';
                                let stderr = '';
                                
                                pythonProcess.stdout.on('data', (data) => { stdout += data.toString(); });
                                pythonProcess.stderr.on('data', (data) => { stderr += data.toString(); });
                                
                                pythonProcess.on('close', (code) => {
                                    if (code !== 0) {
                                        console.log(`[${method}] stderr: ${stderr}`);
                                        reject(new Error(`Python script exited with code ${code}`));
                                    } else {
                                        resolve(stdout);
                                    }
                                });
                                
                                pythonProcess.on('error', (err) => {
                                    reject(err);
                                });
                                
                                // 发送图像数据到标准输入
                                pythonProcess.stdin.write(imageBuffer);
                                pythonProcess.stdin.end();
                            });
                            
                            // 解析结果
                            const output = JSON.parse(result);
                            let lines = output.lines || [];
                            const usedMethod = output.method || method;
                            
                            // ========== 线段质量优化 ==========
                            // 1. 过滤太短的线段（噪声）
                            const minLength = 3; // 最小线段长度
                            lines = lines.filter(l => {
                                const len = Math.sqrt((l.x2 - l.x1) ** 2 + (l.y2 - l.y1) ** 2);
                                return len >= minLength;
                            });
                            
                            // 2. 合并相近且方向相似的线段
                            lines = mergeNearbyLines(lines, 3, 15); // 距离阈值3像素，角度阈值15度
                            
                            console.log(`[Vector-${method}] 优化后 ${lines.length} 条线段 (backend: ${usedMethod})`);
                            
                            // 根据编码方式选择编码函数
                            const encoding = vectorEncoding || 'delta';
                            let vectorBuffer;
                            let encodingLabel;
                            
                            if (encoding === 'contour') {
                                vectorBuffer = encodeContourChain(lines, w, h);
                                encodingLabel = '轮廓链';
                            } else {
                                vectorBuffer = encodeDelta(lines, w, h);
                                encodingLabel = '差分';
                            }
                            
                            // ZSTD 压缩
                            const zstdCompress = await getZstdCompressor();
                            if (zstdCompress) {
                                try {
                                    const compressed = Buffer.from(zstdCompress(vectorBuffer, 19));
                                    if (compressed.length < vectorBuffer.length) {
                                        // 添加 ZSTD 标记头
                                        const finalBuffer = Buffer.alloc(1 + compressed.length);
                                        finalBuffer[0] = 0x5A; // 'Z' for ZSTD 标记
                                        compressed.copy(finalBuffer, 1);
                                        vectorBuffer = finalBuffer;
                                        encodingLabel += '+ZSTD';
                                    }
                                } catch (e) {
                                    // ZSTD 压缩失败，使用原始数据
                                }
                            }
                            
                            const compressionRatio = ((1 - vectorBuffer.length / (w * h / 8)) * 100).toFixed(1);
                            console.log(`[Vector-${method}] 编码(${encodingLabel}): ${vectorBuffer.length}B, 压缩 ${compressionRatio}%`);
                            
                            // 获取方法对应的颜色
                            const methodColors = { 'vtracer': '#2196F3', 'opencv': '#4CAF50', 'pil': '#FF9800' };
                            const labelColor = methodColors[usedMethod] || '#9C27B0';
                            
                            // SVG 预览
                            const svgLines = lines.map(l => 
                                `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="white" stroke-width="1"/>`
                            ).join('');
                            
                            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="black"/>
${svgLines}
<text x="3" y="12" font-size="9" fill="${labelColor}" font-family="monospace">${usedMethod} | ${lines.length} lines | ${vectorBuffer.length}B</text>
</svg>`;
                            const svgBase64 = Buffer.from(svgContent).toString('base64');
                            
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ 
                                success: true, 
                                data: vectorBuffer.toString('base64'),
                                dataUrl: 'data:image/svg+xml;base64,' + svgBase64,
                                size: vectorBuffer.length,
                                format: 'vector',
                                width: w,
                                height: h,
                                vectorInfo: {
                                    lineCount: lines.length,
                                    method: usedMethod,
                                    encoding: encoding,
                                    isVector: true,
                                    compressionRatio: compressionRatio
                                }
                            }));
                            return;
                            
                        } catch (err) {
                            console.error(`[Vector-${method}] 处理失败，回退到骨架追踪:`, err.message);
                            // 失败时回退到 skeleton 方法继续处理
                        }
                    }
                    
                    // ========== Skeleton 骨架追踪矢量化 (Zhang-Suen + Edge Trace) ==========
                    const operator = edgeOperator || 'log';
                    image = image.grayscale();
                    
                    // 根据 quality 参数计算二值化阈值
                    const skeletonThreshold = Math.round(250 - (quality || 50) * 2);
                    
                    // 应用边缘检测算子
                    if (operator === 'sobel') {
                        image = image.convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1] });
                    } else if (operator === 'prewitt') {
                        image = image.convolve({ width: 3, height: 3, kernel: [-1, 0, 1, -1, 0, 1, -1, 0, 1] });
                    } else if (operator === 'laplacian') {
                        image = image.convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] });
                    } else {
                        image = image.convolve({ width: 5, height: 5, kernel: [0, 0, -1, 0, 0, 0, -1, -2, -1, 0, -1, -2, 16, -2, -1, 0, -1, -2, -1, 0, 0, 0, -1, 0, 0] });
                    }
                    
                    image = image.normalise().threshold(skeletonThreshold);
                    const w = width, h = height;
                    
                    // 获取二值图像数据
                    const rawBuffer = await image.raw().toBuffer({ resolveWithObject: true });
                    const pixels = rawBuffer.data;
                    const info = rawBuffer.info;
                    const binaryData = new Uint8Array(w * h);
                    for (let i = 0; i < pixels.length; i += info.channels) {
                        binaryData[i / info.channels] = pixels[i] > 128 ? 1 : 0;
                    }
                    
                    // Zhang-Suen 骨架化算法 - 将边缘细化为1像素宽
                    function thinning(data, width, height) {
                        const result = new Uint8Array(data);
                        let changed = true;
                        
                        while (changed) {
                            changed = false;
                            
                            // Pass 1
                            const toRemove1 = [];
                            for (let y = 1; y < height - 1; y++) {
                                for (let x = 1; x < width - 1; x++) {
                                    const idx = y * width + x;
                                    if (!result[idx]) continue;
                                    
                                    // 获取8邻域 (P2-P9顺时针)
                                    const p2 = result[(y-1)*width+x], p3 = result[(y-1)*width+x+1];
                                    const p4 = result[y*width+x+1], p5 = result[(y+1)*width+x+1];
                                    const p6 = result[(y+1)*width+x], p7 = result[(y+1)*width+x-1];
                                    const p8 = result[y*width+x-1], p9 = result[(y-1)*width+x-1];
                                    
                                    const B = p2+p3+p4+p5+p6+p7+p8+p9; // 非零邻居数
                                    if (B < 2 || B > 6) continue;
                                    
                                    // 0->1 转换次数
                                    const A = (p2===0&&p3===1?1:0)+(p3===0&&p4===1?1:0)+
                                              (p4===0&&p5===1?1:0)+(p5===0&&p6===1?1:0)+
                                              (p6===0&&p7===1?1:0)+(p7===0&&p8===1?1:0)+
                                              (p8===0&&p9===1?1:0)+(p9===0&&p2===1?1:0);
                                    if (A !== 1) continue;
                                    
                                    if (p2*p4*p6 === 0 && p4*p6*p8 === 0) {
                                        toRemove1.push(idx);
                                    }
                                }
                            }
                            for (const idx of toRemove1) { result[idx] = 0; changed = true; }
                            
                            // Pass 2
                            const toRemove2 = [];
                            for (let y = 1; y < height - 1; y++) {
                                for (let x = 1; x < width - 1; x++) {
                                    const idx = y * width + x;
                                    if (!result[idx]) continue;
                                    
                                    const p2 = result[(y-1)*width+x], p3 = result[(y-1)*width+x+1];
                                    const p4 = result[y*width+x+1], p5 = result[(y+1)*width+x+1];
                                    const p6 = result[(y+1)*width+x], p7 = result[(y+1)*width+x-1];
                                    const p8 = result[y*width+x-1], p9 = result[(y-1)*width+x-1];
                                    
                                    const B = p2+p3+p4+p5+p6+p7+p8+p9;
                                    if (B < 2 || B > 6) continue;
                                    
                                    const A = (p2===0&&p3===1?1:0)+(p3===0&&p4===1?1:0)+
                                              (p4===0&&p5===1?1:0)+(p5===0&&p6===1?1:0)+
                                              (p6===0&&p7===1?1:0)+(p7===0&&p8===1?1:0)+
                                              (p8===0&&p9===1?1:0)+(p9===0&&p2===1?1:0);
                                    if (A !== 1) continue;
                                    
                                    if (p2*p4*p8 === 0 && p2*p6*p8 === 0) {
                                        toRemove2.push(idx);
                                    }
                                }
                            }
                            for (const idx of toRemove2) { result[idx] = 0; changed = true; }
                        }
                        return result;
                    }
                    
                    // 应用骨架化
                    const skeletonData = thinning(binaryData, w, h);
                    
                    const simplifyLevel = vectorSimplify || 3;
                    const visited = new Uint8Array(w * h);
                    let lines = [];
                    
                    // 8方向邻居
                    const dx8 = [1, 1, 0, -1, -1, -1, 0, 1];
                    const dy8 = [0, 1, 1, 1, 0, -1, -1, -1];
                    
                    // 追踪一条边缘链 (使用骨架化后的数据)
                    function traceChain(startX, startY) {
                        const chain = [{x: startX, y: startY}];
                        visited[startY * w + startX] = 1;
                        let x = startX, y = startY;
                        let lastDir = -1;
                        
                        while (true) {
                            let found = false;
                            // 优先沿着上一次方向继续
                            const startD = lastDir >= 0 ? lastDir : 0;
                            for (let d = 0; d < 8; d++) {
                                const dir = (startD + d) % 8;
                                const nx = x + dx8[dir];
                                const ny = y + dy8[dir];
                                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                                    const idx = ny * w + nx;
                                    if (skeletonData[idx] && !visited[idx]) {
                                        visited[idx] = 1;
                                        chain.push({x: nx, y: ny});
                                        x = nx; y = ny;
                                        lastDir = dir;
                                        found = true;
                                        break;
                                    }
                                }
                            }
                            if (!found) break;
                        }
                        return chain;
                    }
                    
                    // 扫描并追踪所有边缘链 (使用骨架化数据)
                    const chains = [];
                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            if (skeletonData[y * w + x] && !visited[y * w + x]) {
                                const chain = traceChain(x, y);
                                if (chain.length >= 2) {
                                    chains.push(chain);
                                }
                            }
                        }
                    }
                    
                    // Douglas-Peucker 简化参数
                    const toleranceMap = { 1: 0.2, 2: 0.4, 3: 0.6, 4: 1.0, 5: 1.5 };
                    const tolerance = toleranceMap[simplifyLevel] || 0.6;
                    
                    // 对每条链应用简化并转换为线段
                    for (const chain of chains) {
                        if (chain.length < 2) continue;
                        
                        let simplified;
                        if (simplify && chain.length > 3) {
                            simplified = simplify(chain, tolerance, true);
                        } else {
                            simplified = chain;
                        }
                        
                        // 转换为线段
                        for (let i = 0; i < simplified.length - 1; i++) {
                            lines.push({
                                x1: simplified[i].x, y1: simplified[i].y,
                                x2: simplified[i+1].x, y2: simplified[i+1].y
                            });
                        }
                    }
                    
                    // 简单去重：使用哈希表去除完全重复的线段
                    const lineSet = new Map();
                    for (const line of lines) {
                        // 标准化方向
                        let x1 = line.x1, y1 = line.y1, x2 = line.x2, y2 = line.y2;
                        if (x1 > x2 || (x1 === x2 && y1 > y2)) {
                            [x1, x2] = [x2, x1];
                            [y1, y2] = [y2, y1];
                        }
                        const key = `${x1},${y1}-${x2},${y2}`;
                        if (!lineSet.has(key)) {
                            lineSet.set(key, { x1, y1, x2, y2 });
                        }
                    }
                    
                    lines = Array.from(lineSet.values());
                    
                    // 只过滤极短的点状线段（长度<1像素）
                    const minLenMap = { 1: 0, 2: 0.5, 3: 1, 4: 1.5, 5: 2 };
                    const minLen = minLenMap[simplifyLevel] || 1;
                    lines = lines.filter(l => {
                        const len = Math.sqrt((l.x2 - l.x1) ** 2 + (l.y2 - l.y1) ** 2);
                        return len >= minLen;
                    });
                    
                    console.log(`[Vector] 边缘追踪 (级别${simplifyLevel}): ${chains.length} 链 -> ${lines.length} 线段`);
                    
                    // 根据编码方式选择编码函数
                    const encoding = vectorEncoding || 'delta';
                    let vectorBuffer;
                    let encodingLabel;
                    
                    if (encoding === 'contour') {
                        vectorBuffer = encodeContourChain(lines, w, h);
                        encodingLabel = '轮廓链';
                    } else {
                        vectorBuffer = encodeDelta(lines, w, h);
                        encodingLabel = '差分';
                    }
                    
                    const compressionRatio = ((1 - vectorBuffer.length / (w * h / 8)) * 100).toFixed(1);
                    console.log(`[Vector] 编码(${encodingLabel}): ${vectorBuffer.length}B, 压缩 ${compressionRatio}%`);
                    
                    // SVG 预览 - 显示真实线段效果
                    const svgLines = lines.map(l => 
                        `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="white" stroke-width="1"/>`
                    ).join('');
                    
                    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="black"/>
${svgLines}
<text x="3" y="12" font-size="9" fill="#4CAF50" font-family="monospace">${lines.length} lines | ${vectorBuffer.length}B | ${encodingLabel}</text>
</svg>`;
                    const svgBase64 = Buffer.from(svgContent).toString('base64');
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        data: vectorBuffer.toString('base64'),
                        dataUrl: 'data:image/svg+xml;base64,' + svgBase64,
                        size: vectorBuffer.length,
                        format: 'vector',
                        width: w,
                        height: h,
                        vectorInfo: {
                            lineCount: lines.length,
                            chainCount: chains.length,
                            encoding: encoding,
                            isVector: true,
                            compressionRatio: compressionRatio
                        }
                    }));
                    return;
                    
                } else if (channelMode === 'binary') {
                    // 边缘检测 + 二值化
                    const operator = edgeOperator || 'sobel';
                    image = image.grayscale();
                    
                    if (operator === 'sobel') {
                        // Sobel 边缘检测
                        image = image.convolve({
                            width: 3,
                            height: 3,
                            kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1]
                        });
                    } else if (operator === 'prewitt') {
                        // Prewitt 边缘检测
                        image = image.convolve({
                            width: 3,
                            height: 3,
                            kernel: [-1, 0, 1, -1, 0, 1, -1, 0, 1]
                        });
                    } else if (operator === 'scharr') {
                        // Scharr 边缘检测（更精确）
                        image = image.convolve({
                            width: 3,
                            height: 3,
                            kernel: [-3, 0, 3, -10, 0, 10, -3, 0, 3],
                            scale: 16
                        });
                    } else if (operator === 'roberts') {
                        // Roberts 边缘检测（2x2）
                        image = image.convolve({
                            width: 2,
                            height: 2,
                            kernel: [1, 0, 0, -1]
                        });
                    } else if (operator === 'laplacian') {
                        // Laplacian 边缘检测
                        image = image.convolve({
                            width: 3,
                            height: 3,
                            kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1]
                        });
                    } else if (operator === 'log') {
                        // LoG (Laplacian of Gaussian)
                        image = image.convolve({
                            width: 5,
                            height: 5,
                            kernel: [0, 0, -1, 0, 0, 0, -1, -2, -1, 0, -1, -2, 16, -2, -1, 0, -1, -2, -1, 0, 0, 0, -1, 0, 0]
                        });
                    } else if (operator === 'kirsch') {
                        // Kirsch 边缘检测（使用N方向核）
                        image = image.convolve({
                            width: 3,
                            height: 3,
                            kernel: [5, 5, 5, -3, 0, -3, -3, -3, -3]
                        });
                    } else if (operator === 'canny') {
                        // Canny 边缘检测（使用Sharp内置的高质量实现）
                        try {
                            // Sharp的canny已经包含了高斯平滑、梯度计算、非极大值抑制和双阈值
                            image = image.canny({ sigma: 1.4 }); // 使用适中的高斯平滑
                        } catch (e) {
                            // 回退到手动实现
                            image = image.blur(1.4).convolve({
                                width: 3,
                                height: 3,
                                kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1]
                            });
                        }
                    }
                    
                    // 根据 quality 参数计算二值化阈值
                    // quality: 1-100, 对应阈值: 250-50 (quality越高，阈值越低，边缘越多)
                    const binaryThreshold = Math.round(250 - (quality || 50) * 2);
                    
                    // Canny已经输出二值图，其他算子需要归一化和阈值化
                    if (operator !== 'canny') {
                        image = image.normalise().threshold(binaryThreshold);
                    }
                    
                    // 根据编码方式处理二值图像
                    const binEncoding = binaryEncoding || 'rle';
                    
                    if (binEncoding === 'freeman' || binEncoding === 'rle' || binEncoding === 'raw') {
                        // 获取二值图像数据
                        const rawBuffer = await image.raw().toBuffer({ resolveWithObject: true });
                        const pixels = rawBuffer.data;
                        const info = rawBuffer.info;
                        const w = width, h = height;
                        
                        // 转换为二值数组 (使用相同的阈值)
                        const binaryData = new Uint8Array(w * h);
                        for (let i = 0; i < pixels.length; i += info.channels) {
                            binaryData[i / info.channels] = pixels[i] > 0 ? 1 : 0; // threshold已处理，这里只需>0
                        }
                        
                        // 根据编码方式选择编码函数
                        let encodedBuffer;
                        let encodingLabel;
                        
                        if (binEncoding === 'freeman') {
                            encodedBuffer = encodeFreemanChain(binaryData, w, h);
                            encodingLabel = '像素坐标';
                            
                            // 解码后生成预览，展示真实效果
                            const pixelPreview = decodeFreemanForPreview(encodedBuffer, w, h);
                            if (pixelPreview && pixelPreview.pixels) {
                                const compressionRatio = ((1 - encodedBuffer.length / (w * h / 8)) * 100).toFixed(1);
                                console.log(`[Binary-${operator}] 编码(${encodingLabel}): ${encodedBuffer.length}B, 压缩 ${compressionRatio}%, ${pixelPreview.pixels.length}像素`);
                                
                                // 生成真实解码预览 SVG (每个像素一个小方块)
                                const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="white"/>
${pixelPreview.pixels.map(p => 
    `<rect x="${p.x}" y="${p.y}" width="1" height="1" fill="black"/>`
).join('\n')}
<text x="3" y="12" font-size="9" fill="#E91E63" font-family="monospace">${encodingLabel} | ${encodedBuffer.length}B | ${pixelPreview.pixels.length}px</text>
</svg>`;
                                const svgBase64 = Buffer.from(svgContent).toString('base64');
                                
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ 
                                    success: true, 
                                    data: encodedBuffer.toString('base64'),
                                    dataUrl: 'data:image/svg+xml;base64,' + svgBase64,
                                    size: encodedBuffer.length,
                                    format: 'binary',
                                    width: w,
                                    height: h,
                                    binaryInfo: {
                                        encoding: binEncoding,
                                        compressionRatio: compressionRatio,
                                        pixelCount: pixelPreview.pixels.length
                                    }
                                }));
                                return;
                            }
                        } else if (binEncoding === 'raw') {
                            encodedBuffer = await encodeRawBitmap(binaryData, w, h);
                            encodingLabel = encodedBuffer[0] === 0xB1 ? '原始位图(ZSTD)' : '原始位图(zlib)';
                        } else {
                            encodedBuffer = encodeRLE(binaryData, w, h);
                            encodingLabel = 'RLE';
                        }
                        
                        const compressionRatio = ((1 - encodedBuffer.length / (w * h / 8)) * 100).toFixed(1);
                        console.log(`[Binary-${operator}] 编码(${encodingLabel}): ${encodedBuffer.length}B, 压缩 ${compressionRatio}%`);
                        
                        // 生成预览 SVG
                        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="white"/>
${Array.from({ length: h }, (_, y) => 
    Array.from({ length: w }, (_, x) => 
        binaryData[y * w + x] ? `<rect x="${x}" y="${y}" width="1" height="1" fill="black"/>` : ''
    ).join('')
).join('')}
<text x="3" y="12" font-size="9" fill="#E91E63" font-family="monospace">${encodingLabel} | ${encodedBuffer.length}B | ${compressionRatio}%</text>
</svg>`;
                        const svgBase64 = Buffer.from(svgContent).toString('base64');
                        
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: true, 
                            data: encodedBuffer.toString('base64'),
                            dataUrl: 'data:image/svg+xml;base64,' + svgBase64,
                            size: encodedBuffer.length,
                            format: 'binary',
                            width: w,
                            height: h,
                            binaryInfo: {
                                encoding: binEncoding,
                                compressionRatio: compressionRatio
                            }
                        }));
                        return;
                    }
                }
                
                // 根据格式压缩
                const q = quality || 80;
                let outputBuffer;
                let outputFormat = format || 'jpeg';
                
                switch (outputFormat) {
                    case 'avif':
                        outputBuffer = await image.avif({ quality: q }).toBuffer();
                        break;
                    case 'webp':
                        outputBuffer = await image.webp({ quality: q }).toBuffer();
                        break;
                    case 'jpeg':
                    default:
                        outputBuffer = await image.jpeg({ quality: q }).toBuffer();
                        outputFormat = 'jpeg';
                        break;
                }
                
                // 转换为 Base64
                const outputBase64 = outputBuffer.toString('base64');
                const mimeType = outputFormat === 'jpeg' ? 'image/jpeg' : 
                               outputFormat === 'webp' ? 'image/webp' : 'image/avif';
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    data: outputBase64,
                    dataUrl: `data:${mimeType};base64,${outputBase64}`,
                    size: outputBuffer.length,
                    width: width,
                    height: height,
                    format: outputFormat,
                    channel: channelMode
                }));
                
            } catch (error) {
                console.error('图片压缩错误:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: error.message }));
            }
        });
    }

    handleSaveVersion(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { version, description, items, totalSize } = JSON.parse(body);
                
                if (!version || !items || items.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'version and items are required' }));
                    return;
                }
                
                const fs = require('fs');
                const path = require('path');
                const dir = path.join(__dirname, '..', 'sdk', 'versions');
                
                // 创建目录
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // 生成XML内容
                const timestamp = new Date().toISOString();
                let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
                xmlContent += '<CustomDataBlockVersion>\n';
                xmlContent += `  <Metadata>\n`;
                xmlContent += `    <Version>${this.escapeXml(version)}</Version>\n`;
                xmlContent += `    <Description>${this.escapeXml(description || '')}</Description>\n`;
                xmlContent += `    <CreatedAt>${timestamp}</CreatedAt>\n`;
                xmlContent += `    <TotalSize unit="bytes">${totalSize}</TotalSize>\n`;
                xmlContent += `  </Metadata>\n`;
                xmlContent += `  <Fields count="${items.length}">\n`;
                
                items.forEach((item, index) => {
                    xmlContent += `    <Field index="${index + 1}">\n`;
                    xmlContent += `      <Name>${this.escapeXml(item.name)}</Name>\n`;
                    xmlContent += `      <Type>${this.escapeXml(item.type)}</Type>\n`;
                    xmlContent += `      <Size unit="bytes">${this.getTypeSize(item.type)}</Size>\n`;
                    if (item.min !== undefined || item.max !== undefined) {
                        xmlContent += `      <Range>\n`;
                        xmlContent += `        <Min>${item.min !== undefined ? item.min : 'null'}</Min>\n`;
                        xmlContent += `        <Max>${item.max !== undefined ? item.max : 'null'}</Max>\n`;
                        xmlContent += `      </Range>\n`;
                    }
                    xmlContent += `    </Field>\n`;
                });
                
                xmlContent += `  </Fields>\n`;
                xmlContent += '</CustomDataBlockVersion>\n';
                
                // 保存文件
                const fileName = `custom_data_v${version.replace(/\./g, '_')}.xml`;
                const filePath = path.join(dir, fileName);
                fs.writeFileSync(filePath, xmlContent, 'utf8');
                
                console.log(`📝 已保存版本配置: ${filePath}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    path: `sdk/versions/${fileName}`
                }));
                
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    }

    escapeXml(unsafe) {
        if (unsafe === null || unsafe === undefined) return '';
        return String(unsafe)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    getTypeSize(type) {
        const sizes = {
            'uint8': 1, 'int8': 1, 'bool': 1,
            'uint8_t': 1, 'int8_t': 1,
            'uint16': 2, 'int16': 2,
            'uint16_t': 2, 'int16_t': 2,
            'uint32': 4, 'int32': 4, 'float': 4,
            'uint32_t': 4, 'int32_t': 4,
            'uint64': 8, 'int64': 8,
            'uint64_t': 8, 'int64_t': 8,
            'double': 8,
            'image_block': 128, 'ImageBlock': 128
        };
        return sizes[type] || 0;
    }

    // C 语法检查方法（Web 方案）
    checkCSyntax(hContent, cContent) {
        const errors = [];
        const warnings = [];
        
        // 检查 .h 文件
        this.checkCFile(hContent, 'custom_data.h', errors, warnings);
        
        // 检查 .c 文件
        this.checkCFile(cContent, 'custom_data.c', errors, warnings);
        
        // 构建返回结果
        const result = {
            passed: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
        
        if (errors.length > 0) {
            result.message = `❌ 语法检查发现 ${errors.length} 个错误`;
            console.log(`❌ 语法检查发现 ${errors.length} 个错误`);
            errors.forEach(err => console.log(`   ${err}`));
        } else if (warnings.length > 0) {
            result.message = `✅ 语法检查通过 (${warnings.length} 个警告)`;
            console.log(`⚠️ 语法检查通过，但有 ${warnings.length} 个警告`);
            warnings.forEach(warn => console.log(`   ${warn}`));
        } else {
            result.message = '✅ 语法检查通过';
            console.log('✅ 语法检查通过，无警告');
        }
        
        return result;
    }

    checkCFile(content, filename, errors, warnings) {
        const lines = content.split('\n');
        const isHeader = filename.endsWith('.h');
        
        // 1. 检查常见类型名错误
        const typos = [
            { wrong: 'unint8_t', right: 'uint8_t' },
            { wrong: 'unint16_t', right: 'uint16_t' },
            { wrong: 'unint32_t', right: 'uint32_t' },
            { wrong: 'unint64_t', right: 'uint64_t' }
        ];
        
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            typos.forEach(typo => {
                if (line.includes(typo.wrong)) {
                    errors.push(`${filename}:${lineNum}: 类型名错误: '${typo.wrong}' 应为 '${typo.right}'`);
                }
            });
        });
        
        // 2. 检查括号匹配（全局）
        let braceCount = 0;
        let parenCount = 0;
        
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();
            
            // 跳过注释行
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                return;
            }
            
            // 检查大括号
            for (const char of line) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
                if (braceCount < 0) {
                    errors.push(`${filename}:${lineNum}: 多余的右大括号 '}'`);
                    braceCount = 0;
                }
            }
            
            // 检查圆括号（每行单独检查）
            let localParenCount = 0;
            for (const char of line) {
                if (char === '(') localParenCount++;
                if (char === ')') localParenCount--;
                if (localParenCount < 0) {
                    errors.push(`${filename}:${lineNum}: 括号不匹配`);
                    localParenCount = 0;
                }
            }
            if (localParenCount > 0 && !trimmed.endsWith('\\')) {
                // 可能是多行表达式，只警告
                warnings.push(`${filename}:${lineNum}: 该行圆括号未闭合（可能是多行语句）`);
            }
        });
        
        if (braceCount !== 0) {
            errors.push(`${filename}: 大括号不匹配（${braceCount > 0 ? '缺少' : '多余'} ${Math.abs(braceCount)} 个右大括号）`);
        }
        
        // 3. 检查分号（针对语句）
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();
            
            // 跳过空行、注释、预处理指令、大括号单独行
            if (!trimmed || 
                trimmed.startsWith('//') || 
                trimmed.startsWith('/*') || 
                trimmed.startsWith('*') ||
                trimmed.startsWith('#') ||
                trimmed === '{' ||
                trimmed === '}' ||
                trimmed.endsWith('{') ||
                trimmed.startsWith('}')) {
                return;
            }
            
            // 跳过控制流语句
            if (/^\s*(if|for|while|switch|else|case|default)\b/.test(line)) {
                return;
            }

            // 检查可能需要分号的语句
            const needsSemicolon = 
                /^\s*(return|break|continue)\s+/.test(line) || // return/break/continue 语句
                (/=\s*[^=]/.test(trimmed) && !trimmed.includes('{') && !trimmed.endsWith(';')); // 赋值语句（非结构体初始化，且未以分号结尾）
            
            if (needsSemicolon && !trimmed.endsWith(';') && !trimmed.endsWith(',')) {
                warnings.push(`${filename}:${lineNum}: 可能缺少分号`);
            }
        });
        
        // 4. 头文件特定检查
        if (isHeader) {
            const hasIfndef = content.includes('#ifndef');
            const hasDefine = content.includes('#define');
            const hasEndif = content.includes('#endif');
            
            if (!hasIfndef || !hasDefine || !hasEndif) {
                warnings.push(`${filename}: 头文件可能缺少头文件保护 (#ifndef/#define/#endif)`);
            }
        }
        
        // 5. .c 文件特定检查
        if (!isHeader) {
            if (!content.includes('#include "custom_data.h"')) {
                warnings.push(`${filename}: .c 文件应包含对应的 .h 文件`);
            }
        }
        
        // 6. 检查可疑的指针语法
        lines.forEach((line, idx) => {
            const lineNum = idx + 1;
            const trimmed = line.trim();
            
            // 跳过注释行（包含 @brief、@param 等 Doxygen 标记）
            if (trimmed.startsWith('//') || 
                trimmed.startsWith('/*') || 
                trimmed.startsWith('*') ||
                trimmed.startsWith('@')) {
                return;
            }
            
            // 检查 ** 但不在类型声明中（如 uint8_t **）或注释中
            if (/\*\s*\*(?!\))/.test(line) && 
                !/uint\d+_t\s+\*\*/.test(line) &&
                !line.includes('/**') &&
                !line.includes('**/')) {
                warnings.push(`${filename}:${lineNum}: 检测到双重指针，请确认语法正确`);
            }
        });
    }

    startAutoPublishForMessage(messageType, intervalMs, topic) {
        if (this.autoPublishers[messageType]) {
            clearInterval(this.autoPublishers[messageType].timer);
            this.autoPublishers[messageType] = null;
        }
        const ms = intervalMs || this.messageDefaultFrequencies[messageType] || 1000;
        const publishTopic = topic || messageType;
        const template = this.downlinkConfigs[messageType] || this.generateMockData(messageType) || {};

        const timer = setInterval(() => {
            try {
                const MessageType = this.protoRoot.lookupType(messageType);
                const convertedData = this.convertKeysToCamel(template);
                const errMsg = MessageType.verify(convertedData);
                if (errMsg) return;
                const message = MessageType.create(convertedData);
                const buffer = MessageType.encode(message).finish();
                aedes.publish({ topic: publishTopic, payload: buffer, qos: 0, retain: false });
                console.log(`📤 自动发送下行消息 - 类型: ${messageType}, 大小: ${buffer.length} 字节`);
            } catch (error) {
                console.error(`❌ 自动发送失败 (${messageType}):`, error.message);
            }
        }, ms);

        this.autoPublishers[messageType] = { timer, intervalMs: ms, topic: publishTopic };
        console.log(`🚀 开始自动发送下行消息(${messageType})，间隔: ${ms}ms`);
    }

    stopAutoPublishForMessage(messageType) {
        const p = this.autoPublishers[messageType];
        if (p && p.timer) {
            clearInterval(p.timer);
            delete this.autoPublishers[messageType];
            console.log(`⏹️ 停止自动发送下行消息(${messageType})`);
        }
    }

    generateMockData(messageType) {
        // 根据消息类型生成模拟数据
        const mockDataTemplates = {
            'GameStatus': {
                currentRound: 1,
                totalRounds: 3,
                redScore: Math.floor(Math.random() * 100),
                blueScore: Math.floor(Math.random() * 100),
                currentStage: 4,
                stageCountdownSec: Math.floor(Math.random() * 420),
                stageElapsedSec: Math.floor(Math.random() * 420),
                isPaused: false
            },
            'RobotDynamicStatus': {
                currentHealth: Math.floor(Math.random() * 600),
                currentHeat: Math.random() * 100,
                lastProjectileFireRate: 15 + Math.random() * 3,
                currentChassisEnergy: Math.floor(Math.random() * 60),
                currentBufferEnergy: Math.floor(Math.random() * 100),
                currentExperience: Math.floor(Math.random() * 500),
                experienceForUpgrade: 1000,
                totalProjectilesFired: Math.floor(Math.random() * 200),
                remainingAmmo: Math.floor(Math.random() * 200),
                isOutOfCombat: Math.random() > 0.5,
                outOfCombatCountdown: Math.floor(Math.random() * 10),
                canRemoteHeal: true,
                canRemoteAmmo: true
            },
            'RobotPosition': {
                x: Math.random() * 28 - 14,
                y: Math.random() * 15 - 7.5,
                z: 0.5,
                yaw: Math.random() * 360
            },
            'GlobalUnitStatus': {
                baseHealth: Math.floor(Math.random() * 5000),
                baseStatus: 1,
                baseShield: Math.floor(Math.random() * 500),
                outpostHealth: Math.floor(Math.random() * 1500),
                outpostStatus: 1,
                robotHealth: Array(10).fill(0).map(() => Math.floor(Math.random() * 600)),
                robotBullets: Array(5).fill(0).map(() => Math.floor(Math.random() * 200)),
                totalDamageRed: Math.floor(Math.random() * 5000),
                totalDamageBlue: Math.floor(Math.random() * 5000)
            }
        };
        
        return mockDataTemplates[messageType] || null;
    }

    convertKeysToCamel(value) {
        if (Array.isArray(value)) {
            return value.map(v => this.convertKeysToCamel(v));
        }
        if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
            const newObj = {};
            for (const [k, v] of Object.entries(value)) {
                const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                newObj[camelKey] = this.convertKeysToCamel(v);
            }
            return newObj;
        }
        return value;
    }

    parseFieldValues(messageType, data) {
        const metadata = this.messageMetadata[messageType];
        if (!metadata || !metadata.fields) return {};

        const parsed = {};
        
        // Add customData if present
        if (data.customData) {
            parsed.customData = { 
                value: data.customData, 
                display: 'Custom Data',
                description: '解析后的自定义数据'
            };
        }
        
        for (const [fieldName, value] of Object.entries(data)) {
            // 尝试查找字段元数据（支持camelCase和snake_case）
            let fieldMeta = metadata.fields[fieldName];
            if (!fieldMeta) {
                // 尝试转换为snake_case
                const snakeName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
                fieldMeta = metadata.fields[snakeName];
            }
            if (!fieldMeta) {
                // 尝试转换为camelCase
                const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                fieldMeta = metadata.fields[camelName];
            }
            
            if (!fieldMeta) {
                parsed[fieldName] = { value, display: String(value) };
                continue;
            }

            let display = String(value);
            let description = fieldMeta.description || fieldMeta.comment || '';
            
            // 优先使用 Protocol.md 的状态映射
            const statusMapping = this.statusMappings[fieldName];
            if (statusMapping && Array.isArray(statusMapping)) {
                const mapping = statusMapping.find(m => m.value === value);
                if (mapping) {
                    display = `${value} (${mapping.label})`;
                }
            }
            // 解析布尔值
            else if (fieldMeta.type === 'bool') {
                // 根据字段名称推断含义
                if (fieldName.includes('button') || fieldName.includes('down')) {
                    display = value ? '按下' : '抬起';
                } else if (fieldName.includes('is_') || fieldName.includes('can_')) {
                    display = value ? '是' : '否';
                } else if (fieldName.includes('open')) {
                    display = value ? '开启' : '关闭';
                } else if (description.includes('false') || description.includes('true')) {
                    const match = description.match(/(false|抬起|否)[^a-zA-Z]*[:：=]?([^,，)]+).*?(true|按下|是)[^a-zA-Z]*[:：=]?([^,，)]+)/i);
                    if (match) {
                        const falseText = match[2]?.trim() || '否';
                        const trueText = match[4]?.trim() || '是';
                        display = value ? trueText : falseText;
                    } else {
                        display = value ? '是' : '否';
                    }
                } else {
                    display = value ? '是' : '否';
                }
            }
            // 解析数值（带方向或状态说明）
            else if ((fieldMeta.type === 'int32' || fieldMeta.type === 'float') && description) {
                display = String(value);
                
                // 检查是否有方向说明
                if (fieldName.toLowerCase().includes('mouse')) {
                    if (value < 0) {
                        if (description.includes('向左') || fieldName.includes('_x')) display += ' (向左)';
                        else if (description.includes('向下') || fieldName.includes('_y')) display += ' (向下)';
                        else if (description.includes('向后') || fieldName.includes('_z')) display += ' (向后滚动)';
                    } else if (value > 0) {
                        if (description.includes('向左') || fieldName.includes('_x')) display += ' (向右)';
                        else if (description.includes('向下') || fieldName.includes('_y')) display += ' (向上)';
                        else if (description.includes('向后') || fieldName.includes('_z')) display += ' (向前滚动)';
                    }
                }
            }
            // 解析枚举值（作为fallback）
            else if (fieldMeta.type === 'uint32' && description) {
                const enumComment = this.findEnumComment(metadata, fieldName);
                if (enumComment) {
                    const enumValue = this.parseEnumValue(enumComment, value);
                    if (enumValue) {
                        display = `${value} (${enumValue})`;
                    }
                }
            }

            parsed[fieldName] = {
                value: value,
                display: display,
                description: description,
                type: fieldMeta.type
            };
        }

        return parsed;
    }

    findEnumComment(metadata, fieldName) {
        // 优先使用解析时存储的枚举注释映射
        if (metadata.enumComments && metadata.enumComments[fieldName]) {
            return metadata.enumComments[fieldName];
        }
        // 兼容性：在消息级注释中查找枚举定义（老 proto 的注释可能写在消息上方）
        if (Array.isArray(metadata.comments)) {
            for (const comment of metadata.comments) {
                if (comment.includes(fieldName) && comment.includes('枚举')) {
                    return comment;
                }
            }
        }
        return null;
    }

    parseEnumValue(enumComment, value) {
        // 解析枚举注释，格式如: "枚举值: 0:未开始, 1:准备, 2:自检, 3:倒计时, 4:比赛中, 5:结算"
        const match = enumComment.match(/枚举[^:]*:\s*(.+)/);
        if (!match) return null;

        const enumPart = match[1];
        const pairs = enumPart.split(/[,，、]/);
        
        for (const pair of pairs) {
            const pairMatch = pair.trim().match(/^(\d+)\s*[:：]\s*(.+)/);
            if (pairMatch) {
                const enumKey = parseInt(pairMatch[1]);
                const enumValue = pairMatch[2].trim();
                if (enumKey === value) {
                    return enumValue;
                }
            }
        }
        
        return null;
    }

    encodeCustomDataRaw(data, configName) {
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(__dirname, '..', 'sdk', 'configs', `${configName}.xml`);
            
            if (!fs.existsSync(filePath)) {
                console.warn(`Config file not found: ${filePath}`);
                return null;
            }
            
            const content = fs.readFileSync(filePath, 'utf8');
            
            // 解析 XML 字段
            const fieldMatches = [...content.matchAll(/<Field[^>]*>([\s\S]*?)<\/Field>/g)];
            // 注意：这里会匹配到 ImageCompanionFields 里的 Field，需要过滤
            // 更好的方式是先提取 <Fields> 标签内的内容
            const fieldsBlock = content.match(/<Fields[^>]*>([\s\S]*?)<\/Fields>/)?.[1] || '';
            const itemMatches = [...fieldsBlock.matchAll(/<Field[^>]*>([\s\S]*?)<\/Field>/g)];
            
            const items = itemMatches.map(match => {
                const fieldContent = match[1];
                const itemName = fieldContent.match(/<Name>(.*?)<\/Name>/)?.[1] || '';
                const itemType = fieldContent.match(/<Type>(.*?)<\/Type>/)?.[1] || '';
                const sizeMatch = fieldContent.match(/<Size[^>]*>(\d+)<\/Size>/);
                return { 
                    name: itemName, 
                    type: itemType,
                    size: sizeMatch ? parseInt(sizeMatch[1]) : 0
                };
            });

            // 解析图片伴随字段
            const companionBlock = content.match(/<ImageCompanionFields>([\s\S]*?)<\/ImageCompanionFields>/)?.[1] || '';
            const companionFields = [...companionBlock.matchAll(/<Field>(.*?)<\/Field>/g)].map(m => m[1]);
            
            // 创建 150 字节缓冲区
            const buffer = Buffer.alloc(150);
            let offset = 0;
            
            // 辅助函数：根据字段名从 data 中获取值（支持多种命名格式）
            const getDataValue = (fieldName) => {
                // 直接匹配
                if (data[fieldName] !== undefined) return data[fieldName];
                // snake_case -> camelCase
                const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
                if (data[camelName] !== undefined) return data[camelName];
                // camelCase -> snake_case
                const snakeName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
                if (data[snakeName] !== undefined) return data[snakeName];
                // 忽略下划线的模糊匹配
                for (const key of Object.keys(data)) {
                    if (key.toLowerCase().replace(/_/g, '') === fieldName.toLowerCase().replace(/_/g, '')) {
                        return data[key];
                    }
                }
                return undefined;
            };
            
            // 判断是否为图片模式 (支持 image_block 和 ImageBlock 两种写法)
            const imageField = items.find(i => i.type === 'image_block' || i.type === 'ImageBlock');
            let isImageMode = false;
            if (imageField) {
                const imgData = getDataValue(imageField.name);
                // 如果数据中包含图片字段且不为空，则认为是图片模式
                if (imgData && (imgData.cmd_type !== undefined || imgData.cmdType !== undefined || imgData.data)) {
                    isImageMode = true;
                }
            }
            
            // 调试输出
            console.log(`🔍 Debug: imageField=${imageField?.name}, isImageMode=${isImageMode}`);
            console.log(`🔍 Debug: data keys = ${Object.keys(data).join(', ')}`);
            if (imageField) {
                const imgData = getDataValue(imageField.name);
                if (imgData !== undefined) {
                    const jsonStr = JSON.stringify(imgData) || '';
                    console.log(`🔍 Debug: data[${imageField.name}] =`, jsonStr.substring(0, 200));
                }
            }

            if (isImageMode) {
                // Mode 0x01: Image Data
                buffer.writeUInt8(0x01, offset);
                offset += 1;
                
                // 1. 写入伴随数据
                for (const fieldName of companionFields) {
                    const item = items.find(i => i.name === fieldName);
                    if (item) {
                        offset = this.writeFieldToBuffer(buffer, offset, item, data);
                    }
                }
                
                // 2. 写入图片块 (128 bytes)
                if (imageField) {
                    offset = this.writeImageBlockToBuffer(buffer, offset, imageField, data);
                }
                
            } else {
                // Mode 0x00: Pure Data
                buffer.writeUInt8(0x00, offset);
                offset += 1;
                
                // 写入所有非图片字段 (支持两种 ImageBlock 写法)
                for (const item of items) {
                    if (item.type === 'image_block' || item.type === 'ImageBlock') continue;
                    offset = this.writeFieldToBuffer(buffer, offset, item, data);
                }
            }
            
            console.log(`📦 Raw Data Packed: ${offset} bytes used (Total 150), Mode: ${isImageMode ? '0x01 (Image)' : '0x00 (Pure)'}`);
            
            // 详细打印 MQTT 发送的真实数据
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📡 MQTT 发送的 150 字节原始数据 (Hex):');
            
            // 按行显示，每行 16 字节
            for (let i = 0; i < 150; i += 16) {
                const line = buffer.slice(i, Math.min(i + 16, 150));
                const hex = Array.from(line).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
                const ascii = Array.from(line).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
                console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48)} | ${ascii}`);
            }
            
            // 解析显示各字段
            console.log('');
            console.log('📋 数据结构解析:');
            console.log(`  [0x0000] Mode: 0x${buffer[0].toString(16).padStart(2, '0')} (${buffer[0] === 0x00 ? '纯数据' : '图片模式'})`);
            
            if (isImageMode && imageField) {
                // 图片模式：显示伴随数据 + ImageBlock
                let parseOffset = 1;
                
                // 解析伴随数据
                if (companionFields.length > 0) {
                    console.log('  伴随数据:');
                    for (const fieldName of companionFields) {
                        const item = items.find(i => i.name === fieldName);
                        if (item) {
                            const fieldSize = this.getTypeSize(item.type);
                            const fieldHex = buffer.slice(parseOffset, parseOffset + fieldSize).toString('hex').toUpperCase();
                            console.log(`    [0x${parseOffset.toString(16).padStart(4, '0')}] ${fieldName} (${item.type}): 0x${fieldHex}`);
                            parseOffset += fieldSize;
                        }
                    }
                }
                
                // 解析 ImageBlock (128 字节)
                console.log('  ImageBlock (128字节):');
                console.log(`    [0x${parseOffset.toString(16).padStart(4, '0')}] cmd_type: 0x${buffer[parseOffset].toString(16).padStart(2, '0')} (${buffer[parseOffset] === 0x02 ? '数据块' : buffer[parseOffset] === 0x03 ? '结束帧' : '未知'})`);
                console.log(`    [0x${(parseOffset+1).toString(16).padStart(4, '0')}] img_id: ${buffer.readUInt16LE(parseOffset + 1)} (0x${buffer.readUInt16LE(parseOffset + 1).toString(16).padStart(4, '0')})`);
                console.log(`    [0x${(parseOffset+3).toString(16).padStart(4, '0')}] block_idx: ${buffer.readUInt16LE(parseOffset + 3)}`);
                console.log(`    [0x${(parseOffset+5).toString(16).padStart(4, '0')}] total_block: ${buffer.readUInt16LE(parseOffset + 5)}`);
                console.log(`    [0x${(parseOffset+7).toString(16).padStart(4, '0')}] data_len: ${buffer[parseOffset + 7]} 字节`);
                console.log(`    [0x${(parseOffset+8).toString(16).padStart(4, '0')}] data[0..7]: ${buffer.slice(parseOffset + 8, parseOffset + 16).toString('hex').toUpperCase()}`);
            } else {
                // 纯数据模式：显示所有字段
                let parseOffset = 1;
                for (const item of items) {
                    if (item.type === 'image_block' || item.type === 'ImageBlock') continue;
                    const fieldSize = this.getTypeSize(item.type);
                    const fieldHex = buffer.slice(parseOffset, parseOffset + fieldSize).toString('hex').toUpperCase();
                    let displayValue = fieldHex;
                    
                    // 尝试解析数值
                    if (item.type === 'float' && fieldSize === 4) {
                        displayValue = buffer.readFloatLE(parseOffset).toFixed(4);
                    } else if (item.type === 'int32' || item.type === 'int32_t') {
                        displayValue = buffer.readInt32LE(parseOffset);
                    } else if (item.type === 'uint32' || item.type === 'uint32_t') {
                        displayValue = buffer.readUInt32LE(parseOffset);
                    } else if (item.type === 'int16' || item.type === 'int16_t') {
                        displayValue = buffer.readInt16LE(parseOffset);
                    } else if (item.type === 'uint16' || item.type === 'uint16_t') {
                        displayValue = buffer.readUInt16LE(parseOffset);
                    } else if (item.type === 'int8' || item.type === 'int8_t') {
                        displayValue = buffer.readInt8(parseOffset);
                    } else if (item.type === 'uint8' || item.type === 'uint8_t') {
                        displayValue = buffer.readUInt8(parseOffset);
                    }
                    
                    console.log(`  [0x${parseOffset.toString(16).padStart(4, '0')}] ${item.name} (${item.type}): ${displayValue} (hex: ${fieldHex})`);
                    parseOffset += fieldSize;
                }
            }
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            return buffer;
            
        } catch (e) {
            console.error('Failed to encode raw custom data:', e);
            return null;
        }
    }

    writeFieldToBuffer(buffer, offset, item, data) {
        if (offset + this.getTypeSize(item.type) > 150) {
            console.warn(`Buffer overflow writing field ${item.name}`);
            return offset;
        }

        // 获取数据值 (支持多种命名格式: snake_case, camelCase, 原始名)
        let value = data[item.name];
        let matchedKey = item.name;
        
        if (value === undefined) {
            // 尝试 snake_case -> camelCase
            const camelName = item.name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            value = data[camelName];
            if (value !== undefined) matchedKey = camelName;
        }
        if (value === undefined) {
            // 尝试 camelCase -> snake_case (反向转换)
            const snakeName = item.name.replace(/([A-Z])/g, '_$1').toLowerCase();
            value = data[snakeName];
            if (value !== undefined) matchedKey = snakeName;
        }
        if (value === undefined) {
            // 尝试移除下划线后的部分匹配 (如 infantry_ois -> 匹配 infantryOis)
            for (const key of Object.keys(data)) {
                const keyLower = key.toLowerCase().replace(/_/g, '');
                const itemLower = item.name.toLowerCase().replace(/_/g, '');
                if (keyLower === itemLower) {
                    value = data[key];
                    matchedKey = key;
                    break;
                }
            }
        }
        
        // 调试输出：显示字段匹配情况
        console.log(`  📝 写入字段 ${item.name} (${item.type}): 匹配key="${matchedKey}", 原始值=${JSON.stringify(value)}, 最终值=${value === undefined ? 0 : value}`);
        
        if (value === undefined) value = 0;

        try {
            switch (item.type) {
                case 'uint8':
                case 'uint8_t':
                    buffer.writeUInt8(Number(value) & 0xFF, offset); return offset + 1;
                case 'int8':
                case 'int8_t':
                    buffer.writeInt8(Number(value) & 0xFF, offset); return offset + 1;
                case 'uint16':
                case 'uint16_t':
                    buffer.writeUInt16LE(Number(value) & 0xFFFF, offset); return offset + 2;
                case 'int16':
                case 'int16_t':
                    buffer.writeInt16LE(Number(value) & 0xFFFF, offset); return offset + 2;
                case 'uint32':
                case 'uint32_t':
                    buffer.writeUInt32LE(Number(value) >>> 0, offset); return offset + 4;
                case 'int32':
                case 'int32_t':
                    buffer.writeInt32LE(Number(value) | 0, offset); return offset + 4;
                case 'float':
                    buffer.writeFloatLE(Number(value), offset); return offset + 4;
                case 'double':
                    buffer.writeDoubleLE(Number(value), offset); return offset + 8;
                case 'bool':
                    buffer.writeUInt8(value ? 1 : 0, offset); return offset + 1;
                case 'bytes':
                    const len = item.size || 1;
                    if (Buffer.isBuffer(value)) {
                        value.copy(buffer, offset, 0, Math.min(value.length, len));
                    } else if (Array.isArray(value)) {
                        const buf = Buffer.from(value);
                        buf.copy(buffer, offset, 0, Math.min(buf.length, len));
                    }
                    return offset + len;
                default:
                    console.warn(`Unknown type: ${item.type} for field ${item.name}`);
                    return offset;
            }
        } catch (e) {
            console.error(`Error writing field ${item.name}:`, e);
            return offset;
        }
    }

    writeImageBlockToBuffer(buffer, offset, item, data) {
        // ImageBlock Structure (128 bytes)
        // uint8_t cmd_type;
        // uint16_t img_id;
        // uint16_t block_idx;
        // uint16_t total_block;
        // uint8_t data_len;
        // uint8_t data[120];

        if (offset + 128 > 150) {
            console.warn('Buffer overflow writing ImageBlock');
            return offset;
        }

        // 辅助函数：根据字段名从 data 中获取值（支持多种命名格式）
        const getDataValue = (fieldName) => {
            if (data[fieldName] !== undefined) return data[fieldName];
            const camelName = fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            if (data[camelName] !== undefined) return data[camelName];
            const snakeName = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
            if (data[snakeName] !== undefined) return data[snakeName];
            for (const key of Object.keys(data)) {
                if (key.toLowerCase().replace(/_/g, '') === fieldName.toLowerCase().replace(/_/g, '')) {
                    return data[key];
                }
            }
            return undefined;
        };

        let imgData = getDataValue(item.name);
        if (!imgData) imgData = {};
        
        console.log(`  📷 写入 ImageBlock: 字段名=${item.name}, 找到数据=${imgData !== null && Object.keys(imgData).length > 0}`);

        try {
            // 支持 camelCase 和 snake_case 两种命名风格
            const cmdType = imgData.cmdType ?? imgData.cmd_type ?? 0;
            const imgId = imgData.imgId ?? imgData.img_id ?? 0;
            const blockIdx = imgData.blockIdx ?? imgData.block_idx ?? 0;
            const totalBlock = imgData.totalBlock ?? imgData.total_block ?? 0;
            const dataLen = imgData.dataLen ?? imgData.data_len ?? 0;
            
            console.log(`  📷 ImageBlock 值: cmd_type=${cmdType}, img_id=${imgId}, block_idx=${blockIdx}, total_block=${totalBlock}, data_len=${dataLen}`);
            
            buffer.writeUInt8(cmdType, offset); offset += 1;
            buffer.writeUInt16LE(imgId, offset); offset += 2;
            buffer.writeUInt16LE(blockIdx, offset); offset += 2;
            buffer.writeUInt16LE(totalBlock, offset); offset += 2;
            buffer.writeUInt8(dataLen, offset); offset += 1;
            
            // Write 120 bytes of data
            const rawData = imgData.data;
            if (Buffer.isBuffer(rawData)) {
                rawData.copy(buffer, offset, 0, Math.min(rawData.length, 120));
            } else if (Array.isArray(rawData)) {
                const buf = Buffer.from(rawData);
                buf.copy(buffer, offset, 0, Math.min(buf.length, 120));
            } else if (typeof rawData === 'string') {
                // Base64 string maybe?
                const buf = Buffer.from(rawData, 'base64');
                buf.copy(buffer, offset, 0, Math.min(buf.length, 120));
            }
            
            offset += 120;
            return offset;
        } catch (e) {
            console.error('Error writing ImageBlock:', e);
            return offset;
        }
    }

    generateHTML() {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MQTT 服务器可视化控制台</title>
    <link rel="stylesheet" href="/css/main.css">
    <script src="/lib/vue.global.prod.js"></script>
</head>
<body>
    <div id="app" class="container" v-cloak>
        <header>
            <h1>🚀 MQTT 服务器可视化控制台</h1>
            <div class="subtitle">RoboMaster 2026 自定义客户端通信协议 - 数据配置与监控</div>
        </header>

        <nav-bar :current-tab="currentTab" @update:current-tab="currentTab = $event"></nav-bar>
        
        <div v-if="currentTab === 'console'">
            <div class="main-content">
                <!-- 左侧：上行消息 -->
                <div class="panel">
                    <div class="panel-header">
                        📥 上行消息（客户端 → 服务器）
                        <span class="badge badge-up">{{ uplinkCount }}</span>
                    </div>
                    <div class="panel-body">
                        <p v-if="!messagesData || !messagesData.clientMessages || messagesData.clientMessages.length === 0" style="color: #999; text-align: center; padding: 20px;">
                            {{ messagesData ? '暂无上行消息' : '加载中...' }}
                        </p>
                        <div v-else v-for="msg in messagesData.clientMessages" :key="msg.name" 
                             class="message-item" :class="{ active: activeMessage === msg.name }"
                             @click="toggleMessage(msg.name)">
                            <div class="message-name">{{ msg.name }}</div>
                            <div class="message-desc">{{ msg.metadata.displayName || msg.metadata.description || '无描述' }}</div>
                            
                            <div class="field-list" @click.stop>
                                <!-- CustomByteBlock ImageBlock Display -->
                                <div v-if="msg.name === 'CustomByteBlock' && receivedValues[msg.name] && receivedValues[msg.name].customData && receivedValues[msg.name].customData.value && receivedValues[msg.name].customData.value.Image" class="image-block-container" style="margin-bottom: 15px; border: 1px solid #4caf50; border-radius: 4px; overflow: hidden;">
                                    <div style="background: #e8f5e9; padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #4caf50; color: #2e7d32; display: flex; justify-content: space-between; align-items: center;">
                                        <span>🖼️ 图片块数据 (ImageBlock)</span>
                                        <span style="font-size: 12px;">ID: {{ receivedValues[msg.name].customData.value.Image.img_id }}</span>
                                    </div>
                                    <div style="padding: 10px; background: #fff;">
                                        <div v-for="(val, key) in receivedValues[msg.name].customData.value.Image" :key="key" style="display: flex; margin-bottom: 6px; font-size: 13px; border-bottom: 1px dashed #eee; padding-bottom: 4px;">
                                            <span style="width: 120px; color: #666;">{{ key }}</span>
                                            <span style="font-family: monospace; color: #333; word-break: break-all;">{{ val }}</span>
                                        </div>
                                    </div>
                                </div>
                                <div v-for="(field, fieldName) in msg.metadata.fields" :key="fieldName" class="field-item">
                                    <div class="field-left">
                                        <span class="field-name">{{ fieldName }}</span>
                                        <span class="field-type">({{ field.repeated ? 'repeated ' : '' }}{{ field.type }})</span>
                                        <div class="field-comment">{{ field.description || field.comment || '无说明' }}</div>
                                    </div>
                                    <div class="field-right received" :id="'value-' + msg.name + '-' + fieldName">
                                        <div v-if="receivedValues[msg.name] && receivedValues[msg.name][fieldName]" class="field-value-received">
                                            {{ receivedValues[msg.name][fieldName].display }}
                                        </div>
                                        <div v-if="receivedValues[msg.name] && receivedValues[msg.name][fieldName] && receivedValues[msg.name][fieldName].description" class="field-value-desc">
                                            💡 {{ receivedValues[msg.name][fieldName].description }}
                                        </div>
                                        <div v-if="receivedValues[msg.name] && receivedValues[msg.name][fieldName]" class="field-value-time">
                                            {{ receivedValues[msg.name][fieldName].time }}
                                        </div>
                                        <div v-else class="field-value-empty">暂无数据</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- 右侧：下行消息 -->
                <div class="panel">
                    <div class="panel-header">
                        📤 下行消息（服务器 → 客户端）
                        <span class="badge badge-down">{{ downlinkCount }}</span>
                    </div>
                    <div class="panel-body">
                        <p v-if="!messagesData || !messagesData.serverMessages || messagesData.serverMessages.length === 0" style="color: #999; text-align: center; padding: 20px;">
                            {{ messagesData ? '暂无下行消息' : '加载中...' }}
                        </p>
                        <div v-else v-for="msg in messagesData.serverMessages" :key="msg.name"
                             class="message-item" :class="{ active: activeMessage === msg.name }"
                             @click="toggleMessage(msg.name)">
                            <div class="message-name">{{ messagesData.messageDisplayNames?.[msg.name] || msg.name }}</div>
                            <div class="message-desc">{{ msg.metadata.displayName || msg.metadata.description || '无描述' }}</div>
                            
                            <div class="message-content" @click.stop>
                                <!-- CustomByteBlock 特殊 UI -->
                                <div v-if="msg.name === 'CustomByteBlock'" class="custom-block-ui">
                                    <div style="padding: 10px; background: #f5f5f5; border-radius: 4px; margin-bottom: 10px;">
                                        <div style="margin-bottom: 10px; font-weight: bold; display: flex; justify-content: space-between;">
                                            <span>🛠️ 协议配置选择</span>
                                            <button @click="loadCustomConfigList" style="font-size: 12px; padding: 2px 8px;">🔄 刷新</button>
                                        </div>
                                        <select v-model="currentCustomConfigName" @change="loadCustomConfigDetails" class="form-input" style="width: 100%;">
                                            <option value="">-- 请选择配置 --</option>
                                            <option v-for="c in customConfigList" :value="c.name">{{ c.name }} (纯数据:{{ c.pureDataSize }}B{{ c.hasImageBlock ? ', 图片:' + c.imageDataSize + 'B' : '' }})</option>
                                        </select>
                                    </div>

                                    <div v-if="currentCustomConfig">
                                        <!-- Mode 0: Pure Data -->
                                        <div class="mode-container" style="border: 1px solid #2196F3; border-radius: 4px; margin-bottom: 15px; overflow: hidden;">
                                            <div style="background: #e3f2fd; padding: 8px 12px; color: #1565C0; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                                                <span>📦 纯数据模式 (Mode 0x00)</span>
                                                <span style="font-size: 12px; opacity: 0.8;">发送普通数据</span>
                                            </div>
                                            <div style="padding: 10px;">
                                                <div v-for="field in pureDataFields" :key="field.name" class="field-item">
                                                    <div class="field-left">
                                                        <span class="field-name">{{ field.name }}</span>
                                                        <span class="field-type">({{ field.type }})</span>
                                                    </div>
                                                    <div class="field-right">
                                                        <input v-model="pureDataValues[field.name]" :type="field.type === 'bool' ? 'checkbox' : 'number'" class="form-input">
                                                    </div>
                                                </div>
                                                <button class="send-message-btn" @click="sendCustomData(0)" style="width: 100%; margin-top: 10px; background: #2196F3;">📤 发送纯数据</button>
                                            </div>
                                        </div>

                                        <!-- Mode 1: Image Data -->
                                        <div v-if="hasImageBlock" class="mode-container" style="border: 1px solid #9C27B0; border-radius: 4px; margin-bottom: 15px; overflow: hidden;">
                                            <div style="background: #f3e5f5; padding: 8px 12px; color: #7B1FA2; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
                                                <span>📷 图片模式 (Mode 0x01)</span>
                                                <span style="font-size: 12px; opacity: 0.8;">发送图片+伴随数据</span>
                                            </div>
                                            <div style="padding: 10px;">
                                                <div style="margin-bottom: 10px; font-size: 12px; color: #666; font-weight: bold;">伴随数据字段:</div>
                                                <div v-for="field in companionFields" :key="field.name" class="field-item">
                                                    <div class="field-left">
                                                        <span class="field-name">{{ field.name }}</span>
                                                        <span class="field-type">({{ field.type }})</span>
                                                    </div>
                                                    <div class="field-right">
                                                        <input v-model="companionDataValues[field.name]" :type="field.type === 'bool' ? 'checkbox' : 'number'" class="form-input">
                                                    </div>
                                                </div>
                                                
                                                <div style="margin-top: 15px; border-top: 1px dashed #ccc; padding-top: 10px;">
                                                    <div style="margin-bottom: 5px; font-weight: bold;">图片上传</div>
                                                    <input type="file" @change="handleCustomImageUpload" accept="image/*">
                                                    
                                                    <!-- 压缩配置选项 -->
                                                    <div style="margin-top: 10px; padding: 10px; background: #f8f8f8; border-radius: 6px; font-size: 13px;">
                                                        <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap; margin-bottom: 8px;">
                                                            <label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
                                                                <input type="checkbox" v-model="imageCompression.enabled" @change="reprocessCustomImage" style="cursor: pointer;">
                                                                <span>启用压缩</span>
                                                            </label>
                                                            <label style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>通道:</span>
                                                                <select v-model="imageCompression.channel" @change="reprocessCustomImage" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option value="rgb">🎨 RGB彩色</option>
                                                                    <option value="grayscale">⚪ 灰度</option>
                                                                    <option value="binary">⚫ 边缘+二值化</option>
                                                                    <option value="vector">📐 矢量化(LoG)</option>
                                                                </select>
                                                            </label>
                                                            <label v-if="imageCompression.channel === 'binary' || imageCompression.channel === 'vector'" style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>算子:</span>
                                                                <select v-model="imageCompression.edgeOperator" @change="reprocessCustomImage" :disabled="imageCompression.channel === 'vector'" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option value="sobel">Sobel (经典)</option>
                                                                    <option value="prewitt">Prewitt (简单)</option>
                                                                    <option value="scharr">Scharr (精确)</option>
                                                                    <option value="roberts">Roberts (快速)</option>
                                                                    <option value="laplacian">Laplacian (二阶)</option>
                                                                    <option value="log">LoG (高斯+拉普拉斯)</option>
                                                                    <option value="kirsch">Kirsch (8方向)</option>
                                                                    <option value="canny">Canny (最优)</option>
                                                                </select>
                                                            </label>
                                                            <label v-if="imageCompression.channel === 'binary'" style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>编码:</span>
                                                                <select v-model="imageCompression.binaryEncoding" @change="reprocessCustomImage" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option value="rle">📊 行程编码(RLE)</option>
                                                                    <option value="freeman">📍 像素坐标</option>
                                                                    <option value="raw">📦 原始位图</option>
                                                                </select>
                                                            </label>
                                                            <label v-if="imageCompression.channel === 'vector'" style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>简化:</span>
                                                                <select v-model.number="imageCompression.vectorSimplify" @change="reprocessCustomImage" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option :value="1">🔬 极高精度</option>
                                                                    <option :value="2">🎯 高精度</option>
                                                                    <option :value="3">⚖️ 平衡 (推荐)</option>
                                                                    <option :value="4">📦 高压缩</option>
                                                                    <option :value="5">💨 极限压缩</option>
                                                                </select>
                                                            </label>
                                                            <label v-if="imageCompression.channel === 'vector'" style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>算法:</span>
                                                                <select v-model="imageCompression.vectorMethod" @change="reprocessCustomImage" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option value="skeleton">🦴 骨架追踪</option>
                                                                    <option value="starvector">⭐ StarVector (AI)</option>
                                                                    <option value="vtracer">🔷 VTracer</option>
                                                                </select>
                                                            </label>
                                                            <label v-if="imageCompression.channel === 'vector'" style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>编码:</span>
                                                                <select v-model="imageCompression.vectorEncoding" @change="reprocessCustomImage" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option value="delta">📊 差分编码</option>
                                                                    <option value="contour">🔗 轮廓链编码</option>
                                                                </select>
                                                            </label>
                                                            <label style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>格式:</span>
                                                                <select v-model="imageCompression.format" @change="reprocessCustomImage" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">
                                                                    <option value="jpeg">JPEG</option>
                                                                    <option value="webp">WebP</option>
                                                                    <option value="avif">AVIF</option>
                                                                </select>
                                                            </label>
                                                        </div>
                                                        <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                                                            <label style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>画质:</span>
                                                                <input type="range" v-model.number="imageCompression.quality" @input="reprocessCustomImage" min="10" max="100" step="5" style="width: 100px; cursor: pointer;">
                                                                <span style="min-width: 40px; font-weight: bold; color: #9C27B0;">{{ imageCompression.quality }}%</span>
                                                            </label>
                                                            <label style="display: inline-flex; align-items: center; gap: 5px;">
                                                                <span>最大宽高:</span>
                                                                <input type="number" v-model.number="imageCompression.maxDimension" @change="reprocessCustomImage" min="50" max="1920" step="10" style="width: 70px; padding: 3px 5px; border: 1px solid #ccc; border-radius: 3px;">
                                                                <span>px</span>
                                                            </label>
                                                        </div>
                                                    </div>
                                                    
                                                    <div v-if="customImagePreview" style="margin-top: 10px;">
                                                        <img :src="customImagePreview" style="max-width: 100%; max-height: 100px; border: 1px solid #ddd; border-radius: 4px;">
                                                        <div style="font-size: 12px; color: #666; margin-top: 5px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                                            <span v-if="imageCompression.channel === 'vector'" style="color: #2196F3; font-weight: bold;">
                                                                📐 矢量模式: {{ vectorLines.length }} 条线段
                                                            </span>
                                                            <span>大小: {{ customImageSize }} 字节 (限制 120B/包)</span>
                                                            <span style="color: #9C27B0; font-weight: bold;">
                                                                📦 总包数: {{ imageTotalBlocks }}
                                                            </span>
                                                            <span v-if="imageSendProgress.sending" style="color: #4CAF50; font-weight: bold;">
                                                                ✅ 已发: {{ imageSendProgress.current }}
                                                            </span>
                                                            <span style="font-weight: bold;" :style="{color: imageSendProgress.sending ? '#FF5722' : '#607D8B'}">
                                                                ⏳ 剩余: {{ imageSendProgress.sending ? imageSendProgress.remaining : imageTotalBlocks }}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    
                                                    <!-- 发送进度显示 -->
                                                    <div v-if="imageSendProgress.sending" style="margin-top: 10px;">
                                                        <div style="background: #e0e0e0; border-radius: 10px; overflow: hidden; height: 22px; position: relative;">
                                                            <div :style="{background: 'linear-gradient(90deg, #9C27B0, #BA68C8)', height: '100%', width: imageSendProgress.percent + '%', transition: 'width 0.3s'}"></div>
                                                            <div style="position: absolute; top: 0; left: 0; right: 0; text-align: center; line-height: 22px; color: #333; font-weight: bold; font-size: 12px;">
                                                                {{ imageSendProgress.current }} / {{ imageSendProgress.total }} (剩余 {{ imageSendProgress.remaining }})
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <button class="send-message-btn" @click="sendCustomData(1)" style="width: 100%; margin-top: 10px; background: #9C27B0;">📤 发送图片数据</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 普通消息 UI -->
                                <div v-else class="field-list">
                                    <div v-for="(field, fieldName) in msg.metadata.fields" :key="fieldName" class="field-item">
                                        <div class="field-left">
                                            <span class="field-name">{{ fieldName }}</span>
                                            <span class="field-type">({{ field.repeated ? 'repeated ' : '' }}{{ field.type }})</span>
                                            <div class="field-comment">{{ field.description || field.comment || '无说明' }}</div>
                                        </div>
                                        <div class="field-right" v-html="generateFieldInput(msg.name, fieldName, field)"></div>
                                    </div>
                                </div>
                                
                                <div v-if="msg.name !== 'CustomByteBlock'" class="op-area" style="display: flex; gap: 10px; align-items: center; margin-top: 10px;">
                                    <button class="send-message-btn" @click.stop="sendDownlinkMessage(msg.name)">📤 发送此消息</button>
                                    <label class="form-label" :for="'autoFreq-' + msg.name">频率(Hz)</label>
                                    <input type="number" class="form-input" :id="'autoFreq-' + msg.name" 
                                           :value="messagesData.messageDefaultFrequencies?.[msg.name] || 1"
                                           min="0.1" step="0.1" style="width: 100px;" @click.stop>
                                    <label style="display: flex; gap: 6px; align-items: center; font-size: 12px; color: #333;" @click.stop>
                                        <input type="checkbox" :id="'autoEnable-' + msg.name" @click.stop="toggleAutoPublish(msg.name)">
                                        自动发送
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- 历史记录 -->
            <div class="panel" style="margin-top: 30px;">
                <div class="panel-header">
                    📜 通信历史
                    <button class="btn btn-secondary" @click="refreshHistory" style="margin-left: auto;">刷新</button>
                </div>
                <div class="panel-body" id="historyPanel">
                    <p v-if="history.length === 0" style="color: #999; text-align: center; padding: 20px;">暂无历史记录</p>
                    <div v-for="(item, index) in history" :key="index" class="history-item">
                        <div class="history-header">
                            <div>
                                <span class="history-type">{{ item.messageType }}</span>
                                <span style="color: #999; font-size: 12px;">客户端: {{ item.clientId }}</span>
                            </div>
                            <span class="history-time">{{ new Date(item.timestamp).toLocaleString('zh-CN') }}</span>
                        </div>
                        <div v-if="item.parsedData && Object.keys(item.parsedData).length > 0" style="margin-top: 8px;">
                            <div v-for="(fieldInfo, fieldName) in item.parsedData" :key="fieldName" class="field-display">
                                <span class="field-display-name">{{ fieldName }}:</span>
                                <span class="field-display-value">{{ fieldInfo.display }}</span>
                                <div v-if="fieldInfo.description" class="field-display-desc">💡 {{ fieldInfo.description }}</div>
                            </div>
                        </div>
                        <div v-else class="history-data">{{ JSON.stringify(item.data, null, 2) }}</div>
                    </div>
                </div>
            </div>
        </div>

        <div v-if="currentTab === 'custom-config'">
            <custom-data-config></custom-data-config>
        </div>
        
        <footer style="text-align: center; padding: 20px 0 30px 0; color: #999; font-size: 12px;">
            江南大学霞客湾校区 MeroT 制作
        </footer>
    </div>
    
    <script type="module">
        import NavBar from '/js/components/NavBar.js';
        import CustomDataConfig from '/js/components/CustomDataConfig.js';

        const { createApp, ref, reactive, computed, onMounted } = Vue;

        const app = createApp({
            components: {
                NavBar,
                CustomDataConfig
            },
            setup() {
                const currentTab = ref('console');
                const messagesData = ref(null);
                const activeMessage = ref(null);
                const receivedValues = reactive({});
                const history = ref([]);
                const autoPublishActive = ref(false);
                
                // Custom Data Config State
                const customConfigList = ref([]);
                const currentCustomConfigName = ref('');
                const currentCustomConfig = ref(null);
                const pureDataValues = reactive({});
                const companionDataValues = reactive({});
                const customImageFile = ref(null);
                const customImagePreview = ref(null);
                const customImageSize = ref(0);
                const customImageData = ref(null); // Base64 or Buffer
                
                // 矢量化数据
                const vectorLines = ref([]);
                const vectorDimensions = ref({width: 0, height: 0});
                
                // 图片压缩配置
                const imageCompression = reactive({
                    enabled: true,
                    format: 'jpeg',
                    quality: 80,
                    maxDimension: 320,
                    channel: 'rgb', // rgb, grayscale, binary, vector
                    edgeOperator: 'log', // sobel, prewitt, scharr, roberts, laplacian, log, kirsch, canny
                    vectorSimplify: 3, // 矢量简化级别: 1=极高精度, 2=高精度, 3=平衡, 4=高压缩, 5=极限压缩
                    vectorMethod: 'skeleton', // skeleton, starvector, vtracer
                    vectorEncoding: 'delta', // delta=差分编码, contour=轮廓特征编码(差分+RLE)
                    binaryEncoding: 'rle' // rle=行程编码, freeman=像素坐标, raw=原始位图
                });
                
                // 图片发送进度
                const imageSendProgress = reactive({
                    sending: false,
                    current: 0,
                    total: 0,
                    remaining: 0,
                    percent: 0
                });
                
                // 计算总包数
                const imageTotalBlocks = computed(() => {
                    if (!customImageSize.value) return 0;
                    return Math.ceil(customImageSize.value / 120);
                });

                // Computed for Custom Data
                const pureDataFields = computed(() => {
                    if (!currentCustomConfig.value) return [];
                    // 过滤掉 ImageBlock 类型的字段（兼容大小写）
                    return currentCustomConfig.value.items.filter(i => 
                        i.type !== 'image_block' && i.type !== 'ImageBlock'
                    );
                });

                const hasImageBlock = computed(() => {
                    // 兼容大小写
                    return currentCustomConfig.value?.items.some(i => 
                        i.type === 'image_block' || i.type === 'ImageBlock'
                    );
                });

                const companionFields = computed(() => {
                    if (!currentCustomConfig.value || !hasImageBlock.value) return [];
                    const companionNames = currentCustomConfig.value.imageCompanionFields || [];
                    return currentCustomConfig.value.items.filter(i => companionNames.includes(i.name));
                });

                // Methods for Custom Data
                const loadCustomConfigList = async () => {
                    try {
                        const response = await fetch('/api/list-configs');
                        const result = await response.json();
                        if (result.success) {
                            customConfigList.value = result.configs;
                        }
                    } catch (error) {
                        console.error('加载配置列表失败:', error);
                    }
                };

                const loadCustomConfigDetails = async () => {
                    if (!currentCustomConfigName.value) {
                        currentCustomConfig.value = null;
                        return;
                    }
                    try {
                        const response = await fetch('/api/load-config?name=' + encodeURIComponent(currentCustomConfigName.value));
                        const result = await response.json();
                        if (result.success) {
                            currentCustomConfig.value = result.config;
                            // Reset values
                            Object.keys(pureDataValues).forEach(k => delete pureDataValues[k]);
                            Object.keys(companionDataValues).forEach(k => delete companionDataValues[k]);
                            customImageFile.value = null;
                            customImagePreview.value = null;
                            customImageSize.value = 0;
                            customImageData.value = null;
                        }
                    } catch (error) {
                        console.error('加载配置详情失败:', error);
                    }
                };

                // 处理图片压缩 - 优先使用服务器端 sharp 库
                const processImage = async (file, callback) => {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        if (!imageCompression.enabled) {
                            // 不压缩,直接使用原图
                            const base64 = e.target.result.split(',')[1];
                            const byteString = atob(base64);
                            customImageSize.value = byteString.length;
                            customImagePreview.value = e.target.result;
                            customImageData.value = base64;
                            if (callback) callback();
                            return;
                        }
                        
                        const base64Data = e.target.result.split(',')[1];
                        
                        // 尝试使用服务器端压缩 (支持真正的 AVIF 和高级图像处理)
                        try {
                            const response = await fetch('/api/compress-image', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    imageData: base64Data,
                                    format: imageCompression.format,
                                    quality: imageCompression.quality,
                                    maxWidth: imageCompression.maxDimension,
                                    maxHeight: imageCompression.maxDimension,
                                    channel: imageCompression.channel,
                                    edgeOperator: imageCompression.edgeOperator,
                                    vectorSimplify: imageCompression.vectorSimplify,
                                    vectorMethod: imageCompression.vectorMethod,
                                    vectorEncoding: imageCompression.vectorEncoding,
                                    binaryEncoding: imageCompression.binaryEncoding
                                })
                            });
                            
                            const result = await response.json();
                            
                            if (result.success) {
                                customImageSize.value = result.size;
                                customImagePreview.value = result.dataUrl;
                                customImageData.value = result.data;
                                
                                // 如果是矢量模式，保存矢量信息
                                if (result.vectorInfo && result.vectorInfo.isVector) {
                                    vectorLines.value = [];
                                    vectorDimensions.value = {width: result.width, height: result.height};
                                    // 解码矢量数据并保存到window以便发送时使用
                                    const vectorBuffer = atob(result.data);
                                    const bytes = new Uint8Array(vectorBuffer.length);
                                    for (let i = 0; i < vectorBuffer.length; i++) {
                                        bytes[i] = vectorBuffer.charCodeAt(i);
                                    }
                                    const w = (bytes[0] << 8) | bytes[1];
                                    const h = (bytes[2] << 8) | bytes[3];
                                    const lineCount = (bytes[4] << 8) | bytes[5];
                                    const lines = [];
                                    for (let i = 0; i < lineCount; i++) {
                                        const offset = 6 + i * 8;
                                        lines.push({
                                            x1: (bytes[offset] << 8) | bytes[offset + 1],
                                            y1: (bytes[offset + 2] << 8) | bytes[offset + 3],
                                            x2: (bytes[offset + 4] << 8) | bytes[offset + 5],
                                            y2: (bytes[offset + 6] << 8) | bytes[offset + 7]
                                        });
                                    }
                                    vectorLines.value = lines;
                                    window.vectorLines = lines;
                                    window.vectorDimensions = {width: w, height: h};
                                }
                                
                                console.log('✅ 服务器端压缩成功:', result.format, result.width + 'x' + result.height, result.size + ' bytes');
                                if (callback) callback();
                                return;
                            }
                            
                            // 如果服务器端失败但提示 fallback，使用浏览器端
                            if (result.fallback) {
                                console.warn('服务器端 sharp 未安装，使用浏览器端压缩');
                            }
                        } catch (err) {
                            console.warn('服务器端压缩失败，回退到浏览器端:', err.message);
                        }
                        
                        // 浏览器端压缩 (不支持真正的 AVIF)
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            let width = img.width;
                            let height = img.height;
                            const maxDim = imageCompression.maxDimension;
                            
                            // 缩放
                            if (width > maxDim || height > maxDim) {
                                if (width > height) {
                                    height = Math.round(height * maxDim / width);
                                    width = maxDim;
                                } else {
                                    width = Math.round(width * maxDim / height);
                                    height = maxDim;
                                }
                            }
                            
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, width, height);
                            
                            // 通道处理
                            if (imageCompression.channel === 'grayscale') {
                                const imageData = ctx.getImageData(0, 0, width, height);
                                const data = imageData.data;
                                for (let i = 0; i < data.length; i += 4) {
                                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                                    data[i] = data[i + 1] = data[i + 2] = gray;
                                }
                                ctx.putImageData(imageData, 0, 0);
                            } else if (imageCompression.channel === 'vector') {
                                // ========== 矢量化流程 ==========
                                // 策略: 复用binary模式的边缘检测逻辑，生成完全相同的预览图
                                // 同时提取边缘像素的RLE编码用于传输
                                
                                const imageData = ctx.getImageData(0, 0, width, height);
                                const data = imageData.data;
                                const tempData = new Uint8ClampedArray(data);
                                
                                // 1. 灰度化
                                for (let i = 0; i < data.length; i += 4) {
                                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                                    tempData[i] = tempData[i + 1] = tempData[i + 2] = gray;
                                }
                                
                                // 2. 边缘检测 - 使用与binary模式相同的LoG算子
                                const edgeData = new Uint8ClampedArray(data.length);
                                for (let i = 0; i < edgeData.length; i++) edgeData[i] = 0;
                                const operator = imageCompression.edgeOperator || 'log';
                                
                                console.log('[Vector] 使用边缘检测算子:', operator);
                                
                                if (operator === 'log') {
                                    // LoG (Laplacian of Gaussian) - 先高斯模糊再拉普拉斯
                                    const blurred = new Float32Array(width * height);
                                    const gaussian = [1,4,7,4,1, 4,16,26,16,4, 7,26,41,26,7, 4,16,26,16,4, 1,4,7,4,1];
                                    const gSum = 273;
                                    
                                    for (let y = 2; y < height - 2; y++) {
                                        for (let x = 2; x < width - 2; x++) {
                                            let sum = 0;
                                            for (let ky = -2; ky <= 2; ky++) {
                                                for (let kx = -2; kx <= 2; kx++) {
                                                    sum += tempData[((y + ky) * width + (x + kx)) * 4] * gaussian[(ky + 2) * 5 + (kx + 2)];
                                                }
                                            }
                                            blurred[y * width + x] = sum / gSum;
                                        }
                                    }
                                    
                                    const logKernel = [0,0,-1,0,0, 0,-1,-2,-1,0, -1,-2,16,-2,-1, 0,-1,-2,-1,0, 0,0,-1,0,0];
                                    for (let y = 2; y < height - 2; y++) {
                                        for (let x = 2; x < width - 2; x++) {
                                            let sum = 0;
                                            for (let ky = -2; ky <= 2; ky++) {
                                                for (let kx = -2; kx <= 2; kx++) {
                                                    sum += blurred[(y + ky) * width + (x + kx)] * logKernel[(ky + 2) * 5 + (kx + 2)];
                                                }
                                            }
                                            const idx = (y * width + x) * 4;
                                            const mag = Math.min(255, Math.abs(sum));
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = mag;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else {
                                    // 其他算子使用Sobel
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p00 = tempData[((y-1)*width + x-1)*4];
                                            const p01 = tempData[((y-1)*width + x)*4];
                                            const p02 = tempData[((y-1)*width + x+1)*4];
                                            const p10 = tempData[(y*width + x-1)*4];
                                            const p12 = tempData[(y*width + x+1)*4];
                                            const p20 = tempData[((y+1)*width + x-1)*4];
                                            const p21 = tempData[((y+1)*width + x)*4];
                                            const p22 = tempData[((y+1)*width + x+1)*4];
                                            
                                            const gx = -p00 + p02 - 2*p10 + 2*p12 - p20 + p22;
                                            const gy = -p00 - 2*p01 - p02 + p20 + 2*p21 + p22;
                                            const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy));
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                }
                                
                                // 3. Otsu二值化
                                let histogram = new Array(256).fill(0);
                                for (let i = 0; i < edgeData.length; i += 4) {
                                    histogram[edgeData[i]]++;
                                }
                                
                                let total = width * height;
                                let sum = 0;
                                for (let i = 0; i < 256; i++) sum += i * histogram[i];
                                
                                let sumB = 0, wB = 0, maximum = 0, threshold = 0;
                                for (let t = 0; t < 256; t++) {
                                    wB += histogram[t];
                                    if (wB === 0) continue;
                                    const wF = total - wB;
                                    if (wF === 0) break;
                                    sumB += t * histogram[t];
                                    const mB = sumB / wB;
                                    const mF = (sum - sumB) / wF;
                                    const between = wB * wF * (mB - mF) * (mB - mF);
                                    if (between > maximum) { maximum = between; threshold = t; }
                                }
                                
                                // 4. 应用二值化并绘制到canvas（用于预览）
                                // 同时收集边缘像素的RLE数据（用于传输）
                                const binaryPixels = new Uint8Array(width * height);
                                for (let i = 0; i < data.length; i += 4) {
                                    const isEdge = edgeData[i] > threshold;
                                    const value = isEdge ? 255 : 0;
                                    data[i] = data[i + 1] = data[i + 2] = value;
                                    binaryPixels[i / 4] = isEdge ? 1 : 0;
                                }
                                ctx.putImageData(imageData, 0, 0);
                                
                                // 5. 提取水平run-length数据用于传输
                                const runs = [];
                                for (let y = 0; y < height; y++) {
                                    let x = 0;
                                    while (x < width) {
                                        const idx = y * width + x;
                                        if (binaryPixels[idx]) {
                                            const startX = x;
                                            while (x < width && binaryPixels[y * width + x]) x++;
                                            runs.push({y: y, x: startX, len: x - startX});
                                        } else {
                                            x++;
                                        }
                                    }
                                }
                                
                                // 转换为线段格式
                                const lines = runs.map(r => ({
                                    x1: r.x, y1: r.y,
                                    x2: r.x + r.len - 1, y2: r.y
                                }));
                                
                                vectorLines.value = lines;
                                vectorDimensions.value = {width: width, height: height};
                                
                                // 6. 导出canvas为PNG用于预览（与binary模式完全相同的视觉效果）
                                const previewUrl = canvas.toDataURL('image/png');
                                customImagePreview.value = previewUrl;
                                
                                // 计算传输数据大小
                                const vectorDataSize = 6 + lines.length * 8; // header + lines
                                customImageSize.value = vectorDataSize;
                                customImageData.value = null;
                                
                                console.log('[Vector] 边缘像素runs:', runs.length, '线段:', lines.length, '传输大小:', vectorDataSize, 'B');
                                
                                if (callback) callback();
                                return;
                                
                            } else if (imageCompression.channel === 'binary') {
                                // 边缘检测 + 二值化
                                const imageData = ctx.getImageData(0, 0, width, height);
                                const data = imageData.data;
                                const tempData = new Uint8ClampedArray(data);
                                
                                // 1. 先转灰度
                                for (let i = 0; i < data.length; i += 4) {
                                    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                                    tempData[i] = tempData[i + 1] = tempData[i + 2] = gray;
                                }
                                
                                // 2. 边缘检测（根据算子选择）
                                const edgeData = new Uint8ClampedArray(data.length);
                                for (let i = 0; i < edgeData.length; i++) edgeData[i] = 0;
                                const operator = imageCompression.edgeOperator || 'sobel';
                                
                                console.log('🔍 使用边缘检测算子:', operator);
                                
                                if (operator === 'sobel') {
                                    // Sobel 算子: Gx=[-1,0,1; -2,0,2; -1,0,1], Gy=[-1,-2,-1; 0,0,0; 1,2,1]
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            // 获取3x3邻域
                                            const p00 = tempData[((y-1)*width + x-1)*4];
                                            const p01 = tempData[((y-1)*width + x)*4];
                                            const p02 = tempData[((y-1)*width + x+1)*4];
                                            const p10 = tempData[(y*width + x-1)*4];
                                            const p12 = tempData[(y*width + x+1)*4];
                                            const p20 = tempData[((y+1)*width + x-1)*4];
                                            const p21 = tempData[((y+1)*width + x)*4];
                                            const p22 = tempData[((y+1)*width + x+1)*4];
                                            
                                            const gx = -p00 + p02 - 2*p10 + 2*p12 - p20 + p22;
                                            const gy = -p00 - 2*p01 - p02 + p20 + 2*p21 + p22;
                                            const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy));
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'prewitt') {
                                    // Prewitt 算子: Gx=[-1,0,1; -1,0,1; -1,0,1], Gy=[-1,-1,-1; 0,0,0; 1,1,1]
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p00 = tempData[((y-1)*width + x-1)*4];
                                            const p01 = tempData[((y-1)*width + x)*4];
                                            const p02 = tempData[((y-1)*width + x+1)*4];
                                            const p10 = tempData[(y*width + x-1)*4];
                                            const p12 = tempData[(y*width + x+1)*4];
                                            const p20 = tempData[((y+1)*width + x-1)*4];
                                            const p21 = tempData[((y+1)*width + x)*4];
                                            const p22 = tempData[((y+1)*width + x+1)*4];
                                            
                                            const gx = -p00 + p02 - p10 + p12 - p20 + p22;
                                            const gy = -p00 - p01 - p02 + p20 + p21 + p22;
                                            const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy));
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'scharr') {
                                    // Scharr 算子: Gx=[-3,0,3; -10,0,10; -3,0,3], Gy=[-3,-10,-3; 0,0,0; 3,10,3]
                                    // 比Sobel更精确的旋转不变性
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p00 = tempData[((y-1)*width + x-1)*4];
                                            const p01 = tempData[((y-1)*width + x)*4];
                                            const p02 = tempData[((y-1)*width + x+1)*4];
                                            const p10 = tempData[(y*width + x-1)*4];
                                            const p12 = tempData[(y*width + x+1)*4];
                                            const p20 = tempData[((y+1)*width + x-1)*4];
                                            const p21 = tempData[((y+1)*width + x)*4];
                                            const p22 = tempData[((y+1)*width + x+1)*4];
                                            
                                            const gx = -3*p00 + 3*p02 - 10*p10 + 10*p12 - 3*p20 + 3*p22;
                                            const gy = -3*p00 - 10*p01 - 3*p02 + 3*p20 + 10*p21 + 3*p22;
                                            const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy) / 4);
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'roberts') {
                                    // Roberts 算子: 2x2交叉梯度，计算最快
                                    for (let y = 0; y < height - 1; y++) {
                                        for (let x = 0; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p00 = tempData[idx];
                                            const p01 = tempData[(y*width + x+1)*4];
                                            const p10 = tempData[((y+1)*width + x)*4];
                                            const p11 = tempData[((y+1)*width + x+1)*4];
                                            
                                            const gx = p00 - p11;
                                            const gy = p01 - p10;
                                            const magnitude = Math.min(255, Math.sqrt(gx * gx + gy * gy));
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'laplacian') {
                                    // Laplacian 算子: 二阶导数 [0,1,0; 1,-4,1; 0,1,0] 或 [-1,-1,-1; -1,8,-1; -1,-1,-1]
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p00 = tempData[((y-1)*width + x-1)*4];
                                            const p01 = tempData[((y-1)*width + x)*4];
                                            const p02 = tempData[((y-1)*width + x+1)*4];
                                            const p10 = tempData[(y*width + x-1)*4];
                                            const p11 = tempData[idx];
                                            const p12 = tempData[(y*width + x+1)*4];
                                            const p20 = tempData[((y+1)*width + x-1)*4];
                                            const p21 = tempData[((y+1)*width + x)*4];
                                            const p22 = tempData[((y+1)*width + x+1)*4];
                                            
                                            const laplacian = -p00 - p01 - p02 - p10 + 8*p11 - p12 - p20 - p21 - p22;
                                            const magnitude = Math.min(255, Math.abs(laplacian));
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'log') {
                                    // LoG (Laplacian of Gaussian) - 先高斯平滑再拉普拉斯
                                    // 简化版：使用5x5高斯核近似
                                    const gaussian = new Uint8ClampedArray(data.length);
                                    
                                    // 高斯平滑 (简化3x3)
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const sum = 
                                                tempData[((y-1)*width + x-1)*4] + 2*tempData[((y-1)*width + x)*4] + tempData[((y-1)*width + x+1)*4] +
                                                2*tempData[(y*width + x-1)*4] + 4*tempData[idx] + 2*tempData[(y*width + x+1)*4] +
                                                tempData[((y+1)*width + x-1)*4] + 2*tempData[((y+1)*width + x)*4] + tempData[((y+1)*width + x+1)*4];
                                            gaussian[idx] = sum / 16;
                                        }
                                    }
                                    
                                    // 拉普拉斯
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p01 = gaussian[((y-1)*width + x)*4];
                                            const p10 = gaussian[(y*width + x-1)*4];
                                            const p11 = gaussian[idx];
                                            const p12 = gaussian[(y*width + x+1)*4];
                                            const p21 = gaussian[((y+1)*width + x)*4];
                                            
                                            const laplacian = p01 + p10 - 4*p11 + p12 + p21;
                                            const magnitude = Math.min(255, Math.abs(laplacian) * 2);
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'kirsch') {
                                    // Kirsch 算子: 8个方向的边缘检测，取最大值
                                    const kernels = [
                                        [5, 5, 5, -3, 0, -3, -3, -3, -3],  // N
                                        [5, 5, -3, 5, 0, -3, -3, -3, -3],  // NE
                                        [5, -3, -3, 5, 0, -3, 5, -3, -3],  // E
                                        [-3, -3, -3, 5, 0, -3, 5, 5, -3],  // SE
                                        [-3, -3, -3, -3, 0, -3, 5, 5, 5],  // S
                                        [-3, -3, -3, -3, 0, 5, -3, 5, 5],  // SW
                                        [-3, -3, 5, -3, 0, 5, -3, -3, 5],  // W
                                        [-3, 5, 5, -3, 0, 5, -3, -3, -3]   // NW
                                    ];
                                    
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = (y * width + x) * 4;
                                            const p = [
                                                tempData[((y-1)*width + x-1)*4], tempData[((y-1)*width + x)*4], tempData[((y-1)*width + x+1)*4],
                                                tempData[(y*width + x-1)*4], tempData[idx], tempData[(y*width + x+1)*4],
                                                tempData[((y+1)*width + x-1)*4], tempData[((y+1)*width + x)*4], tempData[((y+1)*width + x+1)*4]
                                            ];
                                            
                                            let maxMag = 0;
                                            for (let k = 0; k < 8; k++) {
                                                let sum = 0;
                                                for (let i = 0; i < 9; i++) {
                                                    sum += kernels[k][i] * p[i];
                                                }
                                                maxMag = Math.max(maxMag, Math.abs(sum));
                                            }
                                            
                                            const magnitude = Math.min(255, maxMag / 5);
                                            edgeData[idx] = edgeData[idx+1] = edgeData[idx+2] = magnitude;
                                            edgeData[idx+3] = 255;
                                        }
                                    }
                                } else if (operator === 'canny') {
                                    // Canny 边缘检测: 5x5高斯平滑 + Sobel梯度 + 非极大值抑制 + 双阈值 + 边缘连接
                                    const gradX = new Float32Array(width * height);
                                    const gradY = new Float32Array(width * height);
                                    const magnitude = new Float32Array(width * height);
                                    const smoothed = new Uint8ClampedArray(width * height);
                                    
                                    // 1. 5x5 高斯平滑 (σ≈1.4)
                                    const gaussian = [2, 4, 5, 4, 2, 4, 9, 12, 9, 4, 5, 12, 15, 12, 5, 4, 9, 12, 9, 4, 2, 4, 5, 4, 2];
                                    const gaussianSum = 159;
                                    
                                    for (let y = 2; y < height - 2; y++) {
                                        for (let x = 2; x < width - 2; x++) {
                                            let sum = 0;
                                            for (let ky = -2; ky <= 2; ky++) {
                                                for (let kx = -2; kx <= 2; kx++) {
                                                    const pixelIdx = ((y + ky) * width + (x + kx)) * 4;
                                                    const kernelIdx = (ky + 2) * 5 + (kx + 2);
                                                    sum += tempData[pixelIdx] * gaussian[kernelIdx];
                                                }
                                            }
                                            smoothed[y * width + x] = sum / gaussianSum;
                                        }
                                    }
                                    
                                    // 2. 计算Sobel梯度和方向
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = y * width + x;
                                            const p00 = smoothed[(y-1)*width + x-1];
                                            const p01 = smoothed[(y-1)*width + x];
                                            const p02 = smoothed[(y-1)*width + x+1];
                                            const p10 = smoothed[y*width + x-1];
                                            const p12 = smoothed[y*width + x+1];
                                            const p20 = smoothed[(y+1)*width + x-1];
                                            const p21 = smoothed[(y+1)*width + x];
                                            const p22 = smoothed[(y+1)*width + x+1];
                                            
                                            gradX[idx] = -p00 + p02 - 2*p10 + 2*p12 - p20 + p22;
                                            gradY[idx] = -p00 - 2*p01 - p02 + p20 + 2*p21 + p22;
                                            magnitude[idx] = Math.sqrt(gradX[idx]**2 + gradY[idx]**2);
                                        }
                                    }
                                    
                                    // 3. 非极大值抑制
                                    const nms = new Float32Array(width * height);
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = y * width + x;
                                            const angle = Math.atan2(gradY[idx], gradX[idx]) * 180 / Math.PI;
                                            let normalizedAngle = ((angle + 180) % 180);
                                            
                                            let neighbor1 = 0, neighbor2 = 0;
                                            if (normalizedAngle < 22.5 || normalizedAngle >= 157.5) {
                                                neighbor1 = magnitude[idx - 1];
                                                neighbor2 = magnitude[idx + 1];
                                            } else if (normalizedAngle < 67.5) {
                                                neighbor1 = magnitude[idx - width + 1];
                                                neighbor2 = magnitude[idx + width - 1];
                                            } else if (normalizedAngle < 112.5) {
                                                neighbor1 = magnitude[idx - width];
                                                neighbor2 = magnitude[idx + width];
                                            } else {
                                                neighbor1 = magnitude[idx - width - 1];
                                                neighbor2 = magnitude[idx + width + 1];
                                            }
                                            
                                            const mag = magnitude[idx];
                                            nms[idx] = (mag >= neighbor1 && mag >= neighbor2) ? mag : 0;
                                        }
                                    }
                                    
                                    // 4. 双阈值和边缘连接
                                    let maxMag = 0;
                                    for (let i = 0; i < nms.length; i++) {
                                        if (nms[i] > maxMag) maxMag = nms[i];
                                    }
                                    const highThreshold = maxMag * 0.15; // 高阈值 15%
                                    const lowThreshold = highThreshold * 0.4; // 低阈值 6%
                                    
                                    const edges = new Uint8Array(width * height);
                                    const STRONG = 255;
                                    const WEAK = 128;
                                    
                                    // 标记强边缘和弱边缘
                                    for (let i = 0; i < nms.length; i++) {
                                        if (nms[i] >= highThreshold) {
                                            edges[i] = STRONG;
                                        } else if (nms[i] >= lowThreshold) {
                                            edges[i] = WEAK;
                                        }
                                    }
                                    
                                    // 边缘连接：保留与强边缘连接的弱边缘
                                    for (let y = 1; y < height - 1; y++) {
                                        for (let x = 1; x < width - 1; x++) {
                                            const idx = y * width + x;
                                            if (edges[idx] === WEAK) {
                                                let hasStrong = false;
                                                for (let ky = -1; ky <= 1; ky++) {
                                                    for (let kx = -1; kx <= 1; kx++) {
                                                        if (edges[(y+ky)*width + (x+kx)] === STRONG) {
                                                            hasStrong = true;
                                                            break;
                                                        }
                                                    }
                                                    if (hasStrong) break;
                                                }
                                                edges[idx] = hasStrong ? STRONG : 0;
                                            }
                                        }
                                    }
                                    
                                    // 写入结果
                                    for (let y = 0; y < height; y++) {
                                        for (let x = 0; x < width; x++) {
                                            const idx = y * width + x;
                                            const pixelIdx = idx * 4;
                                            const value = edges[idx] === STRONG ? 255 : 0;
                                            edgeData[pixelIdx] = edgeData[pixelIdx+1] = edgeData[pixelIdx+2] = value;
                                            edgeData[pixelIdx+3] = 255;
                                        }
                                    }
                                }
                                
                                // 3. 二值化 (Otsu 阈值)
                                let histogram = new Array(256).fill(0);
                                for (let i = 0; i < edgeData.length; i += 4) {
                                    histogram[edgeData[i]]++;
                                }
                                
                                let total = width * height;
                                let sum = 0;
                                for (let i = 0; i < 256; i++) sum += i * histogram[i];
                                
                                let sumB = 0, wB = 0, maximum = 0, threshold = 0;
                                for (let t = 0; t < 256; t++) {
                                    wB += histogram[t];
                                    if (wB === 0) continue;
                                    const wF = total - wB;
                                    if (wF === 0) break;
                                    
                                    sumB += t * histogram[t];
                                    const mB = sumB / wB;
                                    const mF = (sum - sumB) / wF;
                                    const between = wB * wF * (mB - mF) * (mB - mF);
                                    
                                    if (between > maximum) {
                                        maximum = between;
                                        threshold = t;
                                    }
                                }
                                
                                // 应用阈值
                                for (let i = 0; i < data.length; i += 4) {
                                    const value = edgeData[i] > threshold ? 255 : 0;
                                    data[i] = data[i + 1] = data[i + 2] = value;
                                }
                                
                                ctx.putImageData(imageData, 0, 0);
                            }
                            
                            const quality = imageCompression.quality / 100;
                            
                            // 浏览器端：AVIF 不支持，直接用 WebP 或 JPEG
                            let mimeType = 'image/jpeg';
                            let actualFormat = 'jpeg';
                            
                            if (imageCompression.format === 'webp' || imageCompression.format === 'avif') {
                                // 尝试 WebP
                                const testUrl = canvas.toDataURL('image/webp', quality);
                                if (!testUrl.startsWith('data:image/png')) {
                                    mimeType = 'image/webp';
                                    actualFormat = 'webp';
                                }
                                if (imageCompression.format === 'avif') {
                                    console.warn('⚠️ 浏览器不支持 AVIF 编码，已使用', actualFormat);
                                }
                            }
                            
                            const dataUrl = canvas.toDataURL(mimeType, quality);
                            const base64 = dataUrl.split(',')[1];
                            const byteString = atob(base64);
                            
                            customImageSize.value = byteString.length;
                            customImagePreview.value = dataUrl;
                            customImageData.value = base64;
                            
                            console.log('浏览器端压缩完成:', actualFormat, width + 'x' + height, byteString.length + ' bytes');
                            if (callback) callback();
                        };
                        img.src = e.target.result;
                    };
                    reader.readAsDataURL(file);
                };

                const handleCustomImageUpload = (event) => {
                    const file = event.target.files[0];
                    if (!file) return;
                    
                    customImageFile.value = file;
                    processImage(file);
                };
                
                // 重新处理图片(当压缩选项改变时)
                const reprocessCustomImage = () => {
                    if (customImageFile.value) {
                        processImage(customImageFile.value);
                    }
                };

                const sendCustomData = async (mode) => {
                    console.log('sendCustomData called, mode:', mode);
                    console.log('currentCustomConfigName:', currentCustomConfigName.value);
                    
                    if (!currentCustomConfigName.value) {
                        alert('请先选择一个配置');
                        return;
                    }
                    
                    if (!currentCustomConfig.value || !currentCustomConfig.value.items) {
                        alert('配置数据无效,请重新加载配置');
                        return;
                    }

                    if (mode === 0) {
                        // Pure Data Mode - 单次发送
                        const payload = {
                            messageType: 'CustomByteBlock',
                            customConfigName: currentCustomConfigName.value,
                            data: {}
                        };
                        console.log('Pure data mode, values:', pureDataValues);
                        Object.assign(payload.data, pureDataValues);
                        
                        try {
                            const response = await fetch('/api/publish', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });
                            const result = await response.json();
                            if (result.success) {
                                console.log('发送成功', result);
                                alert(\`✅ 发送成功！\\n主题: \${result.topic}\\n大小: \${result.size} 字节\`);
                            } else {
                                alert('发送失败: ' + result.error);
                            }
                        } catch (error) {
                            alert('发送错误: ' + error.message);
                        }
                    } else {
                        // Image Mode - 自动分包发送
                        const imageField = currentCustomConfig.value.items.find(i => i.type === 'ImageBlock' || i.type === 'image_block');
                        if (!imageField) {
                            alert('配置中没有图片字段');
                            return;
                        }
                        
                        if (!customImageData.value && (!vectorLines.value.length || imageCompression.channel !== 'vector')) {
                            alert('请先上传图片');
                            return;
                        }
                        
                        // 检查是否为矢量化模式
                        let imageDataArray = [];
                        let isVectorMode = false;
                        
                        if (imageCompression.channel === 'vector' && vectorLines.value.length > 0) {
                            // 矢量数据编码: 格式为 [width(2B), height(2B), lineCount(2B), ...lines]
                            // 每条线: [x1(2B), y1(2B), x2(2B), y2(2B)]
                            const lines = vectorLines.value;
                            const dims = vectorDimensions.value;
                            
                            const buffer = [];
                            // 图像尺寸
                            buffer.push(dims.width >> 8, dims.width & 0xFF);
                            buffer.push(dims.height >> 8, dims.height & 0xFF);
                            // 线段数量
                            buffer.push(lines.length >> 8, lines.length & 0xFF);
                            
                            // 线段数据 - 使用差分编码
                            // 第一条线段使用绝对坐标(8B)，后续使用相对坐标压缩
                            if (lines.length > 0) {
                                // 第一条线段：绝对坐标
                                const first = lines[0];
                                buffer.push(first.x1 >> 8, first.x1 & 0xFF);
                                buffer.push(first.y1 >> 8, first.y1 & 0xFF);
                                buffer.push(first.x2 >> 8, first.x2 & 0xFF);
                                buffer.push(first.y2 >> 8, first.y2 & 0xFF);
                                
                                // 后续线段：差分编码
                                let prevX1 = first.x1, prevY1 = first.y1;
                                let prevX2 = first.x2, prevY2 = first.y2;
                                
                                for (let i = 1; i < lines.length; i++) {
                                    const line = lines[i];
                                    const dx1 = line.x1 - prevX1;
                                    const dy1 = line.y1 - prevY1;
                                    const dx2 = line.x2 - prevX2;
                                    const dy2 = line.y2 - prevY2;
                                    
                                    // 检查是否可以用1字节表示（-128到127）
                                    if (dx1 >= -128 && dx1 <= 127 && dy1 >= -128 && dy1 <= 127 &&
                                        dx2 >= -128 && dx2 <= 127 && dy2 >= -128 && dy2 <= 127) {
                                        // 使用1字节差分（有符号）
                                        buffer.push(dx1 & 0xFF);
                                        buffer.push(dy1 & 0xFF);
                                        buffer.push(dx2 & 0xFF);
                                        buffer.push(dy2 & 0xFF);
                                    } else {
                                        // 回退到2字节绝对坐标，使用特殊标记
                                        buffer.push(0xFF, 0xFF); // 标记：后续是绝对坐标
                                        buffer.push(line.x1 >> 8, line.x1 & 0xFF);
                                        buffer.push(line.y1 >> 8, line.y1 & 0xFF);
                                        buffer.push(line.x2 >> 8, line.x2 & 0xFF);
                                        buffer.push(line.y2 >> 8, line.y2 & 0xFF);
                                    }
                                    
                                    prevX1 = line.x1;
                                    prevY1 = line.y1;
                                    prevX2 = line.x2;
                                    prevY2 = line.y2;
                                }
                            }
                            
                            imageDataArray = buffer;
                            isVectorMode = true;
                            const compressionRatio = lines.length > 0 ? ((1 - buffer.length / (6 + lines.length * 8)) * 100).toFixed(1) : 0;
                            console.log('[Vector] Encoded: ' + lines.length + ' lines, size=' + buffer.length + ' bytes (saved ' + compressionRatio + '% vs raw)');
                        } else {
                            // 解码图片数据
                            try {
                                const binaryString = atob(customImageData.value);
                                imageDataArray = Array.from(binaryString, char => char.charCodeAt(0));
                            } catch (e) {
                                console.error('Failed to decode image data:', e);
                                alert('图片数据解码失败');
                                return;
                            }
                        }
                        
                        const totalBlocks = Math.ceil(imageDataArray.length / 120);
                        const imgId = Math.floor(Math.random() * 65535);
                        
                        // 初始化进度
                        imageSendProgress.sending = true;
                        imageSendProgress.current = 0;
                        imageSendProgress.total = totalBlocks;
                        imageSendProgress.remaining = totalBlocks;
                        imageSendProgress.percent = 0;
                        
                        console.log(\`开始分包发送图片: 总大小=\${imageDataArray.length}字节, 总包数=\${totalBlocks}\`);
                        
                        // 逐包发送
                        for (let blockIdx = 0; blockIdx < totalBlocks; blockIdx++) {
                            const offset = blockIdx * 120;
                            const blockData = imageDataArray.slice(offset, offset + 120);
                            const isLastBlock = (blockIdx === totalBlocks - 1);
                            
                            const payload = {
                                messageType: 'CustomByteBlock',
                                customConfigName: currentCustomConfigName.value,
                                data: {}
                            };
                            
                            // 添加伴随数据
                            Object.assign(payload.data, companionDataValues);
                            
                            // 添加图片块
                            const imageBlockData = {
                                cmd_type: isLastBlock ? 0x03 : 0x02, // 0x03=结束帧, 0x02=数据块
                                img_id: imgId,
                                block_idx: blockIdx,
                                total_block: totalBlocks,
                                data_len: blockData.length,
                                data: blockData
                            };
                            payload.data[imageField.name] = imageBlockData;
                            
                            // 打印包的 Protobuf 组成
                            console.log(\`%c========== 包 \${blockIdx + 1}/\${totalBlocks} ==========\`, 'color: #9C27B0; font-weight: bold; font-size: 14px;');
                            console.log(\`%cImageBlock 结构:\`, 'color: #2196F3; font-weight: bold;');
                            console.log(\`  cmd_type: 0x\${imageBlockData.cmd_type.toString(16).padStart(2, '0')} (\${isLastBlock ? '结束帧' : '数据块'})\`);
                            console.log(\`  img_id: \${imageBlockData.img_id} (0x\${imageBlockData.img_id.toString(16).padStart(4, '0')})\`);
                            console.log(\`  block_idx: \${imageBlockData.block_idx}\`);
                            console.log(\`  total_block: \${imageBlockData.total_block}\`);
                            console.log(\`  data_len: \${imageBlockData.data_len} 字节\`);
                            console.log(\`  data: [\${blockData.slice(0, 8).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}\${blockData.length > 8 ? ', ...' : ''}] (前8字节)\`);
                            
                            // 打印伴随数据
                            const companionKeys = Object.keys(companionDataValues);
                            if (companionKeys.length > 0) {
                                console.log(\`%c伴随数据:\`, 'color: #4CAF50; font-weight: bold;');
                                companionKeys.forEach(key => {
                                    console.log(\`  \${key}: \${companionDataValues[key]}\`);
                                });
                            }
                            
                            try {
                                const response = await fetch('/api/publish', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });
                                const result = await response.json();
                                
                                if (result.success) {
                                    // 更新进度
                                    imageSendProgress.current = blockIdx + 1;
                                    imageSendProgress.remaining = totalBlocks - blockIdx - 1;
                                    imageSendProgress.percent = Math.round(((blockIdx + 1) / totalBlocks) * 100);
                                    console.log(\`%c✅ 发送成功 - 主题: \${result.topic}, 大小: \${result.size} 字节\`, 'color: #4CAF50;');
                                } else {
                                    console.error(\`发送包 \${blockIdx + 1} 失败:\`, result.error);
                                    alert(\`发送包 \${blockIdx + 1}/\${totalBlocks} 失败: \${result.error}\`);
                                    imageSendProgress.sending = false;
                                    return;
                                }
                            } catch (error) {
                                console.error(\`发送包 \${blockIdx + 1} 错误:\`, error);
                                alert(\`发送包 \${blockIdx + 1}/\${totalBlocks} 错误: \${error.message}\`);
                                imageSendProgress.sending = false;
                                return;
                            }
                            
                            // 延迟以符合 50Hz 速率限制（每 20ms 发一包）
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                        
                        // 发送完成
                        console.log('%c========== 发送完成 ==========', 'color: #4CAF50; font-weight: bold; font-size: 16px;');
                        console.log(\`总包数: \${totalBlocks}, 图片ID: \${imgId}\`);
                        alert(\`✅ 图片发送完成！\\n总包数: \${totalBlocks}\\n图片ID: \${imgId}\`);
                        
                        // 延迟重置进度状态
                        setTimeout(() => {
                            imageSendProgress.sending = false;
                        }, 2000);
                    }
                };

                // Load configs on mount
                onMounted(() => {
                    loadCustomConfigList();
                });
                
                // Image Transmission State
                const imageTxState = reactive({
                    file: null,
                    data: null, // Uint8Array
                    totalBlocks: 0,
                    currentBlock: 0,
                    remainingBlocks: 0,
                    imgId: 0,
                    active: false,
                    timer: null,
                    compressionFormat: 'jpeg', // jpeg, webp, avif
                    quality: 0.8
                });
                
                const imageProgress = computed(() => {
                    if (imageTxState.totalBlocks === 0) return 0;
                    return Math.round((imageTxState.currentBlock / imageTxState.totalBlocks) * 100);
                });
                
                const imageProgressText = computed(() => {
                    const current = imageTxState.currentBlock;
                    const total = imageTxState.totalBlocks;
                    const remaining = imageTxState.remainingBlocks;
                    return current + '/' + total + ' (剩余: ' + remaining + ')';
                });

                const uplinkCount = computed(() => messagesData.value?.clientMessages?.length || 0);
                const downlinkCount = computed(() => messagesData.value?.serverMessages?.length || 0);

                // Expose image handling to window for non-Vue event handlers
                window.handleImageUpload = function(input) {
                    console.log('handleImageUpload called', input.files);
                    if (input.files && input.files[0]) {
                        imageTxState.originalFile = input.files[0];
                        console.log('File selected:', imageTxState.originalFile.name, imageTxState.originalFile.size);
                        window.reprocessImage();
                    }
                };

                window.reprocessImage = function() {
                    console.log('reprocessImage called, originalFile:', imageTxState.originalFile?.name);
                    if (!imageTxState.originalFile) return;
                    
                    const file = imageTxState.originalFile;
                    const enableCompression = document.getElementById('enable-compression')?.checked;
                    
                    console.log('Compression enabled:', enableCompression);
                    
                    if (enableCompression) {
                        const qualityValue = parseInt(document.getElementById('compression-quality')?.value || 80);
                        imageTxState.quality = qualityValue / 100; // Convert 0-100 to 0-1
                        imageTxState.compressionFormat = document.getElementById('compression-format')?.value || 'jpeg';
                        const maxDim = parseInt(document.getElementById('max-dimension')?.value || 320);
                        
                        const reader = new FileReader();
                        reader.onload = function(e) {
                            const img = new Image();
                            img.onload = function() {
                                // Calculate new dimensions
                                let width = img.width;
                                let height = img.height;
                                
                                if (width > height) {
                                    if (width > maxDim) {
                                        height = Math.round(height * (maxDim / width));
                                        width = maxDim;
                                    }
                                } else {
                                    if (height > maxDim) {
                                        width = Math.round(width * (maxDim / height));
                                        height = maxDim;
                                    }
                                }
                                
                                const canvas = document.createElement('canvas');
                                canvas.width = width;
                                canvas.height = height;
                                const ctx = canvas.getContext('2d');
                                
                                // Fill white background to handle transparency (RGBA -> RGB)
                                ctx.fillStyle = '#FFFFFF';
                                ctx.fillRect(0, 0, width, height);
                                
                                ctx.drawImage(img, 0, 0, width, height);
                                
                                // Compress to selected format
                                let mimeType = 'image/jpeg';
                                if (imageTxState.compressionFormat === 'webp') {
                                    mimeType = 'image/webp';
                                } else if (imageTxState.compressionFormat === 'avif') {
                                    mimeType = 'image/avif';
                                }
                                
                                // Try to convert to selected format
                                let dataUrl;
                                try {
                                    dataUrl = canvas.toDataURL(mimeType, imageTxState.quality);
                                    
                                    // Check if browser actually supports the format
                                    // If not supported, toDataURL falls back to PNG (starts with data:image/png)
                                    if (mimeType === 'image/avif' && !dataUrl.startsWith('data:image/avif')) {
                                        console.warn('浏览器不支持AVIF格式，回退到JPEG');
                                        dataUrl = canvas.toDataURL('image/jpeg', imageTxState.quality);
                                        imageTxState.compressionFormat = 'jpeg';
                                    } else if (mimeType === 'image/webp' && !dataUrl.startsWith('data:image/webp')) {
                                        console.warn('浏览器不支持WebP格式，回退到JPEG');
                                        dataUrl = canvas.toDataURL('image/jpeg', imageTxState.quality);
                                        imageTxState.compressionFormat = 'jpeg';
                                    }
                                } catch (e) {
                                    console.error('图片压缩失败，回退到JPEG:', e);
                                    dataUrl = canvas.toDataURL('image/jpeg', imageTxState.quality);
                                    imageTxState.compressionFormat = 'jpeg';
                                }
                                
                                // Convert DataURL to Uint8Array
                                const byteString = atob(dataUrl.split(',')[1]);
                                const ab = new ArrayBuffer(byteString.length);
                                const ia = new Uint8Array(ab);
                                for (let i = 0; i < byteString.length; i++) {
                                    ia[i] = byteString.charCodeAt(i);
                                }
                                
                                imageTxState.file = { name: file.name + ' (' + imageTxState.compressionFormat.toUpperCase() + ')', size: ia.length };
                                imageTxState.data = ia;
                                imageTxState.totalBlocks = Math.ceil(ia.length / 120);
                                imageTxState.currentBlock = 0;
                                imageTxState.remainingBlocks = imageTxState.totalBlocks;
                                imageTxState.imgId = Math.floor(Math.random() * 65535);
                                imageTxState.active = true;
                                
                                console.log('Image processed (compressed):', {
                                    name: imageTxState.file.name,
                                    size: ia.length,
                                    totalBlocks: imageTxState.totalBlocks,
                                    active: imageTxState.active
                                });
                                
                                updateImageUI();
                            };
                            img.src = e.target.result;
                        };
                        reader.readAsDataURL(file);
                    } else {
                        // Original logic (no compression)
                        const reader = new FileReader();
                        reader.onload = function(e) {
                            const arrayBuffer = e.target.result;
                            const uint8Array = new Uint8Array(arrayBuffer);
                            
                            imageTxState.file = file;
                            imageTxState.data = uint8Array;
                            imageTxState.totalBlocks = Math.ceil(uint8Array.length / 120);
                            imageTxState.currentBlock = 0;
                            imageTxState.remainingBlocks = imageTxState.totalBlocks;
                            imageTxState.imgId = Math.floor(Math.random() * 65535);
                            imageTxState.active = true;
                            
                            console.log('Image processed (no compression):', {
                                name: file.name,
                                size: uint8Array.length,
                                totalBlocks: imageTxState.totalBlocks,
                                active: imageTxState.active
                            });
                            
                            updateImageUI();
                        };
                        reader.readAsArrayBuffer(file);
                    }
                };
                
                window.resetImageState = function() {
                    imageTxState.file = null;
                    imageTxState.data = null;
                    imageTxState.totalBlocks = 0;
                    imageTxState.currentBlock = 0;
                    imageTxState.active = false;
                    if (imageTxState.timer) {
                        clearInterval(imageTxState.timer);
                        imageTxState.timer = null;
                    }
                    const input = document.getElementById('custom-image-upload');
                    if (input) input.value = '';
                    updateImageUI();
                };
                
                function updateImageUI() {
                    const statusDiv = document.getElementById('image-tx-status');
                    const progressBar = document.getElementById('image-progress-bar');
                    const progressFill = document.getElementById('progress-fill');
                    const progressText = document.getElementById('progress-text');
                    
                    console.log('updateImageUI called, active:', imageTxState.active, 'statusDiv:', !!statusDiv);
                    
                    if (statusDiv) {
                        if (imageTxState.active) {
                            const remaining = imageTxState.totalBlocks - imageTxState.currentBlock;
                            const progress = imageTxState.totalBlocks > 0 ? Math.round((imageTxState.currentBlock / imageTxState.totalBlocks) * 100) : 0;
                            
                            statusDiv.innerHTML = 
                                '<div style="margin-top: 8px; padding: 8px; background: #e3f2fd; border-radius: 4px; font-size: 13px;">' +
                                    '<div>📁 文件: <strong>' + imageTxState.file.name + '</strong></div>' +
                                    '<div>🔢 大小: ' + imageTxState.data.length + ' bytes</div>' +
                                    '<div>📦 总包数/剩余: ' + imageTxState.currentBlock + '/' + imageTxState.totalBlocks + ' (剩余: ' + remaining + ')</div>' +
                                    '<div>🆔 ID: ' + imageTxState.imgId + '</div>' +
                                    '<button onclick="window.resetImageState()" style="margin-top: 5px; padding: 2px 8px; cursor: pointer;">重置图片</button>' +
                                '</div>';
                            
                            if (progressBar && progressFill && progressText) {
                                progressBar.style.display = 'block';
                                progressFill.style.width = progress + '%';
                                progressText.textContent = imageTxState.currentBlock + '/' + imageTxState.totalBlocks + ' (剩余: ' + remaining + ') - ' + progress + '%';
                            }
                        } else {
                            statusDiv.innerHTML = '';
                            if (progressBar) {
                                progressBar.style.display = 'none';
                            }
                        }
                    }
                }

                function getNextImageChunk() {
                    if (!imageTxState.active || !imageTxState.data) return null;
                    
                    // If finished, return empty/end frame or stop?
                    // User requirement: "ImageBlock仍有剩余分块时，分送一个图片分块并顺延"
                    // If no remaining blocks, we should probably stop sending image data or send empty.
                    // Let's send an empty block if finished, or just return null to indicate no image data to send.
                    if (imageTxState.currentBlock >= imageTxState.totalBlocks) {
                        // Send end frame logic if needed, but here we just stop sending image data
                        // Or maybe we should reset?
                        // Let's just return null so the sender sends normal data without image
                        return null;
                    }
                    
                    const blockSize = 120;
                    const start = imageTxState.currentBlock * blockSize;
                    const end = Math.min(start + blockSize, imageTxState.data.length);
                    const chunkData = Array.from(imageTxState.data.slice(start, end));
                    
                    const isEnd = (imageTxState.currentBlock === imageTxState.totalBlocks - 1);
                    
                    const chunk = {
                        cmd_type: isEnd ? 3 : 2, // 0x02=Data, 0x03=End
                        img_id: imageTxState.imgId,
                        block_idx: imageTxState.currentBlock,
                        total_block: imageTxState.totalBlocks,
                        data_len: chunkData.length,
                        data: chunkData
                    };
                    
                    imageTxState.currentBlock++;
                    imageTxState.remainingBlocks = imageTxState.totalBlocks - imageTxState.currentBlock;
                    updateImageUI();
                    
                    return chunk;
                }

                async function loadMessages() {
                    try {
                        const response = await fetch('/api/messages');
                        messagesData.value = await response.json();
                    } catch (error) {
                        console.error('加载消息定义失败:', error);
                    }
                }

                function toggleMessage(name) {
                    if (activeMessage.value === name) {
                        activeMessage.value = null;
                    } else {
                        activeMessage.value = name;
                    }
                }

                function generateFieldInput(messageName, fieldName, fieldMeta) {
                    const inputId = \`input-\${messageName}-\${fieldName}\`;
                    const description = fieldMeta.description || fieldMeta.comment || '';
                    
                    // CustomByteBlock 特殊处理：显示配置选择器
                    if (messageName === 'CustomByteBlock') {
                        return \`<div class="field-input-section" onclick="event.stopPropagation()">
                            <label class="field-input-label">📋 选择配置</label>
                            <select class="field-select" id="custom-config-selector" onchange="loadCustomConfig(this.value)">
                                <option value="">请选择配置...</option>
                            </select>
                            <label class="field-input-label" for="\${inputId}">✏️ 输入值</label>
                            <input type="text" class="field-input" id="\${inputId}" data-type="\${fieldMeta.type}" placeholder="0" value="0">
                        </div>\`;
                    }
                    
                    let mappingKey = fieldName;
                    if (messageName === 'DeployModeStatusSync' && fieldName === 'status') {
                        mappingKey = 'deploy_mode_status';
                    } else if (messageName === 'TechCoreMotionStateSync' && fieldName === 'status') {
                        mappingKey = 'core_status';
                    }
                    
                    const statusOptions = messagesData.value?.statusMappings?.[mappingKey];
                    if (statusOptions && statusOptions.length > 0) {
                        const optionsHtml = statusOptions.map(opt => 
                            \`<option value="\${opt.value}">\${opt.value}: \${opt.label}</option>\`
                        ).join('');
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 选择状态</label><select class="field-select" id="\${inputId}" data-type="\${fieldMeta.type}">\${optionsHtml}</select></div>\`;
                    }
                    
                    if (fieldMeta.type === 'bool') {
                        let options = '';
                        if (description.includes('false') || description.includes('true')) {
                            const match = description.match(/(false|抬起|否)[^a-zA-Z]*[:：=]?([^,，)]+).*?(true|按下|是)[^a-zA-Z]*[:：=]?([^,，)]+)/i);
                            if (match) {
                                const falseText = match[2]?.trim() || '抬起/否';
                                const trueText = match[4]?.trim() || '按下/是';
                                options = \`<option value="false">false: \${falseText}</option><option value="true">true: \${trueText}</option>\`;
                            } else {
                                options = \`<option value="false">false</option><option value="true">true</option>\`;
                            }
                        } else {
                            options = \`<option value="false">false</option><option value="true">true</option>\`;
                        }
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 设置值</label><select class="field-select" id="\${inputId}" data-type="bool">\${options}</select></div>\`;
                    }
                    
                    const enumComment = fieldMeta.enumComment;
                    if (enumComment || (fieldMeta.type === 'uint32' && description.includes('枚举'))) {
                        const enumOptions = parseEnumOptions(enumComment || description);
                        if (enumOptions.length > 0) {
                            const optionsHtml = enumOptions.map(opt => 
                                \`<option value="\${opt.value}">\${opt.value}: \${opt.label}</option>\`
                            ).join('');
                            return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 选择值</label><select class="field-select" id="\${inputId}" data-type="uint32">\${optionsHtml}</select></div>\`;
                        }
                    }
                    
                    if (fieldMeta.repeated) {
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 输入值 (数组，如: [1,2,3])</label><input type="text" class="field-input" id="\${inputId}" data-type="\${fieldMeta.type}" data-repeated="true" placeholder="[1, 2, 3]" value="[]"></div>\`;
                    }
                    
                    if (fieldMeta.type === 'uint32' || fieldMeta.type === 'int32' || fieldMeta.type === 'uint64' || fieldMeta.type === 'int64') {
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 输入值</label><input type="number" class="field-input" id="\${inputId}" data-type="\${fieldMeta.type}" placeholder="0" value="0"></div>\`;
                    }
                    
                    if (fieldMeta.type === 'float' || fieldMeta.type === 'double') {
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 输入值</label><input type="number" step="0.01" class="field-input" id="\${inputId}" data-type="\${fieldMeta.type}" placeholder="0.0" value="0.0"></div>\`;
                    }
                    
                    if (fieldMeta.type === 'string') {
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 输入值</label><input type="text" class="field-input" id="\${inputId}" data-type="string" placeholder="文本内容" value=""></div>\`;
                    }
                    
                    if (fieldMeta.type === 'bytes') {
                        return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 输入值 (文本或Base64)</label><input type="text" class="field-input" id="\${inputId}" data-type="bytes" placeholder="文本内容" value=""></div>\`;
                    }
                    
                    return \`<div class="field-input-section" onclick="event.stopPropagation()"><label class="field-input-label" for="\${inputId}">✏️ 输入值</label><input type="text" class="field-input" id="\${inputId}" data-type="\${fieldMeta.type}" placeholder="值" value=""></div>\`;
                }

                function parseEnumOptions(description) {
                    const match = description.match(/枚举[^:]*:\s*(.+)/);
                    if (!match) return [];
                    const enumPart = match[1];
                    const pairs = enumPart.split(/[,，、]/);
                    const options = [];
                    for (const pair of pairs) {
                        const pairMatch = pair.trim().match(/^(\d+)\s*[:：]\s*(.+)/);
                        if (pairMatch) {
                            options.push({ value: parseInt(pairMatch[1]), label: pairMatch[2].trim() });
                        }
                    }
                    return options;
                }

                async function sendDownlinkMessage(messageType, silent = false) {
                    try {
                        // 特殊处理 CustomByteBlock
                        if (messageType === 'CustomByteBlock') {
                            // 查找容器
                            let container = null;
                            const messageItems = document.querySelectorAll('.message-item');
                            messageItems.forEach(item => {
                                const nameElement = item.querySelector('.message-name');
                                if (nameElement && (nameElement.textContent.includes('CustomByteBlock') || nameElement.textContent.includes('自定义数据块'))) {
                                    container = item;
                                }
                            });
                            
                            if (!container) {
                                if (!silent) alert('❌ 未找到CustomByteBlock消息容器');
                                return;
                            }
                            
                            // 收集所有输入框的值
                            const data = {};
                            const inputs = container.querySelectorAll('.field-input');
                            
                            inputs.forEach(input => {
                                const inputId = input.id;
                                if (!inputId.startsWith('input-CustomByteBlock-')) return;
                                
                                // Skip image upload input
                                if (inputId === 'custom-image-upload') return;

                                const fieldName = inputId.replace('input-CustomByteBlock-', '');
                                const dataType = input.getAttribute('data-type');
                                
                                let value;
                                if (input.type === 'checkbox') {
                                    value = input.checked;
                                } else if (dataType === 'bool') {
                                    value = input.value === 'true' || input.checked;
                                } else if (dataType === 'uint32' || dataType === 'int32' || dataType === 'uint8' || dataType === 'int8' || dataType === 'uint16' || dataType === 'int16' || dataType === 'uint64' || dataType === 'int64') {
                                    value = parseInt(input.value) || 0;
                                } else if (dataType === 'float' || dataType === 'double') {
                                    value = parseFloat(input.value) || 0.0;
                                } else {
                                    value = input.value;
                                }
                                
                                data[fieldName] = value;
                            });
                            
                            // 如果有 ImageBlock 数据，添加到 data 中
                            const imageChunk = getNextImageChunk();
                            if (imageChunk) {
                                data.Image = imageChunk;
                            }
                            
                            if (Object.keys(data).length === 0) {
                                if (!silent) alert('⚠️ 请先选择配置并填写数据');
                                return;
                            }
                            
                            // Check if we have a config name
                            const configName = container.getAttribute('data-config-name');

                            const response = await fetch('/api/publish', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ 
                                    messageType: messageType, 
                                    topic: messageType, 
                                    data: data,
                                    customConfigName: configName
                                })
                            });
                            const result = await response.json();
                            if (result.success) {
                                if (!silent) alert(\`✅ 发送成功！\\n主题: \${result.topic}\\n大小: \${result.size} 字节\`);
                            } else {
                                if (!silent) alert(\`❌ 发送失败: \${result.error}\`);
                            }
                            return;
                        }
                        
                        // 其他消息类型的处理
                        const msg = messagesData.value.serverMessages.find(m => m.name === messageType);
                        if (!msg) return;
                        const data = {};
                        for (const [fieldName, fieldMeta] of Object.entries(msg.metadata.fields)) {
                            const inputId = \`input-\${messageType}-\${fieldName}\`;
                            const inputElement = document.getElementById(inputId);
                            if (!inputElement) continue;
                            const dataType = inputElement.getAttribute('data-type');
                            const isRepeated = inputElement.getAttribute('data-repeated') === 'true';
                            let value = inputElement.value;
                            if (isRepeated) {
                                try { value = JSON.parse(value); } catch (e) { value = []; }
                            } else if (dataType === 'bool') {
                                value = inputElement.type === 'checkbox' ? inputElement.checked : (value === 'true');
                            } else if (dataType === 'uint32' || dataType === 'int32' || dataType === 'uint64' || dataType === 'int64') {
                                value = parseInt(value) || 0;
                            } else if (dataType === 'float' || dataType === 'double') {
                                value = parseFloat(value) || 0.0;
                            }
                            data[fieldName] = value;
                        }
                        const response = await fetch('/api/publish', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messageType: messageType, topic: messageType, data: data })
                        });
                        const result = await response.json();
                        if (result.success) {
                            alert(\`✅ 发送成功！\\n主题: \${result.topic}\\n大小: \${result.size} 字节\`);
                        } else {
                            alert(\`❌ 发送失败: \${result.error}\`);
                        }
                    } catch (error) {
                        alert(\`❌ 错误: \${error.message}\`);
                    }
                }

                function collectMessageData(messageType) {
                    const msg = messagesData.value.serverMessages.find(m => m.name === messageType);
                    if (!msg) return {};
                    const data = {};
                    for (const [fieldName, fieldMeta] of Object.entries(msg.metadata.fields)) {
                        const inputId = 'input-' + messageType + '-' + fieldName;
                        const inputElement = document.getElementById(inputId);
                        if (!inputElement) continue;
                        const dataType = inputElement.getAttribute('data-type');
                        const isRepeated = inputElement.getAttribute('data-repeated') === 'true';
                        let value = inputElement.value;
                        if (isRepeated) {
                            try { value = JSON.parse(value); } catch (e) { value = []; }
                        } else if (dataType === 'bool') { value = value === 'true'; }
                        else if (dataType === 'uint32' || dataType === 'int32' || dataType === 'uint64' || dataType === 'int64') { value = parseInt(value) || 0; }
                        else if (dataType === 'float' || dataType === 'double') { value = parseFloat(value) || 0.0; }
                        data[fieldName] = value;
                    }
                    return data;
                }

                async function toggleAutoPublish(messageType) {
                    try {
                        const checkbox = document.getElementById('autoEnable-' + messageType);
                        const freqInput = document.getElementById('autoFreq-' + messageType);
                        const enabled = checkbox.checked;
                        const freqHz = parseFloat(freqInput.value) || messagesData.value.messageDefaultFrequencies?.[messageType] || 1;
                        const intervalMs = Math.round(1000 / freqHz);
                        
                        // CustomByteBlock Frontend Auto-Publish Logic
                        if (messageType === 'CustomByteBlock' && imageTxState.active) {
                            if (enabled) {
                                if (imageTxState.timer) clearInterval(imageTxState.timer);
                                imageTxState.timer = setInterval(() => {
                                    // Silent send (no alert)
                                    sendDownlinkMessage(messageType, true);
                                    // Stop if finished
                                    if (!imageTxState.active || imageTxState.currentBlock >= imageTxState.totalBlocks) {
                                        // Keep running? User said "顺延", implies sequential sending.
                                        // If finished, we might want to stop or just send empty frames.
                                        // For now, let's keep running but sendDownlinkMessage will send empty image block.
                                        // Or we can auto-stop.
                                        // Let's auto-stop for better UX.
                                        if (imageTxState.currentBlock >= imageTxState.totalBlocks) {
                                            checkbox.checked = false;
                                            clearInterval(imageTxState.timer);
                                            imageTxState.timer = null;
                                            alert('✅ 图片发送完成');
                                        }
                                    }
                                }, intervalMs);
                            } else {
                                if (imageTxState.timer) {
                                    clearInterval(imageTxState.timer);
                                    imageTxState.timer = null;
                                }
                            }
                            return;
                        }

                        let data = {};
                        let customConfigName = undefined;

                        if (messageType === 'CustomByteBlock') {
                            // CustomByteBlock data collection
                            const findContainer = () => {
                                const messageItems = document.querySelectorAll('.message-item');
                                for (const item of messageItems) {
                                    const nameElement = item.querySelector('.message-name');
                                    if (nameElement && (nameElement.textContent.includes('CustomByteBlock') || nameElement.textContent.includes('自定义数据块'))) {
                                        return item;
                                    }
                                }
                                return null;
                            };
                            const container = findContainer();
                            if (container) {
                                customConfigName = container.getAttribute('data-config-name');
                                const inputs = container.querySelectorAll('.field-input');
                                inputs.forEach(input => {
                                    const inputId = input.id;
                                    if (!inputId.startsWith('input-CustomByteBlock-')) return;
                                    if (inputId === 'custom-image-upload') return;
                                    const fieldName = inputId.replace('input-CustomByteBlock-', '');
                                    const dataType = input.getAttribute('data-type');
                                    let value;
                                    if (input.type === 'checkbox') {
                                        value = input.checked;
                                    } else if (dataType === 'bool') {
                                        value = input.value === 'true' || input.checked;
                                    } else if (dataType === 'uint32' || dataType === 'int32' || dataType === 'uint8' || dataType === 'int8' || dataType === 'uint16' || dataType === 'int16') {
                                        value = parseInt(input.value) || 0;
                                    } else if (dataType === 'float' || dataType === 'double') {
                                        value = parseFloat(input.value) || 0.0;
                                    } else {
                                        value = input.value;
                                    }
                                    data[fieldName] = value;
                                });
                            }
                        } else {
                            data = collectMessageData(messageType);
                        }

                        const response = await fetch('/api/auto-publish', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messageType, enabled, intervalMs: intervalMs, topic: messageType, data, customConfigName })
                        });
                        const result = await response.json();
                        if (!result.success) {
                            alert('自动发送失败: ' + (result.error || 'unknown'));
                            checkbox.checked = !enabled;
                        }
                    } catch (error) {
                        alert('自动发送发生错误: ' + error.message);
                    }
                }

                async function refreshHistory() {
                    try {
                        const response = await fetch('/api/uplink-history');
                        const historyData = await response.json();
                        history.value = historyData;

                        if (historyData.length === 0) return;

                        const latestMessages = {};
                        historyData.forEach(item => {
                            if (!latestMessages[item.messageType]) {
                                latestMessages[item.messageType] = item;
                            }
                        });

                        for (const [messageType, item] of Object.entries(latestMessages)) {
                            if (item.parsedData) {
                                if (!receivedValues[messageType]) receivedValues[messageType] = {};
                                for (const [fieldName, fieldInfo] of Object.entries(item.parsedData)) {
                                    receivedValues[messageType][fieldName] = {
                                        display: fieldInfo.display,
                                        description: fieldInfo.description,
                                        time: new Date().toLocaleTimeString()
                                    };
                                }
                            }
                        }
                    } catch (error) {
                        console.error('刷新历史记录失败:', error);
                    }
                }

                onMounted(() => {
                    loadMessages();
                    setInterval(refreshHistory, 2000);
                    loadConfigList();
                });
                
                // 加载配置列表到选择器
                async function loadConfigList() {
                    try {
                        const response = await fetch('/api/list-configs');
                        const result = await response.json();
                        if (result.success && result.configs.length > 0) {
                            const selector = document.getElementById('custom-config-selector');
                            if (selector) {
                                result.configs.forEach(config => {
                                    const option = document.createElement('option');
                                    option.value = config.name;
                                    option.textContent = config.name;
                                    selector.appendChild(option);
                                });
                            }
                        }
                    } catch (error) {
                        console.error('加载配置列表失败:', error);
                    }
                }
                
                // 全局函数：加载自定义配置
                window.loadCustomConfig = async function(configName) {
                    // Helper to find container
                    const findContainer = () => {
                        const messageItems = document.querySelectorAll('.message-item');
                        for (const item of messageItems) {
                            const nameElement = item.querySelector('.message-name');
                            if (nameElement && (nameElement.textContent.includes('CustomByteBlock') || nameElement.textContent.includes('自定义数据块'))) {
                                return item;
                            }
                        }
                        return null;
                    };

                    const container = findContainer();
                    if (!container) return;
                    
                    const fieldList = container.querySelector('.field-list');
                    if (!fieldList) return;

                    if (!configName) {
                        // 清空字段
                        fieldList.innerHTML = '';
                        return;
                    }
                    
                    try {
                        // 加载proto文件
                        const protoResponse = await fetch(\`/api/load-proto?name=\${encodeURIComponent(configName)}\`);
                        const protoResult = await protoResponse.json();
                        
                        if (!protoResult.success) {
                            alert(\`❌ 加载Proto失败: \${protoResult.error}\`);
                            return;
                        }
                        
                        // 解析proto内容获取字段（包括注释中的范围信息）
                        const protoContent = protoResult.content;
                        const lines = protoContent.split('\\n');
                        const fields = [];
                        let inCustomBlock = false;
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
                            
                            // 简单的状态机：只解析 CustomByteBlock 内部
                            if (line.match(/^message\\s+CustomByteBlock\\s*\{/)) {
                                inCustomBlock = true;
                                continue;
                            }
                            if (inCustomBlock && line.trim() === '}') {
                                inCustomBlock = false;
                                break;
                            }
                            if (!inCustomBlock) continue;

                            // 匹配字段定义: type name = number; // comment
                            const fieldMatch = line.match(/^\\s+(\\w+)\\s+(\\w+)\\s*=\\s*(\\d+);(.*)$/);
                            if (fieldMatch) {
                                const type = fieldMatch[1];
                                const name = fieldMatch[2];
                                const comment = fieldMatch[4].trim();
                                
                                // 跳过padding字段
                                if (name === '_padding') continue;
                                
                                // 解析范围信息
                                let min = undefined, max = undefined;
                                const rangeMatch = comment.match(/范围:\\s*\\[([^,]+),\\s*([^\\]]+)\\]/);
                                if (rangeMatch) {
                                    min = rangeMatch[1] === '-∞' ? undefined : parseFloat(rangeMatch[1]);
                                    max = rangeMatch[2] === '+∞' ? undefined : parseFloat(rangeMatch[2]);
                                }
                                
                                fields.push({ name, type, min, max, comment });
                            }
                        }
                        
                        if (fields.length === 0) {
                            alert('⚠️ 未找到有效字段');
                            return;
                        }
                        
                        // 重新生成字段输入框
                        let html = '';
                        
                        // 检查是否有 ImageBlock 字段
                        const hasImageBlock = fields.some(f => f.name === 'Image' || f.type === 'ImageBlock');
                        
                        if (hasImageBlock) {
                            // 创建 ImageBlock 容器
                            html += '<div class="image-block-container" style="margin-bottom: 15px; border: 1px solid #4caf50; border-radius: 4px; overflow: hidden;">';
                            html += '<div style="background: #e8f5e9; padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #4caf50; color: #2e7d32;">🖼️ 图片块配置 (ImageBlock)</div>';
                            html += '<div style="padding: 10px; background: #fff;">';
                            html += '<div class="field-input-section" onclick="event.stopPropagation()">';
                            html += '<label class="field-input-label">📂 选择图片文件 (自动分块)</label>';
                            html += '<input type="file" id="custom-image-upload" accept="image/*" onchange="window.handleImageUpload(this)" class="field-input">';
                            
                            // 压缩选项
                            html += '<div style="margin-top: 10px; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 13px;">';
                            html += '<div style="margin-bottom: 6px; display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">';
                            html += '<label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">';
                            html += '<input type="checkbox" id="enable-compression" checked onchange="window.reprocessImage()" style="cursor: pointer;">';
                            html += '<span>启用压缩</span>';
                            html += '</label>';
                            html += '<label style="display: inline-flex; align-items: center; gap: 5px;">';
                            html += '<span>格式:</span>';
                            html += '<select id="compression-format" onchange="window.reprocessImage()" style="padding: 3px 8px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer;">';
                            html += '<option value="jpeg">JPEG</option>';
                            html += '<option value="webp">WebP</option>';
                            html += '<option value="avif">AVIF</option>';
                            html += '</select>';
                            html += '</label>';
                            html += '</div>';
                            html += '<div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">';
                            html += '<label style="display: inline-flex; align-items: center; gap: 5px;">';
                            html += '<span>画质:</span>';
                            html += '<input type="range" id="compression-quality" value="80" min="10" max="100" step="5" onchange="document.getElementById(\\'quality-value\\').textContent=this.value+\\'%\\'; window.reprocessImage()" style="width: 100px; cursor: pointer;">';
                            html += '<span id="quality-value" style="min-width: 40px; font-weight: bold; color: #4caf50;">80%</span>';
                            html += '</label>';
                            html += '<label style="display: inline-flex; align-items: center; gap: 5px;">';
                            html += '<span>最大宽/高:</span>';
                            html += '<input type="number" id="max-dimension" value="320" step="10" min="50" max="1920" onchange="window.reprocessImage()" style="width: 70px; padding: 3px 5px; border: 1px solid #ccc; border-radius: 3px;">';
                            html += '<span>px</span>';
                            html += '</label>';
                            html += '</div>';
                            html += '</div>';
                            
                            // 进度条
                            html += '<div id="image-progress-bar" style="display: none; margin-top: 10px;">';
                            html += '<div style="background: #e0e0e0; border-radius: 10px; overflow: hidden; height: 22px; position: relative;">';
                            html += '<div id="progress-fill" style="background: linear-gradient(90deg, #4CAF50, #45a049); height: 100%; width: 0%; transition: width 0.3s;"></div>';
                            html += '<div id="progress-text" style="position: absolute; top: 0; left: 0; right: 0; text-align: center; line-height: 22px; color: #333; font-weight: bold; font-size: 12px;"></div>';
                            html += '</div>';
                            html += '</div>';
                            
                            // 状态信息
                            html += '<div id="image-tx-status" style="margin-top: 8px; font-size: 12px; color: #666;"></div>';
                            
                            html += '</div></div></div>';
                        }

                        fields.forEach(field => {
                            // 跳过 Image 字段，因为它已经特殊处理了（或者我们不希望用户直接输入 ImageBlock 对象）
                            if (field.name === 'Image' || field.type === 'ImageBlock') return;
                            
                            const inputId = \`input-CustomByteBlock-\${field.name}\`;
                            const inputType = (field.type === 'float' || field.type === 'double') ? 'number' : 
                                            (field.type === 'bool') ? 'checkbox' : 'number';
                            const step = (field.type === 'float' || field.type === 'double') ? '0.01' : '1';
                            const minAttr = field.min !== undefined ? \`min="\${field.min}"\` : '';
                            const maxAttr = field.max !== undefined ? \`max="\${field.max}"\` : '';
                            const rangeInfo = (field.min !== undefined || field.max !== undefined) 
                                ? \`范围: [\${field.min ?? '-∞'}, \${field.max ?? '+∞'}]\` 
                                : '';
                            
                            html += \`
                                <div class="field-item">
                                    <div class="field-left">
                                        <span class="field-name">\${field.name}</span>
                                        <span class="field-type">(\${field.type})</span>
                                        \${rangeInfo ? \`<div class="field-comment">\${rangeInfo}</div>\` : ''}
                                    </div>
                                    <div class="field-right">
                                        <div class="field-input-section" onclick="event.stopPropagation()">
                                            <label class="field-input-label" for="\${inputId}">✏️ 输入值</label>
                                            \${field.type === 'bool' 
                                                ? \`<input type="checkbox" class="field-input" id="\${inputId}" data-type="\${field.type}">\`
                                                : \`<input type="\${inputType}" step="\${step}" class="field-input" id="\${inputId}" 
                                                       data-type="\${field.type}" placeholder="0" value="0" \${minAttr} \${maxAttr}>\`
                                            }
                                        </div>
                                    </div>
                                </div>
                            \`;
                        });
                        
                        fieldList.innerHTML = html;
                        
                        // 存储当前配置名称到容器属性，供发送时使用
                        container.setAttribute('data-config-name', configName);
                        
                        console.log(\`✅ 已加载配置: \${configName}，共 \${fields.length} 个字段\`);
                        
                    } catch (error) {
                        console.error('加载配置失败:', error);
                        alert(\`❌ 加载配置失败: \${error.message}\`);
                    }
                };

                return {
                    currentTab,
                    messagesData, activeMessage, receivedValues, history, autoPublishActive,
                    uplinkCount, downlinkCount,
                    loadMessages, toggleMessage, refreshHistory,
                    generateFieldInput, sendDownlinkMessage, toggleAutoPublish,
                    // Custom Data Exports
                    customConfigList, currentCustomConfigName, currentCustomConfig,
                    pureDataValues, companionDataValues, customImageFile,
                    customImagePreview, customImageSize, customImageData,
                    vectorLines, vectorDimensions,
                    pureDataFields, hasImageBlock, companionFields,
                    loadCustomConfigList, loadCustomConfigDetails,
                    handleCustomImageUpload, sendCustomData,
                    // 新增: 压缩配置和进度
                    imageCompression, imageSendProgress, imageTotalBlocks,
                    reprocessCustomImage
                };
            }
        }).mount('#app');
    </script>
</body>
</html>`;
    }

    async start() {
        const loaded = await this.loadProto();
        if (!loaded) {
            throw new Error('Protobuf 加载失败，无法启动服务');
        }

        await this.loadCustomProto();

        await this.startMQTT();
        this.startHTTP();
    }

    stop() {
        this.stopAutoPublish();
        
        if (this.mqttServer) {
            this.mqttServer.close(() => {
                console.log('⏹️ MQTT 服务已停止');
            });
        }

        if (this.httpServer) {
            this.httpServer.close(() => {
                console.log('⏹️ Web 服务已停止');
            });
        }

        if (aedes) {
            aedes.close(() => {
                console.log('⏹️ MQTT Broker 已关闭');
            });
        }
    }
}

module.exports = VisualMQTTServer;

// 如果直接运行此文件
if (require.main === module) {
    (async () => {
        const server = new VisualMQTTServer();
        try {
            await server.start();
        } catch (err) {
            console.error('❌ 启动失败:', err.message);
            process.exit(1);
        }
    })();
}
