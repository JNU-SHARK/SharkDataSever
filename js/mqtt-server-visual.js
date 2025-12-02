const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

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
                                bytes: String 
                            });
                            
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
            } else if (url.pathname === '/api/load-config' && req.method === 'GET') {
                this.handleLoadConfig(req, res);
            } else if (url.pathname === '/api/delete-config' && req.method === 'POST') {
                this.handleDeleteConfig(req, res);
            } else if (url.pathname === '/api/load-proto' && req.method === 'GET') {
                this.handleLoadProto(req, res);
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
                const { messageType, data, topic } = JSON.parse(body);
                
                // 获取消息类型
                const MessageType = this.protoRoot.lookupType(messageType);
                
                // 转换数据
                const convertedData = this.convertKeysToCamel(data);
                
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
                const { messageType, enabled, intervalMs, topic, data } = JSON.parse(body);
                
                if (!messageType) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'messageType is required' }));
                    return;
                }
                
                if (enabled) {
                    // store template data for this message
                    if (data) {
                        this.downlinkConfigs[messageType] = data;
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
                let dir, relativePath;
                if (configName) {
                    const safeName = configName.replace(/[<>:"/\\|?*]/g, '_');
                    dir = path.join(__dirname, '..', 'sdk', safeName);
                    relativePath = `sdk/${safeName}`;
                } else {
                    dir = path.join(__dirname, '..', 'sdk', 'default');
                    relativePath = 'sdk/default';
                }
                
                const filePath = path.join(dir, 'custom_data.proto');
                
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
                    path: `${relativePath}/custom_data.proto`
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
                const { name, description, items, totalSize } = JSON.parse(body);
                
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
                
                // 生成XML内容
                const timestamp = new Date().toISOString();
                let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
                xmlContent += '<CustomDataBlockConfig>\n';
                xmlContent += `  <Metadata>\n`;
                xmlContent += `    <Name>${this.escapeXml(name)}</Name>\n`;
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
                    const sizeMatch = content.match(/<TotalSize[^>]*>(\d+)<\/TotalSize>/);
                    const timeMatch = content.match(/<CreatedAt>(.*?)<\/CreatedAt>/);
                    
                    if (nameMatch) {
                        configs.push({
                            name: nameMatch[1],
                            description: descMatch ? descMatch[1] : '',
                            totalSize: sizeMatch ? parseInt(sizeMatch[1]) : 0,
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
            const fieldMatches = [...content.matchAll(/<Field[^>]*>([\s\S]*?)<\/Field>/g)];
            
            const items = fieldMatches.map(match => {
                const fieldContent = match[1];
                const itemName = fieldContent.match(/<Name>(.*?)<\/Name>/)?.[1] || '';
                const itemType = fieldContent.match(/<Type>(.*?)<\/Type>/)?.[1] || '';
                const minMatch = fieldContent.match(/<Min>(.*?)<\/Min>/);
                const maxMatch = fieldContent.match(/<Max>(.*?)<\/Max>/);
                
                const item = { name: itemName, type: itemType };
                if (minMatch && minMatch[1] !== 'null') item.min = parseFloat(minMatch[1]);
                if (maxMatch && maxMatch[1] !== 'null') item.max = parseFloat(maxMatch[1]);
                
                return item;
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: true, 
                config: {
                    name: nameMatch ? nameMatch[1] : name,
                    description: descMatch ? descMatch[1] : '',
                    items
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
                filePath = path.join(__dirname, '..', 'sdk', safeName, 'custom_data.proto');
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
            'uint16': 2, 'int16': 2,
            'uint32': 4, 'int32': 4, 'float': 4,
            'double': 8
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
                trimmed === '}') {
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
                            
                            <div class="field-list" @click.stop>
                                <div v-for="(field, fieldName) in msg.metadata.fields" :key="fieldName" class="field-item">
                                    <div class="field-left">
                                        <span class="field-name">{{ fieldName }}</span>
                                        <span class="field-type">({{ field.repeated ? 'repeated ' : '' }}{{ field.type }})</span>
                                        <div class="field-comment">{{ field.description || field.comment || '无说明' }}</div>
                                    </div>
                                    <div class="field-right" v-html="generateFieldInput(msg.name, fieldName, field)"></div>
                                </div>
                                
                                <div class="op-area" style="display: flex; gap: 10px; align-items: center; margin-top: 10px;">
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

                const uplinkCount = computed(() => messagesData.value?.clientMessages?.length || 0);
                const downlinkCount = computed(() => messagesData.value?.serverMessages?.length || 0);

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
                    
                    if (fieldMeta.type === 'uint32' || fieldMeta.type === 'int32') {
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

                async function sendDownlinkMessage(messageType) {
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
                                alert('❌ 未找到CustomByteBlock消息容器');
                                return;
                            }
                            
                            // 收集所有输入框的值
                            const data = {};
                            const inputs = container.querySelectorAll('.field-input');
                            inputs.forEach(input => {
                                const inputId = input.id;
                                if (!inputId.startsWith('input-CustomByteBlock-')) return;
                                
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
                            
                            if (Object.keys(data).length === 0) {
                                alert('⚠️ 请先选择配置并填写数据');
                                return;
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
                            } else if (dataType === 'uint32' || dataType === 'int32') {
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
                        else if (dataType === 'uint32' || dataType === 'int32') { value = parseInt(value) || 0; }
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
                        const data = collectMessageData(messageType);
                        const response = await fetch('/api/auto-publish', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messageType, enabled, intervalMs: intervalMs, topic: messageType, data })
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
                    if (!configName) {
                        // 清空字段
                        const container = document.querySelector('.message-item');
                        if (container) {
                            const fieldList = container.querySelector('.field-list');
                            if (fieldList) {
                                const opArea = fieldList.querySelector('.op-area');
                                fieldList.innerHTML = opArea ? opArea.outerHTML : '';
                            }
                        }
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
                        
                        for (let i = 0; i < lines.length; i++) {
                            const line = lines[i];
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
                        
                        // 查找CustomByteBlock消息容器
                        let container = null;
                        const messageItems = document.querySelectorAll('.message-item');
                        messageItems.forEach(item => {
                            const nameElement = item.querySelector('.message-name');
                            if (nameElement && (nameElement.textContent.includes('CustomByteBlock') || nameElement.textContent.includes('自定义数据块'))) {
                                container = item;
                            }
                        });
                        
                        if (!container) {
                            alert('❌ 未找到CustomByteBlock消息容器');
                            return;
                        }
                        
                        const fieldList = container.querySelector('.field-list');
                        if (!fieldList) {
                            alert('❌ 未找到字段列表容器');
                            return;
                        }
                        
                        // 保存操作按钮
                        const opArea = fieldList.querySelector('.op-area');
                        const opAreaHtml = opArea ? opArea.outerHTML : '';
                        
                        // 重新生成字段输入框
                        let html = '';
                        fields.forEach(field => {
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
                        
                        // 添加操作按钮（如果存在）
                        html += opAreaHtml;
                        
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
                    generateFieldInput, sendDownlinkMessage, toggleAutoPublish
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
