# Web 应用安全防护最佳实践指南

> **文档类型**：安全最佳实践  
> **版本**：v2.0  
> **适用范围**：Web 应用 / API 服务  
> **标准参考**：OWASP Top 10:2025 / CWE Top 25  

---

## 1. 概述

本指南覆盖 Web 应用安全防护的 **8 个核心领域**，每个领域包含攻击原理、防护方案和代码示例。遵循本指南可有效防御 OWASP Top 10 中的大多数威胁。

### 1.1 安全防护层次

```
应用层
  ├── 输入验证 & 输出编码
  ├── 认证 & 会话管理
  ├── 访问控制
  ├── 加密 & 密钥管理
  └── 日志 & 监控

基础设施层
  ├── WAF / CDN
  ├── 网络隔离
  └── 依赖扫描

组织层
  ├── 安全培训
  ├── 代码审查
  └── 渗透测试
```

---

## 2. 输入验证与输出编码

### 2.1 XSS（跨站脚本）防护

**攻击原理**：攻击者将恶意脚本注入页面，在受害者浏览器中执行。

**防护方案**：

```typescript
// 1. 输出编码（HTML 上下文）
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 2. 内容安全策略（CSP）头
// 在响应中添加：
// Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{random}'
app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString("base64");
  res.locals.nonce = nonce;
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'`
  );
  next();
});

// 3. 使用安全的 DOM API
// ❌ 危险
element.innerHTML = userInput;

// ✅ 安全
element.textContent = userInput;
```

### 2.2 SQL 注入防护

| 方法 | 安全等级 | 说明 |
|------|----------|------|
| 参数化查询 | ✅ 最高 | 使用预编译语句 + 参数绑定 |
| ORM 框架 | ✅ 高 | 需确保 ORM 正确使用参数化 |
| 输入过滤 | ⚠️ 中 | 仅作辅助手段，不应作为唯一防护 |
| 字符串拼接 | ❌ 危险 | 绝对禁止 |

```java
// ✅ 使用 PreparedStatement（Java 示例）
String customerName = request.getParameter("customerName");
String query = "SELECT account_balance FROM user_data WHERE user_name = ?";
PreparedStatement pstmt = connection.prepareStatement(query);
pstmt.setString(1, customerName);  // 参数绑定
ResultSet results = pstmt.executeQuery();
```

---

## 3. 认证与会话管理

### 3.1 密码安全策略

| 策略 | 要求 | 实现方式 |
|------|------|----------|
| 密码强度 | 最少 8 位，含大小写字母+数字+特殊字符 | 前端 + 后端双重校验 |
| 哈希算法 | bcrypt / argon2id | cost factor ≥ 12 |
| 密码历史 | 禁止重复使用最近 5 次 | 维护密码历史表 |
| 暴力破解防护 | 5 次失败锁定 15 分钟 | Redis 计数器 + TTL |

```python
import bcrypt

def hash_password(password: str) -> str:
    """使用 bcrypt 哈希密码"""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    """验证密码"""
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
```

### 3.2 会话安全

```javascript
// Cookie 安全配置
const sessionConfig = {
  cookie: {
    httpOnly: true,       // 禁止 JavaScript 访问
    secure: true,         // 仅 HTTPS 传输
    sameSite: 'strict',   // 严格同站策略
    maxAge: 3600000,      // 1 小时过期
    domain: '.example.com',
    path: '/',
  },
  name: '__Host-Session', // 带 __Host- 前缀，浏览器强制 Secure
  resave: false,
  saveUninitialized: false,
  rolling: true,          // 每次请求刷新过期时间
};
```

---

## 4. 访问控制

### 4.1 权限模型设计

```
RBAC（基于角色的访问控制）模型：

角色层级：
  super_admin (超级管理员)
    └── admin (管理员)
          ├── editor (编辑者)
          └── viewer (只读者)

权限定义：
  resources: { user, article, report, system }
  actions: { create, read, update, delete }

权限矩阵：
  | 角色          | user:*  | article:* | report:read | system:read |
  |--------------|---------|-----------|-------------|-------------|
  | super_admin  | CRUD    | CRUD      | ✅          | ✅          |
  | admin        | CRUD    | CRUD      | ✅          | ❌          |
  | editor       | R       | CRU       | ✅          | ❌          |
  | viewer       | R       | R         | ✅          | ❌          |
```

### 4.2 接口级鉴权

```go
// Go 中间件示例
func RequirePermission(resource, action string) gin.HandlerFunc {
    return func(c *gin.Context) {
        user := c.MustGet("user").(*User)
        
        if !user.HasPermission(resource, action) {
            c.JSON(403, gin.H{
                "error": "Forbidden",
                "detail": fmt.Sprintf(
                    "User lacks permission: %s:%s",
                    resource, action,
                ),
            })
            c.Abort()
            return
        }
        c.Next()
    }
}

// 使用
router.PUT("/api/articles/:id",
    RequirePermission("article", "update"),
    updateArticle,
)
```

---

## 5. 加密与密钥管理

### 5.1 传输层安全

```nginx
# Nginx TLS 1.3 推荐配置
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_ecdh_curve X25519:secp384r1;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;
    ssl_stapling on;
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff";
    add_header X-Frame-Options "DENY";
}
```

### 5.2 应用层加密

| 场景 | 推荐算法 | 密钥长度 | 说明 |
|------|----------|----------|------|
| 对称加密 | AES-256-GCM | 256 bit | 自带认证 |
| 非对称加密 | RSA-4096 / ECDSA P-384 | — | 密钥交换/签名 |
| 哈希 | SHA-256 / SHA-384 | — | 避免 MD5/SHA-1 |
| 密码哈希 | Argon2id | — | 内存硬哈希函数 |

---

## 6. API 安全

### 6.1 JWT 安全使用

```javascript
const jwt = require('jsonwebtoken');

// ✅ 安全的 JWT 签发
const token = jwt.sign(
  {
    sub: user.id,
    role: user.role,
    jti: crypto.randomUUID(),  // 唯一标识，用于撤销
  },
  process.env.JWT_PRIVATE_KEY,
  {
    algorithm: 'RS256',         // 非对称算法
    expiresIn: '15m',           // 短期有效
    issuer: 'api.example.com',
    audience: 'example-app',
  }
);

// ✅ 安全的 JWT 验证
const decoded = jwt.verify(token, process.env.JWT_PUBLIC_KEY, {
  algorithms: ['RS256'],
  issuer: 'api.example.com',
  audience: 'example-app',
  maxAge: '15m',
});
```

### 6.2 API 速率限制

| 接口类型 | 限制策略 | 超限处理 |
|----------|----------|----------|
| 注册/登录 | 5 次/分钟/IP | 返回 429 + 冷却时间 |
| 搜索 | 30 次/分钟/用户 | 返回 429 |
| 数据修改 | 60 次/分钟/用户 | 返回 429 |
| 文件上传 | 10 次/分钟/用户 | 返回 429 |

---

## 7. 安全监控

### 7.1 关键安全事件

| 事件类型 | 日志级别 | 告警方式 |
|----------|----------|----------|
| 多次登录失败（同账户/IP） | WARN | 邮件 + 即时通讯 |
| 权限越权访问 | ERROR | 即时通讯 + 电话 |
| SQL 注入尝试（WAF 拦截） | WARN | 即时通讯 |
| 异常流量（DDoS） | CRITICAL | 即时通讯 + 电话 |
| 敏感操作（删除/导出） | INFO | 审计日志 |

### 7.2 依赖漏洞扫描

```bash
# npm 依赖审计
npm audit --production

# Python 依赖检查
pip-audit

# OWASP Dependency-Check (Java)
mvn org.owasp:dependency-check-maven:check

# 容器镜像扫描
trivy image my-app:latest
```

---

## 8. 安全检查清单

### 上线前安全审查

- [ ] 所有用户输入经过服务端验证
- [ ] 输出内容进行了上下文相关的编码
- [ ] HTTPS 已启用，HSTS 头已配置
- [ ] CSP 头已配置且无 `unsafe-inline`
- [ ] 敏感 Cookie 设置了 HttpOnly、Secure、SameSite
- [ ] 密码使用 bcrypt/argon2 哈希存储
- [ ] API 接口有速率限制
- [ ] CORS 配置正确，未使用 `*`
- [ ] 文件上传有类型和大小限制
- [ ] 依赖库无已知高危漏洞
- [ ] 错误信息不泄露内部实现细节
- [ ] 关键操作有审计日志

---

*本指南由安全团队每季度审查更新，最新版本请查阅内部 Wiki。*
