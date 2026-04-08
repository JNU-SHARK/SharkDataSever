#!/usr/bin/env python3
"""
ZSTD 压缩骨架图像解码器
用于解压 compressed_zstd.bin 并恢复原始骨架图像
"""

import zstandard as zstd
import numpy as np
import cv2

def decode_zstd_skeleton(input_file: str, output_file: str = None) -> np.ndarray:
    """
    解码 ZSTD 压缩的骨架图像
    
    参数:
        input_file: 压缩文件路径 (.bin)
        output_file: 输出 PNG 路径 (可选)
    
    返回:
        解码后的图像数组
    """
    with open(input_file, 'rb') as f:
        data = f.read()
    
    # 读取头部 (宽度 2 字节 + 高度 2 字节)
    width = int.from_bytes(data[0:2], 'little')
    height = int.from_bytes(data[2:4], 'little')
    compressed_data = data[4:]
    
    # ZSTD 解压
    decompressor = zstd.ZstdDecompressor()
    img_bytes = decompressor.decompress(compressed_data)
    
    # 重建图像
    img = np.frombuffer(img_bytes, dtype=np.uint8).reshape((height, width))
    
    if output_file:
        cv2.imwrite(output_file, img)
        print(f"已保存到: {output_file}")
    
    return img

if __name__ == "__main__":
    # 解码示例
    img = decode_zstd_skeleton('compressed_zstd.bin', 'decoded_skeleton.png')
    print(f"解码完成: {img.shape[1]}x{img.shape[0]}, {np.sum(img > 0)} 个白色像素")
