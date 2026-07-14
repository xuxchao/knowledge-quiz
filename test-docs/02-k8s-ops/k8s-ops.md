# Kubernetes 集群运维实战手册

> **文档类型**：运维实战指南  
> **适用版本**：Kubernetes 1.28+  
> **难度等级**：中级 - 高级  
> **最后更新**：2026-06-20  

---

## 1. 集群架构概览

### 1.1 控制平面组件

| 组件 | 职责 | 关键参数 | 高可用建议 |
|------|------|----------|------------|
| kube-apiserver | 集群 API 入口，认证授权 | `--max-requests-inflight` | 3 节点 + LB |
| etcd | 分布式 KV 存储 | `--quota-backend-bytes` | 奇数节点(3/5) |
| kube-scheduler | Pod 调度决策 | `--kubeconfig` | 2+ 节点 |
| kube-controller-manager | 控制器循环 | `--leader-elect` | 2+ 节点 |
| cloud-controller-manager | 云平台交互 | `--cloud-provider` | 按需配置 |

### 1.2 节点组件

```yaml
# kubelet 关键配置示例 (kubelet-config.yaml)
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: 110
evictionHard:
  memory.available: "200Mi"
  nodefs.available: "10%"
imageGCHighThresholdPercent: 85
imageGCLowThresholdPercent: 80
```

---

## 2. 集群部署与初始化

### 2.1 使用 kubeadm 初始化集群

```bash
# Step 1: 配置容器运行时 containerd
cat <<EOF | sudo tee /etc/containerd/config.toml
version = 2
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc]
  runtime_type = "io.containerd.runc.v2"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]
    SystemdCgroup = true
EOF

sudo systemctl restart containerd

# Step 2: 初始化控制平面
sudo kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12 \
  --control-plane-endpoint="k8s-api.example.com:6443" \
  --upload-certs

# Step 3: 配置 kubectl
mkdir -p $HOME/.kube
sudo cp /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

### 2.2 网络插件选择对比

| 插件 | CNI | 网络策略 | 加密 | 性能 | 适用场景 |
|------|-----|----------|------|------|----------|
| Calico | ✅ | ✅ | WireGuard | 高 | 企业生产环境 |
| Cilium | ✅ | ✅ | eBPF | 极高 | 云原生/高性能 |
| Flannel | ✅ | ❌ | ❌ | 中 | 简单/测试环境 |
| Weave Net | ✅ | ✅ | ✅ | 中 | 中小规模集群 |

---

## 3. 工作负载管理

### 3.1 Deployment 最佳实践

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  labels:
    app: api-server
    version: v2.1.0
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
        version: v2.1.0
    spec:
      terminationGracePeriodSeconds: 30
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - api-server
            topologyKey: kubernetes.io/hostname
      containers:
      - name: app
        image: registry.example.com/api-server:v2.1.0
        imagePullPolicy: Always
        ports:
        - containerPort: 8080
          protocol: TCP
        resources:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "2000m"
            memory: "2Gi"
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /livez
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 20
        env:
        - name: NODE_ENV
          value: "production"
```

### 3.2 资源配额与限制范围

```yaml
# ResourceQuota
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-a-quota
  namespace: team-a
spec:
  hard:
    requests.cpu: "20"
    requests.memory: "40Gi"
    limits.cpu: "40"
    limits.memory: "80Gi"
    persistentvolumeclaims: "10"
    pods: "50"
    services: "10"
```

---

## 4. 存储管理

### 4.1 PV/PVC 生命周期

```
Provisioning → Binding → Using → Releasing → Retaining/Recycling/Deleting
     │            │        │         │              │
   创建PV      绑定PVC   挂载到Pod  删除PVC      回收策略
```

### 4.2 StorageClass 示例

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs
parameters:
  type: gp3
  iopsPerGB: "100"
  encrypted: "true"
reclaimPolicy: Retain
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

---

## 5. 网络策略安全

### 5.1 最小权限原则

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      role: api
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          role: frontend
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - protocol: TCP
      port: 8080
  egress:
  - to:
    - podSelector:
        matchLabels:
          role: database
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - namespaceSelector: {}
      podSelector: {}
    ports:
    - protocol: UDP
      port: 53
```

---

## 6. 监控与告警

### 6.1 核心监控指标

| 监控维度 | 指标 | 告警阈值 | 探针工具 |
|----------|------|----------|----------|
| 节点健康 | `node_ready` | ≠ 1 | kube-state-metrics |
| CPU | `container_cpu_usage` | > 80% | cAdvisor |
| 内存 | `container_memory_working_set_bytes` | > 85% | cAdvisor |
| 磁盘 | `node_filesystem_avail_bytes` | < 10GB | node_exporter |
| Pod 重启 | `kube_pod_container_status_restarts` | > 5/h | kube-state-metrics |
| API Server | `apiserver_request_duration_seconds` | p99 > 1s | kube-apiserver |

### 6.2 Prometheus 告警规则

```yaml
groups:
- name: kubernetes-apps
  rules:
  - alert: PodCrashLoopBackOff
    expr: rate(kube_pod_container_status_restarts_total[15m]) > 0
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Pod {{ $labels.pod }} is crash looping"
      description: "Pod has restarted {{ $value }} times in the last 15 minutes"

  - alert: HighCPUUsage
    expr: avg(rate(container_cpu_usage_seconds_total[5m])) by (pod) > 0.8
    for: 10m
    labels:
      severity: critical
    annotations:
      summary: "High CPU usage on {{ $labels.pod }}"
```

---

## 7. 故障排查手册

### 7.1 常见问题诊断流程

```bash
# 1. 检查节点状态
kubectl get nodes -o wide
kubectl describe node <node-name>

# 2. 检查 Pod 状态
kubectl get pods -A --field-selector=status.phase!=Running

# 3. 查看 Pod 事件和日志
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --tail=100 --previous

# 4. 检查集群事件
kubectl get events -A --sort-by='.lastTimestamp' | tail -20

# 5. etcd 健康检查
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  endpoint health
```

### 7.2 常见问题快查表

| 症状 | 可能原因 | 排查命令 |
|------|----------|----------|
| Pod Pending | 资源不足/调度失败 | `kubectl describe pod` |
| ImagePullBackOff | 镜像拉取失败 | `kubectl describe pod` |
| CrashLoopBackOff | 应用启动失败 | `kubectl logs pod --previous` |
| Node NotReady | kubelet 异常/资源耗尽 | `systemctl status kubelet` |
| Service 不通 | Endpoint 未就绪/网络策略 | `kubectl get endpoints` |
| PVC Pending | 无可用 PV/存储类问题 | `kubectl describe pvc` |

---

## 8. 升级策略

### 8.1 滚动升级流程

1. **升级前检查**：
   - 备份 etcd：`etcdctl snapshot save /backup/snapshot.db`
   - 检查版本兼容性：[Kubernetes Version Skew Policy](https://kubernetes.io/releases/version-skew-policy/)
   - Drain 控制平面节点

2. **执行升级**：
   ```bash
   # 升级 kubeadm
   apt-mark unhold kubeadm && apt-get update && apt-get install -y kubeadm=1.29.0-*
   apt-mark hold kubeadm

   # 升级控制平面
   sudo kubeadm upgrade plan
   sudo kubeadm upgrade apply v1.29.0

   # 升级 kubelet 和 kubectl
   kubectl drain <node> --ignore-daemonsets
   apt-get install -y kubelet=1.29.0-* kubectl=1.29.0-*
   systemctl daemon-reload && systemctl restart kubelet
   kubectl uncordon <node>
   ```

---

## 9. 安全加固清单

- [ ] 启用 RBAC，遵循最小权限原则
- [ ] API Server 配置 `--authorization-mode=Node,RBAC`
- [ ] 禁用匿名认证 `--anonymous-auth=false`
- [ ] etcd 通信启用 TLS
- [ ] 使用 Pod Security Admission 限制 Pod 权限
- [ ] 镜像来源限制为受信任仓库
- [ ] 网络策略全覆盖关键命名空间
- [ ] 审计日志开启并接入集中分析平台
- [ ] Secret 数据使用外部密钥管理服务加密

---

## 10. 总结

Kubernetes 集群运维需要从**部署、监控、安全、故障排查**四个维度体系化建设。本手册覆盖了生产环境中最重要的实践要点。建议团队建立定期演练机制，确保故障场景下有完善的应急预案。

> 📌 **相关资源**：[Kubernetes 官方文档](https://kubernetes.io/docs/) | [CNCF Landscape](https://landscape.cncf.io/)

---

*本文档由基础设施团队维护，每周五例行核查更新。*
