/**
 * @file CustomDataUnpacker.browser.ts
 * @brief 自定义数据块解包器 - 浏览器/Vue 版本 (无 Node.js 依赖)
 * @description 从 XML 配置字符串读取数据结构，解包自定义数据帧
 * @date 2025-12-03
 */

// ==================== 类型定义 ====================

/** 支持的数据类型 */
export type FieldType = 
  | 'bool' 
  | 'int8_t' | 'uint8_t' | 'int8' | 'uint8'
  | 'int16_t' | 'uint16_t' | 'int16' | 'uint16'
  | 'int32_t' | 'uint32_t' | 'int32' | 'uint32'
  | 'float' | 'double'
  | 'ImageBlock' | 'image_block'
  | 'bytes';

/** 字段配置 */
export interface FieldConfig {
  name: string;
  type: FieldType;
  arraySize: number;
  size: number;
  offset: number;
}

/** 图片块结构 (128字节) */
export interface ImageBlock {
  cmdType: number;
  imgId: number;
  blockIdx: number;
  totalBlock: number;
  dataLen: number;
  data: Uint8Array;
}

/** 配置元数据 */
export interface ConfigMetadata {
  name: string;
  description: string;
  createdAt: string;
  totalSize: number;
}

/** 完整配置 */
export interface CustomDataConfig {
  metadata: ConfigMetadata;
  fields: FieldConfig[];
  imageCompanionFields: string[];
}

/** 解包结果 */
export interface UnpackResult {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  imageBlock?: ImageBlock;
  isImageFrame?: boolean;
}

/** 图片组装完成事件 */
export interface ImageCompleteEvent {
  imgId: number;
  imageData: Uint8Array;
  companionData?: Record<string, any>;
}

/** 帧协议常量 */
export const PROTOCOL = {
  SOF: 0xA5,
  CMD_ID: 0x0310,
  DATA_SIZE: 150,
  FRAME_SIZE: 159,
  IMAGE_BLOCK_SIZE: 128,
  IMAGE_DATA_SIZE: 120,
  IMAGE_CMD_DATA: 0x02,
  IMAGE_CMD_END: 0x03,
} as const;

// ==================== CRC 校验 ====================

const CRC8_TABLE = new Uint8Array([
  0x00, 0x5e, 0xbc, 0xe2, 0x61, 0x3f, 0xdd, 0x83, 0xc2, 0x9c, 0x7e, 0x20, 0xa3, 0xfd, 0x1f, 0x41,
  0x9d, 0xc3, 0x21, 0x7f, 0xfc, 0xa2, 0x40, 0x1e, 0x5f, 0x01, 0xe3, 0xbd, 0x3e, 0x60, 0x82, 0xdc,
  0x23, 0x7d, 0x9f, 0xc1, 0x42, 0x1c, 0xfe, 0xa0, 0xe1, 0xbf, 0x5d, 0x03, 0x80, 0xde, 0x3c, 0x62,
  0xbe, 0xe0, 0x02, 0x5c, 0xdf, 0x81, 0x63, 0x3d, 0x7c, 0x22, 0xc0, 0x9e, 0x1d, 0x43, 0xa1, 0xff,
  0x46, 0x18, 0xfa, 0xa4, 0x27, 0x79, 0x9b, 0xc5, 0x84, 0xda, 0x38, 0x66, 0xe5, 0xbb, 0x59, 0x07,
  0xdb, 0x85, 0x67, 0x39, 0xba, 0xe4, 0x06, 0x58, 0x19, 0x47, 0xa5, 0xfb, 0x78, 0x26, 0xc4, 0x9a,
  0x65, 0x3b, 0xd9, 0x87, 0x04, 0x5a, 0xb8, 0xe6, 0xa7, 0xf9, 0x1b, 0x45, 0xc6, 0x98, 0x7a, 0x24,
  0xf8, 0xa6, 0x44, 0x1a, 0x99, 0xc7, 0x25, 0x7b, 0x3a, 0x64, 0x86, 0xd8, 0x5b, 0x05, 0xe7, 0xb9,
  0x8c, 0xd2, 0x30, 0x6e, 0xed, 0xb3, 0x51, 0x0f, 0x4e, 0x10, 0xf2, 0xac, 0x2f, 0x71, 0x93, 0xcd,
  0x11, 0x4f, 0xad, 0xf3, 0x70, 0x2e, 0xcc, 0x92, 0xd3, 0x8d, 0x6f, 0x31, 0xb2, 0xec, 0x0e, 0x50,
  0xaf, 0xf1, 0x13, 0x4d, 0xce, 0x90, 0x72, 0x2c, 0x6d, 0x33, 0xd1, 0x8f, 0x0c, 0x52, 0xb0, 0xee,
  0x32, 0x6c, 0x8e, 0xd0, 0x53, 0x0d, 0xef, 0xb1, 0xf0, 0xae, 0x4c, 0x12, 0x91, 0xcf, 0x2d, 0x73,
  0xca, 0x94, 0x76, 0x28, 0xab, 0xf5, 0x17, 0x49, 0x08, 0x56, 0xb4, 0xea, 0x69, 0x37, 0xd5, 0x8b,
  0x57, 0x09, 0xeb, 0xb5, 0x36, 0x68, 0x8a, 0xd4, 0x95, 0xcb, 0x29, 0x77, 0xf4, 0xaa, 0x48, 0x16,
  0xe9, 0xb7, 0x55, 0x0b, 0x88, 0xd6, 0x34, 0x6a, 0x2b, 0x75, 0x97, 0xc9, 0x4a, 0x14, 0xf6, 0xa8,
  0x74, 0x2a, 0xc8, 0x96, 0x15, 0x4b, 0xa9, 0xf7, 0xb6, 0xe8, 0x0a, 0x54, 0xd7, 0x89, 0x6b, 0x35,
]);

const CRC16_TABLE = new Uint16Array([
  0x0000, 0x1189, 0x2312, 0x329b, 0x4624, 0x57ad, 0x6536, 0x74bf,
  0x8c48, 0x9dc1, 0xaf5a, 0xbed3, 0xca6c, 0xdbe5, 0xe97e, 0xf8f7,
  0x1081, 0x0108, 0x3393, 0x221a, 0x56a5, 0x472c, 0x75b7, 0x643e,
  0x9cc9, 0x8d40, 0xbfdb, 0xae52, 0xdaed, 0xcb64, 0xf9ff, 0xe876,
  0x2102, 0x308b, 0x0210, 0x1399, 0x6726, 0x76af, 0x4434, 0x55bd,
  0xad4a, 0xbcc3, 0x8e58, 0x9fd1, 0xeb6e, 0xfae7, 0xc87c, 0xd9f5,
  0x3183, 0x200a, 0x1291, 0x0318, 0x77a7, 0x662e, 0x54b5, 0x453c,
  0xbdcb, 0xac42, 0x9ed9, 0x8f50, 0xfbef, 0xea66, 0xd8fd, 0xc974,
  0x4204, 0x538d, 0x6116, 0x709f, 0x0420, 0x15a9, 0x2732, 0x36bb,
  0xce4c, 0xdfc5, 0xed5e, 0xfcd7, 0x8868, 0x99e1, 0xab7a, 0xbaf3,
  0x5285, 0x430c, 0x7197, 0x601e, 0x14a1, 0x0528, 0x37b3, 0x263a,
  0xdecd, 0xcf44, 0xfddf, 0xec56, 0x98e9, 0x8960, 0xbbfb, 0xaa72,
  0x6306, 0x728f, 0x4014, 0x519d, 0x2522, 0x34ab, 0x0630, 0x17b9,
  0xef4e, 0xfec7, 0xcc5c, 0xddd5, 0xa96a, 0xb8e3, 0x8a78, 0x9bf1,
  0x7387, 0x620e, 0x5095, 0x411c, 0x35a3, 0x242a, 0x16b1, 0x0738,
  0xffcf, 0xee46, 0xdcdd, 0xcd54, 0xb9eb, 0xa862, 0x9af9, 0x8b70,
  0x8408, 0x9581, 0xa71a, 0xb693, 0xc22c, 0xd3a5, 0xe13e, 0xf0b7,
  0x0840, 0x19c9, 0x2b52, 0x3adb, 0x4e64, 0x5fed, 0x6d76, 0x7cff,
  0x9489, 0x8500, 0xb79b, 0xa612, 0xd2ad, 0xc324, 0xf1bf, 0xe036,
  0x18c1, 0x0948, 0x3bd3, 0x2a5a, 0x5ee5, 0x4f6c, 0x7df7, 0x6c7e,
  0xa50a, 0xb483, 0x8618, 0x9791, 0xe32e, 0xf2a7, 0xc03c, 0xd1b5,
  0x2942, 0x38cb, 0x0a50, 0x1bd9, 0x6f66, 0x7eef, 0x4c74, 0x5dfd,
  0xb58b, 0xa402, 0x9699, 0x8710, 0xf3af, 0xe226, 0xd0bd, 0xc134,
  0x39c3, 0x284a, 0x1ad1, 0x0b58, 0x7fe7, 0x6e6e, 0x5cf5, 0x4d7c,
  0xc60c, 0xd785, 0xe51e, 0xf497, 0x8028, 0x91a1, 0xa33a, 0xb2b3,
  0x4a44, 0x5bcd, 0x6956, 0x78df, 0x0c60, 0x1de9, 0x2f72, 0x3efb,
  0xd68d, 0xc704, 0xf59f, 0xe416, 0x90a9, 0x8120, 0xb3bb, 0xa232,
  0x5ac5, 0x4b4c, 0x79d7, 0x685e, 0x1ce1, 0x0d68, 0x3ff3, 0x2e7a,
  0xe70e, 0xf687, 0xc41c, 0xd595, 0xa12a, 0xb0a3, 0x8238, 0x93b1,
  0x6b46, 0x7acf, 0x4854, 0x59dd, 0x2d62, 0x3ceb, 0x0e70, 0x1ff9,
  0xf78f, 0xe606, 0xd49d, 0xc514, 0xb1ab, 0xa022, 0x92b9, 0x8330,
  0x7bc7, 0x6a4e, 0x58d5, 0x495c, 0x3de3, 0x2c6a, 0x1ef1, 0x0f78,
]);

export function calculateCRC8(data: Uint8Array, length: number): number {
  let crc = 0xFF;
  for (let i = 0; i < length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

export function calculateCRC16(data: Uint8Array, length: number): number {
  let crc = 0xFFFF;
  for (let i = 0; i < length; i++) {
    crc = ((crc >> 8) ^ CRC16_TABLE[(crc ^ data[i]) & 0xFF]) & 0xFFFF;
  }
  return crc;
}

// ==================== 工具函数 ====================

export function getTypeSize(type: FieldType, customSize: number = 0): number {
  const sizes: Record<string, number> = {
    'bool': 1,
    'int8_t': 1, 'uint8_t': 1, 'int8': 1, 'uint8': 1,
    'int16_t': 2, 'uint16_t': 2, 'int16': 2, 'uint16': 2,
    'int32_t': 4, 'uint32_t': 4, 'int32': 4, 'uint32': 4,
    'float': 4, 'double': 8,
    'ImageBlock': 128, 'image_block': 128,
    'bytes': customSize,
  };
  return sizes[type] || 0;
}

export function isImageBlockType(type: FieldType): boolean {
  return type === 'ImageBlock' || type === 'image_block';
}

// ==================== XML 解析 ====================

export function parseXMLConfig(xmlContent: string): CustomDataConfig {
  const config: CustomDataConfig = {
    metadata: { name: '', description: '', createdAt: '', totalSize: 0 },
    fields: [],
    imageCompanionFields: [],
  };

  // 解析元数据
  config.metadata.name = xmlContent.match(/<Name>([^<]*)<\/Name>/)?.[1] || '';
  config.metadata.description = xmlContent.match(/<Description>([^<]*)<\/Description>/)?.[1] || '';
  config.metadata.createdAt = xmlContent.match(/<CreatedAt>([^<]*)<\/CreatedAt>/)?.[1] || '';
  config.metadata.totalSize = parseInt(xmlContent.match(/<TotalSize[^>]*>(\d+)<\/TotalSize>/)?.[1] || '0', 10);

  // 解析图片伴随字段
  const companionBlock = xmlContent.match(/<ImageCompanionFields>([\s\S]*?)<\/ImageCompanionFields>/);
  if (companionBlock) {
    const matches = companionBlock[1].matchAll(/<Field>([^<]*)<\/Field>/g);
    for (const m of matches) {
      config.imageCompanionFields.push(m[1]);
    }
  }

  // 解析字段
  const fieldsBlock = xmlContent.match(/<Fields[^>]*>([\s\S]*?)<\/Fields>/);
  if (fieldsBlock) {
    const fieldRegex = /<Field[^>]*>([\s\S]*?)<\/Field>/g;
    let match;
    let offset = 0;

    while ((match = fieldRegex.exec(fieldsBlock[1])) !== null) {
      const content = match[1];
      const name = content.match(/<Name>([^<]*)<\/Name>/)?.[1] || '';
      const type = (content.match(/<Type>([^<]*)<\/Type>/)?.[1] || 'uint8') as FieldType;
      const arraySize = parseInt(content.match(/<ArraySize>([^<]*)<\/ArraySize>/)?.[1] || '1', 10);
      const size = parseInt(content.match(/<Size[^>]*>(\d+)<\/Size>/)?.[1] || '0', 10);

      config.fields.push({ name, type, arraySize, size, offset });
      offset += getTypeSize(type, size) * arraySize;
    }
  }

  return config;
}

// ==================== 解包器类 ====================

export class CustomDataUnpacker {
  private config: CustomDataConfig;
  private imageAssembler = new Map<number, {
    blocks: Map<number, Uint8Array>;
    totalBlocks: number;
    companionData?: Record<string, any>;
  }>();

  // 事件回调
  public onImageComplete?: (event: ImageCompleteEvent) => void;
  public onImageProgress?: (imgId: number, received: number, total: number) => void;

  constructor(config: CustomDataConfig) {
    this.config = config;
  }

  /** 获取配置 */
  getConfig(): CustomDataConfig {
    return this.config;
  }

  /** 是否包含图片块 */
  hasImageBlock(): boolean {
    return this.config.fields.some(f => isImageBlockType(f.type));
  }

  /** 获取图片伴随字段 */
  getImageCompanionFields(): string[] {
    return this.config.imageCompanionFields;
  }

  /** 解包完整帧 (159字节) */
  unpackFrame(frame: Uint8Array): UnpackResult {
    if (frame.length < PROTOCOL.FRAME_SIZE) {
      return { success: false, error: `帧长度不足: ${frame.length}` };
    }

    if (frame[0] !== PROTOCOL.SOF) {
      return { success: false, error: `帧头错误: 0x${frame[0].toString(16)}` };
    }

    // CRC8 校验
    const crc8 = frame[4];
    if (crc8 !== calculateCRC8(frame, 4)) {
      return { success: false, error: 'CRC8校验失败' };
    }

    // CMD_ID
    const cmdId = frame[5] | (frame[6] << 8);
    if (cmdId !== PROTOCOL.CMD_ID) {
      return { success: false, error: `CMD_ID错误: 0x${cmdId.toString(16)}` };
    }

    // CRC16 校验
    const dataLen = frame[1] | (frame[2] << 8);
    const frameLen = 5 + 2 + dataLen;
    const crc16 = frame[frameLen] | (frame[frameLen + 1] << 8);
    if (crc16 !== calculateCRC16(frame, frameLen)) {
      return { success: false, error: 'CRC16校验失败' };
    }

    return this.unpackData(frame.slice(7, 7 + PROTOCOL.DATA_SIZE));
  }

  /** 解包数据区 (150字节) */
  unpackData(data: Uint8Array): UnpackResult {
    if (data.length < PROTOCOL.DATA_SIZE) {
      return { success: false, error: `数据长度不足: ${data.length}` };
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // 有图片块时
    if (this.hasImageBlock()) {
      const imageField = this.config.fields.find(f => isImageBlockType(f.type));
      if (imageField) {
        const imageBlock = this.parseImageBlock(data.slice(imageField.offset, imageField.offset + PROTOCOL.IMAGE_BLOCK_SIZE));
        
        // 解析伴随字段
        const companionData: Record<string, any> = {};
        let offset = PROTOCOL.IMAGE_BLOCK_SIZE;
        
        for (const fieldName of this.config.imageCompanionFields) {
          const field = this.config.fields.find(f => f.name === fieldName);
          if (field) {
            companionData[field.name] = this.readValue(view, offset, field.type, field.size);
            offset += getTypeSize(field.type, field.size);
          }
        }

        // 自动组装图片
        this.processImageBlock(imageBlock, companionData);

        return { success: true, data: companionData, imageBlock, isImageFrame: true };
      }
    }

    // 普通数据帧
    const result: Record<string, any> = {};
    for (const field of this.config.fields) {
      if (isImageBlockType(field.type)) continue;
      
      if (field.arraySize > 1) {
        const arr: any[] = [];
        let off = field.offset;
        const size = getTypeSize(field.type, field.size);
        for (let i = 0; i < field.arraySize; i++) {
          arr.push(this.readValue(view, off, field.type, field.size));
          off += size;
        }
        result[field.name] = arr;
      } else {
        result[field.name] = this.readValue(view, field.offset, field.type, field.size);
      }
    }

    return { success: true, data: result, isImageFrame: false };
  }

  /** 解析图片块 */
  private parseImageBlock(data: Uint8Array): ImageBlock {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
      cmdType: view.getUint8(0),
      imgId: view.getUint16(1, true),
      blockIdx: view.getUint16(3, true),
      totalBlock: view.getUint16(5, true),
      dataLen: view.getUint8(7),
      data: data.slice(8, 8 + PROTOCOL.IMAGE_DATA_SIZE),
    };
  }

  /** 读取字段值 */
  private readValue(view: DataView, offset: number, type: FieldType, size: number = 0): any {
    try {
      switch (type) {
        case 'bool': return view.getUint8(offset) !== 0;
        case 'int8_t': case 'int8': return view.getInt8(offset);
        case 'uint8_t': case 'uint8': return view.getUint8(offset);
        case 'int16_t': case 'int16': return view.getInt16(offset, true);
        case 'uint16_t': case 'uint16': return view.getUint16(offset, true);
        case 'int32_t': case 'int32': return view.getInt32(offset, true);
        case 'uint32_t': case 'uint32': return view.getUint32(offset, true);
        case 'float': return view.getFloat32(offset, true);
        case 'double': return view.getFloat64(offset, true);
        case 'bytes': return new Uint8Array(view.buffer, view.byteOffset + offset, size);
        default: return null;
      }
    } catch { return null; }
  }

  /** 处理图片块，组装完整图片 */
  processImageBlock(block: ImageBlock, companionData?: Record<string, any>): Uint8Array | null {
    const { imgId, blockIdx, totalBlock, dataLen, data, cmdType } = block;

    if (!this.imageAssembler.has(imgId)) {
      this.imageAssembler.set(imgId, { blocks: new Map(), totalBlocks: totalBlock, companionData });
    }

    const asm = this.imageAssembler.get(imgId)!;
    asm.blocks.set(blockIdx, data.slice(0, dataLen));

    // 触发进度回调
    this.onImageProgress?.(imgId, asm.blocks.size, totalBlock);

    // 检查是否完成
    if (cmdType === PROTOCOL.IMAGE_CMD_END || asm.blocks.size >= totalBlock) {
      const totalSize = Array.from(asm.blocks.values()).reduce((s, b) => s + b.length, 0);
      const imageData = new Uint8Array(totalSize);
      
      let offset = 0;
      for (let i = 0; i < totalBlock; i++) {
        const b = asm.blocks.get(i);
        if (b) { imageData.set(b, offset); offset += b.length; }
      }

      this.imageAssembler.delete(imgId);
      
      // 触发完成回调
      this.onImageComplete?.({ imgId, imageData, companionData: asm.companionData });

      return imageData;
    }

    return null;
  }

  /** 获取图片组装进度 */
  getImageProgress(imgId: number): { received: number; total: number } | null {
    const asm = this.imageAssembler.get(imgId);
    return asm ? { received: asm.blocks.size, total: asm.totalBlocks } : null;
  }

  /** 清理图片组装状态 */
  clearImage(imgId?: number): void {
    if (imgId !== undefined) {
      this.imageAssembler.delete(imgId);
    } else {
      this.imageAssembler.clear();
    }
  }
}

// ==================== 工厂函数 ====================

export function createUnpacker(xmlContent: string): CustomDataUnpacker {
  return new CustomDataUnpacker(parseXMLConfig(xmlContent));
}

export function createUnpackerFromConfig(config: CustomDataConfig): CustomDataUnpacker {
  return new CustomDataUnpacker(config);
}

/** 从 URL 加载配置并创建解包器 */
export async function createUnpackerFromURL(url: string): Promise<CustomDataUnpacker> {
  const response = await fetch(url);
  const xmlContent = await response.text();
  return createUnpacker(xmlContent);
}
