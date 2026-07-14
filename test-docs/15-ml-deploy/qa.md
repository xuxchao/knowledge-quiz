# ML 模型部署 — 问答问题集 (Q&A)

> **配套文档**：`ml-deploy.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题

**Q1.** 五种 ML 部署模式分别是什么？延迟最低的是哪种？  
<details><summary>答案</summary>在线推理（REST API）、批量推理、边缘部署、流式推理、嵌入式模型。延迟最低的是嵌入式模型（< 5ms）。</details>

**Q2.** MLOps 成熟度分为哪四级？  
<details><summary>答案</summary>L0 手动、L1 自动化训练、L2 持续交付、L3 持续监控。</details>

**Q3.** 模型导出 ONNX 格式有什么优势？  
<details><summary>答案</summary>跨框架兼容（PyTorch/TensorFlow/ONNX Runtime），可在不同硬件平台部署运行。</details>

**Q4.** 四种量化方式中，哪一种精度损失最低？  
<details><summary>答案</summary>FP32 → FP16 精度损失极低。</details>

**Q5.** MLflow 中模型阶段从 Staging 转换到 Production 意味着什么？  
<details><summary>答案</summary>模型通过验证，从测试阶段转为正式生产环境使用。</details>

---

## 理解型问题

**Q6.** 为什么嵌入式模型（ONNX/TensorRT）推理延迟最低但成本标注为"低"？  
<details><summary>答案</summary>嵌入式模型经过编译优化（算子融合、图优化、量化），不需要 HTTP 协议的序列化/反序列化开销和网络传输延迟。成本低是因为单次推理的算力消耗最小，适合高吞吐场景。</details>

**Q7.** 动态量化、静态量化、QAT 三者的区别和适用场景是什么？  
<details><summary>答案</summary>动态量化在推理时动态计算量化参数，易于实现但精度损失随机。静态量化用校准数据集预先计算量化参数，精度更稳定。QAT 在训练中模拟量化效果，精度最高但需要重新训练。</details>

**Q8.** 为什么文档强调"预处理 pipeline 一致性"是推理结果不一致的常见原因？  
<details><summary>答案</summary>训练和推理可能使用不同的预处理代码（如不同的 tokenizer 配置、不同的图片归一化参数），导致模型接收到的输入与训练时不同，即使模型相同也会输出不同结果。</details>

---

## 应用型问题

**Q9.** TensorFlow 模型需要部署到不支持 TensorFlow 的边缘设备上怎么办？  
<details><summary>答案</summary>使用 ONNX 作为中间格式：TensorFlow → ONNX 导出工具 → ONNX Runtime（支持 ARM、x86 等多种平台）。如设备支持可进一步转为 TensorRT 进行推理加速优化。</details>

**Q10.** 自动回滚策略说"准确率下降 < 90% 持续 10 分钟回滚"。但模型刚部署时流量少怎么办？  
<details><summary>答案</summary>应该用"足够统计显著"的条件替代固定时间条件——例如"处理了至少 1000 个请求后准确率仍 < 90%"。小样本的准确率波动可能只是随机噪声。</details>

**Q11.** 灰度发布配置中 Beta 版本的流量是 10%，一周后性能指标都正常。下一步怎么操作？  
<details><summary>答案</summary>按渐进式发布策略：10% → 先增加到 25%，监控 1 天 → 增加到 50%，监控 1 天 → 增加到 100%。每步需确认指标（准确率、P99 延迟、错误率）在可接受范围内。</details>

**Q12.** 数据漂移检测发现 p=0.003（< 0.01），A/B 测试显示模型准确率从 94% 降到 89%。但业务人员说现在输入数据分布确实变了（新市场用户）。怎么办？  
<details><summary>答案</summary>漂移分为"概念漂移"（输入分布变化但输出关系也变了）和"协变量漂移"（输入分布变了但关系不变）。准确率下降表明是概念漂移——模型在新数据上不适用。需要收集新市场样本重新训练或 fine-tune 模型。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+
