# Kubernetes 集群运维 — 问答问题集 (Q&A)

> **配套文档**：`k8s-ops.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题 (Factual Questions)

**Q1.** Kubernetes 控制平面的五个核心组件分别是什么？  
<details><summary>答案</summary>kube-apiserver、etcd、kube-scheduler、kube-controller-manager、cloud-controller-manager。</details>

**Q2.** 使用 `kubeadm init` 初始化集群时，`--control-plane-endpoint` 参数的作用是什么？  
<details><summary>答案</summary>指定控制平面的高可用端点地址，多个控制平面节点通过该地址进行通信，通常配置为负载均衡器的地址。</details>

**Q3.** 在 Calico、Cilium、Flannel 三种网络插件中，哪一种使用 eBPF 技术且性能最高？  
<details><summary>答案</summary>Cilium。它使用 eBPF 实现数据平面的高性能转发和网络策略。</details>

**Q4.** Deployment 的 `replicas` 字段设为 3，`maxSurge` 设为 1，`maxUnavailable` 设为 0 的滚动更新策略意味着什么？  
<details><summary>答案</summary>最多可创建 1 个额外 Pod（超出期望数），不能有任何 Pod 不可用。即"先增后减"的保守策略，确保服务始终有 3 个 Pod 在运行。</details>

**Q5.** Kubernetes 中 PV/PVC 的回收策略有哪几种？  
<details><summary>答案</summary>Retain（保留）、Recycle（回收，已废弃）、Delete（删除）。</details>

**Q6.** Prometheus 告警规则中 Pod 重启次数超过 5 次/小时时，应触发哪个严重级别的告警？  
<details><summary>答案</summary>Warning 级别。</details>

**Q7.** 用 `kubectl` 如何查看 Pod 的日志并包含之前崩溃容器的日志？  
<details><summary>答案</summary>`kubectl logs <pod-name> -n <namespace> --previous`</details>

---

## 理解型问题 (Comprehension Questions)

**Q8.** 为什么要配置 Pod 反亲和性（PodAntiAffinity）？文档中的 Deployment 示例设置了怎样的反亲和策略？  
<details><summary>答案</summary>Pod 反亲和性确保同一应用的高可用副本分散在不同节点上，避免单节点故障导致全部副本不可用。文档示例使用 `requiredDuringScheduling`（硬亲和）将 api-server 的 Pod 强制分散到不同节点（topologyKey 为 `kubernetes.io/hostname`）。</details>

**Q9.** 解释 `readinessProbe` 和 `livenessProbe` 的区别。文档示例中这两个探针的 `initialDelaySeconds` 分别为 5 和 15，为什么这样设置？  
<details><summary>答案</summary>ReadinessProbe 检查 Pod 是否准备好接收流量，失败则从 Service 端点移除；LivenessProbe 检查 Pod 是否存活，失败则重启容器。LivenessProbe 的延迟更长（15s）是因为它应在应用完全启动后再检查，避免启动阶段就被重启；ReadinessProbe 可以更早（5s）开始检查应用是否就绪。</details>

**Q10.** `volumeBindingMode: WaitForFirstConsumer` 相比 `Immediate` 模式有什么优势？  
<details><summary>答案</summary>WaitForFirstConsumer 延迟 PV 绑定直到有 Pod 实际使用该 PVC，这样 PV 会在 Pod 调度的节点所在可用区创建，避免跨可用区挂载卷带来的延迟和额外费用。</details>

**Q11.** 为什么 API Server 建议 3 节点 + LB 的高可用方案？  
<details><summary>答案</summary>API Server 是无状态的，多节点通过负载均衡器提供冗余。3 节点足以容忍 1 个节点故障，同时避免过多的资源浪费和协调开销。</details>

**Q12.** 集群升级前为什么需要备份 etcd？etcd 的快照包含哪些数据？  
<details><summary>答案</summary>etcd 存储了集群的完整状态（所有 Kubernetes 对象、配置、密钥），如果升级失败或数据损坏，可以从快照恢复。快照包含所有键值对数据和集群元数据。</details>

---

## 应用型问题 (Application Questions)

**Q13.** 生产环境中一个 Deployment 的 Pod 频繁重启（CrashLoopBackOff）。请描述你的完整排查流程。  
<details><summary>答案</summary>1) `kubectl describe pod <name>` 查看 Events 和 Exit Code；2) `kubectl logs <pod> --previous` 查看上一次崩溃日志；3) 检查资源限制（内存 OOMKilled？）；4) 检查 livenessProbe 配置是否过于严格；5) 检查容器启动命令和环境变量是否正确；6) 用 `kubectl exec` 进入 Pod（如果存活）手动测试。</details>

**Q14.** 一个团队反映他们的 API 服务无法访问数据库。分析文档中的 NetworkPolicy 配置，说明可能的原因和验证方法。  
<details><summary>答案</summary>文档中 API 的 Egress 只允许访问 role=database 的 Pod（TCP 5432）和 DNS（UDP 53）。可能原因：1) API Pod 的 label 不正确；2) 数据库 Pod 的 label 不匹配；3) DNS egress 规则未生效导致无法解析数据库服务名；4) 数据库未在运行。验证：`kubectl get networkpolicy`、`kubectl describe networkpolicy` 查看生效范围，`kubectl exec` 进入 Pod 执行 `nc -zv` 测试连通性。</details>

**Q15.** 你需要为一个核心业务系统设计 Kubernetes 的存储方案，要求支持在线扩容且数据不丢失。请根据文档内容选择合适的 StorageClass 参数。  
<details><summary>答案</summary>选择 `reclaimPolicy: Retain`（确保删除 PVC 时 PV 数据保留），`volumeBindingMode: WaitForFirstConsumer`（避免跨区挂载），`allowVolumeExpansion: true`（支持在线扩容），`type: gp3`（兼顾性能和成本）。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+  
> 问题覆盖：架构组件、部署命令、存储配置、网络策略、监控告警、故障排查
