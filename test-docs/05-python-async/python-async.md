# Python 异步编程完全指南

> **文档类型**：技术教程  
> **适用版本**：Python 3.11+  
> **难度等级**：中级  
> **最后更新**：2026-06-15  

---

## 1. 异步编程基础

### 1.1 为什么需要异步？

在传统的同步编程模型中，当程序执行 I/O 操作（网络请求、文件读写、数据库查询）时，线程会被阻塞，等待操作完成。对于 I/O 密集型应用（如 Web 服务器），这会导致严重的资源浪费。

### 1.2 并发模型对比

| 模型 | 代表技术 | 优点 | 缺点 | 适用场景 |
|------|----------|------|------|----------|
| 多线程 | `threading` | 利用多核，编程模型简单 | GIL 限制，上下文切换开销 | CPU 密集型 |
| 多进程 | `multiprocessing` | 绕过 GIL，真正并行 | 内存开销大，IPC 复杂 | CPU 密集型 |
| 异步 I/O | `asyncio` | 低开销，高并发 | 需要 async/await 语法 | I/O 密集型 |
| 回调 | Twisted / Tornado | 早期高性能方案 | 回调地狱，难以调试 | 遗留系统 |

---

## 2. async/await 语法

### 2.1 核心关键字

```python
import asyncio

async def fetch_data(url: str) -> dict:
    """异步函数（协程）—— 使用 async def 定义"""
    print(f"开始请求：{url}")
    # await 会挂起当前协程，让出控制权给事件循环
    await asyncio.sleep(1)  # 模拟网络延迟
    print(f"请求完成：{url}")
    return {"status": 200, "data": f"来自 {url} 的响应"}

async def main():
    # 创建多个任务并发执行
    tasks = [
        fetch_data("https://api.example.com/users"),
        fetch_data("https://api.example.com/posts"),
        fetch_data("https://api.example.com/comments"),
    ]
    results = await asyncio.gather(*tasks)
    for result in results:
        print(result)

# 运行异步程序入口
asyncio.run(main())
```

### 2.2 可等待对象（Awaitables）类型

| 类型 | 说明 | 创建方式 | 可多次 await？ |
|------|------|----------|----------------|
| **Coroutine** | `async def` 函数返回值 | `async def func()` | ❌ 只能一次 |
| **Task** | 被调度执行的协程 | `asyncio.create_task()` | ✅ |
| **Future** | 低层级，代表将来完成的操作 | `loop.create_future()` | ✅ |

---

## 3. 并发控制模式

### 3.1 信号量（Semaphore）限制并发数

```python
import asyncio

async def bounded_fetch(
    sem: asyncio.Semaphore,
    url: str,
) -> dict:
    """使用信号量限制同时进行的请求数"""
    async with sem:
        print(f"请求 {url} ...")
        await asyncio.sleep(0.5)
        return {"url": url, "result": "ok"}


async def main():
    # 最多同时 5 个并发请求
    semaphore = asyncio.Semaphore(5)
    urls = [f"https://api.example.com/item/{i}" for i in range(20)]

    tasks = [bounded_fetch(semaphore, url) for url in urls]
    results = await asyncio.gather(*tasks)
    print(f"完成 {len(results)} 个请求")
```

### 3.2 生产者 - 消费者模式

```python
import asyncio
from collections.abc import AsyncIterator

async def producer(queue: asyncio.Queue) -> None:
    """生产者：生成数据放入队列"""
    for i in range(10):
        await asyncio.sleep(0.1)
        item = f"数据-{i:03d}"
        await queue.put(item)
        print(f"生产 → {item}")

    # 发送终止信号
    for _ in range(3):
        await queue.put(None)


async def consumer(queue: asyncio.Queue, name: str) -> None:
    """消费者：从队列取出数据处理"""
    while True:
        item = await queue.get()
        if item is None:
            queue.task_done()
            break
        await asyncio.sleep(0.3)  # 模拟处理时间
        print(f"  [{name}] 消费 ← {item}")
        queue.task_done()


async def main():
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=5)

    # 启动 1 个生产者 + 3 个消费者
    await asyncio.gather(
        producer(queue),
        consumer(queue, "A"),
        consumer(queue, "B"),
        consumer(queue, "C"),
    )
```

---

## 4. 异步上下文管理器

```python
import asyncio
from typing import AsyncIterator


class AsyncDatabase:
    """模拟异步数据库连接"""

    async def connect(self) -> None:
        await asyncio.sleep(0.1)
        print("数据库连接已建立")

    async def disconnect(self) -> None:
        await asyncio.sleep(0.1)
        print("数据库连接已关闭")

    async def execute(self, sql: str) -> list[dict]:
        await asyncio.sleep(0.05)
        return [{"sql": sql, "rows": 42}]


class AsyncDBConnection:
    """异步上下文管理器"""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._db = AsyncDatabase()

    async def __aenter__(self) -> AsyncDatabase:
        await self._db.connect()
        return self._db

    async def __aexit__(self, *args) -> None:
        await self._db.disconnect()


async def main():
    async with AsyncDBConnection("postgresql://localhost/test") as db:
        result = await db.execute("SELECT count(*) FROM users")
        print(result)
    # 离开上下文时自动断开连接
```

---

## 5. 性能基准测试

### 5.1 HTTP 客户端对比

| 方案 | 1000 请求耗时 | 内存占用 | 代码复杂度 |
|------|--------------|----------|------------|
| `requests` (同步) | 65.3s | 12MB | 低 |
| `requests` + ThreadPool | 8.2s | 45MB | 中 |
| `aiohttp` (asyncio) | 2.1s | 18MB | 中 |
| `httpx` (async) | 2.3s | 22MB | 低 |

*测试条件：1000 次 HTTP GET 请求，目标延迟 100ms*

### 5.2 FastAPI vs Flask 对比

| 指标 | Flask + Gunicorn | FastAPI + Uvicorn |
|------|-----------------|-------------------|
| 每秒请求数 (RPS) | 1,245 | 8,930 |
| P99 延迟 | 480ms | 62ms |
| 内存占用 | 120MB | 85MB |
| 启动时间 | 2.1s | 1.4s |

---

## 6. 常见陷阱与最佳实践

### 6.1 避免阻塞事件循环

```python
# ❌ 错误：在协程中使用同步阻塞调用
async def bad_handler():
    import time
    time.sleep(5)  # 阻塞整个事件循环！
    return "done"

# ✅ 正确：使用线程池执行阻塞调用
async def good_handler():
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, time.sleep, 5)
    return "done"

# ✅ 更好：使用异步库
async def best_handler():
    await asyncio.sleep(5)
    return "done"
```

### 6.2 任务管理检查清单

| 检查项 | 说明 |
|--------|------|
| 确保 Task 被 await 或存储引用 | 防止 Task 被 GC 导致静默失败 |
| 使用 `asyncio.timeout()` | 防止协程无限挂起 |
| 处理 `CancelledError` | 优雅关闭资源 |
| 避免在 `__init__` 中使用 async | 使用工厂方法或 `__init_subclass__` |
| 设置 `PYTHONASYNCIODEBUG=1` | 开发时检测常见错误 |

---

## 7. 总结

Python 异步编程的核心是理解**事件循环**和**协程调度**。`asyncio` 为 I/O 密集型应用提供了极高并发的可能。关键要点：

1. **`async def`** 声明协程，**`await`** 交出控制权
2. **`asyncio.gather()`** 用于并发执行，**`Semaphore`** 控制并发量
3. 永远不要让同步阻塞代码进入事件循环
4. 异步上下文管理器（`__aenter__/__aexit__`）是资源管理的标准方式
5. 选择 `aiohttp` 或 `httpx` 作为异步 HTTP 客户端

---

*本文档由后端研发组编写，欢迎提交 PR 改进内容。*
