# 微服务架构设计 — 问答问题集 (Q&A)

> **配套文档**：`microservice-arch.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题

**Q1.** ShopStream 的设计目标峰值 QPS 是多少？  
<details><summary>答案</summary>20,000。</details>

**Q2.** 系统使用什么消息队列？为什么选它？  
<details><summary>答案</summary>Apache Pulsar，因为支持多租户隔离和延迟消息。</details>

**Q3.** 订单状态机包含哪些状态？  
<details><summary>答案</summary>CREATED → PAID → CONFIRMED → SHIPPED → RECEIVED → COMPLETED，以及 EXPIRED 和 REFUNDING → REFUNDED。</details>

**Q4.** 库存并发扣减的四种策略分别是什么？文档推荐哪一种？  
<details><summary>答案</summary>数据库行锁、Redis+Lua、分段锁、Redis+MQ 异步。文档推荐 Redis+MQ 异步方案。</details>

**Q5.** 订单表按什么策略分表？分 16 个表的算法是什么？  
<details><summary>答案</summary>分片键 user_id，算法 user_id % 16。</details>

---

## 理解型问题

**Q6.** 为什么 BFF 层用 TypeScript/Node.js，而核心服务用 Go？  
<details><summary>答案</summary>BFF 层需要频繁配合前端需求调整，TypeScript 全栈开发效率高且与前端技术栈统一；核心服务对性能要求高，Go 编译型语言 + goroutine 天然适合高并发微服务。这是"用合适的语言解决合适的问题"。</details>

**Q7.** 订单创建中幂等性设计的必要性是什么？如果去掉幂等 Key 会发生什么问题？  
<details><summary>答案</summary>网络重试、用户重复点击等场景会导致同一订单创建请求被多次执行。没有幂等性可能导致：1) 用户被重复扣款；2) 库存被重复扣减；3) 重复订单记录。通过 Redis SET NX + 数据库唯一索引保证同一请求最多创建一个订单。</details>

**Q8.** 为什么商品表采用垂直分表策略？基本信息和详情分离有什么好处？  
<details><summary>答案</summary>商品详情（长文本、图片）数据量大但查询频率低，与基本信息（价格、库存）的访问模式不同。垂直拆分后：1) 基本信息查询不加载大字段，更快；2) 两者可以独立伸缩；3) 详情可以单独缓存到 CDN。</details>

**Q9.** 为什么文档选择 Istio Ambient 模式而非 Sidecar 模式？  
<details><summary>答案</summary>Ambient 模式将 L4 处理下沉到节点级代理，L7 处理按需启用，比 Sidecar 模式资源开销更小（不需要每个 Pod 注入 Sidecar），运维复杂度更低。适合微服务数量较多的场景。</details>

---

## 应用型问题

**Q10.** 大促期间热点商品出现高并发抢购，库存 Redis+MQ 方案可能短暂超卖。请设计补偿机制。  
<details><summary>答案</summary>1) 数据库层面最终扣减时检查库存 ≥ 0（利用行锁 + UPDATE SET stock = stock - 1 WHERE stock > 0）；2) 超卖订单自动退款并通知用户；3) 对超卖比例设定告警阈值，超过 1% 自动降级为纯数据库模式。</details>

**Q11.** 新需求需要在订单状态机中增加"部分发货"状态。请描述需要修改哪些地方。  
<details><summary>答案</summary>1) 订单状态机定义新增 PARTIALLY_SHIPPED 状态；2) SHIPPED 的触发条件修改为"所有明细都已发货"；3) 订单详情 API 返回发货进度；4) 事件总线新增 order.partially_shipped 事件；5) 数据库迁移脚本 ALTER TABLE 确认状态枚举值兼容。</details>

**Q12.** 怎么做才能确保消息不丢失？从订单创建到营销服务之间的消息可靠性如何保证？  
<details><summary>答案</summary>1) 订单服务在数据库事务提交成功后才发送消息（Outbox 模式：先写 outbox 表，再异步投递）；2) 消费者确认后才 ACK；3) 投递失败重试 3 次后进入死信队列（DLQ）；4) 死信队列有告警和人工处理流程。消息不会丢失但可能重复——消费者需要保证幂等。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+
