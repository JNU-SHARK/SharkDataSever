/**
 * Custom Data Parser for Client Side (TypeScript)
 * 
 * This utility class helps in parsing the 150-byte raw binary data received from the server
 * (or simulated by the server) into structured JavaScript objects.
 * 
 * It supports both:
 * - Mode 0x00: Pure Data Mode (Parsing all configured fields)
 * - Mode 0x01: Image Mode (Parsing companion fields + Image Block)
 */

export interface CustomFieldConfig {
    name: string;
    type: 'uint8' | 'int8' | 'uint16' | 'int16' | 'uint32' | 'int32' | 'float' | 'double' | 'bool';
    offset?: number; // Optional, if not provided, it will be calculated sequentially
}

export interface ImageBlock {
    cmd_type: number;   // 1 byte
    img_id: number;     // 2 bytes
    block_idx: number;  // 2 bytes
    total_block: number;// 2 bytes
    data_len: number;   // 1 byte
    data: Uint8Array;   // 120 bytes max
}

export interface ParsedCustomData {
    mode: number;
    fields: Record<string, number | boolean>;
    imageBlock?: ImageBlock;
}

export class CustomDataParser {
    private config: CustomFieldConfig[];
    private imageCompanionFields: string[];

    constructor(config: CustomFieldConfig[], imageCompanionFields: string[] = []) {
        this.config = config;
        this.imageCompanionFields = imageCompanionFields;
    }

    /**
     * Parse a 150-byte buffer
     * @param buffer Uint8Array or ArrayBuffer
     */
    public parse(buffer: Uint8Array | ArrayBuffer): ParsedCustomData {
        const view = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
        const uint8Array = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        
        if (uint8Array.length < 150) {
            console.warn(`Buffer size ${uint8Array.length} is less than expected 150 bytes.`);
        }

        const mode = view.getUint8(0);
        const result: ParsedCustomData = {
            mode: mode,
            fields: {}
        };

        let offset = 1; // Start after mode byte

        if (mode === 0x00) {
            // --- Mode 0: Pure Data ---
            // Parse all fields sequentially
            for (const field of this.config) {
                // Skip image_block type if it exists in config (it shouldn't be in pure data fields usually, but just in case)
                if (field.type as string === 'image_block') continue;

                const { value, size } = this.readField(view, offset, field.type);
                result.fields[field.name] = value;
                offset += size;
            }
        } else if (mode === 0x01) {
            // --- Mode 1: Image Mode ---
            // 1. Parse Companion Fields first
            for (const fieldName of this.imageCompanionFields) {
                const field = this.config.find(f => f.name === fieldName);
                if (field) {
                    const { value, size } = this.readField(view, offset, field.type);
                    result.fields[field.name] = value;
                    offset += size;
                }
            }

            // 2. Parse Image Block (Fixed 128 bytes at the end of the packet? Or just after companion fields?)
            // According to protocol, Image Block is usually at the end or follows companion fields.
            // Based on C SDK generation: 
            // memcpy(tx_buf + 1 + companion_size, &img_block, sizeof(img_block));
            // So it follows immediately after companion fields.
            
            // Ensure we have enough space for Image Block Header (8 bytes) + Data (up to 120 bytes)
            // Image Block Structure:
            // uint8_t cmd_type;
            // uint16_t img_id;
            // uint16_t block_idx;
            // uint16_t total_block;
            // uint8_t data_len;
            // uint8_t data[120];
            
            const imgOffset = offset;
            
            const cmd_type = view.getUint8(imgOffset);
            const img_id = view.getUint16(imgOffset + 1, true); // Little Endian
            const block_idx = view.getUint16(imgOffset + 3, true);
            const total_block = view.getUint16(imgOffset + 5, true);
            const data_len = view.getUint8(imgOffset + 7);
            
            // Extract image data
            const imgDataStart = imgOffset + 8;
            const imgData = uint8Array.slice(imgDataStart, imgDataStart + data_len);

            result.imageBlock = {
                cmd_type,
                img_id,
                block_idx,
                total_block,
                data_len,
                data: imgData
            };
        }

        return result;
    }

    private readField(view: DataView, offset: number, type: string): { value: number | boolean, size: number } {
        let value: number | boolean = 0;
        let size = 0;

        switch (type) {
            case 'uint8':
                value = view.getUint8(offset);
                size = 1;
                break;
            case 'int8':
                value = view.getInt8(offset);
                size = 1;
                break;
            case 'uint16':
                value = view.getUint16(offset, true); // Little Endian
                size = 2;
                break;
            case 'int16':
                value = view.getInt16(offset, true);
                size = 2;
                break;
            case 'uint32':
                value = view.getUint32(offset, true);
                size = 4;
                break;
            case 'int32':
                value = view.getInt32(offset, true);
                size = 4;
                break;
            case 'float':
                value = view.getFloat32(offset, true);
                size = 4;
                break;
            case 'double':
                value = view.getFloat64(offset, true);
                size = 8;
                break;
            case 'bool':
                value = view.getUint8(offset) !== 0;
                size = 1;
                break;
            default:
                console.warn(`Unknown type: ${type}`);
                size = 0;
        }

        return { value, size };
    }
}

/**
 * Example Usage:
 * 
 * const config = [
 *   { name: 'speed', type: 'float' },
 *   { name: 'yaw', type: 'float' },
 *   { name: 'is_aiming', type: 'bool' }
 * ];
 * 
 * const companionFields = ['yaw', 'is_aiming'];
 * 
 * const parser = new CustomDataParser(config, companionFields);
 * const parsed = parser.parse(receivedBuffer);
 * 
 * if (parsed.mode === 0) {
 *   console.log('Pure Data:', parsed.fields);
 * } else {
 *   console.log('Image Data:', parsed.imageBlock);
 *   console.log('Companion:', parsed.fields);
 * }
 */
