# 知识文档系统

基于 AI 的知识文档管理系统，支持文档上传、智能问答、内容生成等功能。

## 项目结构

```
knowledge-quiz2/
├── pnpm-workspace.yaml          # pnpm 工作区配置
├── README.md                    # 项目说明文档
├── backend/                     # NestJS 后端服务
│   ├── src/
│   │   ├── app.controller.ts    # 应用控制器
│   │   ├── app.module.ts        # 应用模块
│   │   ├── app.service.ts       # 应用服务
│   │   └── main.ts              # 入口文件
│   ├── test/                    # 测试文件
│   └── package.json             # 后端依赖配置
└── frontend/                    # Vue3 前端应用
    ├── src/
    │   ├── components/          # 组件目录
    │   ├── pages/               # 页面目录
    │   ├── routes/              # 路由配置
    │   ├── stores/              # 状态管理
    │   └── main.ts              # 入口文件
    └── package.json             # 前端依赖配置
```

## 技术栈

### 后端 (NestJS)

- **框架**: NestJS 11 + TypeScript
- **数据库**: PostgreSQL (TypeORM)
- **缓存**: Redis
- **认证**: JWT
- **AI 能力**: LangChain + OpenAI + LangGraph
- **监控**: Langfuse
- **文件上传**: Multer

### 前端 (Vue3)

- **框架**: Vue 3 + TypeScript + Vite
- **路由**: Vue Router 4
- **状态管理**: Pinia 2
- **HTTP 请求**: Axios
- **UI 工具库**: Lucide Vue
- **样式**: UnoCSS
- **工具函数**: VueUse

## 快速开始

### 环境要求

- Node.js >= 20.x
- pnpm >= 10.x
- PostgreSQL >= 16.x
- Redis >= 7.x

### 安装依赖

```bash
# 安装所有依赖（工作区模式）
pnpm install
```

### 启动后端

```bash
cd backend
pnpm run start:dev
```

### 启动前端

```bash
cd frontend
pnpm run dev
```

## 功能特性

- 文档上传与管理
- 智能问答系统
- AI 内容生成
- 文档检索
- 用户认证与授权
- 多模态内容支持

## 开发规范

- 代码风格: ESLint + Prettier
- 代码规范: TypeScript 严格模式
- 命名规范: camelCase (变量/函数), PascalCase (组件/类), kebab-case (文件名)
- 注释规范: JSDoc 标准