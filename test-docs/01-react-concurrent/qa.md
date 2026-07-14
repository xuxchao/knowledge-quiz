# React 18 并发渲染 — 问答问题集 (Q&A)

> **配套文档**：`react-concurrent.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题 (Factual Questions)

**Q1.** React 18 引入并发渲染之前，React 16 引入的核心架构叫什么？  
<details><summary>答案</summary>Fiber 架构。Fiber 将虚拟 DOM 树转化为链表结构，使渲染过程可中断。</details>

**Q2.** React 18 中 `startTransition` API 的主要用途是什么？  
<details><summary>答案</summary>将某些状态更新标记为非紧急，使它们可以被更高优先级的更新（如用户输入）中断和推迟。</details>

**Q3.** React 18 新引入的根节点 API 叫做什么？需要从哪个包导入？  
<details><summary>答案</summary>`createRoot`，从 `react-dom/client` 导入。</details>

**Q4.** 在 Lane 优先级模型中，`SyncLane` 的数值和用途分别是什么？  
<details><summary>答案</summary>数值为 `0b1`，用途是同步渲染，不可中断。</details>

**Q5.** 列出 React 18 并发特性的五个核心概念。  
<details><summary>答案</summary>Concurrent Mode、Fiber、Suspense、Time Slicing、Automatic Batching、Transitions（任意五个）。</details>

**Q6.** 在性能测试中，React 18 相比 React 17 在输入响应延迟上提升了多少？  
<details><summary>答案</summary>77.5%（从 187ms 降至 42ms）。</details>

**Q7.** `flushSync` 函数的作用是什么？  
<details><summary>答案</summary>强制退出自动批处理，使包裹的更新立即同步刷新 DOM。</details>

---

## 理解型问题 (Comprehension Questions)

**Q8.** 为什么 Fiber 架构的链表结构能支持"可中断渲染"，而 Stack Reconciler 不能？  
<details><summary>答案</summary>Stack Reconciler 使用递归调用栈，函数调用嵌套在调用栈中无法被打断；而 Fiber 通过 `child/sibling/return` 指针构成的链表组织节点，调度器可以在任意 Fiber 节点暂停或丢弃工作，然后从断点继续或重新开始。</details>

**Q9.** `useDeferredValue` 和 `startTransition` 有什么区别？分别适用于什么场景？  
<details><summary>答案</summary>两者都用于降低更新优先级，但机制不同：`startTransition` 用于**主动**标记某个 setState 操作为低优先级；`useDeferredValue` 用于**被动**接收一个值的延迟版本，当上游值变化时自身不立即更新。前者适合"我知道这个更新不重要"的场景，后者适合"我依赖的值变化频繁但我可以慢一点响应"的场景。</details>

**Q10.** 解释 React 18 中的"自动批处理"是如何工作的？为什么 React 17 在 `setTimeout` 中无法批处理？  
<details><summary>答案</summary>React 18 统一了所有更新上下文（事件处理器、setTimeout、Promise、原生事件等）的批处理行为。React 17 仅在合成事件处理器和生命周期方法中会批处理，因为其批处理逻辑依赖于一个全局标志 `isBatchingUpdates`，异步回调中该标志已被重置为 false。</details>

**Q11.** 什么是 "Time Slicing"？它如何改善用户体验？  
<details><summary>答案</summary>Time Slicing 是将长渲染任务切成多个小时间片的技术，每个时间片（约 5ms）执行部分渲染工作，然后把控制权交还给浏览器处理用户交互。这样即使用户在页面渲染过程中进行输入，也能得到即时响应，而不会被阻塞直到渲染完成。</details>

**Q12.** React 18 Strict Mode 下 `useEffect` 执行两次（开发环境）的设计目的是什么？  
<details><summary>答案</summary>这是为了检测 Effect 是否正确实现了清理（cleanup）逻辑。如果一个 Effect 缺少清理函数，重复挂载/卸载就会暴露内存泄漏或状态不一致的问题。这仅在开发环境生效，生产环境行为不变。</details>

---

## 应用型问题 (Application Questions)

**Q13.** 你需要为一个实时搜索功能做优化：用户在输入框中键入时，搜索框的输入需要即时响应，但搜索结果显示可以稍慢。请用 React 18 的并发特性设计实现方案。  
<details><summary>答案</summary>使用 `startTransition` 包裹搜索结果的 setState，而输入的 setState 保持紧急优先级。或者使用 `useDeferredValue` 对搜索关键词做延迟处理。两种方式都能确保输入框的交互不受搜索结果渲染的阻塞。</details>

**Q14.** 你的团队正在从 React 17 迁移到 React 18。列出迁移时需要检查的 5 个关键项。  
<details><summary>答案</summary>1) 升级 react 和 react-dom 到 18.x；2) 将 `ReactDOM.render` 替换为 `createRoot`；3) 检查 Strict Mode 下 useEffect 双重执行是否暴露了副作用问题；4) 将可延迟的更新包裹在 `startTransition` 中；5) 检查第三方库是否兼容 React 18（如 react-beautiful-dnd 可能需要升级）。</details>

**Q15.** 在一个列表渲染场景中，当用户快速滚动时，列表项中的复杂渲染导致滚动卡顿。请设计使用 React 18 并发特性的优化方案。  
<details><summary>答案</summary>将滚动事件的更新标记为紧急更新（默认就是），而列表项内容的渲染用 `startTransition` 包裹。这样当用户快速滚动时，React 会优先响应滚动位置变化，暂停列表内容的渲染，待到滚动停止后再完成内容渲染。也可以结合 `useDeferredValue` 处理传递给子组件的滚动偏移量。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+  
> 问题覆盖：标题、架构、API、性能数据、迁移指南
