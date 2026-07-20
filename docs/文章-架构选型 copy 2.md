# 从一句 Hello World 到完整 RAG 系统：一个 AI 知识库的架构选型实录

> 这是一篇关于"为什么"的文章。不是教你写代码，而是讲清楚一个 AI 知识库项目里，每个技术决策背后的取舍逻辑。从最简单的 AI 对话 demo 开始，一步步讲到 RAG 检索架构，每一步都回答一个问题：为什么选它，而不是选另一个？

---

## 一、第一步永远是从 Hello World 开始 —— LangChain

### 1.1 最简单的 AI 对话长什么样

在谈论架构之前，先看看 AI 对话的最小可用形态。用 LangChain 调用大模型，核心代码其实就这么几行：

```typescript
import { ChatOpenAI } from '@langchain/openai';

const model = new ChatOpenAI({
  apiKey: process.env.QWEN_API_KEY,
  configuration: {
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  model: 'qwen-plus',
  temperature: 0.7,
  streaming: true,
});

const stream = await model.stream('你好，请用一句话介绍你自己');
for await (const chunk of stream) {
  process.stdout.write(chunk.content as string);
}
```

这就是一个完整的流式 AI 对话。用户输入一句话，模型流式返回回答，就这么简单。

但真正的项目不可能只停在 Hello World。你需要管理对话历史、做文件解析、接检索系统、处理流式协议、追踪调用链路……这时候选什么框架就变得很重要了。

### 1.2 先说协议：大模型通信的事实标准

在比较框架之前，先理清一个比框架更底层的东西——**大模型通信协议**。这决定了你的代码能不能在不同模型之间无缝切换，也决定了框架的生态广度。

目前主流的协议可以分成两层：

**第一层：模型通信协议**（你的应用怎么调模型）

| 协议 | 提出方 | 地位 | 谁在用 |
|------|--------|------|--------|
| **OpenAI Chat Completions API** | OpenAI | 事实标准 | 阿里通义千问、DeepSeek、Moonshot Kimi、智谱 GLM、百度文心、字节豆包……几乎所有国产大模型平台都提供兼容接口 |
| Anthropic Messages API | Anthropic | Claude 原生协议 | Claude 系列模型专用，格式与 OpenAI 不同 |
| Google Gemini API | Google | Gemini 原生协议 | Gemini 系列模型专用 |

这里面 OpenAI 协议是绝对的事实标准。原因很简单：OpenAI 是第一个跑通的大模型 API，生态先发优势太大。后来者想抢占开发者，最快的方式就是兼容它的接口格式——你只需要改一个 `baseURL` 和 `apiKey`，就能从通义千问切到 DeepSeek 再切到 Moonshot，业务代码一行不用动。这就是为什么几乎所有国产模型平台都主动适配 OpenAI 协议，而不是另起炉灶。

**第二层：工具集成协议**（AI 怎么连外部工具和数据）

| 协议 | 提出方 | 定位 | 现状 |
|------|--------|------|------|
| Function Calling | OpenAI | 模型调用外部函数的机制 | 已被广泛实现，但各厂商格式有差异 |
| **MCP (Model Context Protocol)** | Anthropic，2024.11 发布 | 连接 AI 与外部工具/数据源的开放标准 | 2025.12 捐赠给 Linux 基金会，97M+ 月 SDK 下载，1 万+ 公开服务器，Claude/ChatGPT/Gemini/Copilot/Cursor 全部原生支持 |

MCP 解决的是"N×M 集成问题"——以前 5 个模型接 10 个系统要写 50 套对接代码，现在每个系统写一个 MCP Server，所有支持 MCP 的模型都能用。它基于 JSON-RPC 2.0，提供 Python、TypeScript、C#、Java 四种官方 SDK。虽然 MCP 主要解决工具集成而非模型通信，但它正在成为 Agent 时代的基础设施协议。

**对框架选型的影响**：一个框架支持 OpenAI 协议，意味着它能通吃绝大部分模型；支持 MCP，意味着它的 Agent 能接海量工具。这两点是衡量框架生态广度的关键指标。

### 1.3 当前 AI 开发最主流的几个框架

理清协议之后，来看看 Node.js 生态里做 AI 应用开发，同类型的框架有哪些选择。这里比较的是**AI 应用/Agent 编排框架**——它们都解决"怎么用代码组织 LLM 调用、文档处理、检索、工具调用"这个问题，而不是前端 UI 适配（那是下一节的事）。

| 框架 | 定位 | 核心能力 | 多语言支持 | 协议覆盖 |
|------|------|---------|-----------|---------|
| **LangChain** | LLM 应用编排框架 | 模型抽象、文档 Loader、文本 Splitter、链式调用、LangGraph 多 Agent 工作流 | Python（原版，最成熟）、JS/TS（官方，1.0 已与 Python 功能对齐）、Java（社区项目 LangChain4j） | OpenAI 协议通吃，支持 Anthropic/Google 等 20+ Provider |
| **LlamaIndex** | RAG 与数据索引框架 | 文档索引、检索策略、查询引擎，专注"让 AI 回答你的数据" | Python（原版）、TypeScript（LlamaIndex.TS） | OpenAI 协议为主，无 Java 原生支持 |
| **Mastra** | TS 原生一体化 Agent 框架 | Agent、工作流、RAG、记忆、评估一体化，内置可观测性 | TypeScript 原生（非 Python 移植，从零为 TS 设计） | 40+ Provider，内置 MCP Server 支持 |
| **DeepAgents** | LangChain 的"开箱即用"Agent 套件 | 规划（write_todos）、虚拟文件系统、子 Agent 委派，基于 LangGraph | Python、JavaScript | 复用 LangChain 的 Provider 体系 |
| **OpenAI Agents SDK** | OpenAI 官方 Agent 框架 | 多 Agent 协作、任务交接（handoff）、语音 Agent | Python、TypeScript | 原生 OpenAI 协议，对其他厂商支持有限 |

几个关键判断点：

**多语言生态，LangChain 最完整。** Python 版是原版，文档最全、社区最大、迭代最快；JS/TS 版是官方维护，2025 年 10 月 LangChain 1.0 发布后已与 Python 版功能对齐；Java 生态有 LangChain4j（社区项目，非官方，但 API 设计符合 Java 习惯，适合 JVM 企业应用）和 Spring AI（Spring 官方项目，深度绑定 Spring Boot 生态）。LlamaIndex 只有 Python 和 TS，没有 Java 原生支持。Mastra 和 Vercel AI SDK 是 TS 原生，纯 JS/TS 生态。这意味着如果你的后端是 Java，LangChain4j / Spring AI 几乎是唯一成熟的选择。

**集成度越高，灵活度越低。** DeepAgents 是 LangChain 官方的"开箱即用"方案——一行 `createDeepAgent()` 就能得到一个能规划任务、读写文件、委派子 Agent 的完整 Agent。但代价是它的内部流程高度封装，你想替换其中某个环节（比如换一套检索策略或向量库）会比较困难。Mastra 走的也是一体化路线，agents/workflows/RAG/memory/eval 全打包。而 LangChain 本体更像是"乐高积木"——Loader、Splitter、Retriever、Chain 各自独立，你按需拼装，灵活但需要自己写更多胶水代码。

**LlamaIndex 在 RAG 上更专精。** LangChain 是通用编排框架，RAG 只是它众多能力之一；LlamaIndex 从一开始就是为"让 AI 回答你的数据"而设计的，在文档索引、查询引擎、检索策略上提供了更细粒度的抽象。实际上两者经常一起用——LlamaIndex 做数据层和检索，LangChain/LangGraph 做 Agent 编排，这是生产环境的常见组合。

**为什么这个项目选 LangChain？** 三个原因：第一，OpenAI 协议通吃国产模型，改个 `baseURL` 就能切换通义千问/DeepSeek/Moonshot，这个兼容性是刚需；第二，LangChain 社区提供的 Document Loader（PDFLoader、DocxLoader、PPTXLoader、CSVLoader）和 Text Splitter 开箱即用，做 RAG 能省大量时间；第三，LangGraph（多 Agent 工作流）和 LLMGraphTransformer（结构化知识抽取）为后续的图谱检索留了扩展空间。相比之下，DeepAgents 集成度太高、不够灵活，Mastra 当时生态还不够成熟，LlamaIndex 的 JS 版能力不如 Python 版丰富——综合下来 LangChain 是最合适的基座。

值得一提的是，LangChain 和 Vercel AI SDK（`ai` 包）不是竞争关系，而是互补的。LangChain 负责后端的模型调用、文档处理和检索逻辑；AI SDK 负责前后端之间的流式通信协议。项目里用 `@ai-sdk/langchain` 这个桥接包，把 LangChain 的流式输出转换成 AI SDK 的 UI Message Stream 格式：

```
后端模型流（LangChain AIMessageChunk）
    ↓  @ai-sdk/langchain 转换
AI SDK UI Message Stream
    ↓  HTTP SSE 传输
前端 @ai-sdk/vue useChat 消费
```

这套组合的好处是：后端用 LangChain 享受完整的 RAG 生态，前端用 AI SDK 享受成熟的流式 UI 协议，各取所长。前端的流式通信协议为什么选 AI SDK，下一节会详细说。

---

## 二、前端框架：Vue + Vite + UnoCSS + @ai-sdk/vue

### 2.1 为什么是 Vue

后端有了，还需要一个前端来操作。这个项目的前端其实就两个页面：一个 AI 对话页，一个文档管理页。

选 Vue 3 没有什么特别戏剧化的理由——**就是熟悉**。Composition API + `<script setup>` 写起来足够简洁，Pinia 做状态管理，Vueuse 提供常用 composables。一个个人项目，在框架选择上花太多时间不值得，选最顺手的就对了。

技术栈组合也比较标准：

```
Vue 3 + Vite（构建）+ TypeScript + UnoCSS（原子化样式）+ Pinia（状态管理）
```

UnoCSS 选它而不是 TailwindCSS，主要是因为 UnoCSS 的按需生成机制更灵活，预设配置也更轻量。但说实话，两者在这个项目体量下差别不大，选哪个都行。

### 2.2 流式输出为什么用 @ai-sdk/vue

这才是前端选型里真正值得说的部分。

AI 对话的核心体验是**流式输出**——模型一个字一个字地往外吐，用户不需要等全部生成完才看到内容。实现流式输出技术上不难，后端用 SSE（Server-Sent Events）推数据，前端用 `EventSource` 或 `fetch + ReadableStream` 接收就行。但难的是把流式状态管理好：

- 消息正在生成时怎么显示？
- 生成中途出错了怎么回滚？
- 怎么在流开始前先把引用信息发过去？
- 流结束后怎么拿到完整内容做持久化？
- 多条消息并发时状态怎么隔离？

如果自己手写这套逻辑，代码量和 bug 量都不会少。`@ai-sdk/vue` 的 `useChat` composable 把这些都封装好了：

```typescript
const { messages, input, handleSubmit, status, error } = useChat({
  api: '/api/conversations/chat',
});

// messages 是响应式的，流式增量自动更新
// status 管理就绪/流式中/出错等状态
// handleSubmit 处理表单提交和流式接收
```

**更重要的是，AI SDK 的 UI Message Stream 协议正在成为一种事实标准。** Vercel 自己的 v0、ChatGPT Clone 模板、Next.js AI SDK 示例，大量的 AI 应用都在用这套协议。它的数据格式清晰，支持文本增量、数据消息（比如引用、会话 ID）、错误事件等多种类型。选一个普及度高的协议，意味着前端组件生态、调试工具和社区方案都能直接用。

项目早期其实考虑过手写一套自定义 SSE 协议（后端用 GET + SSE，前端用原生 EventSource），但很快就放弃了。原因很简单：自己维护一套通信协议，不仅要写发送端和接收端，还要处理重连、错误恢复、消息状态同步，这些都是重复劳动。用 AI SDK 的标准协议，后端用 `createUIMessageStream` + `pipeUIMessageStreamToResponse`，前端用 `useChat`，两端协议天然对齐，省下来的时间拿去做业务逻辑不香吗。

---

## 三、要存会话和聊天记录，就需要数据库 —— PostgreSQL

### 3.1 为什么是 PostgreSQL 而不是 MySQL

到这一步，系统已经支持了 AI 问答和会话切换。但对话历史、消息记录、文档信息这些数据需要落库。这里选了 PostgreSQL。

最直接的原因：**PostgreSQL 原生支持向量类型（pgvector 扩展），MySQL 不支持。**

在 RAG 系统里，文档分块需要转成向量存储，查询时也需要把用户问题转成向量做相似度搜索。如果用 MySQL，你就需要一个额外的向量数据库（比如 Milvus、Pinecone、Weaviate）来存向量。这意味着：

- **数据一致性问题**：业务数据在 MySQL，向量数据在 Milvus，一次写入要同时操作两个数据库。写入成功了但向量库写入失败了怎么办？删除了一条记录但向量库里的向量还在怎么办？这种跨库一致性问题是 RAG 系统最常见的 bug 来源。
- **同步删除问题**：用户删了一份文档，MySQL 里的记录删了，但向量库里的向量没删，AI 还是会检索到已删除的内容。这种"幽灵引用"比报错更危险。
- **运维复杂度**：多一个组件就多一份部署、监控、备份和故障排查的成本。

用 PostgreSQL + pgvector，业务数据和向量数据在同一个数据库里，同一次事务就能保证一致性。写入要么都成功，要么都回滚。删除时一条 SQL 就能连带向量一起清理。

### 3.2 为什么没有用专门的向量数据库

既然 pgvector 能存向量，那为什么不直接用专门的向量数据库（Milvus、Pinecone、Weaviate、Qdrant）呢？专门做的不是性能更好吗？

这个问题需要从几个维度看：

**数据量级**。专门的向量数据库在百万级、千万级向量场景下优势明显——它们用了专门的索引算法（HNSW、IVF、PQ 等），在大规模近邻搜索时性能远超关系型数据库。但这个项目是个人知识库，文档量在百到千级别，分块数在万级别。pgvector 的 HNSW 索引在这个量级下查询延迟完全够用，通常在毫秒级。为了一个百万级才需要的性能优势去引入一个新组件，不划算。

**代码复杂度**。引入专门向量数据库意味着多一套 SDK、多一套连接管理、多一套索引维护逻辑。用 pgvector，向量操作就是普通的 SQL：

```sql
-- 向量相似度搜索，一条 SQL 搞定
SELECT id, content, embedding <=> $1 AS distance
FROM chunks
WHERE document_id = ANY($2)
ORDER BY embedding <=> $1
LIMIT 30;
```

业务查询和向量查询在同一个连接里完成，不需要在两个数据库之间来回跳。

**服务器要求**。Milvus 依赖 etcd、MinIO 和独立存储，部署起来很重。Pinecone 是 SaaS，数据不在自己手里。Qdrant 和 Weaviate 虽然可以自部署，但也多了一个进程要管理。PostgreSQL 本来就是业务数据库必装的，加一个 pgvector 扩展只是一行命令的事：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**什么时候该换？** 如果向量数量增长到百万级以上，查询延迟明显上升，或者需要更复杂的向量过滤（比如多向量联合查询、混合过滤条件），那时候再考虑迁移到专门向量数据库也不迟。PostgreSQL 的好处是，迁移时只需要把向量数据导出，业务数据不用动。但反过来，如果一开始就用 Milvus，后来发现数据量根本没那么大，想换回 PostgreSQL 就麻烦多了。

**所以结论是**：在数据量不大、追求快速验证和个人项目可控性的阶段，PostgreSQL + pgvector 是最优选择。它用一个数据库解决了业务存储和向量存储两个问题，是复杂度和能力的最佳平衡点。

---

## 四、要回答自己的数据，就需要知识库 —— 文件处理

### 4.1 要支持哪些文件类型

AI 能回答自己存储的信息，靠的不是把整篇文档塞进 Prompt，而是先把文档处理成可检索的分块。这一步需要确认：用户会上传什么类型的文件？

这个项目支持的类型覆盖了常见的知识文档格式：

| 文件类型 | 扩展名 | 处理方式 |
|---------|--------|---------|
| Markdown | `.md` | 按标题层级（`#`~`######`）分割为段落 |
| PDF | `.pdf` | LangChain `PDFLoader` 提取文本 → 文字不足时 OCR |
| Word | `.docx` | LangChain `DocxLoader` |
| Word 旧版 | `.doc` | LibreOffice 转 `.docx` → `DocxLoader` |
| Excel | `.xlsx` | `xlsx` 库按行解析为 table-row 结构 |
| Excel 旧版 | `.xls` | LibreOffice 转 `.xlsx` → `xlsx` 解析 |
| CSV | `.csv` | LangChain `CSVLoader` |
| PPT | `.pptx` | LangChain `PPTXLoader`，按幻灯片分割 |
| TXT | `.txt` | 自动编码检测（UTF-8 / GB18030） |
| JSON | `.json` | 按记录/键值对分割 |
| 图片 | `.jpg` `.png` 等 | `sharp` 处理 + 视觉模型描述 |
| 音频 | `.mp3` `.wav` 等 | 语音转文字（ASR） |
| 视频 | `.mp4` | FFmpeg 提取音频 + 每 30 秒抽帧 + 视觉模型描述 |
| 网页 | URL | `cheerio` HTML 解析，提取 `main`/`article` 内容 |

### 4.2 每种文件大概怎么处理

大致可以分成三类：

**文本类（MD、PDF、Word、PPT、TXT、JSON、CSV）**，这些文件本身就有文本内容，可以直接通过 LangChain 社区的 Loader 来处理。`@langchain/community` 提供了 `PDFLoader`、`DocxLoader`、`PPTXLoader`、`CSVLoader`，基本拿来就用。PDF 有个特殊情况——扫描版 PDF 提取出来的文字可能为空或极少，这时候需要降级到 OCR：先截图每页，再调用视觉模型识别文字。

**图片类**，本身没有文本，需要通过视觉模型来"看图说话"。项目用 `sharp` 先做图片预处理（调整大小、格式转换），然后调用千问视觉模型（`qwen-vl-plus`）生成图片描述文本，再走正常的文本分块流程。

**音视频类**，音频通过 ASR（语音转文字）处理，视频则更复杂——需要 FFmpeg 提取音轨做 ASR，同时每 30 秒抽一帧画面调用视觉模型描述，最后把时间轴上的文本和画面描述合并。这样检索到的视频片段还能定位到具体时间点。

### 4.3 统一转 Markdown：未来的方向

目前不同文件类型的处理结果是各自独立的文本格式，分块策略也各不相同。但后续的演进方向是：**所有文件都先转化成 Markdown 格式，再统一用 Markdown 的 splitter 做结构化切片。**

为什么要这么做？因为 Markdown 是最接近"结构化纯文本"的格式，它天然带层级结构（标题、列表、表格、代码块），而且几乎所有文件类型都可以转成 Markdown 表达：

- PDF 的每一页可以转成带 `## 第 N 页` 标题的 Markdown 段落
- Excel 的每个 Sheet 可以转成 Markdown 表格
- PPT 的每张幻灯片可以转成带标题的 Markdown section
- 音频转写文本天然就是纯文本，直接包在 Markdown 里
- 图片描述可以放在 Markdown 的图片标记位置

统一成 Markdown 之后，用一套 splitter 就能处理所有文件类型，而且能利用 Markdown 的结构信息做更智能的切片。这样做有几个优势：

1. **语义完整性**：Markdown splitter 会沿着标题层级切分，不会把一个章节从中间劈开。一个 Chunk 里包含的是完整的标题 + 正文，不会出现半句话。
2. **表格感知**：Markdown 表格不会被从中间切断，一整行数据就是一个完整语义单元。
3. **来源可追踪**：每个 Chunk 可以保留它在原文档标题树中的位置（`headingPath`），比如 `["第一章", "1.2 核心概念", "定义"]`，这个路径信息在检索结果展示时非常有用。
4. **统一逻辑**：一套解析逻辑、一套分块策略、一套元数据格式，降低维护成本。

目前项目已经保留了 Markdown 的标题路径（`headingPath`）、PDF 页码（`pageNumber`）、Excel 工作表名（`sheetName`）、PPT 幻灯片号（`slideNumber`）、音频时间戳（`startMs`/`endMs`）等结构化来源信息，为后续统一 Markdown 化打好了基础。

---

## 五、要查到合适的内容，就需要 RAG

### 5.1 经典 RAG 架构：关键词 + 向量

文档处理好了，分块也存了，用户提问时怎么找到最相关的内容？

这里用的是经典的双路检索 RAG 架构：**Elasticsearch 做关键词查询，向量做语义查询，两路并行，各取 Top 30 候选。**

为什么需要两路？因为关键词搜索和向量搜索擅长的事情完全不同：

**关键词搜索擅长的场景**：
- 用户问"K8s 的 Pod 亲和性怎么配置"，文档里写的也是"Pod 亲和性"——关键词完全匹配，ES 能精准命中。
- 用户搜一个专有名词"HNSW"，向量搜索可能把它和"ANN"、"近似最近邻"排在一起，但用户要的就是包含"HNSW"这个词的分块。
- 用户搜一个错误码"ERR_CONNECTION_REFUSED"，这种字面精确匹配是关键词搜索的强项。

**向量搜索擅长的场景**：
- 用户问"怎么让容器自动重启"，文档里写的是"Kubernetes 的自愈机制会在 Pod 崩溃后重新调度"——关键词完全不重叠，但语义是一样的，向量搜索能找到。
- 用户问"数据库太慢了怎么办"，文档里写的是"PostgreSQL 查询性能优化方案"——措辞不同但意图相同，向量搜索通过语义相似度能匹配上。
- 用户用口语提问"为啥我的服务起不来"，文档里是"服务启动失败的排查步骤"——向量搜索能跨越表达方式的差异。

一个简单的对比：

| 用户问题 | 文档原文 | 关键词搜索 | 向量搜索 |
|---------|---------|-----------|---------|
| "离职流程" | "离职流程" | ✅ 精准命中 | ✅ 也能命中 |
| "怎么辞职" | "离职流程" | ❌ 无关键词匹配 | ✅ 语义匹配 |
| "HNSW" | "HNSW 索引原理" | ✅ 精准命中 | ⚠️ 可能被泛化稀释 |
| "容器自动重启" | "Pod 自愈机制" | ❌ 无关键词匹配 | ✅ 语义匹配 |
| "ERR_TIMEOUT" | "ERR_TIMEOUT 错误处理" | ✅ 精准命中 | ⚠️ 错误码不是语义实体 |

两路各有盲区，合在一起才能覆盖最多场景。这就是为什么这个项目用了双路检索而不是单路。

**关于 RRF 融合和重排序**：两路检索各返回 30 条结果后，怎么合并排序？直接比分数行不通——向量返回的是余弦相似度（0~1），ES 返回的是 BM25 分数（无上界），两个分数不在一个量纲上。RRF（Reciprocal Rank Fusion）算法的巧妙之处在于它不比较分数，只比较排名。还有重排序模型和图谱检索，这些更深入的优化策略，会在系列的第三篇文章里详细展开。

---

## 六、排查问题：Langfuse

### 6.1 为什么需要链路追踪

RAG 系统的调用链路很长：用户提问 → 查询向量化 → 双路检索 → 融合排序 → 重排序 → 上下文拼接 → LLM 生成 → 流式返回。中间任何一步出问题，表现都是"AI 回答不好"，但你看不出是哪一步的问题。

是检索没召回到相关内容？是召回了但重排序排下去了？是上下文太长被截断了？是模型本身能力不行？还是 Prompt 写得不好？没有链路追踪，这些问题只能靠猜。

### 6.2 为什么选 Langfuse 而不是 LangSmith

做 LLM 可观测性，最知名的两个工具是 LangSmith 和 Langfuse。

**LangSmith** 是 LangChain 官方的追踪平台，和 LangChain 生态集成度最高。但它有一个硬伤：**没有开源自托管版本**。你只能用他们的 SaaS 云服务，数据要传到他们的服务器上。对于这个项目来说，知识库里的文档内容、用户的问题和 AI 的回答都包含敏感数据，传到第三方云服务上不可接受。

**Langfuse** 是开源的 LLM 可观测性平台，支持完全自托管部署。项目里用 Docker Compose 拉起一个 Langfuse 实例，数据存在本地的 PostgreSQL 和 ClickHouse 里，完全不依赖外部服务。它提供了：

- **Trace 追踪**：每次 AI 调用的完整链路——从检索到生成，每一步的输入、输出、耗时和 Token 消耗都记录在案。
- **Generation 记录**：每次 LLM 调用的 prompt、completion、model、temperature、token 用量都有详细记录。
- **Score 评分**：可以对回答质量打分，支持人工评分和自动评分。
- **LangChain 集成**：通过 `@langfuse/langchain` 包，LangChain 的回调自动上报到 Langfuse，不需要改业务代码。

```typescript
// LangChain 模型初始化时传入 Langfuse 回调
const model = new ChatOpenAI({
  model: 'qwen-plus',
  callbacks: langfuseService.getLangChainCallbacks(), // 自动追踪
});
```

有了 Langfuse，当用户反馈"AI 回答得不对"时，你可以打开 Langfuse 面板，看到这次对话的完整链路：检索召回了哪些分块、各自分数多少、最终送进 Prompt 的上下文是什么、模型生成了什么。问题出在哪一步一目了然。

---

## 七、记忆系统：Mem0

最后提一下记忆系统。

项目目前用了 Mem0 做跨会话的语义记忆——简单说就是让 AI 记住用户的偏好、身份和长期目标，在以后的对话中能参考。比如用户说过"我是做后端开发的"，以后 AI 回答时就默认用后端视角解释问题。

但说实话，**对于当前这个项目来说，记忆系统没有太多实际意义。** 这是一个个人知识库工具，用户量和会话频率都不高，AI 记不记住你的偏好影响不大。引入 Mem0 更多是个人想了解这套技术方案是怎么工作的——它怎么从对话中提取记忆、怎么做语义检索、怎么管理记忆生命周期。

如果你只是想做一个能用的知识库问答系统，完全可以直接用 PostgreSQL 存会话历史，在 Prompt 里拼上最近几轮对话就够了。Mem0 这种语义记忆系统更适合用户量更大、交互更频繁的 C 端 AI 产品。

所以这一节不展开讲，把它当成一个"用了但不是必须"的组件就好。

---

## 写在最后

回顾一下整个架构选型的思路：

| 层级 | 选择 | 核心理由 |
|------|------|---------|
| LLM 框架 | LangChain | OpenAI 兼容协议通吃国产模型，Loader/Splitter/Graph 开箱即用 |
| 流式通信 | Vercel AI SDK | 统一前后端流式协议，`useChat` 封装好状态管理，生态普及度高 |
| 前端 | Vue 3 + Vite + UnoCSS | 熟悉，够用，不过度设计 |
| 数据库 | PostgreSQL + pgvector | 业务数据和向量数据同库，事务一致性，万级数据量性能足够 |
| 文件处理 | LangChain Loaders + 视觉模型 + ASR | 全格式覆盖，统一转 Markdown 是未来方向 |
| 检索 | ES 关键词 + pgvector 向量 | 双路互补，覆盖关键词精确匹配和语义泛化两种场景 |
| 可观测性 | Langfuse | 开源自托管，数据不外传，LangChain 集成零侵入 |
| 记忆 | Mem0 | 了解技术方案为主，当前项目非必须 |

每个决策背后都有一个共同的逻辑：**在当前阶段，用最小的复杂度解决问题，同时给未来留出演进空间。**

PostgreSQL 既能存业务数据又能存向量，不用一上来就部署 Milvus；LangChain 的 Loader 能处理大部分文件，不用自己写解析器；AI SDK 的协议标准化了流式通信，不用手写 SSE；Langfuse 自托管不用传数据到外部。每一个选择都是在"够用"和"不过度"之间找平衡。

技术选型没有标准答案，但有一个判断原则：**如果你说不清楚为什么不选另一个，那你还没想清楚为什么选这个。**

这是系列的第二篇文章。第一篇讲了项目整体复盘，这篇讲架构选型，第三篇会深入 RAG 检索的进阶优化——RRF 融合、重排序、邻居扩展、图谱检索，以及如何评估检索质量。

---

> 项目地址：[Knowledge Quiz 2](https://github.com/YOUR_USERNAME/knowledge-quiz2)
>
> 如果觉得有帮助，点个 Star ⭐。有问题评论区见。
