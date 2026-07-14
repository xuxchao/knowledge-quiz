# DataVault 企业级数据备份恢复系统 — 用户手册

> **产品名称**：DataVault Enterprise Backup System  
> **软件版本**：v4.2  
> **文档编号**：DV-UM-2026-07  
> **适用角色**：系统管理员 / IT 运维  

---

## 1. 产品简介

DataVault 是面向企业环境的一体化数据保护平台，支持**数据库、文件系统、虚拟机、云存储**四种数据源的集中备份与快速恢复。

### 1.1 功能矩阵

| 功能模块 | 描述 | 许可要求 |
|----------|------|----------|
| 定时备份 | 按 Cron 表达式执行备份计划 | 基础版 |
| 增量备份 | 仅备份自上次备份后变化的数据块 | 基础版 |
| 实时保护 | CDP（连续数据保护），秒级 RPO | 企业版 |
| 跨地域复制 | 备份数据异地容灾 | 企业版 |
| 即时恢复 | 无需回拷，直接在备份存储上运行 | 企业版 |
| 勒索软件检测 | AI 异常检测 + 不可变快照 | 高级版 |

### 1.2 系统架构

```
┌─────────────── 管理控制台（Web UI）────────────────┐
│  策略管理 │ 任务监控 │ 恢复向导 │ 审计日志 │ 报表  │
└───────────────────────┬───────────────────────────┘
                        │ REST API (HTTPS)
┌───────────────────────▼───────────────────────────┐
│              DataVault Server                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │调度引擎   │ │策略引擎   │ │存储抽象层        │   │
│  └──────────┘ └──────────┘ └──────────────────┘   │
└───────┬──────────────────────────────────┬────────┘
        │                                  │
   ┌────▼────┐                       ┌─────▼─────┐
   │ Agent 层 │                       │ 存储后端   │
   │ ┌──────┐ │                       │ ┌────────┐ │
   │ │MySQL │ │                       │ │ 本地NAS │ │
   │ │Mongo │ │                       │ │ S3/MinIO│ │
   │ │ VM   │ │                       │ │ 磁带库  │ │
   │ └──────┘ │                       │ └────────┘ │
   └─────────┘                       └───────────┘
```

---

## 2. 快速入门

### 2.1 安装与初始化

```bash
# 1. 解压安装包
tar -xzf datavault-server-4.2.0-linux-amd64.tar.gz
cd datavault-server-4.2.0

# 2. 运行安装脚本
sudo ./install.sh \
  --data-dir /data/datavault \
  --log-dir /var/log/datavault \
  --port 8443

# 3. 初始化配置数据库
dvadmin init \
  --db-type postgresql \
  --db-url "postgresql://dvuser:secret@localhost:5432/datavault"

# 4. 创建管理员账户
dvadmin user create \
  --username admin \
  --role superadmin \
  --email admin@company.com

# 5. 启动服务
sudo systemctl enable datavault-server
sudo systemctl start datavault-server

# 6. 验证服务状态
dvadmin status
# 期望输出：Server: RUNNING | Scheduler: RUNNING | Agents: 0 connected
curl -k https://localhost:8443/api/v1/health
```

### 2.2 添加备份源

```yaml
# 通过配置文件批量添加 MySQL 备份源
# /etc/datavault/sources.d/mysql-production.yaml
sources:
  - name: prod-mysql-master
    type: mysql
    host: 10.0.1.50
    port: 3306
    credentials:
      type: vault          # 支持 vault / env / plain
      path: secret/datavault/prod-mysql
    databases:
      - name: order_db
        priority: critical  # critical / high / normal / low
      - name: user_db
        priority: critical
      - name: log_db
        priority: low
    options:
      consistent_snapshot: true
      lock_timeout: 120
      compress: zstd
      parallel_threads: 4
```

---

## 3. 备份策略配置

### 3.1 策略模板

| 策略模板 | 全量备份 | 增量备份 | 保留周期 | 适用数据 |
|----------|----------|----------|----------|----------|
| 金融合规 | 每日 | 每小时 | 90 天 + 7 年归档 | 交易数据 |
| 核心业务 | 每周 | 每日 | 60 天 | 业务数据库 |
| 开发测试 | 每周 | 无 | 14 天 | 测试环境 |
| 文件归档 | 每月 | 每周 | 365 天 | 文档/合同 |

### 3.2 创建备份策略

```json
{
  "name": "核心业务 MySQL 备份策略",
  "schedule": {
    "full": {
      "cron": "0 2 * * 0",
      "description": "每周日凌晨 2:00 全量备份"
    },
    "incremental": {
      "cron": "0 */6 * * 1-6",
      "description": "周一至周六每 6 小时增量备份"
    }
  },
  "retention": {
    "full_backups": 8,
    "incremental_backups": 42,
    "archive_after_days": 60
  },
  "storage": {
    "primary": "local-nas",
    "replica": "s3-archive",
    "replica_delay_hours": 2
  },
  "verification": {
    "auto_verify": true,
    "verify_schedule": "0 8 * * 1",
    "verify_sample_ratio": 0.05
  },
  "notification": {
    "on_success": ["email:ops-team@company.com"],
    "on_failure": ["email:ops-team@company.com", "sms:+8613800138000"],
    "on_warning": ["webhook:https://hooks.slack.com/xxx"]
  }
}
```

---

## 4. 数据恢复

### 4.1 恢复类型

| 恢复类型 | 操作粒度 | 最快恢复时间 | 说明 |
|----------|----------|--------------|------|
| 即时挂载 | 整个备份集 | < 1 分钟 | 直接在备份存储上挂载为可读写卷 |
| 快速恢复 | 单个数据库/卷 | 5-15 分钟 | 按需回拷必要数据块 |
| 完整恢复 | 整个备份集 | 取决于数据量 | 完整回拷所有数据 |
| 粒度恢复 | 单表/单文件 | < 5 分钟 | 无需恢复整个备份集 |

### 4.2 恢复操作示例

```bash
# CLI 方式执行恢复
dvadmin restore create \
  --source prod-mysql-master \
  --type point-in-time \
  --timestamp "2026-07-13 14:30:00" \
  --database order_db \
  --target staging-mysql \
  --mode fast

# 查看恢复任务进度
dvadmin restore status --task-id restore-20260713-001

# 验证恢复结果
dvadmin restore verify --task-id restore-20260713-001
```

---

## 5. 监控与告警

### 5.1 核心指标

| 指标类别 | 关键指标 | 正常范围 | 告警阈值 |
|----------|----------|----------|----------|
| 备份成功率 | 近 7 天成功率 | 100% | < 99% |
| 备份窗口 | 备份耗时 vs 分配窗口 | < 80% 窗口 | > 90% 窗口 |
| 存储利用率 | 备份存储空间使用率 | < 75% | > 85% |
| RPO 达标率 | 实际 RPO vs SLA RPO | 100% | < 99.5% |
| 数据可恢复率 | 验证成功/总验证次数 | 100% | < 99.9% |

---

## 6. 安全最佳实践

### 6.1 备份数据加密

```yaml
encryption:
  algorithm: AES-256-GCM
  key_management: external-kms
  kms:
    provider: hashicorp-vault
    key_path: transit/keys/datavault-backup
    auto_rotation_days: 90
  
immutable_backup:
  enabled: true
  retention_lock_days: 30
  compliance_mode: false
```

### 6.2 3-2-1 备份原则实现

| 要求 | DataVault 实现 |
|------|---------------|
| **3** 份数据副本 | 生产数据 + 本地备份 + 异地副本 |
| **2** 种不同介质 | NAS (HDD) + S3 对象存储 |
| **1** 份异地副本 | 自动跨地域复制到远程站点 |

---

## 7. 故障排除

| 问题现象 | 排查步骤 | 解决方案 |
|----------|----------|----------|
| 备份任务失败 | `dvadmin task list --failed` | 检查 Agent 连接和磁盘空间 |
| 恢复速度慢 | `dvadmin perf report` | 增加并行恢复线程数 |
| 存储空间告急 | `dvadmin storage usage` | 手动清理过期备份或扩容 |
| Agent 未连接 | `dvadmin agent list` | 检查 Agent 服务及证书有效性 |

---

*如遇紧急问题，请拨打 7×24 技术支持热线：400-XXX-XXXX*
