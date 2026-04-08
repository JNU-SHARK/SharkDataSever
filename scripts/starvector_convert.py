#!/usr/bin/env python3
"""
StarVector 矢量化脚本
用于将位图图像转换为 SVG 矢量图或线段数据

使用方法:
  cat image.png | python starvector_convert.py --mode lines

基础依赖:
pip install pillow

可选安装 (更高质量):
pip install opencv-python numpy
pip install vtracer

StarVector AI (需要 GPU 和更多依赖):
pip install torch torchvision transformers
pip install starvector  # 或从 GitHub 安装
"""

import sys
import json
import io
import os
import argparse

# 全局阈值变量
g_threshold = 128

def check_vtracer():
    """检查 vtracer 是否可用"""
    try:
        import vtracer
        return True
    except ImportError:
        return False

def check_opencv():
    """检查 OpenCV 是否可用"""
    try:
        import cv2
        import numpy
        return True
    except ImportError:
        return False

def check_starvector():
    """检查 StarVector 是否可用"""
    try:
        import torch
        from starvector.model import StarVector
        return True
    except ImportError:
        return False

def check_torch():
    """检查 PyTorch 是否可用"""
    try:
        import torch
        return True
    except ImportError:
        return False

def convert_with_starvector(image_data, simplify_level=3):
    """使用 StarVector AI 模型进行矢量化 (最高质量)
    
    StarVector 是基于 Transformer 的图像矢量化模型，
    可以生成高质量的 SVG 路径。
    
    安装: pip install starvector torch torchvision transformers
    或从 GitHub 安装: pip install git+https://github.com/joanrod/star-vector.git
    """
    try:
        import torch
        from PIL import Image
        import re
        import tempfile
        
        # 尝试导入 StarVector 库
        use_starvector_lib = False
        use_transformers = False
        
        try:
            from starvector.model import StarVector as StarVectorModel
            from starvector.data.augmentation import process_image
            use_starvector_lib = True
        except ImportError:
            pass
        
        if not use_starvector_lib:
            # 尝试使用 transformers 直接加载
            try:
                from transformers import AutoModelForCausalLM, AutoImageProcessor, AutoTokenizer
                use_transformers = True
            except ImportError:
                try:
                    # 备选导入方式
                    from transformers import AutoModelForCausalLM, AutoFeatureExtractor as AutoImageProcessor, AutoTokenizer
                    use_transformers = True
                except ImportError:
                    pass
        
        if not use_starvector_lib and not use_transformers:
            return {
                "success": False,
                "error": "StarVector requires: pip install starvector OR pip install transformers",
                "lines": [],
                "method": "starvector"
            }
        
        # 解码图像
        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        w, h = img.size
        
        # 确保图像尺寸适合模型
        max_size = 512
        if w > max_size or h > max_size:
            ratio = min(max_size / w, max_size / h)
            new_w, new_h = int(w * ratio), int(h * ratio)
            img = img.resize((new_w, new_h), Image.LANCZOS)
            w, h = new_w, new_h
        
        # 设置设备
        device = "cuda" if torch.cuda.is_available() else "cpu"
        
        svg_content = None
        
        if use_starvector_lib:
            # 使用 starvector 库
            try:
                # 加载模型 (使用预训练模型)
                model_name = "joanrodriguezpena/starvector-1b"
                model = StarVectorModel.from_pretrained(model_name).to(device)
                model.eval()
                
                # 处理图像
                processed_img = process_image(img)
                
                # 推理生成 SVG
                with torch.no_grad():
                    svg_content = model.generate(processed_img.unsqueeze(0).to(device))
                    if isinstance(svg_content, list):
                        svg_content = svg_content[0]
                        
            except Exception as e:
                return {
                    "success": False,
                    "error": f"StarVector model error: {str(e)}",
                    "lines": [],
                    "method": "starvector"
                }
        else:
            # 使用 transformers 直接加载 (备选方案)
            try:
                model_name = "joanrodriguezpena/starvector-1b"
                
                # 加载处理器和模型
                processor = AutoImageProcessor.from_pretrained(model_name, trust_remote_code=True)
                model = AutoModelForCausalLM.from_pretrained(
                    model_name, 
                    trust_remote_code=True,
                    torch_dtype=torch.float16 if device == "cuda" else torch.float32
                ).to(device)
                model.eval()
                
                # 处理图像
                inputs = processor(images=img, return_tensors="pt").to(device)
                
                # 生成 SVG
                with torch.no_grad():
                    outputs = model.generate(
                        **inputs,
                        max_new_tokens=4096,
                        do_sample=False,
                        num_beams=1
                    )
                    svg_content = processor.decode(outputs[0], skip_special_tokens=True)
                    
            except Exception as e:
                return {
                    "success": False,
                    "error": f"StarVector transformers error: {str(e)}",
                    "lines": [],
                    "method": "starvector"
                }
        
        if not svg_content:
            return {
                "success": False,
                "error": "No SVG output generated",
                "lines": [],
                "method": "starvector"
            }
        
        # 解析 SVG 内容提取线段
        lines = parse_svg_to_lines(svg_content)
        
        # 根据简化级别过滤短线段
        min_length_map = {1: 0, 2: 1, 3: 2, 4: 3, 5: 5}
        min_length = min_length_map.get(simplify_level, 2)
        
        if min_length > 0:
            filtered_lines = []
            for line in lines:
                dx = line["x2"] - line["x1"]
                dy = line["y2"] - line["y1"]
                length = (dx * dx + dy * dy) ** 0.5
                if length >= min_length:
                    filtered_lines.append(line)
            lines = filtered_lines
        
        return {
            "success": True,
            "lines": lines,
            "width": w,
            "height": h,
            "method": "starvector"
        }
        
    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": f"StarVector error: {str(e)}\n{traceback.format_exc()}",
            "lines": [],
            "method": "starvector"
        }

def convert_with_starvector_simple(image_data, simplify_level=3):
    """StarVector 简化版本 - 使用预训练模型的 API
    
    这个版本使用 HuggingFace 的 pipeline API，更容易使用
    """
    try:
        from PIL import Image
        import re
        
        # 解码图像
        img = Image.open(io.BytesIO(image_data)).convert('RGB')
        w, h = img.size
        
        # 尝试使用 diffusers 或 transformers pipeline
        try:
            from transformers import pipeline
            
            # 尝试加载 StarVector pipeline
            pipe = pipeline("image-to-text", model="joanrodriguezpena/starvector-1b", 
                          trust_remote_code=True)
            
            result = pipe(img)
            svg_content = result[0].get('generated_text', '') if result else ''
            
        except Exception as e:
            # 如果 pipeline 方式失败，返回错误
            return {
                "success": False,
                "error": f"StarVector pipeline not available: {str(e)}",
                "lines": [],
                "method": "starvector"
            }
        
        if not svg_content or '<svg' not in svg_content.lower():
            return {
                "success": False,
                "error": "Invalid SVG output from StarVector",
                "lines": [],
                "method": "starvector"
            }
        
        # 解析 SVG
        lines = parse_svg_to_lines(svg_content)
        
        return {
            "success": True,
            "lines": lines,
            "width": w,
            "height": h,
            "method": "starvector"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"StarVector simple error: {str(e)}",
            "lines": [],
            "method": "starvector"
        }

def convert_with_pil(image_data, simplify_level=3):
    """使用 PIL 进行简单边缘检测矢量化 (最基础的 fallback)"""
    try:
        from PIL import Image, ImageFilter
        
        # 解码图像
        img = Image.open(io.BytesIO(image_data)).convert('L')
        w, h = img.size
        
        # 边缘检测
        edges = img.filter(ImageFilter.FIND_EDGES)
        edges = edges.point(lambda x: 255 if x > 30 else 0)
        
        pixels = list(edges.getdata())
        
        # 简单链追踪
        visited = [False] * (w * h)
        lines = []
        
        # 8方向邻居
        dx8 = [1, 1, 0, -1, -1, -1, 0, 1]
        dy8 = [0, 1, 1, 1, 0, -1, -1, -1]
        
        def trace_chain(start_x, start_y):
            chain = [(start_x, start_y)]
            visited[start_y * w + start_x] = True
            x, y = start_x, start_y
            
            while True:
                found = False
                for d in range(8):
                    nx, ny = x + dx8[d], y + dy8[d]
                    if 0 <= nx < w and 0 <= ny < h:
                        idx = ny * w + nx
                        if pixels[idx] > 128 and not visited[idx]:
                            visited[idx] = True
                            chain.append((nx, ny))
                            x, y = nx, ny
                            found = True
                            break
                if not found:
                    break
            return chain
        
        # 扫描并追踪
        chains = []
        for y in range(h):
            for x in range(w):
                idx = y * w + x
                if pixels[idx] > 128 and not visited[idx]:
                    chain = trace_chain(x, y)
                    if len(chain) >= 2:
                        chains.append(chain)
        
        # Douglas-Peucker 简化
        def simplify_chain(chain, tolerance):
            if len(chain) <= 2:
                return chain
            
            def perpendicular_distance(point, start, end):
                dx = end[0] - start[0]
                dy = end[1] - start[1]
                if dx == 0 and dy == 0:
                    return ((point[0] - start[0])**2 + (point[1] - start[1])**2)**0.5
                t = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx*dx + dy*dy)))
                proj_x = start[0] + t * dx
                proj_y = start[1] + t * dy
                return ((point[0] - proj_x)**2 + (point[1] - proj_y)**2)**0.5
            
            def rdp(points, start, end, tolerance):
                if end <= start + 1:
                    return [points[start]]
                max_dist = 0
                max_idx = start
                for i in range(start + 1, end):
                    d = perpendicular_distance(points[i], points[start], points[end])
                    if d > max_dist:
                        max_dist = d
                        max_idx = i
                if max_dist > tolerance:
                    left = rdp(points, start, max_idx, tolerance)
                    right = rdp(points, max_idx, end, tolerance)
                    return left + right
                else:
                    return [points[start]]
            
            result = rdp(chain, 0, len(chain) - 1, tolerance)
            result.append(chain[-1])
            return result
        
        # 简化程度映射
        tolerance_map = {1: 0.5, 2: 1.0, 3: 1.5, 4: 2.5, 5: 4.0}
        tolerance = tolerance_map.get(simplify_level, 1.5)
        
        for chain in chains:
            simplified = simplify_chain(chain, tolerance)
            for i in range(len(simplified) - 1):
                lines.append({
                    "x1": simplified[i][0], "y1": simplified[i][1],
                    "x2": simplified[i+1][0], "y2": simplified[i+1][1]
                })
        
        return {
            "success": True,
            "lines": lines,
            "width": w,
            "height": h,
            "method": "pil"
        }
        
    except Exception as e:
        return {"success": False, "error": str(e), "lines": [], "method": "pil"}

def convert_with_opencv(image_data, simplify_level=3):
    """使用 OpenCV 进行边缘检测和矢量化"""
    try:
        import cv2
        import numpy as np
        
        # 解码图像
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
        
        if img is None:
            return {"success": False, "error": "Failed to decode image", "lines": [], "method": "opencv"}
        
        h, w = img.shape
        
        # 边缘检测
        edges = cv2.Canny(img, 50, 150)
        
        # 骨架化细化
        kernel = np.ones((3,3), np.uint8)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        
        # Zhang-Suen 细化 (如果可用)
        if hasattr(cv2, 'ximgproc'):
            skeleton = cv2.ximgproc.thinning(edges)
        else:
            skeleton = edges
        
        # 查找轮廓
        contours, _ = cv2.findContours(skeleton, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        
        lines = []
        # 简化程度映射
        epsilon_map = {1: 0.5, 2: 1.0, 3: 2.0, 4: 3.0, 5: 5.0}
        epsilon = epsilon_map.get(simplify_level, 2.0)
        
        for contour in contours:
            # Douglas-Peucker 简化
            approx = cv2.approxPolyDP(contour, epsilon, closed=False)
            
            # 转换为线段
            for i in range(len(approx) - 1):
                pt1 = approx[i][0]
                pt2 = approx[i + 1][0]
                lines.append({
                    "x1": int(pt1[0]), "y1": int(pt1[1]),
                    "x2": int(pt2[0]), "y2": int(pt2[1])
                })
        
        return {
            "success": True,
            "lines": lines,
            "width": w,
            "height": h,
            "method": "opencv"
        }
        
    except Exception as e:
        return {"success": False, "error": str(e), "lines": [], "method": "opencv"}

def convert_with_vtracer(image_data, simplify_level=3):
    """使用 vtracer 进行矢量化"""
    try:
        import vtracer
        import tempfile
        import re
        from PIL import Image
        import io
        
        # 获取全局阈值
        global g_threshold
        threshold = g_threshold if 'g_threshold' in dir() else 128
        
        # 读取原始图像
        img = Image.open(io.BytesIO(image_data))
        original_w, original_h = img.size
        
        # 转为灰度并应用阈值
        img_gray = img.convert('L')
        # 应用边缘检测阈值 (阈值越低，边缘越多)
        img_binary = img_gray.point(lambda x: 255 if x > threshold else 0, '1')
        img = img_binary.convert('RGB')
        
        # 添加白色边距（padding），这样 vtracer 不会追踪到图像边框
        padding = 10
        
        # 创建带白色边距的新图像
        padded_img = Image.new('RGB', (original_w + padding * 2, original_h + padding * 2), (255, 255, 255))
        padded_img.paste(img, (padding, padding))
        
        # 写入临时文件
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            temp_input = f.name
            padded_img.save(temp_input, 'PNG')
        
        temp_output = temp_input.replace('.png', '.svg')
        
        # 根据简化级别设置参数 - 增大 filter_speckle 来过滤更多噪点
        params = {
            1: {"filter_speckle": 4, "corner_threshold": 60, "length_threshold": 4.0},
            2: {"filter_speckle": 6, "corner_threshold": 90, "length_threshold": 6.0},
            3: {"filter_speckle": 8, "corner_threshold": 120, "length_threshold": 8.0},
            4: {"filter_speckle": 12, "corner_threshold": 150, "length_threshold": 12.0},
            5: {"filter_speckle": 16, "corner_threshold": 180, "length_threshold": 16.0},
        }
        p = params.get(simplify_level, params[3])
        
        # 转换 - 使用 polygon 模式代替 spline，生成更少更直的线段
        vtracer.convert_image_to_svg_py(
            temp_input,
            temp_output,
            colormode="binary",
            hierarchical="stacked",
            mode="polygon",  # polygon 模式生成直线段，比 spline 更少曲线
            filter_speckle=p["filter_speckle"],
            color_precision=6,
            layer_difference=32,
            corner_threshold=p["corner_threshold"],
            length_threshold=p["length_threshold"],
            splice_threshold=90,
            path_precision=3
        )
        
        # 读取结果并解析 SVG 提取线段
        with open(temp_output, "r") as f:
            svg_content = f.read()
        
        # 清理临时文件
        os.remove(temp_input)
        os.remove(temp_output)
        
        # 从 SVG 解析出简单线段 (path 转换为 polyline)
        lines = parse_svg_to_lines(svg_content)
        
        # 使用原始图像尺寸
        w, h = original_w, original_h
        
        # 将坐标减去 padding 还原到原始图像坐标系
        for line in lines:
            line['x1'] -= padding
            line['y1'] -= padding
            line['x2'] -= padding
            line['y2'] -= padding
        
        # 坐标归一化：确保所有坐标在图像范围内
        if lines:
            # 裁剪到图像范围，过滤掉超出边界的线段
            filtered_lines = []
            for line in lines:
                x1, y1 = line['x1'], line['y1']
                x2, y2 = line['x2'], line['y2']
                
                # 完全在图像外的线段直接丢弃
                if (x1 < 0 and x2 < 0) or (x1 >= w and x2 >= w):
                    continue
                if (y1 < 0 and y2 < 0) or (y1 >= h and y2 >= h):
                    continue
                
                # 裁剪到边界内
                x1 = max(0, min(w - 1, x1))
                y1 = max(0, min(h - 1, y1))
                x2 = max(0, min(w - 1, x2))
                y2 = max(0, min(h - 1, y2))
                
                # 长度为0的线段丢弃
                if x1 == x2 and y1 == y2:
                    continue
                
                # 检查是否是边缘线（两端都在边框附近且沿着边框方向）
                edge_margin = 2
                
                # 左边缘
                if x1 <= edge_margin and x2 <= edge_margin:
                    continue
                # 右边缘
                if x1 >= w - 1 - edge_margin and x2 >= w - 1 - edge_margin:
                    continue
                # 上边缘
                if y1 <= edge_margin and y2 <= edge_margin:
                    continue
                # 下边缘
                if y1 >= h - 1 - edge_margin and y2 >= h - 1 - edge_margin:
                    continue
                
                filtered_lines.append({
                    'x1': x1, 'y1': y1,
                    'x2': x2, 'y2': y2
                })
            
            lines = filtered_lines
        
        return {
            "success": True,
            "lines": lines,
            "width": w,
            "height": h,
            "method": "vtracer"
        }
        
    except Exception as e:
        return {"success": False, "error": str(e), "lines": [], "method": "vtracer"}

def parse_svg_to_lines(svg_content):
    """从 SVG 内容解析出线段"""
    import re
    lines = []
    
    # 解析 path 元素 - 更灵活的正则表达式
    # 匹配完整的 path 元素
    path_element_pattern = r'<path\s+([^>]*)/?>'
    
    for path_match in re.finditer(path_element_pattern, svg_content):
        attrs = path_match.group(1)
        
        # 提取 d 属性
        d_match = re.search(r'd="([^"]+)"', attrs)
        if not d_match:
            continue
        d = d_match.group(1)
        
        # 提取 transform 属性
        tx, ty = 0, 0
        transform_match = re.search(r'transform="translate\(([^)]+)\)"', attrs)
        if transform_match:
            transform_str = transform_match.group(1)
            transform_coords = [float(x) for x in re.findall(r'-?\d+\.?\d*', transform_str)]
            if len(transform_coords) >= 2:
                tx, ty = transform_coords[0], transform_coords[1]
            elif len(transform_coords) == 1:
                tx = transform_coords[0]
        
        # 解析路径
        path_lines = parse_path_to_lines(d)
        
        # 应用变换
        for line in path_lines:
            line["x1"] = int(line["x1"] + tx)
            line["y1"] = int(line["y1"] + ty)
            line["x2"] = int(line["x2"] + tx)
            line["y2"] = int(line["y2"] + ty)
        
        lines.extend(path_lines)
    
    # 解析 line 元素
    line_pattern = r'<line[^>]*x1="([^"]+)"[^>]*y1="([^"]+)"[^>]*x2="([^"]+)"[^>]*y2="([^"]+)"'
    for match in re.finditer(line_pattern, svg_content):
        try:
            x1, y1, x2, y2 = [float(m) for m in match.groups()]
            lines.append({"x1": int(x1), "y1": int(y1), "x2": int(x2), "y2": int(y2)})
        except:
            pass
    
    # 解析 polyline 元素
    polyline_pattern = r'<polyline[^>]*points="([^"]+)"'
    for match in re.finditer(polyline_pattern, svg_content):
        points_str = match.group(1)
        coords = [float(x) for x in re.findall(r'-?\d+\.?\d*', points_str)]
        for i in range(0, len(coords) - 3, 2):
            lines.append({
                "x1": int(coords[i]), "y1": int(coords[i+1]),
                "x2": int(coords[i+2]), "y2": int(coords[i+3])
            })
    
    return lines

def parse_path_to_lines(d):
    """将 SVG path 的 d 属性解析为线段
    
    支持的命令: M, m, L, l, H, h, V, v, Z, z, C, c, S, s, Q, q, T, t
    曲线命令会被线性化为多条线段
    """
    import re
    lines = []
    
    # 分割命令和参数
    # 匹配所有 SVG 路径命令
    cmd_pattern = r'([MmLlHhVvZzCcSsQqTtAa])([^MmLlHhVvZzCcSsQqTtAa]*)'
    commands = re.findall(cmd_pattern, d)
    
    current_x, current_y = 0, 0
    start_x, start_y = 0, 0
    last_control_x, last_control_y = 0, 0  # 用于 S/s 和 T/t 命令
    last_cmd = ''
    
    def bezier_point(t, p0, p1, p2, p3=None):
        """计算贝塞尔曲线上的点"""
        if p3 is None:
            # 二次贝塞尔
            return (1-t)**2 * p0 + 2*(1-t)*t * p1 + t**2 * p2
        else:
            # 三次贝塞尔
            return (1-t)**3 * p0 + 3*(1-t)**2*t * p1 + 3*(1-t)*t**2 * p2 + t**3 * p3
    
    def sample_bezier(x0, y0, x1, y1, x2, y2, x3=None, y3=None, segments=None):
        """将贝塞尔曲线采样为线段
        
        采样点数根据曲线长度自适应调整
        """
        # 估算曲线长度（使用控制点距离的和作为上界）
        if x3 is None:
            # 二次贝塞尔
            length = ((x1-x0)**2 + (y1-y0)**2)**0.5 + ((x2-x1)**2 + (y2-y1)**2)**0.5
        else:
            # 三次贝塞尔
            length = (((x1-x0)**2 + (y1-y0)**2)**0.5 + 
                     ((x2-x1)**2 + (y2-y1)**2)**0.5 + 
                     ((x3-x2)**2 + (y3-y2)**2)**0.5)
        
        # 根据长度决定采样点数（每 10 像素一个采样点，最少 2 个，最多 8 个）
        if segments is None:
            segments = max(2, min(8, int(length / 10)))
        
        result = []
        prev_x, prev_y = x0, y0
        for i in range(1, segments + 1):
            t = i / segments
            if x3 is None:
                # 二次贝塞尔
                new_x = bezier_point(t, x0, x1, x2)
                new_y = bezier_point(t, y0, y1, y2)
            else:
                # 三次贝塞尔
                new_x = bezier_point(t, x0, x1, x2, x3)
                new_y = bezier_point(t, y0, y1, y2, y3)
            
            # 只添加有效移动的线段
            int_prev_x, int_prev_y = int(prev_x), int(prev_y)
            int_new_x, int_new_y = int(new_x), int(new_y)
            if int_prev_x != int_new_x or int_prev_y != int_new_y:
                result.append({
                    "x1": int_prev_x, "y1": int_prev_y,
                    "x2": int_new_x, "y2": int_new_y
                })
            prev_x, prev_y = new_x, new_y
        return result
    
    for cmd, args in commands:
        coords = [float(x) for x in re.findall(r'-?\d+\.?\d*', args)]
        
        if cmd == 'M':
            # 绝对移动
            if len(coords) >= 2:
                current_x, current_y = coords[0], coords[1]
                start_x, start_y = current_x, current_y
                # M 后面如果有更多点，视为 L
                for i in range(2, len(coords) - 1, 2):
                    new_x, new_y = coords[i], coords[i + 1]
                    lines.append({
                        "x1": int(current_x), "y1": int(current_y),
                        "x2": int(new_x), "y2": int(new_y)
                    })
                    current_x, current_y = new_x, new_y
                    
        elif cmd == 'm':
            # 相对移动
            if len(coords) >= 2:
                current_x += coords[0]
                current_y += coords[1]
                start_x, start_y = current_x, current_y
                for i in range(2, len(coords) - 1, 2):
                    new_x = current_x + coords[i]
                    new_y = current_y + coords[i + 1]
                    lines.append({
                        "x1": int(current_x), "y1": int(current_y),
                        "x2": int(new_x), "y2": int(new_y)
                    })
                    current_x, current_y = new_x, new_y
                    
        elif cmd == 'L':
            # 绝对直线
            for i in range(0, len(coords) - 1, 2):
                new_x, new_y = coords[i], coords[i + 1]
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(new_x), "y2": int(new_y)
                })
                current_x, current_y = new_x, new_y
                
        elif cmd == 'l':
            # 相对直线
            for i in range(0, len(coords) - 1, 2):
                new_x = current_x + coords[i]
                new_y = current_y + coords[i + 1]
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(new_x), "y2": int(new_y)
                })
                current_x, current_y = new_x, new_y
                
        elif cmd == 'H':
            # 绝对水平线
            for x in coords:
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(x), "y2": int(current_y)
                })
                current_x = x
                
        elif cmd == 'h':
            # 相对水平线
            for dx in coords:
                new_x = current_x + dx
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(new_x), "y2": int(current_y)
                })
                current_x = new_x
                
        elif cmd == 'V':
            # 绝对垂直线
            for y in coords:
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(current_x), "y2": int(y)
                })
                current_y = y
                
        elif cmd == 'v':
            # 相对垂直线
            for dy in coords:
                new_y = current_y + dy
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(current_x), "y2": int(new_y)
                })
                current_y = new_y
                
        elif cmd == 'C':
            # 绝对三次贝塞尔曲线
            for i in range(0, len(coords) - 5, 6):
                x1, y1 = coords[i], coords[i + 1]
                x2, y2 = coords[i + 2], coords[i + 3]
                x3, y3 = coords[i + 4], coords[i + 5]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2, x3, y3))
                current_x, current_y = x3, y3
                last_control_x, last_control_y = x2, y2
                
        elif cmd == 'c':
            # 相对三次贝塞尔曲线
            for i in range(0, len(coords) - 5, 6):
                x1 = current_x + coords[i]
                y1 = current_y + coords[i + 1]
                x2 = current_x + coords[i + 2]
                y2 = current_y + coords[i + 3]
                x3 = current_x + coords[i + 4]
                y3 = current_y + coords[i + 5]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2, x3, y3))
                current_x, current_y = x3, y3
                last_control_x, last_control_y = x2, y2
                
        elif cmd == 'S':
            # 平滑三次贝塞尔 (反射控制点)
            for i in range(0, len(coords) - 3, 4):
                if last_cmd in ('C', 'c', 'S', 's'):
                    x1 = 2 * current_x - last_control_x
                    y1 = 2 * current_y - last_control_y
                else:
                    x1, y1 = current_x, current_y
                x2, y2 = coords[i], coords[i + 1]
                x3, y3 = coords[i + 2], coords[i + 3]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2, x3, y3))
                current_x, current_y = x3, y3
                last_control_x, last_control_y = x2, y2
                
        elif cmd == 's':
            # 相对平滑三次贝塞尔
            for i in range(0, len(coords) - 3, 4):
                if last_cmd in ('C', 'c', 'S', 's'):
                    x1 = 2 * current_x - last_control_x
                    y1 = 2 * current_y - last_control_y
                else:
                    x1, y1 = current_x, current_y
                x2 = current_x + coords[i]
                y2 = current_y + coords[i + 1]
                x3 = current_x + coords[i + 2]
                y3 = current_y + coords[i + 3]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2, x3, y3))
                current_x, current_y = x3, y3
                last_control_x, last_control_y = x2, y2
                
        elif cmd == 'Q':
            # 绝对二次贝塞尔曲线
            for i in range(0, len(coords) - 3, 4):
                x1, y1 = coords[i], coords[i + 1]
                x2, y2 = coords[i + 2], coords[i + 3]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2))
                current_x, current_y = x2, y2
                last_control_x, last_control_y = x1, y1
                
        elif cmd == 'q':
            # 相对二次贝塞尔曲线
            for i in range(0, len(coords) - 3, 4):
                x1 = current_x + coords[i]
                y1 = current_y + coords[i + 1]
                x2 = current_x + coords[i + 2]
                y2 = current_y + coords[i + 3]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2))
                current_x, current_y = x2, y2
                last_control_x, last_control_y = x1, y1
                
        elif cmd == 'T':
            # 平滑二次贝塞尔
            for i in range(0, len(coords) - 1, 2):
                if last_cmd in ('Q', 'q', 'T', 't'):
                    x1 = 2 * current_x - last_control_x
                    y1 = 2 * current_y - last_control_y
                else:
                    x1, y1 = current_x, current_y
                x2, y2 = coords[i], coords[i + 1]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2))
                current_x, current_y = x2, y2
                last_control_x, last_control_y = x1, y1
                
        elif cmd == 't':
            # 相对平滑二次贝塞尔
            for i in range(0, len(coords) - 1, 2):
                if last_cmd in ('Q', 'q', 'T', 't'):
                    x1 = 2 * current_x - last_control_x
                    y1 = 2 * current_y - last_control_y
                else:
                    x1, y1 = current_x, current_y
                x2 = current_x + coords[i]
                y2 = current_y + coords[i + 1]
                lines.extend(sample_bezier(current_x, current_y, x1, y1, x2, y2))
                current_x, current_y = x2, y2
                last_control_x, last_control_y = x1, y1
                
        elif cmd in ('Z', 'z'):
            # 闭合路径
            if current_x != start_x or current_y != start_y:
                lines.append({
                    "x1": int(current_x), "y1": int(current_y),
                    "x2": int(start_x), "y2": int(start_y)
                })
            current_x, current_y = start_x, start_y
        
        last_cmd = cmd
    
    return lines

def main():
    parser = argparse.ArgumentParser(description='Image to vector conversion')
    parser.add_argument('--mode', choices=['lines', 'svg'], default='lines',
                        help='Output mode: lines (JSON) or svg')
    parser.add_argument('--simplify', type=int, default=3,
                        help='Simplification level 1-5')
    parser.add_argument('--method', choices=['auto', 'starvector', 'opencv', 'vtracer', 'pil'], default='auto',
                        help='Vectorization method: auto, starvector (AI), opencv, vtracer, pil')
    parser.add_argument('--threshold', type=int, default=128,
                        help='Binary threshold for edge detection (0-255)')
    
    args = parser.parse_args()
    
    # 设置全局阈值 (传递给各个转换函数)
    global g_threshold
    g_threshold = args.threshold
    
    # 从标准输入读取图像数据
    image_data = sys.stdin.buffer.read()
    
    if not image_data:
        print(json.dumps({"success": False, "error": "No image data received", "lines": []}))
        sys.exit(1)
    
    result = None
    
    if args.method == 'starvector':
        # 强制使用 StarVector AI
        if check_starvector() or check_torch():
            result = convert_with_starvector(image_data, args.simplify)
            # 如果 StarVector 失败，尝试简化版本
            if not result.get("success", False):
                result_simple = convert_with_starvector_simple(image_data, args.simplify)
                if result_simple.get("success", False):
                    result = result_simple
        else:
            result = {
                "success": False, 
                "error": "StarVector requires PyTorch. Install with: pip install torch torchvision transformers starvector", 
                "lines": [],
                "method": "starvector"
            }
    elif args.method == 'auto':
        # 自动选择: StarVector > vtracer > opencv > PIL
        if check_starvector():
            result = convert_with_starvector(image_data, args.simplify)
            if not result.get("success", False):
                # StarVector 失败，回退
                if check_vtracer():
                    result = convert_with_vtracer(image_data, args.simplify)
                elif check_opencv():
                    result = convert_with_opencv(image_data, args.simplify)
                else:
                    result = convert_with_pil(image_data, args.simplify)
        elif check_vtracer():
            result = convert_with_vtracer(image_data, args.simplify)
        elif check_opencv():
            result = convert_with_opencv(image_data, args.simplify)
        else:
            result = convert_with_pil(image_data, args.simplify)
    elif args.method == 'vtracer':
        if check_vtracer():
            result = convert_with_vtracer(image_data, args.simplify)
        else:
            result = {"success": False, "error": "vtracer not installed. pip install vtracer", "lines": []}
    elif args.method == 'opencv':
        if check_opencv():
            result = convert_with_opencv(image_data, args.simplify)
        else:
            result = {"success": False, "error": "opencv not installed. pip install opencv-python numpy", "lines": []}
    elif args.method == 'pil':
        result = convert_with_pil(image_data, args.simplify)
    
    if result is None:
        result = {"success": False, "error": "No vectorization method available", "lines": []}
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
