---
name: code-log-checker
description: "Invoke when any code file is created, edited, modified, or deleted, especially .ts/.js files in controllers, services, or infrastructure layers."
license: MIT
metadata:
  author: knowledge-quiz2
  version: "1.0.0"
---

# 代码日志规范检查与自动修复

本技能用于在代码变更时自动检查日志规范合规性，并对不符合规范的代码进行自动修复，确保所有代码变更具备完整、规范的日志记录。

## 触发条件

**本技能在以下场景必须自动触发：**

1. **代码新增**：创建新的 `.ts` / `.js` 文件（控制器、服务、模块等）
2. **代码修改**：编辑现有代码文件，新增或修改了方法、类、函数
3. **代码删除**：删除代码文件或方法时，检查相关日志引用是否需要清理
4. **用户请求**：用户明确要求检查日志规范时

**扫描范围：**
- `backend/src/**/*.controller.ts` - 所有控制器文件
- `backend/src/**/*.service.ts` - 所有服务文件
- `backend/src/**/*.ts`（排除 `*.spec.ts`、`*.module.ts`、`*.entity.ts`、`*.config.ts`）- 其他业务逻辑文件

**排除范围：**
- 测试文件 `*.spec.ts`、`*.test.ts`
- 模块定义文件 `*.module.ts`
- 实体定义文件 `*.entity.ts`
- 配置文件 `*.config.ts`
- 已有的 logger 系统文件 `backend/src/common/logger/**`

## 日志规范标准

### 规范 1：使用自定义 LoggerService（CRITICAL）

**规则 ID：** `log-use-custom-logger`

所有类必须使用项目自定义的 `LoggerService`，禁止使用 NestJS 内置的 `Logger`。

**正确：**
```typescript
import { LoggerService } from '../common/logger';

@Controller('documents')
export class DocumentController {
  private readonly logger = new LoggerService(DocumentController.name);
}
```

**错误：**
```typescript
import { Logger } from '@nestjs/common';

@Controller('documents')
export class DocumentController {
  private readonly logger = new Logger(DocumentController.name); // 禁止使用内置Logger
}
```

**自动修复策略：**
1. 将 `import { Logger } from '@nestjs/common'` 替换为 `import { LoggerService } from '../common/logger'`（路径根据文件位置调整）
2. 将 `new Logger(ClassName.name)` 替换为 `new LoggerService(ClassName.name)`
3. 如果类中没有 logger 实例，自动添加 `private readonly logger = new LoggerService(ClassName.name);`

---

### 规范 2：控制器方法必须记录请求和响应（CRITICAL）

**规则 ID：** `log-controller-request-response`

每个控制器方法（被 `@Get`、`@Post`、`@Put`、`@Delete`、`@Patch` 装饰的方法）必须包含：
1. **请求入口日志**：方法体开始处记录请求进入
2. **响应成功日志**：返回成功结果前记录响应
3. **错误日志**：catch 块中记录错误信息

**正确：**
```typescript
@Get(':id')
async getDocument(@Param('id') id: string) {
  this.logger.debug(`请求进入 - 获取文档，ID: ${id}`);

  const document = await this.documentService.findById(id);
  if (!document) {
    this.logger.warn(`文档未找到 - ID: ${id}`);
    throw new Error('Document not found');
  }

  this.logger.info(`请求成功 - 获取文档完成，ID: ${id}`);
  return {
    success: true,
    data: document,
  };
}
```

**错误（缺少日志）：**
```typescript
@Get(':id')
async getDocument(@Param('id') id: string) {
  const document = await this.documentService.findById(id);
  if (!document) {
    throw new Error('Document not found');
  }
  return {
    success: true,
    data: document,
  };
}
```

**自动修复策略：**
1. 在方法体第一行添加 `this.logger.debug(\`请求进入 - ${方法描述}，参数: ${参数列表}\`);`
2. 在 return 语句前添加 `this.logger.info(\`请求成功 - ${方法描述}完成\`);`
3. 如果方法有 try/catch，在 catch 块添加 `this.logger.error(\`请求处理异常 - ${方法描述}，错误: ${errorMessage}\`, stackTrace);`
4. 如果方法没有 try/catch 但包含 await 操作，自动包裹 try/catch 并添加错误日志

---

### 规范 3：服务方法必须记录调用信息（HIGH）

**规则 ID：** `log-service-method-calls`

每个服务类（`@Injectable` 装饰的类）的公开方法必须记录：
1. **方法调用日志**：方法开始时记录调用
2. **方法返回日志**：方法正常返回时记录完成
3. **异常日志**：方法抛出异常时记录错误

**正确（使用装饰器）：**
```typescript
import { LogServiceCall } from '../common/logger';

@Injectable()
export class DocumentService {
  @LogServiceCall()
  async create(data: Partial<Document>): Promise<Document> {
    const document = this.documentRepository.create(data);
    return this.documentRepository.save(document);
  }
}
```

**正确（手动日志）：**
```typescript
@Injectable()
export class DocumentService {
  async create(data: Partial<Document>): Promise<Document> {
    this.logger.debug(`服务调用开始 - DocumentService.create`);
    try {
      const document = this.documentRepository.create(data);
      const result = await this.documentRepository.save(document);
      this.logger.debug(`服务调用成功 - DocumentService.create`);
      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;
      this.logger.error(`服务调用异常 - DocumentService.create，错误: ${errorMessage}`, stackTrace);
      throw error;
    }
  }
}
```

**自动修复策略：**
1. 优先推荐使用 `@LogServiceCall()` 装饰器，自动添加到服务方法上
2. 如果服务类没有 logger 实例，自动添加 `private readonly logger = new LoggerService(ClassName.name);`
3. 对于复杂方法（超过20行），推荐使用 `this.logger.stepAsync()` 包裹关键步骤

---

### 规范 4：异步操作必须记录执行状态（HIGH）

**规则 ID：** `log-async-operations`

所有 `await` 操作必须有以下之一：
1. 使用 `@LogAsync()` 装饰器包裹所在方法
2. 使用 `this.logger.stepAsync()` 包裹关键 await 操作
3. 使用 `this.logger.serviceCall()` 包裹服务调用
4. 在 await 前后手动添加日志

**正确（使用 stepAsync）：**
```typescript
async uploadFile(file: Express.Multer.File) {
  const document = await this.logger.stepAsync('创建文档记录', async () => {
    return this.documentService.create({
      name: file.originalname,
      type: fileType,
      status: DocumentStatus.PROCESSING,
    });
  });

  const rustfsUrl = await this.logger.serviceCall(
    'RustfsService',
    'uploadFile',
    () => this.rustfsService.uploadFile(key, buffer, mimetype),
  );
}
```

**正确（使用 @LogAsync 装饰器）：**
```typescript
@Post()
@UseInterceptors(FileInterceptor('file'))
@LogAsync()
async uploadFile(@UploadedFile() file: Express.Multer.File) {
  // 方法被自动包裹日志，记录开始、成功、失败状态
}
```

**错误（await 操作无日志）：**
```typescript
async uploadFile(file: Express.Multer.File) {
  const document = await this.documentService.create({...});
  const rustfsUrl = await this.rustfsService.uploadFile(key, buffer, mimetype);
  // 缺少对 await 操作的日志记录
}
```

**自动修复策略：**
1. 对于包含多个 await 的复杂方法，优先添加 `@LogAsync()` 装饰器
2. 对于单个关键 await 操作，使用 `this.logger.stepAsync('描述', () => ...)` 包裹
3. 对于服务间调用，使用 `this.logger.serviceCall('服务名', '方法名', () => ...)` 包裹

---

### 规范 5：错误处理必须包含日志（CRITICAL）

**规则 ID：** `log-error-handling`

所有 `try/catch` 块必须：
1. 在 catch 中记录错误日志（使用 `this.logger.error()`）
2. 日志必须包含错误消息和堆栈信息
3. 错误日志消息必须使用中文

**正确：**
```typescript
try {
  const result = await this.fileProcessorService.processFile(filePath, fileName, document.type);
} catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stackTrace = error instanceof Error ? error.stack : undefined;
  this.logger.error(`文件处理失败 - document.id: ${document.id}，错误: ${errorMessage}`, stackTrace);
  throw new Error(`File processing failed: ${errorMessage}`);
}
```

**错误（catch 块无日志）：**
```typescript
try {
  const result = await this.fileProcessorService.processFile(filePath, fileName, document.type);
} catch (error) {
  throw new Error(`File processing failed: ${error.message}`); // 缺少日志记录
}
```

**自动修复策略：**
1. 在 catch 块开头添加错误信息提取代码
2. 添加 `this.logger.error()` 调用，消息使用中文
3. 如果 catch 参数类型不是 `unknown`，修改为 `unknown` 并使用类型守卫

---

### 规范 6：日志消息必须使用中文（HIGH）

**规则 ID：** `log-chinese-messages`

所有日志消息必须使用中文表达，包括：
1. 操作描述（如"请求进入"、"服务调用开始"）
2. 错误提示（如"文件处理失败"、"文档未找到"）
3. 状态描述（如"异步操作成功完成"、"步骤执行失败"）

**正确：**
```typescript
this.logger.debug(`请求进入 - 获取文档列表，页码: ${page}`);
this.logger.info(`文件上传成功 - 文档ID: ${document.id}`);
this.logger.error(`文件处理失败 - 错误: ${errorMessage}`, stackTrace);
```

**错误（使用英文日志）：**
```typescript
this.logger.debug(`Request received - get document list, page: ${page}`);
this.logger.info(`File uploaded successfully - document ID: ${document.id}`);
this.logger.error(`File processing failed - error: ${errorMessage}`, stackTrace);
```

**自动修复策略：**
1. 将英文日志消息翻译为中文
2. 保持变量名和技术术语（如 ID、URL）不变
3. 遵循中文日志消息模板格式

---

### 规范 7：复杂逻辑函数必须记录步骤日志（MEDIUM）

**规则 ID：** `log-complex-function-steps`

对于满足以下任一条件的函数，必须使用步骤日志：
1. 函数体超过 30 行
2. 包含 3 个以上 await 操作
3. 包含嵌套的条件判断（if/else 嵌套超过 2 层）
4. 包含多个顺序处理步骤

**正确：**
```typescript
async uploadFile(file: Express.Multer.File) {
  // 步骤1：创建文档记录
  const document = await this.logger.stepAsync('创建文档记录', async () => {
    return this.documentService.create({...});
  });

  // 步骤2：上传文件到存储
  const rustfsUrl = await this.logger.stepAsync('上传文件到RustFS', async () => {
    return this.rustfsService.uploadFile(key, buffer, mimetype);
  });

  // 步骤3：处理文件内容
  const { text, metadata } = await this.logger.stepAsync('解析文件内容', async () => {
    return this.fileProcessorService.processFile(filePath, fileName, document.type);
  });

  // 步骤4：存储分块
  await this.logger.stepAsync('存储文档分块', async () => {
    const chunks = this.fileProcessorService.chunkText(text);
    await this.fileProcessorService.storeChunks(document.id, chunks);
  });
}
```

**自动修复策略：**
1. 识别函数中的关键步骤（通过 await 操作或逻辑块划分）
2. 使用 `this.logger.stepAsync('步骤描述', () => ...)` 包裹每个关键步骤
3. 步骤描述使用中文，简洁明了

---

### 规范 8：敏感信息不得记录到日志（HIGH）

**规则 ID：** `log-no-sensitive-info`

日志中禁止记录以下敏感信息：
1. 密码、密钥、令牌
2. 完整的文件内容
3. 用户的个人隐私信息
4. 完整的 URL（应使用 `***URL***` 脱敏）
5. 完整的文件路径（应使用 `***REDACTED***` 脱敏）

**正确：**
```typescript
this.logger.debug(`文件上传请求 - 文件名: ${file.originalname}, URL: ${body.url ? '***URL***' : '无'}`);
```

**错误：**
```typescript
this.logger.debug(`文件上传请求 - URL: ${body.url}`); // 直接记录完整URL
```

## 检查流程

当技能被触发时，按以下流程执行检查：

### 步骤 1：识别变更内容

1. 确定哪些文件被新增、修改或删除
2. 对于修改的文件，识别具体变更的代码行（新增的方法、修改的函数体等）
3. 确定变更涉及的类类型（控制器、服务、其他）

### 步骤 2：逐规则扫描

按优先级顺序对变更代码执行规则扫描：

| 优先级 | 规则 ID | 规则描述 | 严重级别 |
|--------|---------|----------|----------|
| 1 | `log-use-custom-logger` | 使用自定义LoggerService | CRITICAL |
| 2 | `log-controller-request-response` | 控制器请求响应日志 | CRITICAL |
| 3 | `log-error-handling` | 错误处理日志 | CRITICAL |
| 4 | `log-service-method-calls` | 服务方法调用日志 | HIGH |
| 5 | `log-async-operations` | 异步操作状态日志 | HIGH |
| 6 | `log-chinese-messages` | 中文日志消息 | HIGH |
| 7 | `log-no-sensitive-info` | 敏感信息脱敏 | HIGH |
| 8 | `log-complex-function-steps` | 复杂函数步骤日志 | MEDIUM |

### 步骤 3：生成检查报告

对每个发现的问题，生成包含以下信息的报告：
- 文件路径和行号
- 违反的规则 ID
- 问题描述（中文）
- 修复建议（中文）
- 自动修复代码片段

### 步骤 4：执行自动修复

对于每个可自动修复的问题：
1. 按规则优先级顺序执行修复
2. 每次修复后重新验证代码语法正确性
3. 确保修复不会破坏现有功能
4. 修复完成后输出修复摘要

## 日志语句生成模板

### 控制器方法日志模板

```typescript
// 请求入口日志（方法体第一行）
this.logger.debug(`请求进入 - ${操作描述}，参数: ${参数列表}`);

// 条件判断日志
this.logger.warn(`${资源描述}未找到 - ID: ${id}`);

// 成功响应日志（return 前）
this.logger.info(`请求成功 - ${操作描述}完成，ID: ${id}`);

// 错误日志（catch 块中）
this.logger.error(`请求处理异常 - ${操作描述}，错误: ${errorMessage}`, stackTrace);
```

### 服务方法日志模板

```typescript
// 使用装饰器（推荐）
@LogServiceCall()
async methodName(params: ParamType): Promise<ReturnType> { ... }

// 手动日志
this.logger.debug(`服务调用开始 - ${ServiceName}.${methodName}`);
// ... 业务逻辑
this.logger.debug(`服务调用成功 - ${ServiceName}.${methodName}`);
// catch 块
this.logger.error(`服务调用异常 - ${ServiceName}.${methodName}，错误: ${errorMessage}`, stackTrace);
```

### 步骤日志模板

```typescript
// 同步步骤
const result = this.logger.step('${步骤描述}', () => {
  return /* 操作代码 */;
});

// 异步步骤
const result = await this.logger.stepAsync('${步骤描述}', async () => {
  return /* 异步操作代码 */;
});

// 服务调用步骤
const result = await this.logger.serviceCall('${服务名}', '${方法名}', async () => {
  return /* 服务调用代码 */;
});
```

### 中文日志消息对照表

| 英文 | 中文 |
|------|------|
| Request received | 请求进入 |
| Request success | 请求成功 |
| Request error | 请求处理异常 |
| Service call started | 服务调用开始 |
| Service call success | 服务调用成功 |
| Service call error | 服务调用异常 |
| Async operation started | 异步操作开始 |
| Async operation success | 异步操作成功完成 |
| Async operation failed | 异步操作失败 |
| Step started | 步骤开始 |
| Step success | 步骤成功完成 |
| Step failed | 步骤执行失败 |
| Not found | 未找到 |
| Upload success | 上传成功 |
| Upload failed | 上传失败 |
| Processing completed | 处理完成 |
| Processing failed | 处理失败 |
| Delete success | 删除成功 |
| Delete failed | 删除失败 |
| Create success | 创建成功 |
| Create failed | 创建失败 |
| Update success | 更新成功 |
| Update failed | 更新失败 |

## 自动修复执行规范

### 修复顺序

1. **导入修复**：确保 `LoggerService` 已正确导入
2. **实例修复**：确保类中有 `logger` 实例
3. **方法级修复**：添加方法内日志语句
4. **错误处理修复**：补充 catch 块日志
5. **装饰器修复**：为合适的方法添加装饰器
6. **消息修复**：将英文日志消息转为中文

### 修复验证

每次修复后必须验证：
1. TypeScript 编译通过（`npx tsc --noEmit`）
2. 不破坏现有代码逻辑
3. 日志语句语法正确
4. 变量引用有效

### 修复报告格式

修复完成后输出如下格式的报告：

```
## 日志规范检查报告

### 检查范围
- 文件: [文件路径列表]
- 变更类型: [新增/修改/删除]

### 发现问题
| 序号 | 文件 | 行号 | 规则ID | 严重级别 | 问题描述 |
|------|------|------|--------|----------|----------|
| 1 | document.controller.ts | 45 | log-controller-request-response | CRITICAL | 控制器方法缺少请求入口日志 |

### 自动修复
| 序号 | 文件 | 规则ID | 修复操作 | 修复状态 |
|------|------|--------|----------|----------|
| 1 | document.controller.ts | log-controller-request-response | 添加请求入口日志 | 已修复 |

### 修复摘要
- 检查文件数: X
- 发现问题数: X
- 已修复问题数: X
- 未修复问题数: X（需手动处理）
```

## 与现有日志系统的集成

本技能基于项目已有的日志系统（`backend/src/common/logger/`）工作，相关文件：

- `LoggerService` - 核心日志服务，提供 `debug`、`info`、`warn`、`error`、`step`、`stepAsync`、`serviceCall` 方法
- `@LogAsync()` - 异步方法日志装饰器
- `@LogStep(name)` - 步骤日志装饰器
- `@LogServiceCall()` - 服务调用日志装饰器

所有自动生成的日志代码必须使用上述 API，禁止使用 `console.log` 或 NestJS 内置 `Logger`。
