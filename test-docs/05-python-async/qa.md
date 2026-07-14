# Python 异步编程 — 问答问题集 (Q&A)

> **配套文档**：`python-async.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题 (Factual Questions)

**Q1.** Python 中创建协程使用什么关键字？交出控制权给事件循环使用什么关键字？  
<details><summary>答案</summary>创建协程用 `async def`，交出控制权用 `await`。</details>

**Q2.** Python 中三种可等待对象（Awaitables）分别是什么？哪个可以多次 await？  
<details><summary>答案</summary>Coroutine（协程）、Task（任务）、Future。Task 和 Future 可以多次 await，Coroutine 只能 await 一次。</details>

**Q3.** `asyncio.Semaphore(5)` 的作用是什么？  
<details><summary>答案</summary>限制同时进行的并发操作数量为 5，超过的协程将等待直到有 slot 释放。</details>

**Q4.** FastAPI + Uvicorn 相比 Flask + Gunicorn 的每秒请求数（RPS）大约是多少倍？  
<details><summary>答案</summary>约 7.2 倍（8930 vs 1245）。</details>

**Q5.** 在生产代码中，应使用什么方法代替 `time.sleep()` 来避免阻塞事件循环？  
<details><summary>答案</summary>`await asyncio.sleep()` 或 `await loop.run_in_executor(None, time.sleep, n)`。</details>

**Q6.** 异步上下文管理器需要实现哪两个特殊方法？  
<details><summary>答案</summary>`__aenter__` 和 `__aexit__`。</details>

---

## 理解型问题 (Comprehension Questions)

**Q7.** 解释 GIL 对 Python 并发模型的影响。为什么多线程不适合 CPU 密集型但 asyncio 适合 I/O 密集型？  
<details><summary>答案</summary>GIL（全局解释器锁）限制同一时刻只有一个线程执行 Python 字节码，因此多线程无法实现真正的并行计算，且线程切换有上下文开销。asyncio 使用单线程 + 协程的协作式调度，当协程遇到 `await I/O 操作` 时主动让出控制权，事件循环切换到其他协程，避免了线程切换开销和 GIL 竞争。CPU 密集型需要真正并行，更适合 multiprocessing 绕过 GIL。</details>

**Q8.** 文档中的生产者-消费者示例中，为什么生产者最后放入 3 个 `None` 值？如果不放 `None` 会怎样？  
<details><summary>答案</summary>`None` 是终止信号，告诉消费者"没有更多数据了，请退出循环"。3 个是因为有 3 个消费者，每个需要收到自己的终止信号。如果不放 `None`，消费者会永远在 `await queue.get()` 阻塞等待，程序无法正常结束。</details>

**Q9.** 解释 `asyncio.gather()` 和 `asyncio.create_task()` 的区别和使用场景。  
<details><summary>答案</summary>`create_task` 将协程封装为 Task 并立即调度执行，返回 Task 对象；`gather` 等待一组协程/Task 全部完成并收集结果。`create_task` 适合"发射后不管"或需要访问中间结果的场景；`gather` 适合"启动一批任务并等待全部完成"的场景。两者常组合使用。</details>

**Q10.** HTTP 客户端对比表中，为什么 `aiohttp` 在 1000 个请求中仅需 2.1 秒，而同步 `requests` 需要 65.3 秒？  
<details><summary>答案</summary>同步 `requests` 串行发送请求，每个请求阻塞等待响应（100ms 网络延迟）后才发送下一个：1000 × 100ms ≈ 100s。`aiohttp` 使用 asyncio 并发发送，所有请求几乎同时发出，总耗时 ≈ 最长单个请求耗时 + 协程调度开销。</details>

---

## 应用型问题 (Application Questions)

**Q11.** 你需要实现一个同时从 3 个不同 API 获取数据的接口，任一 API 失败不应影响其他。请用 asyncio 设计实现。  
<details><summary>答案</summary>使用 `asyncio.gather(return_exceptions=True)` 或 `asyncio.TaskGroup`。`return_exceptions=True` 使 gather 不会因单个任务异常而取消其他任务，而是在结果列表中用 Exception 对象替代。结合 try/except 处理后返回部分可用数据。</details>

**Q12.** 代码审查时发现同事在 `async def` 函数中直接调用了 `requests.get()`。这有什么问题？应如何修改？  
<details><summary>答案</summary>问题：`requests.get()` 是同步阻塞调用，会阻塞整个事件循环，期间其他协程都无法运行。修改方案：1) 使用异步 HTTP 库如 `aiohttp` 或 `httpx.AsyncClient`；2) 如果必须用 requests，使用 `await loop.run_in_executor(None, requests.get, url)` 在线程池中执行。</details>

**Q13.** 设计一个异步任务队列系统：支持添加任务、限制并发、超时取消、收集结果。  
<details><summary>答案</summary>核心组件：1) `asyncio.Queue` 作为任务队列；2) 固定数量 worker 协程（如 10 个）从队列取任务；3) `asyncio.wait_for` 设置每个任务的超时；4) `try/except asyncio.TimeoutError` 处理超时；5) 用另一个 Queue 或列表收集结果。关闭时向队列放入 `None` 作为停止信号。</details>

**Q14.** 为什么文档建议设置 `PYTHONASYNCIODEBUG=1` 进行开发调试？它会检测哪些常见问题？  
<details><summary>答案</summary>会检测：1) 协程被 GC 回收前未 await（通常因忘记 await 导致逻辑错误）；2) 在线程不安全的上下文中调用 `loop.call_soon_threadsafe()`；3) 执行时间 > 100ms 的回调函数（可能是阻塞事件循环的代码）；4) 未正确关闭的异步资源。</details>

**Q15.** 为 FastAPI 应用添加请求超时控制。要求：单请求最长处理时间 30 秒，超过则返回 504。  
<details><summary>答案</summary>使用 `asyncio.timeout`（Python 3.11+）或 `asyncio.wait_for`：在请求处理函数中用 `async with asyncio.timeout(30): result = await process()`，捕获 `TimeoutError` 后返回 `HTTPException(status_code=504)`。同时应在中间件层实现，避免每个端点重复编写超时逻辑。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+  
> 问题覆盖：async/await 语法、并发模型对比、控制模式、性能数据、陷阱与最佳实践
