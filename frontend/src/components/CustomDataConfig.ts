declare var Vue: any;
const { ref, computed, reactive } = Vue;

export default {
    template: `
    <div class="panel">
        <div class="panel-header">
            🛠️ 自定义数据块配置管理
        </div>
        <div class="panel-body">
            <!-- 配置管理区域 -->
            <div style="margin-bottom: 20px;">
                <div style="display: flex; gap: 10px; align-items: stretch; margin-bottom: 15px;">
                    <!-- 左侧：已保存配置列表 -->
                    <div style="flex: 1; background: #f8f9fa; border-radius: 8px; padding: 15px;">
                        <div style="font-weight: bold; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                            <span>📋 已保存配置</span>
                            <button @click="loadConfigList" class="btn btn-secondary" style="padding: 4px 12px; font-size: 12px;">🔄 刷新</button>
                        </div>
                        <div v-if="configList.length === 0" style="color: #999; text-align: center; padding: 20px;">
                            暂无已保存配置
                        </div>
                        <div v-else>
                            <div 
                                v-for="config in configList" 
                                :key="config.name"
                                @click="loadConfig(config.name)"
                                :class="{ 'config-item': true, 'config-item-active': currentConfigName === config.name }"
                                style="cursor: pointer; padding: 10px; margin-bottom: 5px; background: white; border-radius: 5px; border: 2px solid #e0e0e0; transition: all 0.2s;"
                            >
                                <div style="font-weight: bold; color: #333;">🚗 {{ config.name }}</div>
                                <div style="font-size: 12px; color: #666;">{{ config.description || '无说明' }}</div>
                                <div style="font-size: 11px; color: #999;">{{ config.totalSize }} Bytes | {{ config.createdAt }}</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 右侧：当前配置操作 -->
                    <div style="flex: 1; background: #e8f4f8; border-radius: 8px; padding: 15px; border-left: 4px solid #0066cc;">
                        <div style="font-weight: bold; margin-bottom: 10px;">
                            {{ currentConfigName ? '✏️ 编辑配置' : '➕ 新建配置' }}
                        </div>
                        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <input 
                                v-model="configName" 
                                placeholder="配置名称（如：哨兵、英雄、步兵）" 
                                class="form-input" 
                                style="flex: 1;"
                            >
                        </div>
                        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                            <input 
                                v-model="configDescription" 
                                placeholder="配置说明（可选）" 
                                class="form-input" 
                                style="flex: 1;"
                            >
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button 
                                @click="saveConfig" 
                                class="btn btn-success" 
                                :disabled="items.length === 0 || !configName.trim()"
                                style="flex: 1;"
                            >
                                💾 {{ currentConfigName ? '更新配置' : '保存配置' }}
                            </button>
                            <button 
                                v-if="currentConfigName"
                                @click="newConfig" 
                                class="btn btn-secondary"
                                style="flex: 1;"
                            >
                                ➕ 新建
                            </button>
                            <button 
                                v-if="currentConfigName"
                                @click="deleteConfig" 
                                class="btn btn-danger"
                                style="flex: 1;"
                            >
                                🗑️ 删除
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 数据大小进度条和生成按钮 -->
            <div style="display: flex; gap: 15px; align-items: stretch; margin-bottom: 20px;">
                <div class="size-progress-container" style="flex: 1; margin-bottom: 0;">
                    <div class="size-info">
                        <span class="size-label">数据块大小</span>
                        <span class="size-value" :class="{ 'size-warning': totalSize > 150 }">
                            {{ totalSize }} / 150 Bytes
                        </span>
                    </div>
                    <div class="progress-bar-wrapper">
                        <div 
                            class="progress-bar" 
                            :class="{ 'progress-warning': totalSize > 120, 'progress-danger': totalSize > 150 }"
                            :style="{ width: Math.min((totalSize / 150) * 100, 100) + '%' }"
                        >
                            <span class="progress-text" v-if="totalSize > 0">{{ Math.round((totalSize / 150) * 100) }}%</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px; min-width: 150px;">
                    <button 
                        @click="generateProtoFile" 
                        class="btn btn-primary" 
                        :disabled="items.length === 0"
                        style="flex: 1; white-space: nowrap;"
                    >
                        📄 生成 Proto 文件
                    </button>
                    <button 
                        @click="generateCFile" 
                        class="btn btn-primary" 
                        :disabled="items.length === 0"
                        style="flex: 1; white-space: nowrap;"
                    >
                        💾 生成 C SDK 文件
                    </button>
                </div>
            </div>

            <div style="margin-bottom: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <input v-model="newItem.name" placeholder="数据名称" class="form-input" style="flex: 2">
                    <select v-model="newItem.type" class="field-select" style="flex: 1">
                        <option value="uint8">uint8 (1B)</option>
                        <option value="int8">int8 (1B)</option>
                        <option value="uint16">uint16 (2B)</option>
                        <option value="int16">int16 (2B)</option>
                        <option value="uint32">uint32 (4B)</option>
                        <option value="int32">int32 (4B)</option>
                        <option value="float">float (4B)</option>
                        <option value="double">double (8B)</option>
                        <option value="bool">bool (1B)</option>
                        <option value="bytes">bytes (变长)</option>
                        <option value="image_block">图片块协议 (128B)</option>
                    </select>
                    <button @click="addItem" class="btn btn-primary" :disabled="!isValidNewItem">添加</button>
                </div>
                <div v-if="newItem.type === 'image_block'" style="padding: 10px; background: #e3f2fd; border-radius: 4px; margin-bottom: 10px; font-size: 12px;">
                    <div style="font-weight: bold; margin-bottom: 5px;">📷 图片块传输协议 (定长128字节)</div>
                    <div style="color: #1976d2; line-height: 1.6;">
                        • cmd_type(1B) + img_id(2B) + block_idx(2B) + total_block(2B) + data_len(1B) + data(120B)<br>
                        • cmd_type: 0x02=图片数据块 / 0x03=传输结束帧<br>
                        • data_len: 有效数据长度(1~120字节), 不足部分填0<br>
                        • 依赖外层协议的SOF和CRC16保护，无冗余校验
                    </div>
                </div>
                <div v-if="newItem.type === 'bytes'" style="display: flex; gap: 10px; align-items: center;">
                    <label>字节长度(必填):</label>
                    <input type="number" v-model.number="newItem.size" placeholder="字节数" class="form-input" style="width: 100px" min="1">
                    <span style="color: #999; font-size: 12px;">（建议不超过140字节）</span>
                </div>
                <div v-else-if="newItem.type !== 'bool'" style="display: flex; gap: 10px; align-items: center;">
                    <label>范围限定(可选):</label>
                    <input type="number" v-model.number="newItem.min" placeholder="最小值" class="form-input" style="width: 100px">
                    <span>-</span>
                    <input type="number" v-model.number="newItem.max" placeholder="最大值" class="form-input" style="width: 100px">
                </div>
            </div>

            <!-- 图片块独立配置区域 -->
            <div v-if="hasImageBlock" style="margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px; color: white;">
                <div style="font-weight: bold; font-size: 16px; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
                    <span>📷</span>
                    <span>图片块数据配置 (128字节)</span>
                    <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                        剩余可用: {{ 150 - imageBlockCompanionSize - 128 }} 字节
                    </span>
                </div>
                
                <div style="background: rgba(255,255,255,0.95); padding: 15px; border-radius: 6px; color: #333; margin-bottom: 15px;">
                    <div style="font-weight: bold; margin-bottom: 10px; color: #667eea;">
                        🔧 随图片发送的数据字段配置
                    </div>
                    <div style="font-size: 13px; color: #666; margin-bottom: 15px; line-height: 1.6;">
                        ℹ️ 在发送图片时，可以同时携带其他传感器数据（如温度、速度等）。<br>
                        您可以从已有字段中选择，或新建专用字段。总大小不能超过 {{ 150 - 128 }} 字节。
                    </div>
                    
                    <!-- 从已有字段选择 -->
                    <div style="margin-bottom: 15px;">
                        <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px;">📋 从已有字段选择：</div>
                        <div v-if="availableFieldsForImage.length === 0" style="color: #999; font-size: 12px; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                            暂无可用字段（已有字段都是image_block类型，或已全部添加到图片伴随数据中）
                        </div>
                        <div v-else style="display: flex; flex-wrap: wrap; gap: 8px;">
                            <button 
                                v-for="field in availableFieldsForImage" 
                                :key="field.name"
                                @click="addFieldToImageCompanion(field)"
                                class="btn btn-secondary"
                                style="padding: 6px 12px; font-size: 12px; background: white; color: #667eea; border: 2px solid #667eea;"
                            >
                                ➕ {{ field.name }} ({{ getTypeSize(field.type, field.size) }}B)
                            </button>
                        </div>
                    </div>
                    
                    <!-- 新建字段 -->
                    <div style="border-top: 1px solid #e0e0e0; padding-top: 15px;">
                        <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px;">➕ 新建专用字段：</div>
                        <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                            <input v-model="newImageField.name" placeholder="字段名称" class="form-input" style="flex: 2;">
                            <select v-model="newImageField.type" class="field-select" style="flex: 1;">
                                <option value="uint8">uint8 (1B)</option>
                                <option value="int8">int8 (1B)</option>
                                <option value="uint16">uint16 (2B)</option>
                                <option value="int16">int16 (2B)</option>
                                <option value="uint32">uint32 (4B)</option>
                                <option value="int32">int32 (4B)</option>
                                <option value="float">float (4B)</option>
                                <option value="double">double (8B)</option>
                                <option value="bool">bool (1B)</option>
                            </select>
                            <button @click="addNewImageField" class="btn btn-primary" :disabled="!isValidNewImageField" style="white-space: nowrap;">
                                添加
                            </button>
                        </div>
                        <div v-if="newImageField.type !== 'bool' && newImageField.type" style="display: flex; gap: 8px; align-items: center; font-size: 12px;">
                            <label>范围:</label>
                            <input type="number" v-model.number="newImageField.min" placeholder="最小值" class="form-input" style="width: 80px;">
                            <span>-</span>
                            <input type="number" v-model.number="newImageField.max" placeholder="最大值" class="form-input" style="width: 80px;">
                        </div>
                    </div>
                    
                    <!-- 已选字段列表 -->
                    <div v-if="imageCompanionFields.length > 0" style="margin-top: 15px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
                        <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px;">
                            ✅ 已选字段 ({{ imageBlockCompanionSize }} / {{ 150 - 128 }} 字节)：
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div 
                                v-for="(field, idx) in imageCompanionFields" 
                                :key="idx"
                                style="display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; padding: 8px 12px; border-radius: 4px; font-size: 12px;"
                            >
                                <div>
                                    <span style="font-weight: bold;">{{ field.name }}</span>
                                    <span style="color: #666; margin-left: 8px;">{{ field.type }} ({{ getTypeSize(field.type, field.size) }}B)</span>
                                    <span v-if="field.min !== undefined || field.max !== undefined" style="color: #999; margin-left: 8px; font-size: 11px;">
                                        [{{ field.min ?? '-∞' }}, {{ field.max ?? '+∞' }}]
                                    </span>
                                </div>
                                <button @click="removeImageCompanionField(idx)" class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;">移除</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="data-list">
                <div v-if="items.length === 0" style="text-align: center; color: #999; padding: 20px;">
                    暂无配置数据
                </div>
                <div v-for="(item, index) in items" :key="index" class="message-item" 
                    style="display: flex; justify-content: space-between; align-items: center;"
                    v-show="item.type !== 'image_block'">
                    <div style="flex: 1;">
                        <div class="message-name">{{ item.name }}</div>
                        <div class="message-desc">
                            类型: {{ item.type }} ({{ getTypeSize(item.type, item.size) }} Bytes)
                            <span v-if="item.type === 'image_block'" style="color: #667eea; font-weight: bold;">
                                | 📷 图片传输协议
                            </span>
                            <span v-else-if="item.type === 'bytes' && item.size">
                                | 长度: {{ item.size }} 字节
                            </span>
                            <span v-else-if="item.min !== undefined || item.max !== undefined">
                                | 范围: [{{ item.min ?? '-∞' }}, {{ item.max ?? '+∞' }}]
                            </span>
                        </div>
                    </div>
                    <button @click="removeItem(index)" class="btn btn-danger" style="padding: 5px 10px; font-size: 12px;">删除</button>
                </div>
            </div>
        </div>
    </div>
    `,
    setup() {
        interface DataItem {
            name: string;
            type: string;
            min?: number;
            max?: number;
            size?: number;  // 用于 bytes 类型指定长度
        }

        interface ConfigInfo {
            name: string;
            description: string;
            totalSize: number;
            createdAt: string;
        }

        const items = ref([] as DataItem[]);
        const configName = ref('');
        const configDescription = ref('');
        const currentConfigName = ref('');
        const configList = ref([] as ConfigInfo[]);
        const newItem = reactive({
            name: '',
            type: 'float',
            min: undefined as number | undefined,
            max: undefined as number | undefined,
            size: undefined as number | undefined
        });

        // 图片块伴随字段相关
        const imageCompanionFields = ref([] as DataItem[]);
        const newImageField = reactive({
            name: '',
            type: 'float',
            min: undefined as number | undefined,
            max: undefined as number | undefined
        });

        const typeSizes: Record<string, number> = {
            'bool': 1,
            'uint8': 1, 'int8': 1,
            'uint16': 2, 'int16': 2,
            'uint32': 4, 'int32': 4,
            'float': 4,
            'double': 8
        };

        const getTypeSize = (type: string, size?: number) => {
            if (type === 'bytes') return size || 0;
            if (type === 'image_block') return 128; // 固定128字节: cmd_type(1) + img_id(2) + block_idx(2) + total_block(2) + data_len(1) + data(120)
            return typeSizes[type] || 0;
        };

        // 计算是否有image_block
        const hasImageBlock = computed(() => {
            return items.value.some((item: DataItem) => item.type === 'image_block');
        });

        // 计算图片伴随字段的总大小
        const imageBlockCompanionSize = computed(() => {
            return imageCompanionFields.value.reduce((sum: number, item: DataItem) => 
                sum + getTypeSize(item.type, item.size), 0);
        });

        // 可用于添加到图片伴随数据的字段（排除image_block类型和已添加的）
        const availableFieldsForImage = computed(() => {
            return items.value.filter((item: DataItem) => {
                if (item.type === 'image_block') return false;
                return !imageCompanionFields.value.some((f: DataItem) => f.name === item.name);
            });
        });

        // 验证新图片字段是否有效
        const isValidNewImageField = computed(() => {
            if (!newImageField.name.trim() || !newImageField.type) return false;
            const fieldSize = getTypeSize(newImageField.type);
            if (imageBlockCompanionSize.value + fieldSize > 150 - 128) return false;
            return true;
        });

        const totalSize = computed(() => {
            return items.value.reduce((sum: number, item: DataItem) => {
                // 如果是图片块，不计入总大小（方便查看纯数据大小）
                if (item.type === 'image_block') return sum;
                return sum + getTypeSize(item.type, item.size);
            }, 0);
        });

        const isValidNewItem = computed(() => {
            if (newItem.name.trim() === '' || !newItem.type) return false;
            if (newItem.type === 'bytes' && (!newItem.size || newItem.size <= 0)) return false;
            // image_block 类型不需要size参数，固定131字节
            return true;
        });

        const addItem = () => {
            if (!isValidNewItem.value) return;
            
            items.value.push({
                name: newItem.name,
                type: newItem.type,
                min: newItem.min,
                max: newItem.max,
                size: newItem.size
            });

            // Reset
            newItem.name = '';
            newItem.min = undefined;
            newItem.max = undefined;
            newItem.size = undefined;
            newItem.max = undefined;
        };

        const removeItem = (index: number) => {
            const removedItem = items.value[index];
            items.value.splice(index, 1);
            
            // 如果删除的是image_block，清空伴随字段
            if (removedItem.type === 'image_block') {
                imageCompanionFields.value = [];
            }
        };

        // 添加字段到图片伴随数据
        const addFieldToImageCompanion = (field: DataItem) => {
            const fieldSize = getTypeSize(field.type, field.size);
            if (imageBlockCompanionSize.value + fieldSize > 150 - 128) {
                alert(`❌ 空间不足！添加此字段后将超过可用空间 (${150 - 128} 字节)`);
                return;
            }
            imageCompanionFields.value.push({ ...field });
        };

        // 新建图片伴随字段
        const addNewImageField = () => {
            if (!isValidNewImageField.value) return;
            
            imageCompanionFields.value.push({
                name: newImageField.name,
                type: newImageField.type,
                min: newImageField.min,
                max: newImageField.max
            });

            // 同时添加到主列表
            items.value.push({
                name: newImageField.name,
                type: newImageField.type,
                min: newImageField.min,
                max: newImageField.max
            });

            // 重置
            newImageField.name = '';
            newImageField.type = 'float';
            newImageField.min = undefined;
            newImageField.max = undefined;
        };

        // 移除图片伴随字段
        const removeImageCompanionField = (index: number) => {
            imageCompanionFields.value.splice(index, 1);
        };

        const generateProtoFile = async () => {
            if (items.value.length === 0) return;
            
            let protoContent = 'syntax = "proto3";\n\n';
            
            // 检查是否有image_block类型，如果有需要先定义ImageBlock消息
            const hasImageBlock = items.value.some((item: DataItem) => item.type === 'image_block');
            if (hasImageBlock) {
                protoContent += '// 图片块协议消息定义 (128字节)\n';
                protoContent += 'message ImageBlock {\n';
                protoContent += '    fixed32 cmd_type = 1;         // 命令类型 (1B)\n';
                protoContent += '    fixed32 img_id = 2;           // 图片ID (2B)\n';
                protoContent += '    fixed32 block_idx = 3;        // 当前块索引 (2B)\n';
                protoContent += '    fixed32 total_block = 4;      // 总块数 (2B)\n';
                protoContent += '    fixed32 data_len = 5;         // 有效数据长度 (1B)\n';
                protoContent += '    bytes data = 6;               // 数据块 (120B)\n';
                protoContent += '}\n\n';
            }
            
            protoContent += 'message CustomByteBlock {\n';
            
            // 先添加实际数据字段
            items.value.forEach((item: DataItem, index: number) => {
                let comment = '';
                let protoType = item.type;
                
                if (item.type === 'image_block') {
                    protoType = 'ImageBlock';
                    comment = ' // 图片块协议 (131B定长帧)';
                } else if (item.type === 'bytes' && item.size) {
                    comment = ` // 长度: ${item.size} bytes (用于图片等二进制数据)`;
                } else if (item.min !== undefined || item.max !== undefined) {
                    comment = ` // 范围: [${item.min ?? '-∞'}, ${item.max ?? '+∞'}]`;
                }
                protoContent += `    ${protoType} ${item.name} = ${index + 1};${comment}\n`;
            });
            
            // 计算已使用字节数并填充到150字节
            // 注意：这里需要包含image_block的大小
            const actualSize = items.value.reduce((sum: number, item: DataItem) => sum + getTypeSize(item.type, item.size), 0);
            const requiredSize = 150;
            if (actualSize < requiredSize) {
                const paddingSize = requiredSize - actualSize;
                protoContent += `    bytes _padding = ${items.value.length + 1}; // 填充到150字节 (${paddingSize} bytes)\n`;
            }
            
            protoContent += '}\n';
            
            // 发送到服务器保存文件
            try {
                const response = await fetch('/api/save-proto', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        content: protoContent,
                        configName: configName.value.trim() || '默认配置'
                    })
                });
                const result = await response.json();
                if (result.success) {
                    alert(`✅ Proto 文件已生成！\n路径: ${result.path}`);
                } else {
                    alert(`❌ 生成失败: ${result.error}`);
                }
            } catch (error: any) {
                alert(`❌ 错误: ${error.message}`);
            }
        };

        const generateCFile = async () => {
            if (items.value.length === 0) return;
            
            // ========== 生成 .h 文件 ==========
            let hContent = '/**\n';
            hContent += ' * @file custom_data.h\n';
            hContent += ' * @brief 自定义数据块 SDK - 适用于 STM32/ARM 架构单片机\n';
            hContent += ' * @note 串口协议：帧头(5B) + CMD_ID(2B) + 数据(nB) + 帧尾(2B CRC16)\n';
            hContent += ' * @date ' + new Date().toLocaleString('zh-CN') + '\n';
            hContent += ` * @size ${totalSize.value} Bytes\n`;
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
            hContent += '#define CUSTOM_DATA_ACTUAL_SIZE ' + totalSize.value + '       // 实际数据长度\n';
            hContent += '#define CUSTOM_DATA_SIZE        150       // 裁判系统要求固定150字节\n';
            hContent += '#define CUSTOM_DATA_FRAME_SIZE  (5 + 2 + CUSTOM_DATA_SIZE + 2) // 总帧长度\n\n';
            
            // 检查是否有image_block类型
            const hasImageBlock = items.value.some((item: DataItem) => item.type === 'image_block');
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
            
            // 数据结构定义
            if (hasImageBlock) {
                // 计算非图片字段
                const nonImageFields = items.value.filter((item: DataItem) => item.type !== 'image_block');
                const nonImageSize = nonImageFields.reduce((sum: number, item: DataItem) => 
                    sum + getTypeSize(item.type, item.size), 0);
                
                // 1. 纯数据结构（不含图片）
                hContent += '/**\n';
                hContent += ' * @brief 纯数据结构（不含图片块）\n';
                hContent += ' * @note 用于无图片传输场景，节省内存\n';
                hContent += ` * @size ${nonImageSize + 1} Bytes (1B类型 + ${nonImageSize}B数据)\n`;
                hContent += ' */\n';
                hContent += '#pragma pack(push, 1)\n';
                hContent += 'typedef struct {\n';
                hContent += '    uint8_t packet_type; // 0x00: 纯数据\n';
                
                nonImageFields.forEach((item: DataItem) => {
                    let cType;
                    let arraySize = '';
                    
                    if (item.type === 'bytes') {
                        cType = 'uint8_t';
                        arraySize = `[${item.size || 1}]`;
                    } else {
                        cType = {
                            'uint8': 'uint8_t',
                            'int8': 'int8_t',
                            'uint16': 'uint16_t',
                            'int16': 'int16_t',
                            'uint32': 'uint32_t',
                            'int32': 'int32_t',
                            'float': 'float',
                            'double': 'double',
                            'bool': 'uint8_t'
                        }[item.type] || item.type;
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
                hContent += ` * @size ${imageBlockCompanionSize.value + 128 + 1} Bytes (1B类型 + ${imageBlockCompanionSize.value}B伴随数据 + 128B图片)\n`;
                hContent += ' */\n';
                hContent += '#pragma pack(push, 1)\n';
                hContent += 'typedef struct {\n';
                hContent += '    uint8_t packet_type; // 0x01: 含图片数据\n';
                
                // 先添加非图片字段（伴随数据）
                imageCompanionFields.value.forEach((item: DataItem) => {
                    let cType;
                    let arraySize = '';
                    
                    if (item.type === 'bytes') {
                        cType = 'uint8_t';
                        arraySize = `[${item.size || 1}]`;
                    } else {
                        cType = {
                            'uint8': 'uint8_t',
                            'int8': 'int8_t',
                            'uint16': 'uint16_t',
                            'int16': 'int16_t',
                            'uint32': 'uint32_t',
                            'int32': 'int32_t',
                            'float': 'float',
                            'double': 'double',
                            'bool': 'uint8_t'
                        }[item.type] || item.type;
                    }
                    
                    let comment = '';
                    if (item.type === 'bytes' && item.size) {
                        comment = ` // ${item.size} bytes (伴随数据)`;
                    } else if (item.min !== undefined || item.max !== undefined) {
                        comment = ` // 范围: [${item.min ?? '-∞'}, ${item.max ?? '+∞'}] (伴随数据)`;
                    } else {
                        comment = ' // 图片伴随数据';
                    }
                    
                    hContent += `    ${cType} ${item.name}${arraySize};${comment}\n`;
                });
                
                // 再添加图片块字段
                const imageField = items.value.find((item: DataItem) => item.type === 'image_block');
                if (imageField) {
                    hContent += `    ImageBlock_t ${imageField.name}; // 图片块 (131B)\n`;
                }
                
                hContent += '} CustomDataWithImage_t;\n';
                hContent += '#pragma pack(pop)\n\n';
                
            } else {
                // 没有图片块，只生成一个结构体
                hContent += '/**\n';
                hContent += ' * @brief 自定义数据块\n';
                hContent += ' * @note 用于参数传递\n';
                hContent += ` * @size ${totalSize.value} Bytes\n`;
                hContent += ' */\n';
                hContent += '#pragma pack(push, 1)\n';
                hContent += 'typedef struct {\n';
                
                items.value.forEach((item: DataItem) => {
                    let cType;
                    let arraySize = '';
                    
                    if (item.type === 'bytes') {
                        cType = 'uint8_t';
                        arraySize = `[${item.size || 1}]`;
                    } else {
                        cType = {
                            'uint8': 'uint8_t',
                            'int8': 'int8_t',
                            'uint16': 'uint16_t',
                            'int16': 'int16_t',
                            'uint32': 'uint32_t',
                            'int32': 'int32_t',
                            'float': 'float',
                            'double': 'double',
                            'bool': 'uint8_t'
                        }[item.type] || item.type;
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
                hContent += 'static inline void CustomData_Write(const CustomData_t *data);\n\n';
                
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
                hContent += 'static inline void CustomData_Write(const CustomData_t *data);\n\n';
                
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
            
            // 如果有image_block类型，添加相关函数声明
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
            
            // 内联函数实现
            if (hasImageBlock) {
                const nonImageSize = items.value.reduce((sum: number, item: DataItem) => {
                    if (item.type === 'image_block') return sum;
                    return sum + getTypeSize(item.type, item.size);
                }, 0);
                
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
                cContent += `    memcpy(s_data_buffer, &s_custom_data, ${nonImageSize + 1});\n`;
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
                cContent += `    memcpy(s_data_buffer, &s_custom_data_with_image, ${imageBlockCompanionSize.value + 128 + 1});\n`;
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
            } else {
                cContent += '/**\n';
                cContent += ' * @brief 写入数据到内部缓冲区（内联实现）\n';
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
            
            // 如果有image_block类型，添加图片块函数实现
            if (hasImageBlock) {
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
            }
            
            // 发送到服务器保存文件
            try {
                const response = await fetch('/api/save-c', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        hContent: hContent,
                        cContent: cContent,
                        configName: configName.value.trim() || '默认配置'
                    })
                });
                const result = await response.json();
                if (result.success) {
                    let message = `✅ C SDK 文件已生成！\n.h 文件: ${result.hPath}\n.c 文件: ${result.cPath}`;
                    
                    // 添加语法检查结果
                    if (result.syntaxCheck) {
                        message += '\n\n━━━━━━━━━━━━━━━━━━\n';
                        message += `${result.syntaxCheck.message}\n`;
                        
                        if (result.syntaxCheck.errors && result.syntaxCheck.errors.length > 0) {
                            message += '\n❌ 错误:\n';
                            result.syntaxCheck.errors.slice(0, 5).forEach((err: string) => {
                                message += `  ${err}\n`;
                            });
                            if (result.syntaxCheck.errors.length > 5) {
                                message += `  ... 还有 ${result.syntaxCheck.errors.length - 5} 个错误\n`;
                            }
                        }
                        
                        if (result.syntaxCheck.warnings && result.syntaxCheck.warnings.length > 0) {
                            message += '\n⚠️ 警告:\n';
                            result.syntaxCheck.warnings.slice(0, 3).forEach((warn: string) => {
                                message += `  ${warn}\n`;
                            });
                            if (result.syntaxCheck.warnings.length > 3) {
                                message += `  ... 还有 ${result.syntaxCheck.warnings.length - 3} 个警告\n`;
                            }
                        }
                    }
                    
                    alert(message);
                } else {
                    alert(`❌ 生成失败: ${result.error}`);
                }
            } catch (error: any) {
                alert(`❌ 错误: ${error.message}`);
            }
        };

        const saveConfig = async () => {
            if (items.value.length === 0 || !configName.value.trim()) return;
            
            try {
                const response = await fetch('/api/save-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: configName.value.trim(),
                        description: configDescription.value.trim(),
                        items: items.value,
                        totalSize: totalSize.value,
                        imageCompanionFields: imageCompanionFields.value.map((f: DataItem) => f.name)
                    })
                });
                const result = await response.json();
                if (result.success) {
                    alert(`✅ 配置已保存！\n配置名: ${configName.value}\n路径: ${result.path}`);
                    currentConfigName.value = configName.value.trim();
                    await loadConfigList();
                } else {
                    alert(`❌ 保存失败: ${result.error}`);
                }
            } catch (error: any) {
                alert(`❌ 错误: ${error.message}`);
            }
        };

        const loadConfigList = async () => {
            try {
                const response = await fetch('/api/list-configs');
                const result = await response.json();
                if (result.success) {
                    configList.value = result.configs;
                }
            } catch (error: any) {
                console.error('加载配置列表失败:', error);
            }
        };

        const loadConfig = async (name: string) => {
            try {
                const response = await fetch(`/api/load-config?name=${encodeURIComponent(name)}`);
                const result = await response.json();
                if (result.success) {
                    items.value = result.config.items;
                    configName.value = result.config.name;
                    configDescription.value = result.config.description || '';
                    currentConfigName.value = name;

                    // 恢复图片伴随字段
                    if (result.config.imageCompanionFields) {
                        const companionNames = result.config.imageCompanionFields;
                        imageCompanionFields.value = items.value.filter((item: DataItem) => 
                            companionNames.includes(item.name)
                        );
                    } else {
                        imageCompanionFields.value = [];
                    }
                } else {
                    alert(`❌ 加载失败: ${result.error}`);
                }
            } catch (error: any) {
                alert(`❌ 错误: ${error.message}`);
            }
        };

        const newConfig = () => {
            items.value = [];
            configName.value = '';
            configDescription.value = '';
            currentConfigName.value = '';
        };

        const deleteConfig = async () => {
            if (!currentConfigName.value) return;
            
            if (!confirm(`确定要删除配置 "${currentConfigName.value}" 吗？`)) return;
            
            try {
                const response = await fetch('/api/delete-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: currentConfigName.value })
                });
                const result = await response.json();
                if (result.success) {
                    alert(`✅ 配置已删除！`);
                    newConfig();
                    await loadConfigList();
                } else {
                    alert(`❌ 删除失败: ${result.error}`);
                }
            } catch (error: any) {
                alert(`❌ 错误: ${error.message}`);
            }
        };

        // 初始加载配置列表
        loadConfigList();

        return {
            items,
            newItem,
            configName,
            configDescription,
            currentConfigName,
            configList,
            totalSize,
            isValidNewItem,
            addItem,
            removeItem,
            getTypeSize,
            generateProtoFile,
            generateCFile,
            saveConfig,
            loadConfigList,
            loadConfig,
            newConfig,
            deleteConfig,
            // 图片块相关
            hasImageBlock,
            imageCompanionFields,
            imageBlockCompanionSize,
            availableFieldsForImage,
            newImageField,
            isValidNewImageField,
            addFieldToImageCompanion,
            addNewImageField,
            removeImageCompanionField
        };
    }
}