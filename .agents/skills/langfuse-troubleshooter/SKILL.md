---
name: "langfuse-troubleshooter"
description: "Troubleshoots and fixes langfuse container startup issues including PostgreSQL connection errors, ClickHouse migration failures, and Docker volume permission problems. Invoke when langfuse container fails to start or shows migration errors."
---

# Langfuse 容器故障排查与修复

## 问题描述

当 langfuse 容器启动时出现以下错误：

- `Error: P1001 Can't reach database server at 'postgres:5432'`
- `error: code: 1001, message: std::exception: std::exception`
- `Applying clickhouse migrations failed`

## 根本原因分析

1. **容器启动顺序问题**：langfuse 启动时依赖的数据库服务尚未就绪
2. **PostgreSQL 数据库未创建**：需要初始化 `langfuse` 数据库
3. **ClickHouse 权限问题**：在 Windows Docker 环境下，绑定挂载导致文件系统权限不足，无法执行数据写入操作

## 解决方案

### 步骤 1：检查 docker-compose.yml 配置

确保 PostgreSQL 配置包含健康检查和初始化脚本：

```yaml
postgres:
  image: postgres:16-alpine
  volumes:
    - ./volumes/postgres-data:/var/lib/postgresql/data
    - ./docker/initdb:/docker-entrypoint-initdb.d
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 5
```

确保 ClickHouse 使用命名卷而非绑定挂载：

```yaml
clickhouse:
  image: clickhouse/clickhouse-server:latest
  volumes:
    - clickhouse-data:/var/lib/clickhouse  # 使用命名卷
    - ./docker/clickhouse:/etc/clickhouse-server/config.d
```

在文件末尾添加命名卷定义：

```yaml
volumes:
  clickhouse-data:
```

### 步骤 2：创建 PostgreSQL 初始化脚本

创建 `docker/initdb/01-create-langfuse-db.sql` 文件：

```sql
CREATE DATABASE IF NOT EXISTS langfuse;
```

### 步骤 3：配置 ClickHouse 监听地址

创建 `docker/clickhouse/listen_host.xml` 文件：

```xml
<clickhouse>
  <listen_host>0.0.0.0</listen_host>
</clickhouse>
```

### 步骤 4：设置 langfuse 服务依赖

确保 langfuse 服务等待所有依赖服务就绪：

```yaml
langfuse:
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    clickhouse:
      condition: service_healthy
    minio:
      condition: service_healthy
```

### 步骤 5：执行修复

```bash
# 停止所有服务
docker-compose down -v

# 启动依赖服务
docker-compose up -d postgres redis clickhouse minio

# 等待服务就绪
sleep 30

# 验证服务状态
docker-compose ps

# 执行 ClickHouse 迁移
docker-compose run --rm --entrypoint sh langfuse -c "cd ./packages/shared && migrate -verbose -source file://clickhouse/migrations/unclustered -database 'clickhouse://clickhouse:9000?username=default&password=langfuse123&database=langfuse&x-multi-statement=true&x-migrations-table-engine=MergeTree' up"

# 启动 langfuse
docker-compose up -d langfuse

# 检查日志
docker-compose logs langfuse
```

## 验证

验证所有服务是否正常运行：

1. PostgreSQL：端口 5432，数据库 `langfuse` 已创建
2. ClickHouse：端口 8123 和 9000，所有迁移已执行
3. langfuse：端口 3000，容器状态为 running

## 关键修复点

- **ClickHouse 卷挂载**：使用 Docker 命名卷替代绑定挂载，解决 Windows 文件系统权限问题
- **健康检查**：确保依赖服务完全就绪后再启动 langfuse
- **数据库初始化**：自动创建 PostgreSQL 数据库

## 注意事项

- 在 Windows 环境下，避免将 ClickHouse 数据目录绑定挂载到本地文件系统
- 定期检查 Docker 卷状态，确保有足够的磁盘空间
- 迁移失败时，检查 ClickHouse 日志中的权限错误

## 参考文件

- `docker-compose.yml` - Docker Compose 配置文件
- `docker/initdb/01-create-langfuse-db.sql` - PostgreSQL 初始化脚本
- `docker/clickhouse/listen_host.xml` - ClickHouse 监听配置
