# RoboMaster 2026 自定义客户端 MQTT 通信协议说明文档

**版本：** V1.0.0 (20251127)
**通信格式：** Protobuf v3 (二进制流) over MQTT
**服务器地址：** `192.168.12.1` : `3333`

> **注意**：MQTT 的 Topic 名称即为 Protobuf 的 Message 名称。

---

## 1. 客户端 -> 服务器 (上行消息)

此类消息由自定义客户端发布 (Publish)，用于控制机器人、发送交互指令或上传数据。

### 1.1 `RemoteControl`
* **用途：** 传输鼠标键盘输入和自定义数据
* **频率：** 75Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `mouse_x` | int32 | 鼠标 x 轴移动速度，负值标识向左移动 |
| `mouse_y` | int32 | 鼠标 y 轴移动速度，负值标识向下移动 |
| `mouse_z` | int32 | 鼠标滚轮移动速度，负值标识向后滚动 |
| `left_button_down` | bool | 左键是否按下 (`false`: 抬起, `true`: 按下) |
| `right_button_down` | bool | 右键是否按下 (`false`: 抬起, `true`: 按下) |
| `keyboard_value` | uint32 | 键盘按键位掩码 |
| `mid_button_down` | bool | 中键是否按下 (`false`: 抬起, `true`: 按下) |
| `data` | bytes | 最大 30 字节的自定义数据 |

### 1.2 `MapClickInfoNotify`
* **用途：** 云台手地图点击标记
* **频率：** 触发式发送
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `is_send_all` | uint32 | 发送范围 (0: 指定客户端, 1: 除哨兵, 2: 包含哨兵) |
| `robot_id` | bytes | 目标机器人 ID 列表 (固定 7 字节) |
| `mode` | uint32 | 标记模式 (1: 地图, 2: 对方机器人) |
| `enemy_id` | uint32 | 标定的对方 ID |
| `ascii` | uint32 | 自定义图标 ASCII 码 |
| `type` | uint32 | 标记类型 (1: 攻击, 2: 防御, 3: 警戒, 4: 自定义) |
| `screen_x` | uint32 | 屏幕坐标 X (像素) |
| `screen_y` | uint32 | 屏幕坐标 Y (像素) |
| `map_x` | float | 地图坐标 X |
| `map_y` | float | 地图坐标 Y |

### 1.3 `AssemblyCommand`
* **用途：** 工程装配指令
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `operation` | uint32 | 装配操作类型 (1: 确认装配, 2: 取消装配) |
| `difficulty` | uint32 | 选中的装配难度 |

### 1.4 `RobotPerformanceSelectionCommand`
* **用途：** 步兵/英雄选择性能体系
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `shooter` | uint32 | 发射机构性能体系 (1: 冷却优先, 2: 爆发优先, 3: 英雄近战优先, 4: 英雄远程优先) |
| `chassis` | uint32 | 底盘性能体系 (1: 血量优先, 2: 功率优先, 3: 英雄近战优先, 4: 英雄远程优先) |

### 1.5 `HeroDeployModeEventCommand`
* **用途：** 英雄部署模式指令
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `mode` | uint32 | 模式 (0: 退出, 1: 进入) |

### 1.6 `RuneActivateCommand`
* **用途：** 能量机关激活指令
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `activate` | uint32 | 激活 (1: 开启) |

### 1.7 `DartCommand`
* **用途：** 飞镖控制指令
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `target_id` | uint32 | 目标 ID (1: 前哨站, 2: 基地固定目标, 3: 基地随机固定目标, 4: 基地随机移动目标, 5: 基地末端移动目标) |
| `open` | bool | 闸门开关 (true: 开启/闭合) |

### 1.8 `GuardCtrlCommand`
* **用途：** 哨兵控制指令请求
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `command_id` | uint32 | 指令编号 (1: 补血点补弹, 2: 补给站实体补弹, 3: 远程补弹, 4: 远程回血, 5: 确认复活, 6: 确认花费金币复活, 7: 地图标点, 8: 切换为进攻姿态, 9: 切换为防御姿态, 10: 切换为移动姿态) |

### 1.9 `AirSupportCommand`
* **用途：** 空中支援指令
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `command_id` | uint32 | 指令类型 (1: 免费呼叫, 2: 花费金币呼叫, 3: 中断) |

---

## 2. 服务器 -> 客户端 (下行消息)

此类消息由客户端订阅 (Subscribe)，用于接收实时比赛数据。

### 2.1 `GameStatus`
* **用途：** 同步比赛全局状态信息
* **频率：** 5Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `current_round` | uint32 | 当前局号 (从 1 开始) |
| `total_rounds` | uint32 | 总局数 |
| `red_score` | uint32 | 红方得分 |
| `blue_score` | uint32 | 蓝方得分 |
| `current_stage` | uint32 | 当前阶段 (0: 未开始, 1: 准备, 2: 自检, 3: 倒计时, 4: 比赛中, 5: 结算) |
| `stage_countdown_sec` | int32 | 当前阶段剩余时间 |
| `stage_elapsed_sec` | int32 | 当前阶段已过时间 (秒) |
| `is_paused` | bool | 是否暂停 |

### 2.2 `GlobalUnitStatus`
* **用途：** 同步基地、前哨站和所有机器人状态
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `base_health` | uint32 | 基地当前血量 (0: 已摧毀) |
| `base_status` | uint32 | 基地状态 (0: 无敌, 1: 解除无敌护甲未展开, 2: 解除无敌护甲展开) |
| `base_shield` | uint32 | 基地当前护盾值 (0: 无护盾) |
| `outpost_health` | uint32 | 前哨站当前血量 (0: 已摧毁) |
| `outpost_status` | uint32 | 前哨站状态 (0: 无敌, 1: 存活转, 2: 存活停, 3: 毁不可建, 4: 毁可建) |
| `robot_health` | repeated uint32 | 所有机器人血量 (先己方后对方) |
| `robot_bullets` | repeated int32 | 己方机器人剩余累计发弹量 |
| `total_damage_red` | uint32 | 己方累计总伤害 |
| `total_damage_blue` | uint32 | 对方累计总伤害 |

### 2.3 `GlobalLogisticsStatus`
* **用途：** 同步全局后勤信息
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `remaining_economy` | uint32 | 己方当前经济 |
| `total_economy_obtained` | uint64 | 己方累计总经济 |
| `tech_level` | uint32 | 己方科技等级 (工程机器人曾装配最高难度) |
| `encryption_level` | uint32 | 己方加密等级 (雷达解析信息波机制) |

### 2.4 `GlobalSpecialMechanism`
* **用途：** 同步正在生效的全局特殊机制
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `mechanism_id` | repeated uint32 | 正在生效的机制 ID 列表 (1: 己方堡垒被占领, 2: 对方堡垒被占领) |
| `mechanism_time_sec` | repeated int32 | 对应的时间参数 (秒) |

### 2.5 `Event`
* **用途：** 全局事件通知
* **频率：** 触发式发送
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `event_id` | int32 | 事件编号 (1: 击杀, 2: 基地被毁, ... 18: 基地护甲展开) |
| `param` | string | 事件参数 (含义随 event_id 变化) |

### 2.6 `RobotInjuryStat`
* **用途：** 机器人一次存活期间累计受伤统计
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `total_damage` | uint32 | 该次存活累计受伤总计 |
| `collision_damage` | uint32 | 撞击伤害 |
| `small_projectile_damage` | uint32 | 17mm 弹丸伤害 |
| `large_projectile_damage` | uint32 | 42mm 弹丸伤害 |
| `dart_splash_damage` | uint32 | 飞镖溅射伤害 |
| `module_offline_damage` | uint32 | 模块离线扣血 |
| `wifi_offline_damage` | uint32 | WiFi 离线扣血 |
| `penalty_damage` | uint32 | 判罚扣血 |
| `server_kill_damage` | uint32 | 服务器强制使其战亡扣血 |
| `killer_id` | uint32 | 击杀者 ID (若未检测到击杀者，值为 0) |

### 2.7 `RobotRespawnStatus`
* **用途：** 机器人复活状态同步
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `is_pending_respawn` | bool | 是否处于待复活状态 |
| `total_respawn_progress` | uint32 | 复活所需总读条 |
| `current_respawn_progress` | uint32 | 当前复活读条进度 |
| `can_free_respawn` | bool | 是否可以免费复活 |
| `gold_cost_for_respawn` | uint32 | 花费金币复活所需金币数 |
| `can_pay_for_respawn` | bool | 是否允许花费金币复活 |

### 2.8 `RobotStaticStatus`
* **用途：** 机器人固定属性和配置
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `connection_state` | uint32 | 连接状态 (0: 未连接, 1: 连接) |
| `field_state` | uint32 | 上场状态 (0: 已上场, 1: 未上场) |
| `alive_state` | uint32 | 存活状态 (0: 未知, 1: 存活, 2: 战亡) |
| `robot_id` | uint32 | 机器人编号 |
| `robot_type` | uint32 | 机器人类型 |
| `performance_system_shooter` | uint32 | 性能体系-发射机构 (1-4) |
| `performance_system_chassis` | uint32 | 性能体系-底盘 (1-4) |
| `level` | uint32 | 当前等级 |
| `max_health` | uint32 | 最大血量 |
| `max_heat` | uint32 | 最大热量 |
| `heat_cooldown_rate` | float | 热量冷却速率 (每秒) |
| `max_power` | uint32 | 最大功率 |
| `max_buffer_energy` | uint32 | 最大缓冲能量 |
| `max_chassis_energy` | uint32 | 最大底盘能量 |

### 2.9 `RobotDynamicStatus`
* **用途：** 机器人实时数据
* **频率：** 10Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `current_health` | uint32 | 当前血量 |
| `current_heat` | float | 当前热量 |
| `last_projectile_fire_rate` | float | 上一次弹丸射速 |
| `current_chassis_energy` | uint32 | 当前剩余底盘能量 |
| `current_buffer_energy` | uint32 | 当前缓冲能量 |
| `current_experience` | uint32 | 当前经验值 |
| `experience_for_upgrade` | uint32 | 升级所需经验 |
| `total_projectiles_fired` | uint32 | 累计已发弹量 |
| `remaining_ammo` | uint32 | 剩余允许发弹量 |
| `is_out_of_combat` | bool | 是否处于脱战状态 |
| `out_of_combat_countdown` | uint32 | 脱战状态倒计时 |
| `can_remote_heal` | bool | 是否可以远程补血 |
| `can_remote_ammo` | bool | 是否可以远程补弹 |

### 2.10 `RobotModuleStatus`
* **用途：** 机器人各模块运行状态
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 (0: 离线, 1: 在线) |
| :--- | :--- | :--- |
| `power_manager` | uint32 | 电源管理模块状态 |
| `rfid` | uint32 | RFID 模块状态 |
| `light_strip` | uint32 | 灯条模块状态 |
| `small_shooter` | uint32 | 17mm 发射机构状态 |
| `big_shooter` | uint32 | 42mm 发射机构状态 |
| `uwb` | uint32 | 定位模块状态 |
| `armor` | uint32 | 装甲模块状态 |
| `video_transmission` | uint32 | 图传模块状态 |
| `capacitor` | uint32 | 电容模块状态 |
| `main_controller` | uint32 | 主控状态 |

### 2.11 `RobotPosition`
* **用途：** 机器人空间坐标和朝向
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `x` | float | 世界坐标轴 X |
| `y` | float | 世界坐标轴 Y |
| `z` | float | 世界坐标轴 Z |
| `yaw` | float | 本机器人测速模块的朝向，单位: 度，正北为 0 度 |

### 2.12 `Buff`
* **用途：** Buff 效果信息
* **频率：** 获得增益时触发发送，此后 1Hz 定频发送直到失去增益
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `robot_id` | uint32 | 机器人 ID |
| `buff_type` | uint32 | Buff 类型 (1: 攻击, 2: 防御, 3: 冷却, 4: 功率, 5: 回血, 6: 发弹, 7: 地形) |
| `buff_level` | int32 | Buff 增益值 |
| `buff_max_time` | uint32 | Buff 最大剩余时间 |
| `buff_left_time` | uint32 | Buff 剩余时间 |
| `msg_params` | string | 额外文字参数 |

### 2.13 `PenaltyInfo`
* **用途：** 判罚信息同步
* **频率：** 触发式发送
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `penalty_type` | uint32 | 当前受罚类型 (1: 黄牌, 2: 双方黄牌, 3: 红牌, 4: 超功率, 5: 超热量, 6: 超射速) |
| `penalty_effect_sec` | uint32 | 当前受罚效果时长 (秒) |
| `total_penalty_num` | uint32 | 当前判罚数量 |

### 2.14 `RobotPathPlanInfo`
* **用途：** 哨兵轨迹规划信息
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `intention` | uint32 | 哨兵意图 (1: 攻击, 2: 防守, 3: 移动) |
| `start_pos_x` | uint32 | 起始点 X 坐标 (分米) |
| `start_pos_y` | uint32 | 起始点 Y 坐标 (分米) |
| `offset_x` | repeated int32 | 相对起始点 X 增量数组 |
| `offset_y` | repeated int32 | 相对起始点 Y 增量数组 |
| `sender_id` | uint32 | 发送者 ID |

### 2.15 `RaderInfoToClient`
* **用途：** 雷达发送的机器人位置信息
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `target_robot_id` | uint32 | 目标机器人 ID |
| `target_pos_x` | float | 目标位置 X (米) |
| `target_pos_y` | float | 目标位置 Y (米) |
| `torward_angle` | float | 朝向角度 |
| `is_high_light` | uint32 | 是否特殊标识 (0: 否, 1: 是) |

### 2.16 `CustomByteBlock`
* **用途：** 机器人自定义上传数据流 (机器人端对应 0x0310)
* **频率：** 50Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `data` | bytes | 最大为 1.2 kbit 的自定义数据包 |

### 2.17 `TechCoreMotionStateSync`
* **用途：** 科技核心运动状态同步
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `maximum_difficulty_level` | uint32 | 当前可选择的最高装配难度等级 |
| `status` | uint32 | 科技核心状态 (1: 未进入, 2-6: 各装配阶段) |

### 2.18 `RobotPerformanceSelectionSync`
* **用途：** 步兵/英雄性能体系状态同步
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `shooter` | uint32 | 发射机构性能体系 |
| `chassis` | uint32 | 底盘性能体系 |

### 2.19 `DeployModeStatusSync`
* **用途：** 英雄部署模式状态同步
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `status` | uint32 | 当前部署模式状态 (0: 未部署, 1: 已部署) |

### 2.20 `RuneStatusSync`
* **用途：** 能量机关状态同步
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `rune_status` | uint32 | 状态 (1: 未激活, 2: 正在激活, 3: 已激活) |
| `activated_arms` | uint32 | 当前已激活的灯臂数量 |
| `average_rings` | uint32 | 总环数 |

### 2.21 `SentinelStatusSync`
* **用途：** 哨兵姿态和弱化状态
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `posture_id` | uint32 | 姿态 ID (1: 进攻, 2: 防御, 3: 移动) |
| `is_weakened` | bool | 是否弱化 |

### 2.22 `DartSelectTargetStatusSync`
* **用途：** 飞镖目标选择状态同步
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `target_id` | uint32 | 目标 ID |
| `open` | bool | 闸门状态 |

### 2.23 `GuardCtrlResult`
* **用途：** 哨兵控制指令结果反馈
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `command_id` | uint32 | 对应的指令编号 |
| `result_code` | uint32 | 执行结果码 (0: 成功, 其他: 失败) |

### 2.24 `AirSupportStatusSync`
* **用途：** 空中支援状态反馈
* **频率：** 1Hz
* **QoS：** 1

| 变量名 | 数据类型 | 说明 |
| :--- | :--- | :--- |
| `airsupport_status` | uint32 | 状态 (0: 未进行, 1: 正在进行, 2: 被锁定) |
| `left_time` | uint32 | 免费空中支援剩余时间 |
| `cost_coins` | uint32 | 付费空中支援已花费金币 |