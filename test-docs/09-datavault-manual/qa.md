# DataVault 数据备份系统 — 问答问题集 (Q&A)

> **配套文档**：`datavault-manual.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题

**Q1.** DataVault 支持哪四种数据源的备份？  
<details><summary>答案</summary>数据库、文件系统、虚拟机、云存储。</details>

**Q2.** CDP 的全称是什么？对应什么功能？  
<details><summary>答案</summary>Continuous Data Protection（连续数据保护），实现秒级 RPO 的实时保护。</details>

**Q3.** DataVault 的软件版本号是多少？文档编号是什么？  
<details><summary>答案</summary>软件版本 v4.2，文档编号 DV-UM-2026-07。</details>

**Q4.** "3-2-1 备份原则"中的三个数字分别代表什么？  
<details><summary>答案</summary>3 份数据副本、2 种不同介质、1 份异地副本。</details>

**Q5.** 备份数据加密使用什么算法？密钥管理支持什么外部系统？  
<details><summary>答案</summary>AES-256-GCM，支持 HashiCorp Vault 作为外部 KMS。</details>

---

## 理解型问题

**Q6.** "即时挂载恢复"和"完整恢复"有什么区别？分别在什么场景下使用？  
<details><summary>答案</summary>即时挂载恢复直接在备份存储上挂载为可读写卷，无需回拷数据，< 1 分钟即可恢复，适合紧急业务恢复。完整恢复将所有数据从备份存储回拷到生产存储，恢复时间取决于数据量，适合迁移或重建场景。</details>

**Q7.** 解释"不可变快照"在防御勒索软件中的作用。为什么 `retention_lock_days: 30` 的安全意义？  
<details><summary>答案</summary>不可变快照确保备份数据在指定期限内无法被任何用户（包括管理员）修改或删除。即使攻击者获取了最高权限，也无法删除或加密备份数据。30 天的锁定意味着即使发现被攻击的时间较晚，仍有充足的恢复窗口。</details>

**Q8.** 备份策略中的自动验证机制如何工作？为什么 `verify_sample_ratio` 设为 0.05？  
<details><summary>答案</summary>自动验证在每周一 8:00 执行，从备份集中随机抽样 5% 的数据进行恢复测试。5% 是平衡验证成本与覆盖率的经验值——全量验证耗时太长影响存储性能，而太小比例可能漏检损坏数据。</details>

---

## 应用型问题

**Q9.** 设计一个金融企业的备份策略：要求每日全量备份、每 4 小时增量备份，保留 90 天，异地复制延迟不超过 4 小时。  
<details><summary>答案</summary>全量：cron `0 2 * * *`；增量：cron `0 */4 * * *`；retention full_backups: 90（需考虑存储容量）；replica_delay_hours: 4；存储选择 NAS+S3 双副本。</details>

**Q10.** 恢复任务中断在 50% 进度怎么办？  
<details><summary>答案</summary>不要中断当前任务，先诊断中断原因（网络/磁盘/Agent），确认后可选择从头恢复或继续——具体取决于恢复类型和数据损坏程度。</details>

**Q11.** 勒索软件检测触发了告警，备份管理员应采取什么行动？  
<details><summary>答案</summary>1) 确认告警真实性；2) 隔离受影响系统；3) 确定最后干净备份时间点；4) 从不可变快照恢复；5) 调查入侵路径并修复漏洞。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+
