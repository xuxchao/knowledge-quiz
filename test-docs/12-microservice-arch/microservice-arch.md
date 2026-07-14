# 微服务电商平台架构设计文档

> **项目代号**：ShopStream  
> **版本**：v2.0  
> **文档类型**：技术架构设计  
> **设计阶段**：详细设计  
> **最后更新**：2026-06-28  

---

## 1. 项目背景与目标

### 1.1 业务背景

ShopStream 是一个面向中型电商企业的 SaaS 平台，预计支撑 **日均 500 万独立访客、峰值 QPS 20,000** 的业务规模。平台需要支持多租户模式，每租户数据物理隔离。

### 1.2 架构目标

| 目标 | 指标 | 优先级 |
|------|------|--------|
| 高可用 | 99.95% (年度) | P0 |
| 可扩展 | 水平扩展至 100+ 服务节点 | P0 |
| 低延迟 | P99 < 200ms（读）, < 500ms（写） | P1 |
| 数据一致性 | 订单/支付强一致，其他最终一致 | P0 |
| 可观测 | 全链路追踪 + 集中日志 + 指标监控 | P1 |
| 安全合规 | 等保三级 + PCI-DSS | P1 |

---

## 2. 系统架构总览

### 2.1 架构图

```
                       ┌──────────────┐
                       │   CDN + WAF   │
                       └──────┬───────┘
                              │
                       ┌──────▼───────┐
                       │  API Gateway  │ (Kong / APISIX)
                       └──────┬───────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
    │ BFF Layer │      │ Auth Svc  │      │ Rate Limit│
    │ (Web/Mobile)│    │ (OAuth2)  │      │ Svc       │
    └─────┬─────┘      └───────────┘      └───────────┘
          │
    ┌─────▼────────────────────────────────────┐
    │           核心业务服务层                    │
    │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐│
    │  │商品   │ │订单   │ │支付   │ │用户/会员  ││
    │  │服务   │ │服务   │ │服务   │ │服务       ││
    │  └──────┘ └──────┘ └──────┘ └──────────┘│
    │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐│
    │  │库存   │ │营销   │ │搜索   │ │推荐       ││
    │  │服务   │ │服务   │ │服务   │ │服务       ││
    │  └──────┘ └──────┘ └──────┘ └──────────┘│
    └──────────────────┬──────────────────────┘
                       │
    ┌──────────────────▼──────────────────────┐
    │             中间件与基础设施层              │
    │  ┌────────┐ ┌────────┐ ┌──────────────┐│
    │  │ MySQL  │ │  Redis  ││ Elasticsearch ││
    │  └────────┘ └────────┘ └──────────────┘│
    │  ┌────────┐ ┌────────┐ ┌──────────────┐│
    │  │  MQ    │ │Neo4j   ││   MinIO/S3   ││
    │  └────────┘ └────────┘ └──────────────┘│
    └────────────────────────────────────────┘
```

### 2.2 技术选型

| 层次 | 技术 | 选择理由 |
|------|------|----------|
| 语言 | Go (核心服务) + TypeScript (BFF) | Go 高性能 + TS 全栈开发效率 |
| 服务框架 | Go-Zero (Go) / NestJS (BFF) | 丰富的微服务治理能力 |
| RPC | gRPC (服务间) + REST (对外) | 高性能 + 生态兼容 |
| 消息队列 | Apache Pulsar | 多租户隔离 + 延迟消息 |
| 容器编排 | Kubernetes + Helm | 标准化部署 |
| 服务网格 | Istio (Ambient) | 零侵入流量治理 |

---

## 3. 核心领域设计

### 3.1 订单服务

订单服务是整个平台的核心，需要保证**强一致性和幂等性**。

#### 3.1.1 订单状态机

```
         ┌──────────┐
         │  CREATED  │
         └─────┬────┘
               │ 用户支付
         ┌─────▼────┐
         │ PAID     │──── 超时未支付 (30min) ──→ EXPIRED
         └─────┬────┘
               │ 商家确认
         ┌─────▼────┐
         │ CONFIRMED│──── 商家取消 ──→ REFUNDING → REFUNDED
         └─────┬────┘
               │ 发货
         ┌─────▼────┐
         │ SHIPPED  │
         └─────┬────┘
               │ 用户确认收货
         ┌─────▼────┐
         │ RECEIVED │
         └─────┬────┘
               │ 自动/手动
         ┌─────▼────┐
         │ COMPLETED│
         └──────────┘
```

#### 3.1.2 幂等性设计

```go
// 订单创建幂等性保证
func (s *OrderService) CreateOrder(ctx context.Context, req *CreateOrderReq) (*Order, error) {
    // 1. 基于客户端生成的幂等 Key 去重
    idempotentKey := fmt.Sprintf("order:create:%s", req.IdempotentKey)
    
    // 2. Redis SET NX + TTL
    ok, err := s.redis.SetNX(ctx, idempotentKey, "processing", 5*time.Minute).Result()
    if err != nil {
        return nil, fmt.Errorf("redis error: %w", err)
    }
    if !ok {
        // 幂等键已存在，查询已有订单
        existing, _ := s.repo.GetByIdempotentKey(ctx, req.IdempotentKey)
        if existing != nil {
            return existing, nil
        }
        return nil, ErrOrderProcessing
    }

    // 3. 执行订单创建逻辑（带数据库事务）
    order, err := s.repo.CreateInTx(ctx, func(tx *sql.Tx) (*Order, error) {
        // 库存扣减
        if err := s.inventoryClient.Deduct(ctx, req.Items); err != nil {
            return nil, fmt.Errorf("inventory deduct failed: %w", err)
        }
        // 创建订单记录
        return tx.InsertOrder(ctx, req)
    })

    // 4. 更新幂等 Key 状态
    s.redis.Set(ctx, idempotentKey, order.ID, 24*time.Hour)
    
    return order, err
}
```

### 3.2 库存服务

#### 并发扣减策略

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| 数据库行锁 | 最强一致性 | 性能瓶颈 | 低并发 |
| Redis + Lua | 高性能 | 缓存与 DB 可能不一致 | 高并发 |
| 分段锁 | 高并发 + 强一致 | 实现复杂 | 超高并发 |
| **Redis + MQ 异步** | **性能 + 最终一致** | 短暂超卖风险 | 推荐方案 |

---

## 4. 数据架构

### 4.1 数据库分库策略

```yaml
分库分表策略:
  租户隔离:
    方式: 每个租户独立数据库
    命名: tenant_{tenant_id}_db
    
  订单表分表:
    分片键: user_id
    分片算法: user_id % 16
    表名: orders_00 ~ orders_15
    
  商品表:
    策略: 垂直分表
    拆分方式: 基本信息 / 详情 / 属性 / SKU
```

### 4.2 缓存策略

| 数据类型 | 缓存时间 | 更新策略 | 存储 |
|----------|----------|----------|------|
| 商品基本信息 | 1 小时 | Cache-Aside + 延迟双删 | Redis String |
| 商品库存 | 实时 | 预扣减 + 定时同步 | Redis Hash |
| 用户 Session | 7 天 | JWT 无状态 | Redis String |
| 热搜词 | 5 分钟 | 定时刷新 | Redis Sorted Set |
| 页面片段 | 24 小时 | CDN 边缘缓存 | CDN |

---

## 5. 消息与事件

### 5.1 事件驱动架构

```
事件总线 (Apache Pulsar):

订单系统事件：
  order.created → 营销服务（发优惠券）
               → 推荐服务（更新用户画像）
               → 通知服务（短信/推送）

  order.paid    → 库存服务（确认扣减）
               → 积分服务（增加积分）
               → 财务服务（记录流水）

  order.shipped → 物流追踪服务
               → 通知服务（发货提醒）
```

### 5.2 死信队列策略

```go
// 消息消费重试配置
type RetryPolicy struct {
    MaxRetries    int           // 最大重试次数: 3
    InitialDelay  time.Duration // 初始延迟: 1s
    MaxDelay      time.Duration // 最大延迟: 60s
    BackoffFactor float64       // 退避因子: 2.0
    DLQ           string        // 死信队列: order-events-dlq
}
```

---

## 6. 可观测性

### 6.1 监控指标体系

| 层级 | 指标 | 采集方式 | 告警规则 |
|------|------|----------|----------|
| 基础设施 | CPU/Mem/Disk/Network | Prometheus Node Exporter | > 80% |
| 应用服务 | QPS/Latency/Error Rate | OpenTelemetry + Jaeger | Error > 1% |
| 业务指标 | 下单量/支付转化率/GMV | 埋点 SDK → ClickHouse | 环比下降 > 20% |
| 数据库 | 连接数/慢查询/死锁 | MySQL Exporter | 慢查询 > 200ms |

### 6.2 日志规范

```json
{
  "timestamp": "2026-07-13T09:30:00.123Z",
  "level": "INFO",
  "service": "order-service",
  "trace_id": "abc123def456",
  "span_id": "789ghi",
  "user_id": "u_12345",
  "tenant_id": "t_67890",
  "action": "order.created",
  "duration_ms": 45,
  "status": "success",
  "detail": {
    "order_id": "ord_001",
    "amount": 29900,
    "items_count": 3
  }
}
```

---

## 7. 安全设计

### 7.1 服务间认证

```yaml
# Istio mTLS + AuthorizationPolicy
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: order-service-policy
  namespace: production
spec:
  selector:
    matchLabels:
      app: order-service
  rules:
  - from:
    - source:
        principals:
        - "cluster.local/ns/production/sa/bff-service"
        - "cluster.local/ns/production/sa/payment-service"
    to:
    - operation:
        methods: ["POST", "GET"]
        paths: ["/api/v1/orders/*"]
```

---

## 8. 部署架构

### 8.1 环境规划

| 环境 | 用途 | 节点数 | 规格 |
|------|------|--------|------|
| dev | 开发联调 | 3 | 4C16G |
| staging | 预发布验证 | 6 | 8C32G |
| production | 生产环境 | 20+ | 16C64G |
| dr | 容灾 | 10 | 8C32G |

---

*本文档属于公司机密，未经授权不得外传。架构评审通过日期：2026-06-15*
