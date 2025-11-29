const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

// 设置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
// 设置 ffprobe 路径（用于获取帧率）
try {
    ffmpeg.setFfprobePath(ffprobeInstaller.path);
} catch (e) {
    console.warn('⚠️ 无法设置 ffprobe 路径:', e.message);
}

class UDPVideoStreamer {
    constructor(port = 3334, host = '127.0.0.1') {
        this.port = port;
        this.host = host;
        this.socket = dgram.createSocket('udp4');
        this.frameNumber = 0;
        this.isStreaming = false;
        this.maxPacketSize = 1400; // UDP 最大包大小（减去8字节头部后的有效载荷）
    this.lastSendAt = 0;
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.socket.on('error', (err) => {
                console.error(`❌ UDP 发送套接字错误: ${err.message}`);
                reject(err);
            });

            // 不绑定目标端口(3334)，以免占用客户端监听端口。
            // 发送端只需向目标地址发送数据即可，操作系统会分配临时源端口。
            console.log(`✅ UDP 视频流服务就绪（发送目标: ${this.host}:${this.port}）`);
            this.isStreaming = true;
            this.streamVideo();
            resolve();
        });
    }

    async streamVideo() {
        const videoDir = path.join(__dirname, '..', 'VideoSource');
        
        // 查找视频文件
        if (!fs.existsSync(videoDir)) {
            console.error('❌ VideoSource 文件夹不存在');
            return;
        }

        const files = fs.readdirSync(videoDir).filter(file => 
            file.endsWith('.mp4') || file.endsWith('.avi') || file.endsWith('.mov')
        );

        if (files.length === 0) {
            console.error('❌ VideoSource 文件夹中没有找到视频文件');
            return;
        }

        const videoFile = path.join(videoDir, files[0]);
        console.log(`📹 正在处理视频文件: ${files[0]}`);

        // 获取视频帧率 (FPS)，用于按帧发送
        let fps = 25; // 默认值
        try {
            const probe = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(videoFile, (err, metadata) => {
                    if (err) return reject(err);
                    resolve(metadata);
                });
            });
            const vstream = (probe.streams || []).find(s => s.codec_type === 'video');
            if (vstream) {
                const r = vstream.r_frame_rate || vstream.avg_frame_rate || vstream.frame_rate;
                if (r && typeof r === 'string') {
                    const parts = r.split('/').map(Number);
                    if (parts.length === 2 && parts[1] !== 0) {
                        fps = parts[0] / parts[1];
                    } else if (!isNaN(Number(r))) {
                        fps = Number(r);
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ 无法获取视频帧率，使用默认 25 fps:', e.message);
        }

    const frameIntervalMs = Math.max(10, Math.round(1000 / fps));
    // 保存到实例便于 sendFrame 日志打印与检测
    this.frameIntervalMs = frameIntervalMs;

        // 使用 libx265 (HEVC) 编码并以原始流输出；如果运行时缺少编码器会抛出错误并在5秒后重试
        const command = ffmpeg(videoFile)
            .inputOptions(['-re']) // 以实际帧率读取输入
            .videoCodec('libx265')
            .outputOptions([
                '-f hevc',           // 输出格式为 HEVC 原始流
                '-preset ultrafast', // 快速编码
                '-tune zerolatency', // 低延迟
                '-an'                // 不处理音频
            ])
            .on('start', (cmd) => {
                console.log('🎬 FFmpeg 命令:', cmd);
            })
            .on('error', (err) => {
                console.error('❌ FFmpeg 错误:', err.message);
                // 清理定时器
                try { clearInterval(frameTimer); } catch (e) {}
                // 5秒后重试
                setTimeout(() => this.streamVideo(), 5000);
            })
            .on('end', () => {
                console.log('🔄 视频处理完成，重新开始循环...');
                this.frameNumber = 0;
                // 重新开始循环
                setTimeout(() => this.streamVideo(), 1000);
            });

        // 使用流式处理
        let stream = command.pipe();
        // 将收到的数据缓冲并按帧率定时 flush（发送）
        let pendingFrameBuf = Buffer.alloc(0);
        let lastFlushAt = Date.now();
        const maxBufferedBytes = this.maxPacketSize * 500; // 约 700kB
        const maxBufferedMs = frameIntervalMs * 4; // 超过此时间窗口则丢弃并重置

        const frameTimer = setInterval(() => {
            if (!this.isStreaming) return;
            const now = Date.now();
            // 如果没有数据，则跳过
            if (pendingFrameBuf.length === 0) {
                lastFlushAt = now;
                return;
            }

            // 如果缓冲区过大或积压超过多帧，丢掉以前的内容，保留近期数据
            if (pendingFrameBuf.length > maxBufferedBytes || (now - lastFlushAt) > maxBufferedMs) {
                console.warn('⚠️ pendingFrameBuf 积压过大，执行丢弃并重置');
                pendingFrameBuf = Buffer.alloc(0);
                lastFlushAt = now;
                return;
            }

            // 发送一帧（当前缓冲）
            this.sendFrame(pendingFrameBuf);
            pendingFrameBuf = Buffer.alloc(0);
            lastFlushAt = now;
        }, frameIntervalMs);

        // 只追加到 pendingFrameBuf，实际发送由 frameTimer 控制，避免重复发送
        stream.on('data', (chunk) => {
            pendingFrameBuf = Buffer.concat([pendingFrameBuf, chunk]);
        });

        stream.on('end', () => {
            if (pendingFrameBuf.length > 0) {
                this.sendFrame(pendingFrameBuf);
                pendingFrameBuf = Buffer.alloc(0);
            }
            // 清理定时器
            clearInterval(frameTimer);
        });
    }

    sendFrame(frameData) {
        if (!this.isStreaming) return;

        this.frameNumber++;
        const totalBytes = frameData.length;
        const payloadSize = this.maxPacketSize - 8; // 减去8字节头部
        const totalPackets = Math.ceil(totalBytes / payloadSize);

    const now = Date.now();
    const delta = this.lastSendAt ? (now - this.lastSendAt) : 0;
    this.lastSendAt = now;
    console.log(`📤 发送帧 #${this.frameNumber}, 大小: ${totalBytes} 字节, 分 ${totalPackets} 个包, 间隔: ${delta} ms (目标: ${this.frameIntervalMs} ms)`);

        for (let packetIndex = 0; packetIndex < totalPackets; packetIndex++) {
            const start = packetIndex * payloadSize;
            const end = Math.min(start + payloadSize, totalBytes);
            const payload = frameData.slice(start, end);

            // 构造 8 字节头部
            const header = Buffer.alloc(8);
            header.writeUInt16BE(this.frameNumber & 0xFFFF, 0);      // 帧编号 (2 bytes)
            header.writeUInt16BE(packetIndex, 2);                     // 分片序号 (2 bytes)
            header.writeUInt32BE(totalBytes, 4);                      // 总字节数 (4 bytes)

            // 合并头部和载荷
            const packet = Buffer.concat([header, payload]);

            // 发送 UDP 包
            this.socket.send(packet, this.port, this.host, (err) => {
                if (err) {
                    console.error(`❌ UDP 发送错误: ${err.message}`);
                }
            });
        }
    }

    stop() {
        this.isStreaming = false;
        if (this.socket) {
            this.socket.close();
            console.log('⏹️  UDP 视频流服务已停止');
        }
    }
}

module.exports = UDPVideoStreamer;
