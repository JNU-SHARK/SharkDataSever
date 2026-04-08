# CustomDataUnpacker TypeScript SDK

适用于 Electron + Vue 客户端的自定义数据块解包器。

## 文件说明

| 文件 | 说明 | 适用环境 |
|------|------|----------|
| `CustomDataUnpacker.ts` | 完整版，支持文件系统 | Node.js / Electron 主进程 |
| `CustomDataUnpacker.browser.ts` | 浏览器版，无 fs 依赖 | 浏览器 / Vue 渲染进程 |
| `useCustomDataUnpacker.ts` | Vue 3 组合式 API 封装 | Vue 3 组件 |

## 快速开始

### 1. Vue 组件中使用 (推荐)

```vue
<template>
  <div class="data-viewer">
    <!-- 普通数据显示 -->
    <div v-if="isReady && !hasImageBlock">
      <h3>数据字段</h3>
      <div v-for="(value, key) in latestData" :key="key">
        {{ key }}: {{ value }}
      </div>
    </div>

    <!-- 图片显示 -->
    <div v-if="hasImageBlock">
      <h3>图片传输</h3>
      <div v-if="currentImageProgress">
        进度: {{ currentImageProgress.received }}/{{ currentImageProgress.total }}
        ({{ currentImageProgress.progress }}%)
      </div>
      <img v-if="getLatestCompletedImage()" :src="getLatestCompletedImage()?.url" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useCustomDataUnpacker } from '@/sdk/ts/useCustomDataUnpacker';

const {
  isReady,
  hasImageBlock,
  latestData,
  currentImageProgress,
  initialize,
  unpackData,
  getLatestCompletedImage,
} = useCustomDataUnpacker();

onMounted(async () => {
  // 从服务器加载配置
  await initialize('/api/config/infantry.xml', true);
});

// 处理接收到的数据 (例如从 WebSocket 或 MQTT)
function handleReceivedData(data: Uint8Array) {
  if (!isReady.value) return;
  
  const result = unpackData(data);
  if (result.success) {
    console.log('解包成功:', result.data);
    if (result.isImageFrame) {
      console.log('图片块:', result.imageBlock);
    }
  }
}

// 暴露给父组件
defineExpose({ handleReceivedData });
</script>
```

### 2. 纯 TypeScript 使用

```typescript
import { createUnpacker, CustomDataUnpacker } from './CustomDataUnpacker.browser';

// 从 XML 字符串创建
const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<CustomDataBlockConfig>
  <Metadata>
    <Name>infantry</Name>
    <TotalSize unit="bytes">133</TotalSize>
  </Metadata>
  <Fields count="3">
    <Field index="1">
      <Name>TestEnergy</Name>
      <Type>int32_t</Type>
      <ArraySize>1</ArraySize>
    </Field>
    <Field index="2">
      <Name>DetectFrame</Name>
      <Type>ImageBlock</Type>
      <ArraySize>1</ArraySize>
    </Field>
    <Field index="3">
      <Name>TsetDegree</Name>
      <Type>float</Type>
      <ArraySize>1</ArraySize>
    </Field>
  </Fields>
  <ImageCompanionFields>
    <Field>TsetDegree</Field>
  </ImageCompanionFields>
</CustomDataBlockConfig>`;

const unpacker = createUnpacker(xmlContent);

// 设置图片完成回调
unpacker.onImageComplete = (event) => {
  console.log(`图片 ${event.imgId} 组装完成, 大小: ${event.imageData.length}`);
  // 创建 Blob URL 显示图片
  const blob = new Blob([event.imageData], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  // document.getElementById('preview').src = url;
};

// 设置进度回调
unpacker.onImageProgress = (imgId, received, total) => {
  console.log(`图片 ${imgId}: ${received}/${total} (${Math.round(received/total*100)}%)`);
};

// 解包数据
function onDataReceived(data: Uint8Array) {
  const result = unpacker.unpackData(data);
  
  if (result.success) {
    if (result.isImageFrame) {
      // 图片帧 - 伴随数据在 result.data
      console.log('伴随数据:', result.data);
    } else {
      // 普通数据帧
      console.log('数据:', result.data);
    }
  }
}
```

### 3. Electron 主进程使用

```typescript
import { createUnpackerFromFile } from './CustomDataUnpacker';
import * as path from 'path';

// 从文件加载配置
const configPath = path.join(__dirname, 'configs', 'infantry.xml');
const unpacker = createUnpackerFromFile(configPath);

// 打印配置信息
console.log('配置名称:', unpacker.getConfig().metadata.name);
console.log('字段数量:', unpacker.getConfig().fields.length);
console.log('包含图片块:', unpacker.hasImageBlock());
```

## 协议说明

### 帧格式 (159 字节)

| 偏移 | 长度 | 说明 |
|------|------|------|
| 0 | 1 | SOF (0xA5) |
| 1-2 | 2 | 数据长度 (150) |
| 3 | 1 | 序列号 |
| 4 | 1 | CRC8 (前4字节) |
| 5-6 | 2 | CMD_ID (0x0310) |
| 7-156 | 150 | 数据区 |
| 157-158 | 2 | CRC16 (整帧) |

### 图片块格式 (128 字节)

| 偏移 | 长度 | 说明 |
|------|------|------|
| 0 | 1 | cmd_type (0x02=数据, 0x03=结束) |
| 1-2 | 2 | img_id (图片ID) |
| 3-4 | 2 | block_idx (块索引) |
| 5-6 | 2 | total_block (总块数) |
| 7 | 1 | data_len (有效数据长度 1-120) |
| 8-127 | 120 | data (图片数据) |

## API 参考

### CustomDataUnpacker

```typescript
class CustomDataUnpacker {
  // 获取配置
  getConfig(): CustomDataConfig;
  
  // 检查是否包含图片块
  hasImageBlock(): boolean;
  
  // 获取图片伴随字段
  getImageCompanionFields(): string[];
  
  // 解包完整帧 (159字节)
  unpackFrame(frame: Uint8Array): UnpackResult;
  
  // 解包数据区 (150字节)
  unpackData(data: Uint8Array): UnpackResult;
  
  // 手动处理图片块
  processImageBlock(block: ImageBlock, companionData?: Record<string, any>): Uint8Array | null;
  
  // 获取图片组装进度
  getImageProgress(imgId: number): { received: number; total: number } | null;
  
  // 清理图片组装状态
  clearImage(imgId?: number): void;
  
  // 回调
  onImageComplete?: (event: ImageCompleteEvent) => void;
  onImageProgress?: (imgId: number, received: number, total: number) => void;
}
```

### useCustomDataUnpacker (Vue 3)

```typescript
function useCustomDataUnpacker(options?: {
  xmlContent?: string;
  configUrl?: string;
}) {
  // 响应式状态
  isReady: Ref<boolean>;
  error: Ref<string | null>;
  config: Ref<CustomDataConfig | null>;
  latestData: Record<string, any>;
  latestImageBlock: Ref<ImageBlock | null>;
  hasImageBlock: ComputedRef<boolean>;
  currentImageProgress: ComputedRef<ImageAssemblyState | null>;
  completedImages: Map<number, { data: Uint8Array; url: string }>;
  
  // 方法
  initialize(xmlContentOrUrl?: string, isUrl?: boolean): Promise<boolean>;
  unpackFrame(frame: Uint8Array): UnpackResult;
  unpackData(data: Uint8Array): UnpackResult;
  getCompletedImage(imgId: number): { data: Uint8Array; url: string } | undefined;
  getLatestCompletedImage(): { data: Uint8Array; url: string } | null;
  releaseImage(imgId: number): void;
  cleanup(): void;
}
```

## 类型定义

```typescript
interface UnpackResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  imageBlock?: ImageBlock;
  isImageFrame?: boolean;
}

interface ImageBlock {
  cmdType: number;
  imgId: number;
  blockIdx: number;
  totalBlock: number;
  dataLen: number;
  data: Uint8Array;
}

interface FieldConfig {
  name: string;
  type: FieldType;
  arraySize: number;
  size: number;
  offset: number;
}

type FieldType = 
  | 'bool' 
  | 'int8_t' | 'uint8_t' | 'int8' | 'uint8'
  | 'int16_t' | 'uint16_t' | 'int16' | 'uint16'
  | 'int32_t' | 'uint32_t' | 'int32' | 'uint32'
  | 'float' | 'double'
  | 'ImageBlock' | 'image_block'
  | 'bytes';
```
