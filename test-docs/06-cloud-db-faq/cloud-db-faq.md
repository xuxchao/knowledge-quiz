# 企业云数据库迁移与优化 FAQ

> **文档类型**：常见问题解答  
> **适用产品**：TencentDB / AWS RDS / AliCloud RDS  
> **版本**：v3.1  
> **最后更新**：2026-07-05  

---

## 一、迁移准备阶段

### Q1：迁移前需要评估哪些关键指标？

**A：** 迁移评估需从以下维度进行全面审视：

| 评估维度 | 具体指标 | 评估工具 |
|----------|----------|----------|
| 数据规模 | 总数据量（GB）、表数量、最大表单行数 | `information_schema.TABLES` |
| 读写特性 | QPS / TPS，读多写少还是均衡型 | `performance_schema` |
| 延迟要求 | P99 查询延迟、主从复制延迟目标 | 慢查询日志分析 |
| 兼容性 | 存储引擎、字符集、特殊数据类型 | 数据库兼容性检查工具 |
| 安全合规 | 数据加密要求、审计日志保留策略 | 合规检查清单 |

### Q2：自建 MySQL 5.7 迁移到云数据库有哪些风险点？

**A：** 主要风险点包括：

1. **字符集不兼容**：自建库常用 `utf8`（3字节），云数据库默认 `utf8mb4`（4字节），可能导致索引超长。
2. **存储引擎差异**：云数据库可能禁用 `MyISAM`，需要提前转换为 `InnoDB`。
3. **权限模型变化**：云数据库限制 `SUPER` 权限，部分运维脚本需要调整。
4. **网络延迟**：应用服务器与数据库可能不在同一 VPC，需评估网络延迟影响。
5. **版本特性差异**：MySQL 5.7 到 8.0 升级需要注意 `sql_mode` 和认证插件变化。

```sql
-- 迁移前检查脚本（示例）
SELECT TABLE_NAME, ENGINE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'your_db'
  AND ENGINE NOT IN ('InnoDB', 'NDB');

SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'your_db'
  AND CHARACTER_SET_NAME IS NOT NULL
  AND CHARACTER_SET_NAME NOT IN ('utf8mb4', 'utf8');
```

---

## 二、迁移执行阶段

### Q3：支持哪些迁移方式？各有何优劣？

| 迁移方式 | 适用场景 | 停机时间 | 数据一致性 | 复杂度 |
|----------|----------|----------|------------|--------|
| 逻辑备份（mysqldump） | 小数据量（< 10GB） | 分钟级 | 强 | 低 |
| 物理备份（XtraBackup） | 大数据量 | 分钟级 | 强 | 中 |
| DTS 在线迁移 | 不可停机的业务 | 秒级 | 最终一致 | 高 |
| 双写迁移 | 极高可用性要求 | 零停机 | 最终一致 | 极高 |

### Q4：DTS 迁移过程中如何处理增量同步冲突？

**A：** DTS（数据传输服务）在执行增量同步时，可能遇到以下冲突场景：

```yaml
冲突类型：
  主键冲突:
    原因: 目标库已有相同主键数据
    解决: 设置冲突策略为 "覆盖" 或 "忽略"
  
  外键约束:
    原因: 子表数据先于父表同步
    解决: 迁移前禁用外键检查，迁移后重建
  
  时间戳漂移:
    原因: 源库和目标库时区设置不一致
    解决: 统一 UTC 时区后迁移
```

### Q5：迁移中断后如何恢复？

**A：** 迁移中断恢复流程：

1. **确定中断点**：查看 DTS 任务日志，确认最后同步的 binlog 位点
2. **数据一致性校验**：对核心表执行 `CHECKSUM TABLE` 对比
3. **增量补齐**：从中断位点重新启动增量同步任务
4. **全量对账**：任务完成后执行全量数据对账脚本

```python
def checksum_compare(source_conn, target_conn, table_name):
    """核心表数据一致性校验"""
    source_checksum = source_conn.execute(
        f"CHECKSUM TABLE {table_name}"
    ).fetchone()[1]

    target_checksum = target_conn.execute(
        f"CHECKSUM TABLE {table_name}"
    ).fetchone()[1]

    return {
        "table": table_name,
        "source_checksum": source_checksum,
        "target_checksum": target_checksum,
        "consistent": source_checksum == target_checksum,
    }
```

---

## 三、性能优化

### Q6：云数据库常见的性能瓶颈有哪些？

**A：**

| 瓶颈类型 | 表现 | 诊断方法 | 优化方案 |
|----------|------|----------|----------|
| 慢查询 | 个别 SQL 执行超时 | 慢查询日志 + EXPLAIN | 创建/优化索引，重写 SQL |
| 连接数不足 | 应用报 `Too many connections` | `SHOW PROCESSLIST` | 连接池 + 提高实例规格 |
| 锁等待 | 事务长时间不提交 | `INFORMATION_SCHEMA.INNODB_TRX` | 优化事务，拆分大事务 |
| 磁盘 I/O | `%iowait` 高 | `iostat` / 云监控面板 | 升级 ESSD，增加只读实例 |
| 内存不足 | Buffer Pool 命中率 < 95% | `SHOW ENGINE INNODB STATUS` | 增加内存或优化缓存策略 |

### Q7：如何制定合理的索引优化策略？

**A：** 索引优化四步法：

1. **分析慢查询日志**：使用 `pt-query-digest` 找出频率最高的慢查询
2. **EXPLAIN 分析执行计划**：关注 `type` 列（目标 `ref` 或 `const`）和 `rows` 列
3. **遵循最左前缀原则**：复合索引列顺序与查询条件顺序匹配
4. **避免过度索引**：每个表索引建议 ≤ 5 个，索引数量会影响写入性能

```sql
-- 索引使用率分析
SELECT
    t.TABLE_SCHEMA,
    t.TABLE_NAME,
    INDEX_NAME,
    CARDINALITY,
    ROWS_READ,
    ROWS_READ / NULLIF(CARDINALITY, 0) AS efficiency_ratio
FROM information_schema.INNODB_INDEX_STATS iis
JOIN information_schema.TABLES t
  ON iis.table_name = t.TABLE_NAME
 AND iis.database_name = t.TABLE_SCHEMA
WHERE t.TABLE_SCHEMA NOT IN ('mysql', 'sys', 'performance_schema')
ORDER BY efficiency_ratio DESC;
```

---

## 四、高可用与容灾

### Q8：云数据库高可用方案如何选型？

| 方案 | RTO | RPO | 成本系数 | 适用场景 |
|------|-----|-----|----------|----------|
| 单可用区主备 | < 60s | 0 | 1x | 一般业务 |
| 跨可用区主备 | < 60s | 0 | 1.4x | 核心业务 |
| 跨地域灾备 | < 5min | < 1s | 2.5x | 金融/支付 |
| 两地三中心 | < 30s | 0 | 4x+ | 监管要求最高级别 |

### Q9：如何设计数据库备份策略？

**A：**

```yaml
备份策略建议:
  全量备份:
    频率: 每天凌晨 2:00
    保留: 最近 7 天
    类型: 物理备份（优先于逻辑备份）
  
  增量备份:
    频率: 每 6 小时
    保留: 最近 3 天
  
  日志备份:
    频率: 实时 / 每 5 分钟
    保留: 最近 7 天
    目的: PITR（时间点恢复）

  异地备份:
    频率: 每天
    保留: 30 天
    存储: 跨地域 OSS / S3
```

---

## 五、成本优化

### Q10：如何有效降低云数据库费用？

1. **选择合适的计费模式**：长期稳定业务选包年包月（节省 30%-50%）
2. **使用只读实例**：读写分离，降低主实例规格需求
3. **数据归档**：将 6 个月以上历史数据迁移至归档存储
4. **弹性伸缩**：按需配置自动扩缩容策略
5. **清理无用数据**：定期 `OPTIMIZE TABLE` 回收空间

| 优化措施 | 预期节省 | 实施难度 |
|----------|----------|----------|
| 包年包月 | 30-50% | 低 |
| 只读实例分流 | 20-35% | 中 |
| 冷热数据分离 | 15-25% | 中 |
| 弹性伸缩 | 10-20% | 高 |

---

*本文由数据库架构团队维护，如有疑问请提交工单至 DB-OPS 队列。*
