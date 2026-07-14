# QuantumDB v3.0 — 问答问题集 (Q&A)

> **配套文档**：`quantumdb-release.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题

**Q1.** QuantumDB v3.0 的代号是什么？发布日期是哪天？  
<details><summary>答案</summary>代号 "Helix"，发布日期 2026-07-01。</details>

**Q2.** 新引擎 Helix 相比旧引擎 Delta，单节点写入吞吐提升了多少？  
<details><summary>答案</summary>从 250 万点/秒提升到 820 万点/秒，提升 +228%。</details>

**Q3.** 列出 v3.0 支持的五种数据压缩算法。  
<details><summary>答案</summary>Delta-of-Delta、Gorilla、ZSTD（字典）、Simple8b、LZ4。</details>

**Q4.** `ASOF JOIN` 的作用是什么？  
<details><summary>答案</summary>时序数据的对齐连接——对两个时间序列中时间戳最接近的记录进行关联。</details>

**Q5.** v3.0 从哪个版本开始时间精度由毫秒变更为纳秒？  
<details><summary>答案</summary>v3.0 开始，默认时间精度从毫秒变更为纳秒。</details>

---

## 理解型问题

**Q6.** 为什么列式存储引擎（Helix）能实现压缩率从 8:1 提升到 15:1？  
<details><summary>答案</summary>列式存储将同类型数据连续存放，同类数据的值域和模式相似度更高，压缩算法可以更高效地利用数据局部性。行式存储中不同类型数据交错存放，压缩效率较低。</details>

**Q7.** 为什么 v3.0 选择废弃 InfluxQL 查询语法？这对现有用户有什么影响？  
<details><summary>答案</summary>标准 SQL 生态成熟、开发者学习成本低、工具链丰富。现有用户需要在 v3.2 之前将 InfluxQL 查询迁移为标准 SQL，否则需要使用旧版客户端。</details>

**Q8.** 聚合查询从 4.2s 降到 0.6s 的关键技术因素是什么？  
<details><summary>答案</summary>1) 列式存储按需读取所需列而非整行；2) 压缩数据直接在内存中解压计算，减少 I/O；3) SIMD 向量化执行加速聚合运算。</details>

---

## 应用型问题

**Q9.** 升级前检查清单中有哪些关键项？如果漏掉一项可能产生什么后果？  
<details><summary>答案</summary>漏掉"在 staging 验证"可能直接在生产环境触发兼容性问题；漏掉"通知下游 API 变更"可能导致依赖方服务中断。</details>

**Q10.** 升级脚本中 `--version-check=false` 的作用是什么？为什么需要这个参数？  
<details><summary>答案</summary>跳过版本兼容性检查。在节点逐个升级时，部分节点还是旧版本，集群处于混合版本状态，此时版本检查会报错阻塞升级。</details>

**Q11.** 已知问题中 gRPC 流查询断连影响 < 0.1% 查询，你作为运维负责人会如何处理？  
<details><summary>答案</summary>在对应 API 网关层增加失败重试机制（自动切换到 HTTP API 重试）；监控 gRPC 断连频率；等待 3.0.1 修复版发布后优先升级。</details>

**Q12.** ARM64 平台压缩性能比 x86_64 低 15%，应如何决策部署架构？  
<details><summary>答案</summary>对于对延迟敏感的写入密集型场景，优先选择 x86_64；对于成本敏感的边缘/大规模部署场景，ARM64 的性价比可能更好；可混合部署——热数据用 x86_64，冷数据归到 ARM64。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+
