# Web 应用安全 — 问答问题集 (Q&A)

> **配套文档**：`web-security.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题

**Q1.** OWASP Top 10 是什么？  
<details><summary>答案</summary>OWASP（开放式 Web 应用安全项目）每 2-4 年发布的 Web 应用十大安全风险排名。</details>

**Q2.** Cookie 安全的三个关键属性是什么？  
<details><summary>答案</summary>HttpOnly（禁止 JS 访问）、Secure（仅 HTTPS）、SameSite（防 CSRF）。</details>

**Q3.** 密码哈希推荐使用哪些算法？cost factor 建议多少？  
<details><summary>答案</summary>bcrypt / argon2id，cost factor ≥ 12。</details>

**Q4.** CSP 的全称是什么？`script-src 'self'` 表示什么？  
<details><summary>答案</summary>Content-Security-Policy，`script-src 'self'` 表示只允许加载同源的脚本。</details>

**Q5.** JWT 为什么推荐使用非对称算法（如 RS256）而非对称算法（如 HS256）？  
<details><summary>答案</summary>非对称算法允许服务间共享公钥验证签名而不暴露签名密钥，更安全。对称算法的密钥一旦泄露就可以伪造任意 Token。</details>

---

## 理解型问题

**Q6.** 为什么输出编码需要根据上下文（HTML/JavaScript/CSS/URL）不同而采用不同的编码方式？  
<details><summary>答案</summary>不同上下文的特殊字符不同：HTML 需要转义 `<>&"'`，JavaScript 字符串中 `\` 和引号需要转义，URL 需要百分号编码。一种编码方式不能适用于所有上下文，攻击者可能利用不同上下文中转义规则的差异绕过防护。</details>

**Q7.** 解释 JWT 中 `jti`（JWT ID）字段的作用。为什么需要它？  
<details><summary>答案</summary>`jti` 是 JWT 的唯一标识符，用于实现 Token 撤销机制。当需要强制用户下线或 Token 被盗用时，服务端将 jti 加入黑名单，即使 Token 未过期也无法使用。</details>

**Q8.** `Strict-Transport-Security` 头中的 `max-age=63072000`（2年）和 `includeSubDomains` 有什么安全意义？  
<details><summary>答案</summary>HSTS 强制浏览器在指定时间内只能通过 HTTPS 访问该域名，防止 SSL 剥离攻击。2 年是最大推荐值，`includeSubDomains` 将策略应用到所有子域名。</details>

---

## 应用型问题

**Q9.** 一个用户反馈个人信息泄露，怀疑是 XSS 攻击。请设计安全加固方案。  
<details><summary>答案</summary>1) 全站启用 CSP 头并逐步收紧至无 `unsafe-inline`；2) 审查所有用户输入输出点添加上下文编码；3) 前端避免使用 `innerHTML` 和 `eval()`；4) Cookie 添加 HttpOnly 标志；5) 定期渗透测试验证修复效果。</details>

**Q10.** 检查清单中"错误信息不泄露内部实现细节"是什么意思？请举例说明。  
<details><summary>答案</summary>生产环境不应返回详细堆栈跟踪、数据库表名/字段名、框架版本号等。例如：返回"用户名或密码错误"而非"用户 'admin' 不存在"（泄露用户是否存在），返回"服务暂时不可用"而非"PostgreSQL连接池耗尽"。</details>

**Q11.** API 网关层如何实现"注册/登录接口 5次/分钟/IP"的速率限制？  
<details><summary>答案</summary>使用 Redis 计数器：Key = `rate:register:{IP}:{minute}`，每次请求 INCR，首次设置 TTL=60s。超过 5 次返回 429，同时在响应头中加入 Retry-After 和 X-RateLimit-Reset。</details>

**Q12.** 公司需要上线一个文件上传功能，允许用户上传简历 PDF。请设计安全方案。  
<details><summary>答案</summary>1) 服务端验证文件扩展名和 MIME 类型（白名单）；2) 限制文件大小（如 5MB）；3) 上传后病毒扫描；4) 重命名文件为 UUID 防路径猜测；5) 存储到独立域名/隔离存储区；6) Content-Disposition 设置为 attachment 防止浏览器直接执行。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+
