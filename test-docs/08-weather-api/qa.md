# WeatherSense API — 问答问题集 (Q&A)

> **配套文档**：`weather-api.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题 (Factual Questions)

**Q1.** WeatherSense API 的当前版本和基础 URL 是什么？  
<details><summary>答案</summary>v2.3，基础 URL 为 `https://api.weathersense.io/v2.3`。</details>

**Q2.** API 认证方式需要在请求头中添加哪个字段？  
<details><summary>答案</summary>`X-API-Key`。</details>

**Q3.** 获取实时天气时，哪些参数是必填的？哪些是可选的？  
<details><summary>答案</summary>必填：`lat`（纬度）和 `lon`（经度）。可选：`units`（单位制）、`lang`（语言）。</details>

**Q4.** 天气预报接口最多可以预报多少天？  
<details><summary>答案</summary>1-16 天，默认 7 天。</details>

**Q5.** Starter 套餐的每分钟和每天请求限制是多少？  
<details><summary>答案</summary>每分钟 300 次，每天 50,000 次。</details>

**Q6.** 批量查询接口最多支持多少个地点？  
<details><summary>答案</summary>50 个。</details>

**Q7.** API 从哪个版本开始新增了 AQI 字段和地理编码接口？  
<details><summary>答案</summary>v2.3（2026-06-01 发布）。</details>

---

## 理解型问题 (Comprehension Questions)

**Q8.** 为什么 API 返回的 `temperature.feels_like`（体感温度）可能高于或低于实际温度？  
<details><summary>答案</summary>体感温度综合考虑了湿度、风速、日照等因素。高湿度（如 68%）会阻止汗液蒸发使人感觉更热（feels_like > actual），强风则加速散热使人感觉更冷。这是气象学中体感温度计算的科学依据。</details>

**Q9.** 响应中的 `weather.code` 字段（如 800、801、500）遵循什么标准？这些数字代表什么含义？  
<details><summary>答案</summary>遵循 OpenWeatherMap Weather Condition Codes 标准。800 = 晴天（Clear），801 = 少云（Few Clouds），500 = 小雨（Light Rain）。编码按百位分组：2xx = 雷暴，3xx = 毛毛雨，5xx = 雨，6xx = 雪，7xx = 雾/霾，8xx = 云/晴。</details>

**Q10.** 为什么 Free 套餐的批量查询"1 次 = 1 个地点"，而 Pro 套餐"1 次 = 最多 50 个地点"？这个设计背后的商业逻辑是什么？  
<details><summary>答案</summary>分层定价策略：Free 套餐主要用于试用和个人开发者，限制批量能力防止滥用。Pro 套餐面向商业用户，提供更高价值（一次查询多个地点减少请求开销）。实际数据获取成本相近，但在 Free 层限制可以转化付费用户。</details>

**Q11.** AQI 字段返回值 72、级别为"良"的含义是什么？主要污染物 PM2.5 说明什么？  
<details><summary>答案</summary>AQI 72 在 51-100 范围内，属于"良"级别——空气质量可接受，但对极少数敏感人群可能有轻微影响。PM2.5 是主要污染物说明当前空气污染主要来自细颗粒物（如汽车尾气、工业排放），而非臭氧或其他污染物。</details>

---

## 应用型问题 (Application Questions)

**Q12.** 你正在开发一个旅行规划 App，需要为用户提供目的地未来一周的天气概览。请设计调用 WeatherSense API 的方案（包含具体端点和参数）。  
<details><summary>答案</summary>首先调用 `GET /geo/search?q=<城市名>` 获取经纬度，然后调用 `GET /weather/forecast?lat=<lat>&lon=<lon>&days=7&lang=zh-CN&alerts=true` 获取 7 天预报和预警信息。展示每个日期的天气图标、温度范围、降水概率，如有天气预警高亮提醒用户。</details>

**Q13.** 应用需要同时监控 3 个仓库的天气情况（北京、上海、深圳），设计批量查询方案并计算 Pro 套餐下每天可执行的查询频率。  
<details><summary>答案</summary>使用 `POST /weather/bulk` 接口，一次请求传入 3 个地点。Pro 套餐每天 500,000 次请求，按 3 地点/请求计为 1 次。理论上可执行 500,000 次/天 ≈ 348 次/分钟，远超实际需求。实际建议每 10 分钟轮询一次（3 次/小时 × 24 小时 = 72 次/天），留下充足余量。</details>

**Q14.** API 返回 429（rate_limited）错误时应如何处理？设计一个带指数退避的重试策略。  
<details><summary>答案</summary>1) 检查响应头中的 `Retry-After`（如存在）等待指定秒数；2) 使用指数退避：首次重试等 1s，二次等 2s，三次等 4s，最多重试 3 次；3) 如果持续被限，检查请求频率是否超过套餐限制；4) 考虑添加本地缓存（实时数据缓存 5 分钟，预报缓存 1 小时）减少 API 调用。</details>

**Q15.** 一个天气预警应用需要在 SDK 中实现"警报分级推送"功能——黄色预警只推送通知，红色预警同时拨打紧急电话。请用提供的 Python SDK 设计实现方案。  
<details><summary>答案</summary>定期调用 `client.weather.forecast(alerts=True)` 获取当前预警列表。遍历 alerts 检查 severity 字段：`severity=red` → 触发紧急通知（短信+电话），`severity=orange` → 推送高优先级通知，`severity=yellow` → 推送普通通知。使用 Redis 记录已推送的预警 ID 避免重复告警，预警过期后清理记录。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+  
> 问题覆盖：接口参数、响应结构、速率限制、SDK 使用、版本变更
