/**
 * @file custom_data.h
 * @brief 自定义数据块 SDK - 适用于 STM32/ARM 架构单片机
 * @note 串口协议：帧头(5B) + CMD_ID(2B) + 数据(nB) + 帧尾(2B CRC16)
 * @date 2025/12/3 02:02:30
 * @size 4 Bytes
 */

#ifndef CUSTOM_DATA_H
#define CUSTOM_DATA_H

#include <stdint.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

/* 串口协议常量 */
#define CUSTOM_DATA_SOF         0xA5      // 帧头起始符
#define CUSTOM_DATA_CMD_ID      0x0310    // 命令ID (自定义数据)
#define CUSTOM_DATA_ACTUAL_SIZE 4       // 实际数据长度
#define CUSTOM_DATA_SIZE        150       // 裁判系统要求固定150字节
#define CUSTOM_DATA_FRAME_SIZE  (5 + 2 + CUSTOM_DATA_SIZE + 2) // 总帧长度

/* 图片块协议常量 */
#define IMAGE_BLOCK_CMD_DATA    0x02      // 数据块类型
#define IMAGE_BLOCK_CMD_END     0x03      // 结束帧类型
#define IMAGE_BLOCK_DATA_SIZE   120       // 每块数据大小
#define IMAGE_BLOCK_SIZE        128       // ImageBlock结构大小

/**
 * @brief 图片块协议结构 (128字节)
 * @note 嵌入在150字节自定义数据块中，由外层协议提供SOF和CRC16保护
 */
#pragma pack(push, 1)
typedef struct {
    uint8_t cmd_type;         // 命令类型 (0x02=数据块, 0x03=结束帧)
    uint16_t img_id;          // 图片ID (唯一标识)
    uint16_t block_idx;       // 当前块索引 (从0开始)
    uint16_t total_block;     // 总块数
    uint8_t data_len;         // 有效数据长度 (1-120, 其余填0)
    uint8_t data[IMAGE_BLOCK_DATA_SIZE];  // 数据块 (120字节)
} ImageBlock_t;
#pragma pack(pop)

/**
 * @brief 纯数据结构（不含图片块）
 * @note 用于无图片传输场景，节省内存
 * @size 5 Bytes (1B类型 + 4B数据)
 */
#pragma pack(push, 1)
typedef struct {
    uint8_t packet_type; // 0x00: 纯数据
    int32_t TestEnergy;
    float TsetDegree;
} CustomData_t;
#pragma pack(pop)

/**
 * @brief 含图片的数据结构
 * @note 用于图片传输场景，包含图片块和伴随数据
 * @size 133 Bytes (1B类型 + 4B伴随数据 + 128B图片)
 */
#pragma pack(push, 1)
typedef struct {
    uint8_t packet_type; // 0x01: 含图片数据
    float TsetDegree; // 图片伴随数据
    ImageBlock_t DetectFrame; // 图片块 (128B)
} CustomDataWithImage_t;
#pragma pack(pop)

/* ========== 纯数据传输函数 ========== */

/**
 * @brief 写入纯数据（不含图片）
 * @param data 数据结构指针
 */
void CustomData_Write(const CustomData_t *data);

/**
 * @brief 打包纯数据帧
 * @param seq 包序号
 * @return 打包好的数据指针（159字节）
 */
uint8_t* CustomData_Pack(uint8_t seq);

/* ========== 含图片传输函数 ========== */

/**
 * @brief 写入含图片的数据
 * @param data 含图片的数据结构指针
 */
void CustomDataWithImage_Write(const CustomDataWithImage_t *data);

/**
 * @brief 打包含图片的数据帧
 * @param seq 包序号
 * @return 打包好的数据指针（159字节）
 */
uint8_t* CustomDataWithImage_Pack(uint8_t seq);

/**
 * @brief 获取打包后的帧长度
 * @return 帧长度（字节）
 */
static inline uint16_t CustomData_GetFrameSize(void) {
    return CUSTOM_DATA_FRAME_SIZE;
}

/* 图片块协议辅助函数 */

/**
 * @brief 填充图片数据块
 * @param block 图片块结构指针
 * @param img_id 图片ID
 * @param block_idx 当前块索引
 * @param total_block 总块数
 * @param data 数据指针
 * @param data_len 数据长度 (1-120)
 * @param is_end 是否为结束帧
 * @note 不包含CRC计算，由外层CustomDataWithImage_Pack统一处理
 */
void ImageBlock_Fill(ImageBlock_t *block, uint16_t img_id, uint16_t block_idx, uint16_t total_block, const uint8_t *data, uint8_t data_len, uint8_t is_end);

#ifdef __cplusplus
}
#endif

#endif // CUSTOM_DATA_H
