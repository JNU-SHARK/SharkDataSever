/**
 * @file CustomDataUnpacker.ts
 * @brief 自定义数据块解包器 - 适用于 Electron + Vue 客户端
 * @description 从 XML 配置文件读取数据结构，解包自定义数据帧
 * @date 2025-12-03
 */

import * as fs from 'fs';
import * as path from 'path';

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
  size: number;  // bytes类型的自定义大小
  offset: number; // 在数据块中的偏移
}

/** 图片块结构 (128字节) */
export interface ImageBlock {
  cmdType: number;      // 命令类型 (0x02=数据块, 0x03=结束帧)
  imgId: number;        // 图片ID
  blockIdx: number;     // 当前块索引
  totalBlock: number;   // 总块数
  dataLen: number;      // 有效数据长度
  data: Uint8Array;     // 数据块 (120字节)
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

/** 帧协议常量 */
export const PROTOCOL = {
  SOF: 0xA5,
  CMD_ID: 0x0310,
  DATA_SIZE: 150,
  FRAME_SIZE: 159,  // 5 + 2 + 150 + 2
  IMAGE_BLOCK_SIZE: 128,
  IMAGE_DATA_SIZE: 120,
  IMAGE_CMD_DATA: 0x02,
  IMAGE_CMD_END: 0x03,
} as const;

// ==================== CRC 校验 ====================

/** CRC8 查找表 */
const CRC8_TABLE: number[] = [
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
];

/** CRC16 查找表 */
const CRC16_TABLE: number[] = [
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
];

/**
 * 计算 CRC8 校验值
 */
export function calculateCRC8(data: Uint8Array, length: number): number {
  let crc = 0xFF;
  for (let i = 0; i < length; i++) {
    crc = CRC8_TABLE[crc ^ data[i]];
  }
  return crc;
}

/**
 * 计算 CRC16 校验值
 */
export function calculateCRC16(data: Uint8Array, length: number): number {
  let crc = 0xFFFF;
  for (let i = 0; i < length; i++) {
    crc = ((crc >> 8) ^ CRC16_TABLE[(crc ^ data[i]) & 0xFF]) & 0xFFFF;
  }
  return crc;
}

// ==================== XML 解析器 ====================

/**
 * 解析 XML 配置文件
 */
export function parseXMLConfig(xmlContent: string): CustomDataConfig {
  const config: CustomDataConfig = {
    metadata: {
      name: '',
      description: '',
      createdAt: '',
      totalSize: 0,
    },
    fields: [],
    imageCompanionFields: [],
  };

  // 解析元数据
  const nameMatch = xmlContent.match(/<Name>([^<]*)<\/Name>/);
  const descMatch = xmlContent.match(/<Description>([^<]*)<\/Description>/);
  const createdMatch = xmlContent.match(/<CreatedAt>([^<]*)<\/CreatedAt>/);
  const sizeMatch = xmlContent.match(/<TotalSize[^>]*>(\d+)<\/TotalSize>/);

  if (nameMatch) config.metadata.name = nameMatch[1];
  if (descMatch) config.metadata.description = descMatch[1];
  if (createdMatch) config.metadata.createdAt = createdMatch[1];
  if (sizeMatch) config.metadata.totalSize = parseInt(sizeMatch[1], 10);

  // 解析图片伴随字段
  const companionBlock = xmlContent.match(/<ImageCompanionFields>([\s\S]*?)<\/ImageCompanionFields>/);
  if (companionBlock) {
    const fieldMatches = companionBlock[1].matchAll(/<Field>([^<]*)<\/Field>/g);
    for (const match of fieldMatches) {
      config.imageCompanionFields.push(match[1]);
    }
  }

  // 解析字段定义
  const fieldsBlock = xmlContent.match(/<Fields[^>]*>([\s\S]*?)<\/Fields>/);
  if (fieldsBlock) {
    const fieldRegex = /<Field[^>]*>([\s\S]*?)<\/Field>/g;
    let fieldMatch;
    let offset = 0;

    while ((fieldMatch = fieldRegex.exec(fieldsBlock[1])) !== null) {
      const fieldContent = fieldMatch[1];
      
      const fieldName = fieldContent.match(/<Name>([^<]*)<\/Name>/)?.[1] || '';
      const fieldType = (fieldContent.match(/<Type>([^<]*)<\/Type>/)?.[1] || 'uint8') as FieldType;
      const arraySize = parseInt(fieldContent.match(/<ArraySize>([^<]*)<\/ArraySize>/)?.[1] || '1', 10);
      const customSize = parseInt(fieldContent.match(/<Size[^>]*>(\d+)<\/Size>/)?.[1] || '0', 10);

      const typeSize = getTypeSize(fieldType, customSize);
      
      config.fields.push({
        name: fieldName,
        type: fieldType,
        arraySize,
        size: customSize,
        offset,
      });

      offset += typeSize * arraySize;
    }
  }

  return config;
}

/**
 * 从文件加载 XML 配置
 */
export function loadConfigFromFile(filePath: string): CustomDataConfig {
  const xmlContent = fs.readFileSync(filePath, 'utf-8');
  return parseXMLConfig(xmlContent);
}

/**
 * 从字符串加载 XML 配置 (适用于浏览器环境)
 */
export function loadConfigFromString(xmlContent: string): CustomDataConfig {
  return parseXMLConfig(xmlContent);
}

// ==================== 工具函数 ====================

/**
 * 获取类型大小
 */
export function getTypeSize(type: FieldType, customSize: number = 0): number {
  const typeSizes: Record<string, number> = {
    'bool': 1,
    'int8_t': 1, 'uint8_t': 1, 'int8': 1, 'uint8': 1,
    'int16_t': 2, 'uint16_t': 2, 'int16': 2, 'uint16': 2,
    'int32_t': 4, 'uint32_t': 4, 'int32': 4, 'uint32': 4,
    'float': 4,
    'double': 8,
    'ImageBlock': 128, 'image_block': 128,
    'bytes': customSize,
  };
  return typeSizes[type] || 0;
}

/**
 * 检查是否为图片块类型
 */
export function isImageBlockType(type: FieldType): boolean {
  return type === 'ImageBlock' || type === 'image_block';
}

// ==================== 自定义数据解包器类 ====================

export class CustomDataUnpacker {
  private config: CustomDataConfig;
  private imageAssembler: Map<number, { blocks: Map<number, Uint8Array>; totalBlocks: number; companionData?: Record<string, any> }>;

  constructor(config: CustomDataConfig) {
    this.config = config;
    this.imageAssembler = new Map();
  }

  /**
   * 获取配置信息
   */
  getConfig(): CustomDataConfig {
    return this.config;
  }

  /**
   * 检查配置是否包含图片块
   */
  hasImageBlock(): boolean {
    return this.config.fields.some(f => isImageBlockType(f.type));
  }

  /**
   * 获取图片伴随字段列表
   */
  getImageCompanionFields(): string[] {
    return this.config.imageCompanionFields;
  }

  /**
   * 解包完整帧 (包含帧头和CRC校验)
   * @param frame 完整帧数据 (159字节)
   */
  unpackFrame(frame: Uint8Array): UnpackResult {
    // 检查帧长度
    if (frame.length < PROTOCOL.FRAME_SIZE) {
      return { success: false, error: `帧长度不足: ${frame.length} < ${PROTOCOL.FRAME_SIZE}` };
    }

    // 检查帧头
    if (frame[0] !== PROTOCOL.SOF) {
      return { success: false, error: `帧头错误: 0x${frame[0].toString(16)} != 0xA5` };
    }

    // 解析帧头
    const dataLength = frame[1] | (frame[2] << 8);
    const seq = frame[3];
    const crc8 = frame[4];

    // 验证 CRC8 (前4字节)
    const calcCRC8 = calculateCRC8(frame, 4);
    if (crc8 !== calcCRC8) {
      return { success: false, error: `CRC8校验失败: 0x${crc8.toString(16)} != 0x${calcCRC8.toString(16)}` };
    }

    // 解析 CMD_ID
    const cmdId = frame[5] | (frame[6] << 8);
    if (cmdId !== PROTOCOL.CMD_ID) {
      return { success: false, error: `CMD_ID错误: 0x${cmdId.toString(16)} != 0x${PROTOCOL.CMD_ID.toString(16)}` };
    }

    // 验证 CRC16 (整帧除最后2字节)
    const frameLen = 5 + 2 + dataLength;
    const crc16 = frame[frameLen] | (frame[frameLen + 1] << 8);
    const calcCRC16 = calculateCRC16(frame, frameLen);
    if (crc16 !== calcCRC16) {
      return { success: false, error: `CRC16校验失败: 0x${crc16.toString(16)} != 0x${calcCRC16.toString(16)}` };
    }

    // 提取数据部分 (从第7字节开始，150字节)
    const data = frame.slice(7, 7 + PROTOCOL.DATA_SIZE);
    return this.unpackData(data);
  }

  /**
   * 解包纯数据 (不含帧头，150字节数据区)
   * @param data 数据区 (150字节)
   */
  unpackData(data: Uint8Array): UnpackResult {
    if (data.length < PROTOCOL.DATA_SIZE) {
      return { success: false, error: `数据长度不足: ${data.length} < ${PROTOCOL.DATA_SIZE}` };
    }

    const result: Record<string, any> = {};
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // 检查是否有图片块
    if (this.hasImageBlock()) {
      // 获取图片块字段
      const imageField = this.config.fields.find(f => isImageBlockType(f.type));
      if (imageField) {
        // 解析图片块
        const imageBlock = this.unpackImageBlock(data.slice(imageField.offset, imageField.offset + PROTOCOL.IMAGE_BLOCK_SIZE));
        
        // 解析伴随字段
        const companionData: Record<string, any> = {};
        let companionOffset = PROTOCOL.IMAGE_BLOCK_SIZE;
        
        for (const fieldName of this.config.imageCompanionFields) {
          const field = this.config.fields.find(f => f.name === fieldName);
          if (field) {
            companionData[field.name] = this.readFieldValue(view, companionOffset, field.type);
            companionOffset += getTypeSize(field.type, field.size);
          }
        }

        return {
          success: true,
          data: companionData,
          imageBlock,
          isImageFrame: true,
        };
      }
    }

    // 普通数据帧 - 解析所有字段
    for (const field of this.config.fields) {
      if (isImageBlockType(field.type)) continue;
      
      if (field.arraySize > 1) {
        const arr: any[] = [];
        let offset = field.offset;
        const typeSize = getTypeSize(field.type, field.size);
        for (let i = 0; i < field.arraySize; i++) {
          arr.push(this.readFieldValue(view, offset, field.type, field.size));
          offset += typeSize;
        }
        result[field.name] = arr;
      } else {
        result[field.name] = this.readFieldValue(view, field.offset, field.type, field.size);
      }
    }

    return { success: true, data: result, isImageFrame: false };
  }

  /**
   * 解包图片块
   */
  private unpackImageBlock(data: Uint8Array): ImageBlock {
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

  /**
   * 读取字段值
   */
  private readFieldValue(view: DataView, offset: number, type: FieldType, customSize: number = 0): any {
    try {
      switch (type) {
        case 'bool':
          return view.getUint8(offset) !== 0;
        case 'int8_t':
        case 'int8':
          return view.getInt8(offset);
        case 'uint8_t':
        case 'uint8':
          return view.getUint8(offset);
        case 'int16_t':
        case 'int16':
          return view.getInt16(offset, true);
        case 'uint16_t':
        case 'uint16':
          return view.getUint16(offset, true);
        case 'int32_t':
        case 'int32':
          return view.getInt32(offset, true);
        case 'uint32_t':
        case 'uint32':
          return view.getUint32(offset, true);
        case 'float':
          return view.getFloat32(offset, true);
        case 'double':
          return view.getFloat64(offset, true);
        case 'bytes':
          return new Uint8Array(view.buffer, view.byteOffset + offset, customSize);
        default:
          return null;
      }
    } catch (e) {
      console.error(`读取字段失败: offset=${offset}, type=${type}`, e);
      return null;
    }
  }

  /**
   * 处理图片块，尝试组装完整图片
   * @returns 如果图片组装完成，返回完整图片数据；否则返回 null
   */
  processImageBlock(imageBlock: ImageBlock, companionData?: Record<string, any>): Uint8Array | null {
    const { imgId, blockIdx, totalBlock, dataLen, data, cmdType } = imageBlock;

    // 获取或创建图片组装器
    if (!this.imageAssembler.has(imgId)) {
      this.imageAssembler.set(imgId, {
        blocks: new Map(),
        totalBlocks: totalBlock,
        companionData,
      });
    }

    const assembler = this.imageAssembler.get(imgId)!;
    
    // 存储数据块
    assembler.blocks.set(blockIdx, data.slice(0, dataLen));

    // 检查是否收到结束帧或所有块
    if (cmdType === PROTOCOL.IMAGE_CMD_END || assembler.blocks.size >= totalBlock) {
      // 组装完整图片
      const totalSize = Array.from(assembler.blocks.values()).reduce((sum, block) => sum + block.length, 0);
      const imageData = new Uint8Array(totalSize);
      
      let offset = 0;
      for (let i = 0; i < totalBlock; i++) {
        const block = assembler.blocks.get(i);
        if (block) {
          imageData.set(block, offset);
          offset += block.length;
        }
      }

      // 清理组装器
      this.imageAssembler.delete(imgId);

      return imageData;
    }

    return null;
  }

  /**
   * 获取图片组装进度
   */
  getImageAssemblyProgress(imgId: number): { received: number; total: number } | null {
    const assembler = this.imageAssembler.get(imgId);
    if (!assembler) return null;
    return {
      received: assembler.blocks.size,
      total: assembler.totalBlocks,
    };
  }

  /**
   * 清理指定图片的组装状态
   */
  clearImageAssembly(imgId: number): void {
    this.imageAssembler.delete(imgId);
  }

  /**
   * 清理所有图片组装状态
   */
  clearAllImageAssembly(): void {
    this.imageAssembler.clear();
  }
}

// ==================== 导出工厂函数 ====================

/**
 * 从 XML 文件创建解包器 (Node.js 环境)
 */
export function createUnpackerFromFile(xmlPath: string): CustomDataUnpacker {
  const config = loadConfigFromFile(xmlPath);
  return new CustomDataUnpacker(config);
}

/**
 * 从 XML 字符串创建解包器 (浏览器环境)
 */
export function createUnpackerFromString(xmlContent: string): CustomDataUnpacker {
  const config = loadConfigFromString(xmlContent);
  return new CustomDataUnpacker(config);
}

/**
 * 从配置对象创建解包器
 */
export function createUnpackerFromConfig(config: CustomDataConfig): CustomDataUnpacker {
  return new CustomDataUnpacker(config);
}

// ==================== 使用示例 ====================

/*
// Node.js 环境使用示例:
import { createUnpackerFromFile, UnpackResult } from './CustomDataUnpacker';

const unpacker = createUnpackerFromFile('./sdk/configs/infantry.xml');

// 解包完整帧
const frame = new Uint8Array(159); // 从串口/网络接收的数据
const result = unpacker.unpackFrame(frame);

if (result.success) {
  if (result.isImageFrame) {
    console.log('图片帧:', result.imageBlock);
    console.log('伴随数据:', result.data);
    
    // 尝试组装完整图片
    const imageData = unpacker.processImageBlock(result.imageBlock!, result.data);
    if (imageData) {
      console.log('图片组装完成, 大小:', imageData.length);
    }
  } else {
    console.log('普通数据:', result.data);
  }
}

// Vue 组件中使用示例:
// <script setup lang="ts">
// import { ref, onMounted } from 'vue';
// import { createUnpackerFromString, CustomDataUnpacker, UnpackResult } from '@/utils/CustomDataUnpacker';
// 
// const unpacker = ref<CustomDataUnpacker | null>(null);
// 
// onMounted(async () => {
//   const response = await fetch('/api/config/infantry.xml');
//   const xmlContent = await response.text();
//   unpacker.value = createUnpackerFromString(xmlContent);
// });
// 
// function handleData(data: Uint8Array) {
//   if (!unpacker.value) return;
//   const result = unpacker.value.unpackData(data);
//   // 处理解包结果...
// }
// </script>
*/
