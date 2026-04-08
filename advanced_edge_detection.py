#!/usr/bin/env python3
"""
高级边缘检测工具
- 去除黄色区域（地面标记）
- 多尺度 Canny 边缘检测
- 亮度过滤（去除地面花纹）
- 轮廓大小过滤

使用方法:
    python3 advanced_edge_detection.py <image_path> [options]
    
参数:
    --brightness-threshold <int>    亮度阈值 (默认: 60)
    --min-contour-length <int>      最小轮廓长度 (默认: 25)
    --remove-yellow                 去除黄色区域
    --yellow-hue-min <int>          黄色色调最小值 (默认: 15)
    --yellow-hue-max <int>          黄色色调最大值 (默认: 35)
    --output-dir <path>             输出目录 (默认: 与输入图片同目录)
"""

import cv2
import numpy as np
import os
import sys
import argparse


class AdvancedEdgeDetector:
    def __init__(self, brightness_threshold=60, min_contour_length=25,
                 remove_yellow=True, yellow_hue_range=(15, 35),
                 use_hed=False, hed_model_dir=None):
        """
        初始化边缘检测器
        
        Args:
            brightness_threshold: 亮度阈值，低于此值的区域会被过滤
            min_contour_length: 最小轮廓周长，小于此值的轮廓会被过滤
            remove_yellow: 是否去除黄色区域
            yellow_hue_range: 黄色 Hue 范围 (min, max)
            use_hed: 是否使用 HED 深度学习模型
            hed_model_dir: HED 模型文件目录
        """
        self.brightness_threshold = brightness_threshold
        self.min_contour_length = min_contour_length
        self.remove_yellow = remove_yellow
        self.yellow_hue_range = yellow_hue_range
        self.use_hed = use_hed
        self.hed_net = None
        
        # 加载 HED 模型
        if use_hed:
            if hed_model_dir is None:
                hed_model_dir = os.path.join(os.path.dirname(__file__), 'models')
            self._load_hed_model(hed_model_dir)
    
    def _load_hed_model(self, model_dir):
        """加载 HED 深度学习模型"""
        prototxt_path = os.path.join(model_dir, 'hed_deploy.prototxt')
        caffemodel_path = os.path.join(model_dir, 'hed_pretrained_bsds.caffemodel')
        
        if not os.path.exists(prototxt_path):
            print(f"警告: HED prototxt 不存在: {prototxt_path}")
            self.use_hed = False
            return
        
        if not os.path.exists(caffemodel_path):
            print(f"警告: HED caffemodel 不存在: {caffemodel_path}")
            self.use_hed = False
            return
        
        try:
            self.hed_net = cv2.dnn.readNetFromCaffe(prototxt_path, caffemodel_path)
            print(f"✓ HED 模型加载成功")
        except Exception as e:
            print(f"警告: HED 模型加载失败: {e}")
            self.use_hed = False
        
    def remove_yellow_regions(self, img):
        """
        去除图像中的黄色区域
        
        Args:
            img: BGR 图像
            
        Returns:
            处理后的图像, 黄色掩码
        """
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # 黄色范围
        lower_yellow = np.array([self.yellow_hue_range[0], 50, 50])
        upper_yellow = np.array([self.yellow_hue_range[1], 255, 255])
        
        # 创建黄色掩码
        yellow_mask = cv2.inRange(hsv, lower_yellow, upper_yellow)
        
        # 膨胀掩码，确保完全覆盖黄色边缘
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        yellow_mask_dilated = cv2.dilate(yellow_mask, kernel, iterations=2)
        
        # 使用 inpaint 修复黄色区域
        img_no_yellow = cv2.inpaint(img, yellow_mask_dilated, 3, cv2.INPAINT_TELEA)
        
        return img_no_yellow, yellow_mask_dilated
    
    def hed_edge_detection(self, img):
        """
        HED 深度学习边缘检测
        
        Args:
            img: BGR 图像
            
        Returns:
            边缘图像 (0-255)
        """
        if not self.use_hed or self.hed_net is None:
            return None
        
        h, w = img.shape[:2]
        
        # 为了加速，如果图片太大就缩小
        scale = 1.0
        if max(h, w) > 800:
            scale = 800 / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            img_resized = cv2.resize(img, (new_w, new_h))
        else:
            img_resized = img
            new_w, new_h = w, h
        
        # HED 推理
        blob = cv2.dnn.blobFromImage(img_resized, scalefactor=1.0, size=(new_w, new_h),
                                      mean=(104.00698793, 116.66876762, 122.67891434),
                                      swapRB=False, crop=False)
        
        self.hed_net.setInput(blob)
        output = self.hed_net.forward()
        
        # 后处理
        edge = output[0, 0]
        edge = (255 * edge).astype(np.uint8)
        
        # 如果缩小了，放大回原始尺寸
        if scale < 1.0:
            edge = cv2.resize(edge, (w, h))
        
        return edge
    
    def multiscale_canny(self, gray):
        """
        多尺度 Canny 边缘检测
        
        Args:
            gray: 灰度图像
            
        Returns:
            边缘图像
        """
        # 双边滤波去噪
        denoised = cv2.bilateralFilter(gray, 9, 75, 75)
        
        # 多尺度 Canny
        edges1 = cv2.Canny(cv2.GaussianBlur(denoised, (3, 3), 0), 50, 150)
        edges2 = cv2.Canny(cv2.GaussianBlur(denoised, (5, 5), 0), 30, 100)
        edges3 = cv2.Canny(cv2.GaussianBlur(denoised, (7, 7), 0), 20, 80)
        
        # 融合多尺度结果
        multi_scale = np.maximum(np.maximum(edges1, edges2), edges3)
        
        return multi_scale
    
    def filter_by_brightness(self, edges, gray):
        """
        根据亮度过滤边缘（去除暗区域如地面）
        
        Args:
            edges: 边缘图像
            gray: 灰度图像
            
        Returns:
            过滤后的边缘图像
        """
        # 创建亮度掩码
        bright_mask = (gray > self.brightness_threshold).astype(np.uint8) * 255
        
        # 膨胀掩码
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        bright_mask_dilated = cv2.dilate(bright_mask, kernel, iterations=2)
        
        # 应用掩码
        edges_filtered = cv2.bitwise_and(edges, bright_mask_dilated)
        
        return edges_filtered, bright_mask_dilated
    
    def filter_small_contours(self, edges):
        """
        过滤小轮廓
        
        Args:
            edges: 边缘图像
            
        Returns:
            过滤后的边缘图像, 保留的轮廓列表
        """
        # 找到所有轮廓
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        
        # 创建新图像，只绘制大轮廓
        edges_filtered = np.zeros_like(edges)
        large_contours = [c for c in contours if cv2.arcLength(c, False) > self.min_contour_length]
        cv2.drawContours(edges_filtered, large_contours, -1, 255, 1)
        
        return edges_filtered, large_contours
    
    def detect_edges(self, img):
        """
        完整的边缘检测流程
        
        Args:
            img: BGR 图像
            
        Returns:
            dict 包含所有中间结果和最终结果
        """
        results = {}
        h, w = img.shape[:2]
        
        # 1. 去除黄色（可选）
        if self.remove_yellow:
            img_processed, yellow_mask = self.remove_yellow_regions(img)
            yellow_pixels = np.sum(yellow_mask > 0)
            results['yellow_mask'] = yellow_mask
            results['yellow_percentage'] = yellow_pixels * 100 / (h * w)
            results['preprocessed'] = img_processed
        else:
            img_processed = img
            results['preprocessed'] = img
        
        # 2. 转灰度
        gray = cv2.cvtColor(img_processed, cv2.COLOR_BGR2GRAY)
        
        # 3. 边缘检测 (HED 或多尺度 Canny)
        if self.use_hed:
            edges = self.hed_edge_detection(img_processed)
            if edges is not None:
                # HED 输出是灰度边缘，需要二值化
                _, edges_binary = cv2.threshold(edges, 50, 255, cv2.THRESH_BINARY)
                results['hed_edges'] = edges
                edges = edges_binary
                results['method'] = 'HED'
            else:
                # HED 失败，回退到 Canny
                edges = self.multiscale_canny(gray)
                results['method'] = 'Canny (HED failed)'
        else:
            edges = self.multiscale_canny(gray)
            results['method'] = 'Canny'
        
        results['multiscale_edges'] = edges
        
        # 4. 亮度过滤
        edges_bright, bright_mask = self.filter_by_brightness(edges, gray)
        results['brightness_filtered'] = edges_bright
        results['bright_mask'] = bright_mask
        
        # 5. 轮廓大小过滤
        edges_final, contours = self.filter_small_contours(edges_bright)
        results['final_edges'] = edges_final
        results['contours'] = contours
        results['contour_count'] = len(contours)
        
        return results
    
    def process_image(self, image_path, output_dir=None, save_debug=True):
        """
        处理图像文件
        
        Args:
            image_path: 输入图像路径
            output_dir: 输出目录
            save_debug: 是否保存调试文件
            
        Returns:
            results dict
        """
        # 读取图像
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError(f"无法读取图像: {image_path}")
        
        h, w = img.shape[:2]
        print(f"图像尺寸: {w}x{h}")
        
        # 设置输出目录
        if output_dir is None:
            output_dir = os.path.dirname(image_path) or '.'
        os.makedirs(output_dir, exist_ok=True)
        
        base_name = os.path.splitext(os.path.basename(image_path))[0]
        
        # 执行边缘检测
        print("\n开始边缘检测...")
        results = self.detect_edges(img)
        
        # 保存结果
        print("\n保存结果...")
        
        # 主要结果
        final_path = os.path.join(output_dir, f'{base_name}_edges_final.png')
        cv2.imwrite(final_path, results['final_edges'])
        print(f"✓ 最终边缘: {final_path}")
        
        multiscale_path = os.path.join(output_dir, f'{base_name}_edges_multiscale.png')
        cv2.imwrite(multiscale_path, results['multiscale_edges'])
        print(f"  多尺度边缘: {multiscale_path}")
        
        # 调试文件
        if save_debug:
            if self.remove_yellow and 'yellow_mask' in results:
                yellow_mask_path = os.path.join(output_dir, f'{base_name}_debug_yellow_mask.png')
                cv2.imwrite(yellow_mask_path, results['yellow_mask'])
                print(f"  黄色掩码: {yellow_mask_path}")
                
                preprocessed_path = os.path.join(output_dir, f'{base_name}_preprocessed.png')
                cv2.imwrite(preprocessed_path, results['preprocessed'])
                print(f"  预处理图像: {preprocessed_path}")
            
            bright_mask_path = os.path.join(output_dir, f'{base_name}_debug_bright_mask.png')
            cv2.imwrite(bright_mask_path, results['bright_mask'])
            print(f"  亮度掩码: {bright_mask_path}")
        
        # 保存 HED 软边缘
        if self.use_hed and 'hed_edges' in results:
            hed_soft_path = os.path.join(output_dir, f'{base_name}_HED_soft.png')
            cv2.imwrite(hed_soft_path, results['hed_edges'])
            print(f"  HED 软边缘: {hed_soft_path}")
        
        # 打印统计信息
        print("\n========== 统计信息 ==========")
        print(f"检测方法: {results.get('method', 'Canny')}")
        if self.remove_yellow and 'yellow_percentage' in results:
            print(f"黄色像素: {results['yellow_percentage']:.2f}%")
        print(f"检测到轮廓: {results['contour_count']} 个")
        edge_pixels = np.sum(results['final_edges'] > 0)
        print(f"边缘像素: {edge_pixels} ({edge_pixels*100/(h*w):.2f}%)")
        
        return results


def main():
    parser = argparse.ArgumentParser(
        description='高级边缘检测工具 - 去除地面花纹和黄色标记',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    # 基本用法
    python3 advanced_edge_detection.py test.png
    
    # 不去除黄色
    python3 advanced_edge_detection.py test.png --no-remove-yellow
    
    # 调整参数
    python3 advanced_edge_detection.py test.png --brightness-threshold 80 --min-contour-length 30
    
    # 指定输出目录
    python3 advanced_edge_detection.py test.png --output-dir ./output
        """
    )
    
    parser.add_argument('image', help='输入图像路径')
    parser.add_argument('--brightness-threshold', type=int, default=60,
                        help='亮度阈值 (默认: 60)')
    parser.add_argument('--min-contour-length', type=int, default=25,
                        help='最小轮廓长度 (默认: 25)')
    parser.add_argument('--no-remove-yellow', action='store_true',
                        help='不去除黄色区域')
    parser.add_argument('--yellow-hue-min', type=int, default=15,
                        help='黄色 Hue 最小值 (默认: 15)')
    parser.add_argument('--yellow-hue-max', type=int, default=35,
                        help='黄色 Hue 最大值 (默认: 35)')
    parser.add_argument('--output-dir', type=str, default=None,
                        help='输出目录 (默认: 与输入图片同目录)')
    parser.add_argument('--no-debug', action='store_true',
                        help='不保存调试文件')
    parser.add_argument('--use-hed', action='store_true',
                        help='使用 HED 深度学习边缘检测模型')
    parser.add_argument('--hed-model-dir', type=str, default=None,
                        help='HED 模型文件目录 (默认: ./models)')
    
    args = parser.parse_args()
    
    # 创建检测器
    detector = AdvancedEdgeDetector(
        brightness_threshold=args.brightness_threshold,
        min_contour_length=args.min_contour_length,
        remove_yellow=not args.no_remove_yellow,
        yellow_hue_range=(args.yellow_hue_min, args.yellow_hue_max),
        use_hed=args.use_hed,
        hed_model_dir=args.hed_model_dir
    )
    
    # 处理图像
    try:
        detector.process_image(
            args.image,
            output_dir=args.output_dir,
            save_debug=not args.no_debug
        )
        print("\n✓ 完成!")
    except Exception as e:
        print(f"\n✗ 错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
