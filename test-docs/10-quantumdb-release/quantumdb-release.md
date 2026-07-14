# QuantumDB v3.0 版本发布说明

> **产品**：QuantumDB — 分布式时序数据库  
> **版本号**：v3.0.0 (Codename: "Helix")  
> **发布日期**：2026-07-01  
> **兼容性**：向前兼容 v2.x 数据格式，API 有少量不兼容变更  

---

## 1. 版本概述

QuantumDB v3.0 是自 v1.0 发布以来最大的一次架构升级。本次版本围绕**更高写入吞吐、列式存储引擎、SQL 兼容性增强**三大方向进行了全面重构。经过 6 个月的内测和 3 个月的公测，现已达到生产就绪状态。

### 1.1 核心数据

| 指标 | v2.5 | v3.0 | 变化 |
|------|------|------|------|
| 单节点写入吞吐 | 250 万点/秒 | 820 万点/秒 | **+228%** |
| 压缩率 | 8:1 | 15:1 | **+87.5%** |
| 聚合查询 (1 亿行) | 4.2s | 0.6s | **-85.7%** |
| 内存占用 (10M 时间序列) | 8.5 GB | 3.2 GB | **-62.4%** |
| 集群启动时间 | 45s | 12s | **-73.3%** |

---

## 2. 新特性

### 2.1 Helix 列式存储引擎

全新的列式存储引擎 Helix 替代了旧版 Delta 引擎，采用**列簇（Column Family）**设计：

```
时序数据表结构示意：

┌────────────────────────────────────────────┐
│ Table: sensor_data                         │
├────────┬──────────┬──────────┬─────────────┤
│  Time  │  Col A   │  Col B   │  Col C      │
│ (索引) │ (温度)    │ (湿度)    │ (压力)      │
├────────┼──────────┼──────────┼─────────────┤
│ 分区1  │ [列文件]  │ [列文件]  │ [列文件]    │
│ 分区2  │ [列文件]  │ [列文件]  │ [列文件]    │
│ 分区3  │ [列文件]  │ [列文件]  │ [列文件]    │
└────────┴──────────┴──────────┴─────────────┘
```

每个列独立存储和压缩，查询时只读取需要的列，大幅减少 I/O。

### 2.2 增强 SQL 支持

```sql
-- 新增：窗口函数支持
SELECT
    device_id,
    timestamp,
    temperature,
    AVG(temperature) OVER (
        PARTITION BY device_id
        ORDER BY timestamp
        RANGE BETWEEN INTERVAL '5' MINUTE PRECEDING AND CURRENT ROW
    ) AS moving_avg_5min
FROM sensor_data
WHERE timestamp >= NOW() - INTERVAL '1' HOUR;

-- 新增：时序专用聚合函数
SELECT
    device_id,
    TIME_BUCKET(timestamp, INTERVAL '15' MINUTE) AS bucket,
    FIRST(temperature, timestamp) AS first_temp,
    LAST(temperature, timestamp) AS last_temp,
    HISTOGRAM(temperature, 0, 50, 10) AS temp_distribution
FROM sensor_data
GROUP BY device_id, bucket;

-- 新增：ASOF 连接（时序对齐查询）
SELECT a.timestamp, a.device_id, a.temperature, b.pressure
FROM temp_readings a
ASOF JOIN pressure_readings b
    ON a.device_id = b.device_id
    AND a.timestamp >= b.timestamp;
```

### 2.3 多级压缩策略

| 压缩算法 | 适用类型 | 压缩比 | CPU 开销 |
|----------|----------|--------|----------|
| Delta-of-Delta | 时间戳 | 40:1+ | 极低 |
| Gorilla | 浮点数 | 10:1+ | 低 |
| ZSTD (字典) | 字符串标签 | 8:1+ | 中 |
| Simple8b | 整数 | 5:1+ | 极低 |
| LZ4 | 不可压缩数据 | 1.5:1 | 极低 |

---

## 3. 破坏性变更

### 3.1 API 变更

| 变更项 | v2.x 行为 | v3.0 行为 | 迁移方案 |
|--------|-----------|-----------|----------|
| `GET /api/v1/query` | 返回 `data` 字段 | 返回 `rows` 字段 | 修改响应解析逻辑 |
| 时间精度 | 毫秒 | **纳秒**（默认） | 查询时添加 `?precision=ms` |
| 认证方式 | Basic Auth | **Bearer Token** | 重新申请 API Token |
| 默认端口 | 8086 | 8086 (HTTP) / **9086 (gRPC)** | 防火墙开放新端口 |

### 3.2 配置变更

```yaml
# 旧配置（v2.x，已废弃）
storage:
  engine: delta
  wal_path: /var/lib/quantumdb/wal

# 新配置（v3.0）
storage:
  engine: helix            # 必须显式指定
  wal:
    path: /var/lib/quantumdb/wal
    fsync: true            # 新增：强制刷新
    batch_size: 16384      # 新增：批量写入大小
  column_families:
    default:
      compression: zstd
      block_size: 64KB
```

---

## 4. 已修复的 Bug

本次版本修复了 127 个 Issue，以下是高优先级修复：

| Issue # | 严重级别 | 描述 | 影响版本 |
|---------|----------|------|----------|
| #2841 | Critical | 节点分裂时偶发数据丢失 | 2.5.0 - 2.5.3 |
| #2756 | High | 大量 TTL 删除导致 GC 压力过大 | 2.4.0+ |
| #2612 | High | WAL 损坏后无法自动恢复 | 2.3.0 - 2.5.4 |
| #3015 | Medium | Prometheus 远程写入超时 | 2.5.2+ |
| #2988 | Medium | 时区转换偏移 1 小时 | 2.5.0+ |

---

## 5. 升级指南

### 5.1 升级前检查

- [ ] 确认当前运行版本 ≥ 2.5.0（否则需要先升级到 2.5.x）
- [ ] 备份配置文件和数据目录
- [ ] 在 staging 环境验证兼容性
- [ ] 检查自定义插件是否兼容新 API
- [ ] 通知下游使用方 API 变更事项

### 5.2 升级步骤

```bash
# 1. 优雅关闭集群
quantumdb-admin cluster stop --mode graceful

# 2. 备份数据
tar -czf quantumdb-backup-$(date +%Y%m%d).tar.gz /var/lib/quantumdb/

# 3. 升级二进制文件
dpkg -i quantumdb-server_3.0.0_amd64.deb
dpkg -i quantumdb-client_3.0.0_amd64.deb

# 4. 数据格式迁移
quantumdb-admin migrate --from 2.5 --to 3.0 --data-dir /var/lib/quantumdb/

# 5. 启动新版本
quantumdb-admin cluster start --version-check=false

# 6. 验证升级
quantumdb-cli --version    # 应输出 3.0.0
quantumdb-cli health       # 检查所有节点健康状态
```

---

## 6. 已知问题

| 问题 | 影响 | 绕过方法 | 计划修复 |
|------|------|----------|----------|
| gRPC 流查询大数据集时偶发断连 | < 0.1% 查询 | 使用 HTTP API 替代 | 3.0.1 |
| Helix 引擎与旧版备份工具不兼容 | 备份恢复 | 使用 v3.0 内置备份工具 | 3.0.1 |
| ARM64 平台压缩性能低于预期 | 写入延迟 +15% | 使用 x86_64 部署 | 3.1.0 |

---

## 7. 废弃通知

以下功能将在 v3.2 中移除，请尽快迁移：

- **Delta 存储引擎** → 使用 Helix 引擎替代
- **InfluxQL 查询语法** → 使用标准 SQL 替代
- **UDP 写入协议** → 使用 HTTP/gRPC 替代
- **v1 API 端点** → 使用 `/api/v2` 端点替代

---

> 📦 下载地址：https://releases.quantumdb.io/3.0.0/  
> 📖 完整文档：https://docs.quantumdb.io/v3.0/  
> 🐛 Issue 跟踪：https://github.com/quantumdb/quantumdb/issues  

*QuantumDB Team — Making Time Series Fast Again™*
