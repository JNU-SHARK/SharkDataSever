/**
 * @file useCustomDataUnpacker.ts
 * @brief Vue 3 组合式 API 封装 - 自定义数据解包器
 * @description 提供响应式的数据解包和图片组装功能
 * @date 2025-12-03
 */

import { ref, reactive, computed, onUnmounted, Ref } from 'vue';
import {
  CustomDataUnpacker,
  CustomDataConfig,
  UnpackResult,
  ImageBlock,
  ImageCompleteEvent,
  createUnpacker,
  createUnpackerFromURL,
  PROTOCOL,
} from './CustomDataUnpacker.browser';

export interface UseCustomDataUnpackerOptions {
  /** XML 配置内容 */
  xmlContent?: string;
  /** XML 配置 URL */
  configUrl?: string;
  /** 是否自动组装图片 */
  autoAssembleImage?: boolean;
}

export interface ImageAssemblyState {
  imgId: number;
  received: number;
  total: number;
  progress: number;
}

export function useCustomDataUnpacker(options: UseCustomDataUnpackerOptions = {}) {
  // 状态
  const unpacker: Ref<CustomDataUnpacker | null> = ref(null);
  const isReady = ref(false);
  const error = ref<string | null>(null);
  const config = ref<CustomDataConfig | null>(null);

  // 最新数据
  const latestData = reactive<Record<string, any>>({});
  const latestImageBlock = ref<ImageBlock | null>(null);
  const latestResult = ref<UnpackResult | null>(null);

  // 图片组装状态
  const imageAssemblyStates = reactive<Map<number, ImageAssemblyState>>(new Map());
  const completedImages = reactive<Map<number, { data: Uint8Array; url: string; companionData?: Record<string, any> }>>(new Map());

  // 计算属性
  const hasImageBlock = computed(() => unpacker.value?.hasImageBlock() ?? false);
  const imageCompanionFields = computed(() => unpacker.value?.getImageCompanionFields() ?? []);
  const currentImageProgress = computed(() => {
    const states = Array.from(imageAssemblyStates.values());
    return states.length > 0 ? states[states.length - 1] : null;
  });

  // 初始化解包器
  async function initialize(xmlContentOrUrl?: string, isUrl = false): Promise<boolean> {
    try {
      error.value = null;
      isReady.value = false;

      const content = xmlContentOrUrl || options.xmlContent;
      const url = options.configUrl;

      if (isUrl && xmlContentOrUrl) {
        unpacker.value = await createUnpackerFromURL(xmlContentOrUrl);
      } else if (url) {
        unpacker.value = await createUnpackerFromURL(url);
      } else if (content) {
        unpacker.value = createUnpacker(content);
      } else {
        throw new Error('需要提供 xmlContent 或 configUrl');
      }

      config.value = unpacker.value.getConfig();

      // 设置回调
      unpacker.value.onImageComplete = handleImageComplete;
      unpacker.value.onImageProgress = handleImageProgress;

      isReady.value = true;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  // 处理图片完成
  function handleImageComplete(event: ImageCompleteEvent) {
    const { imgId, imageData, companionData } = event;
    
    // 创建 Blob URL
    const blob = new Blob([imageData], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);

    completedImages.set(imgId, { data: imageData, url, companionData });
    imageAssemblyStates.delete(imgId);
  }

  // 处理图片进度
  function handleImageProgress(imgId: number, received: number, total: number) {
    imageAssemblyStates.set(imgId, {
      imgId,
      received,
      total,
      progress: Math.round((received / total) * 100),
    });
  }

  // 解包完整帧
  function unpackFrame(frame: Uint8Array): UnpackResult {
    if (!unpacker.value) {
      return { success: false, error: '解包器未初始化' };
    }

    const result = unpacker.value.unpackFrame(frame);
    latestResult.value = result;

    if (result.success && result.data) {
      Object.assign(latestData, result.data);
      if (result.imageBlock) {
        latestImageBlock.value = result.imageBlock;
      }
    }

    return result;
  }

  // 解包数据区
  function unpackData(data: Uint8Array): UnpackResult {
    if (!unpacker.value) {
      return { success: false, error: '解包器未初始化' };
    }

    const result = unpacker.value.unpackData(data);
    latestResult.value = result;

    if (result.success && result.data) {
      Object.assign(latestData, result.data);
      if (result.imageBlock) {
        latestImageBlock.value = result.imageBlock;
      }
    }

    return result;
  }

  // 获取完成的图片
  function getCompletedImage(imgId: number) {
    return completedImages.get(imgId);
  }

  // 获取最新完成的图片
  function getLatestCompletedImage() {
    const ids = Array.from(completedImages.keys());
    if (ids.length === 0) return null;
    return completedImages.get(ids[ids.length - 1]);
  }

  // 释放图片资源
  function releaseImage(imgId: number) {
    const img = completedImages.get(imgId);
    if (img) {
      URL.revokeObjectURL(img.url);
      completedImages.delete(imgId);
    }
  }

  // 释放所有图片资源
  function releaseAllImages() {
    for (const img of completedImages.values()) {
      URL.revokeObjectURL(img.url);
    }
    completedImages.clear();
  }

  // 清理
  function cleanup() {
    releaseAllImages();
    unpacker.value?.clearImage();
    imageAssemblyStates.clear();
  }

  // 组件卸载时清理
  onUnmounted(() => {
    cleanup();
  });

  // 自动初始化
  if (options.xmlContent || options.configUrl) {
    initialize();
  }

  return {
    // 状态
    unpacker,
    isReady,
    error,
    config,
    
    // 数据
    latestData,
    latestImageBlock,
    latestResult,
    
    // 图片相关
    hasImageBlock,
    imageCompanionFields,
    imageAssemblyStates,
    currentImageProgress,
    completedImages,
    
    // 方法
    initialize,
    unpackFrame,
    unpackData,
    getCompletedImage,
    getLatestCompletedImage,
    releaseImage,
    releaseAllImages,
    cleanup,
    
    // 常量
    PROTOCOL,
  };
}

export type { CustomDataConfig, UnpackResult, ImageBlock, ImageCompleteEvent };
export { PROTOCOL };
