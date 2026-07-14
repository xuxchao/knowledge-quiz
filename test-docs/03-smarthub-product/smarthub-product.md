# SmartHub 智能家居中控系统 — 产品白皮书

> **产品代号**：SmartHub Pro X1  
> **文档版本**：v2.4  
> **目标受众**：集成商、终端用户、地产开发商  
> **发布日期**：2026-07-01  

---

## 1. 产品概述

SmartHub Pro X1 是新一代全屋智能中控系统，整合了**环境感知、语音交互、能源管理和安防监控**四大核心能力。产品采用边缘计算架构，在网络断开时仍可维持基础自动化逻辑。

### 1.1 产品定位

SmartHub 面向**200㎡ 以上大平层和别墅**用户群体，填补了市面上轻量级智能音箱与专业级楼宇控制系统之间的空白。

### 1.2 核心卖点

- 🏠 **全协议兼容**：Zigbee 3.0 / Wi-Fi 6 / Thread / BLE Mesh 四模合一
- 🧠 **本地 AI 推理**：NPU 算力 6 TOPS，无需云端即可完成人脸识别和场景判断
- ⚡ **零感知切换**：停电自动切换到备用电池，续航 8 小时
- 🔐 **金融级安全**：国密 SM2/SM4 加密芯片，通过等保三级认证

---

## 2. 技术规格

### 2.1 硬件参数

| 参数 | 规格 |
|------|------|
| 处理器 | ARM Cortex-A78 四核 2.4 GHz |
| NPU | 6 TOPS (int8) |
| 内存 | 8 GB LPDDR5 |
| 存储 | 128 GB eMMC + MicroSD 扩展槽(最大 1 TB) |
| 网络 | Wi-Fi 6 (802.11ax), 千兆以太网 |
| IoT 协议 | Zigbee 3.0, Thread 1.3, BLE 5.3, IR |
| 音频 | 4 麦克风阵列 + 双喇叭 (10W×2) |
| 显示 | 7 英寸 IPS 触摸屏 (1920×1200) |
| 尺寸 | 180mm × 120mm × 35mm |
| 电源 | DC 12V/3A，内置 5000mAh 备用电池 |

### 2.2 软件能力

```yaml
系统层:
  OS: SmartOS 3.2 (基于 Linux 6.6 LTS)
  容器运行时: Podman 4.x
  
AI 引擎:
  语音识别: 离线 + 云端混合模式
  人脸识别: 本地推理，识别速度 < 200ms
  场景推荐: 基于用户习惯的联邦学习模型
  
自动化:
  规则引擎: 支持 if-then-else 条件组合
  场景联动: 支持 500+ 设备同时联动
  地理围栏: 基于手机位置的家庭/离家模式
```

---

## 3. 核心功能模块

### 3.1 环境管理

```json
{
  "environment": {
    "temperature": {
      "range": "16°C - 30°C",
      "precision": 0.5,
      "sensors": ["客厅", "主卧", "次卧", "书房", "厨房"]
    },
    "humidity": {
      "target": "40% - 60%",
      "dehumidifier_trigger": 65,
      "humidifier_trigger": 35
    },
    "air_quality": {
      "pm25_threshold": 75,
      "co2_threshold": 1000,
      "automatic_ventilation": true
    }
  }
}
```

### 3.2 安防监控

| 模式 | 触发条件 | 响应动作 | 通知方式 |
|------|----------|----------|----------|
| 在家模式 | 门窗传感器 + 红外探测 | 声光告警 | App 推送 + 本地语音 |
| 离家模式 | 所有安防传感器 | 警笛 + 录像 | App + 短信 + 电话 |
| 夜间模式 | 仅外围传感器触发 | 静默告警 | App 推送 |
| 紧急模式 | SOS 按钮/关键词 | 全屋警报 + 开灯 | App + 紧急联系人 |

### 3.3 能源管理

```
智能电价调度策略：

电价低谷（22:00-06:00）
  ├── 电动车充电启动
  ├── 储能电池充电
  └── 热水器预热

电价高峰（10:00-12:00, 14:00-17:00）
  ├── 空调温度上调 1-2°C
  ├── 储能电池放电
  └── 关闭非必要电器

普通时段
  └── 正常运行，适度节能
```

---

## 4. 安装与部署

### 4.1 安装前检查清单

| 检查项目 | 要求 | 工具 |
|----------|------|------|
| 网络环境 | 2.4GHz Wi-Fi 信号 ≥ -65 dBm | 手机 Wi-Fi 分析仪 |
| 电力供应 | 预留 86 底盒 12V 供电 | 万用表 |
| 墙面位置 | 距地面 1.4m，避开金属遮挡 | 卷尺 |
| Zigbee 信号 | 与网关距离 ≤ 15m | SmartHub App |
| 已有设备兼容性 | 参见兼容性列表附录B | 文档查询 |

### 4.2 配网流程

```bash
# 开发者模式：通过 SSH 直接配置（高级用户）
ssh admin@smarthub.local -p 2222

# 查看设备列表
smarthub-cli device list --protocol zigbee

# 添加 Zigbee 设备
smarthub-cli device pair --protocol zigbee --mode permit-join-60s

# 导出当前配置
smarthub-cli config export --output /mnt/sdcard/backup-20260701.json
```

---

## 5. 场景配置示例

### 5.1 回家模式

```
触发条件：智能门锁指纹验证成功 | 地理围栏进入 200m 范围
    │
    ├── 玄关灯：渐亮至 80%（2 秒过渡）
    ├── 客厅窗帘：打开（如果时间在日出-日落后 1 小时）
    ├── 客厅空调：启动并设为 24°C
    ├── 客厅音响：播放欢迎音乐（音量 30%）
    ├── 空气净化器：自动模式
    └── 语音播报："欢迎回家，当前室内温度 28°C，空调已开启"
```

### 5.2 观影模式（联动 15 个设备）

| 步骤 | 设备 | 操作 | 延迟 |
|------|------|------|------|
| 1 | 客厅主灯 | 关闭 | 0s |
| 2 | 电视背景灯带 | 暖黄色 40% | 0s |
| 3 | 客厅窗帘 | 关闭 | 0s |
| 4 | 电视 | HDMI-CEC 开机 | 1s |
| 5 | 功放 | 开机，切换至 HDMI1 | 1s |
| 6 | 空调 | 调至 25°C，低风速 | 2s |
| 7 | 氛围灯 | 背面蓝色，渐变 | 2s |

---

## 6. API 与集成

### 6.1 本地 REST API 接口列表

| 端点 | 方法 | 描述 | 鉴权 |
|------|------|------|------|
| `/api/v2/devices` | GET | 获取所有设备状态 | API Key |
| `/api/v2/devices/{id}` | GET/PUT | 获取/控制单个设备 | API Key |
| `/api/v2/scenes` | GET | 获取场景列表 | API Key |
| `/api/v2/scenes/{id}/execute` | POST | 激活场景 | API Key |
| `/api/v2/energy/report` | GET | 获取能耗报告 | API Key |
| `/api/v2/system/status` | GET | 系统健康状态 | Token |

### 6.2 场景触发 Webhook

```python
import requests
import hashlib
import hmac
import time

def trigger_scene(scene_id: str, api_key: str, secret: str):
    """通过 Webhook 触发 SmartHub 场景"""
    timestamp = str(int(time.time()))
    body = f'{{"scene_id": "{scene_id}", "timestamp": {timestamp}}}'

    signature = hmac.new(
        secret.encode(),
        body.encode(),
        hashlib.sha256
    ).hexdigest()

    response = requests.post(
        "https://smarthub.local/api/v2/scenes/execute",
        headers={
            "X-API-Key": api_key,
            "X-Signature": signature,
            "X-Timestamp": timestamp,
            "Content-Type": "application/json"
        },
        data=body,
        verify=False  # 本地设备使用自签名证书
    )
    return response.json()
```

---

## 7. 兼容性列表

### 7.1 已认证生态品牌

| 品牌 | 协议 | 设备数量 | 认证状态 |
|------|------|----------|----------|
| Philips Hue | Zigbee | 45+ | ✅ 深度集成 |
| Aqara | Zigbee | 30+ | ✅ 认证 |
| SONOFF | Zigbee/Wi-Fi | 20+ | ✅ 认证 |
| Tuya | Wi-Fi/BLE | 100+ | ✅ 社区认证 |
| Eve Systems | Thread | 12 | ✅ 认证 |
| Xiaomi | BLE Mesh | 25+ | ✅ 认证 |

---

## 8. 售后服务与保修

| 服务项目 | 标准版 | Pro 版 | 企业版 |
|----------|--------|--------|--------|
| 硬件保修 | 1 年 | 3 年 | 5 年 |
| 远程技术支持 | 工作日 9-18 | 7×12 小时 | 7×24 小时 |
| 上门服务 | 付费 | 2 次/年 | 4 次/年 |
| 软件更新 | 3 年 | 5 年 | 终身 |
| 安装指导 | 在线文档 | 1 次远程视频 | 1 次上门 |

---

## 9. 常见问题

**Q: SmartHub 断网后还能工作吗？**  
A: 可以。所有自动化规则和语音命令都在本地执行，仅语音识别的高级语义理解和远程控制需要网络。

**Q: 支持哪些语音助手？**  
A: 内置 SmartVoice 引擎，同时兼容 Alexa、Google Assistant 和小爱同学。

**Q: 最多支持多少个设备？**  
A: SmartHub Pro X1 最多支持 512 个直接连接设备和 2048 个通过子网关桥接的设备。

---

*© 2026 SmartHome Technologies Inc. 保留所有权利。*
