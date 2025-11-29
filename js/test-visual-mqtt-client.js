const mqtt = require('mqtt');
const protobuf = require('protobufjs');
const fs = require('fs');
const path = require('path');

class VisualMQTTTestClient {
    constructor() {
        this.client = null;
        this.protoRoot = null;
        this.sendInterval = null;
    }

    async loadProto() {
        try {
            const protoPath = path.join(__dirname, '..', 'proto', 'messages.proto');
            const protoText = fs.readFileSync(protoPath, 'utf8');
            const protoTextSanitized = protoText.replace(/^\s*package\s+\S+;\s*$/gm, '');
            const parsed = protobuf.parse(protoTextSanitized);
            this.protoRoot = parsed.root;
            console.log('✅ Protobuf 定义加载成功');
            return true;
        } catch (error) {
            console.error('❌ Protobuf 加载失败:', error.message);
            return false;
        }
    }

    connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 正在连接到 MQTT 服务器...');
            
            this.client = mqtt.connect('mqtt://127.0.0.1:3333', {
                clientId: 'visual-test-client-' + Math.random().toString(16).substring(2, 8),
                clean: true,
                connectTimeout: 4000,
                reconnectPeriod: 1000
            });

            this.client.on('connect', () => {
                console.log('✅ 已连接到 MQTT 服务器');
                
                // 订阅所有下行消息
                this.client.subscribe('#', (err) => {
                    if (err) {
                        console.error('❌ 订阅失败:', err.message);
                    } else {
                        console.log('📌 已订阅所有主题');
                    }
                });
                
                resolve();
            });

            this.client.on('error', (err) => {
                console.error('❌ MQTT 连接错误:', err.message);
                reject(err);
            });

            this.client.on('message', (topic, payload) => {
                this.handleMessage(topic, payload);
            });

            this.client.on('close', () => {
                console.log('📴 MQTT 连接已关闭');
            });
        });
    }

    handleMessage(topic, payload) {
        try {
            // 尝试解析服务器发送的下行消息
            const messageTypes = [
                'GameStatus',
                'RobotDynamicStatus',
                'RobotPosition',
                'GlobalUnitStatus',
                'GlobalLogisticsStatus',
                'Event',
                'Buff',
                'RobotStaticStatus'
            ];

            for (const msgType of messageTypes) {
                if (topic.includes(msgType) || topic === msgType) {
                    try {
                        const MessageType = this.protoRoot.lookupType(msgType);
                        const decoded = MessageType.decode(payload);
                        const obj = MessageType.toObject(decoded, {
                            longs: String,
                            enums: String,
                            bytes: String
                        });
                        
                        console.log(`📥 收到下行消息 - 主题: ${topic}, 类型: ${msgType}`);
                        console.log('   内容:', JSON.stringify(obj, null, 2));
                        return;
                    } catch (err) {
                        // 继续尝试下一个类型
                    }
                }
            }
            
            console.log(`📨 收到消息 - 主题: ${topic}, 大小: ${payload.length} 字节`);
            
        } catch (error) {
            console.error('❌ 处理消息失败:', error.message);
        }
    }

    startSendingUplinkMessages() {
        console.log('🚀 开始发送上行消息（每2秒一次）...');
        
        let count = 0;
        this.sendInterval = setInterval(() => {
            count++;
            
            // 轮流发送不同类型的上行消息
            const messageType = count % 3;
            
            switch (messageType) {
                case 0:
                    this.sendRemoteControl();
                    break;
                case 1:
                    this.sendMapClickInfo();
                    break;
                case 2:
                    this.sendAssemblyCommand();
                    break;
            }
        }, 2000);
    }

    sendRemoteControl() {
        try {
            const MessageType = this.protoRoot.lookupType('RemoteControl');
            
            const data = {
                mouseX: Math.floor(Math.random() * 200 - 100),
                mouseY: Math.floor(Math.random() * 200 - 100),
                mouseZ: Math.floor(Math.random() * 10 - 5),
                leftButtonDown: Math.random() > 0.5,
                rightButtonDown: Math.random() > 0.5,
                keyboardValue: Math.floor(Math.random() * 0xFFFFFF),
                midButtonDown: false,
                data: Buffer.from('test data')
            };
            
            const message = MessageType.create(data);
            const buffer = MessageType.encode(message).finish();
            
            this.client.publish('RemoteControl', buffer);
            console.log(`📤 发送上行消息 - 类型: RemoteControl, 大小: ${buffer.length} 字节`);
            
        } catch (error) {
            console.error('❌ 发送 RemoteControl 失败:', error.message);
        }
    }

    sendMapClickInfo() {
        try {
            const MessageType = this.protoRoot.lookupType('MapClickInfoNotify');
            
            const data = {
                isSendAll: 1,
                robotId: Buffer.from([1, 2, 3, 0, 0, 0, 0]),
                mode: 1,
                enemyId: 3,
                ascii: 65,
                type: 1,
                screenX: Math.floor(Math.random() * 1920),
                screenY: Math.floor(Math.random() * 1080),
                mapX: Math.random() * 28 - 14,
                mapY: Math.random() * 15 - 7.5
            };
            
            const message = MessageType.create(data);
            const buffer = MessageType.encode(message).finish();
            
            this.client.publish('MapClickInfoNotify', buffer);
            console.log(`📤 发送上行消息 - 类型: MapClickInfoNotify, 大小: ${buffer.length} 字节`);
            
        } catch (error) {
            console.error('❌ 发送 MapClickInfoNotify 失败:', error.message);
        }
    }

    sendAssemblyCommand() {
        try {
            const MessageType = this.protoRoot.lookupType('AssemblyCommand');
            
            const data = {
                operation: Math.random() > 0.5 ? 1 : 2,
                difficulty: Math.floor(Math.random() * 3) + 1
            };
            
            const message = MessageType.create(data);
            const buffer = MessageType.encode(message).finish();
            
            this.client.publish('AssemblyCommand', buffer);
            console.log(`📤 发送上行消息 - 类型: AssemblyCommand, 大小: ${buffer.length} 字节`);
            
        } catch (error) {
            console.error('❌ 发送 AssemblyCommand 失败:', error.message);
        }
    }

    stop() {
        if (this.sendInterval) {
            clearInterval(this.sendInterval);
            this.sendInterval = null;
        }

        if (this.client) {
            this.client.end();
        }
    }
}

// 主函数
(async () => {
    const client = new VisualMQTTTestClient();
    
    try {
        await client.loadProto();
        await client.connect();
        
        console.log('\n========================================');
        console.log('  可视化MQTT测试客户端已启动');
        console.log('========================================');
        console.log('📌 已订阅所有主题，等待接收下行消息');
        console.log('📤 将发送上行消息到服务器');
        console.log('🌐 打开浏览器查看: http://127.0.0.1:8080');
        console.log('========================================\n');
        
        // 开始发送上行消息
        client.startSendingUplinkMessages();
        
        // 优雅退出
        process.on('SIGINT', () => {
            console.log('\n\n⏹️ 正在关闭测试客户端...');
            client.stop();
            process.exit(0);
        });
        
    } catch (err) {
        console.error('❌ 启动失败:', err.message);
        process.exit(1);
    }
})();
