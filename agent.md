# Agent Guide

This guide is for AI/coding agents working in `knowledge-quiz2`. It describes the repository as it exists on 2026-07-17. Read the relevant implementation before changing behavior; the worktree may contain newer, uncommitted work.

## Project Summary

`knowledge-quiz2` is a pnpm monorepo for an AI knowledge-document and novel-question-answering system:

- `backend/`: NestJS 11 API, document ingestion worker, LangGraph workflows, and infrastructure integrations.
- `frontend/`: Vue 3 + TypeScript + Vite single-page UI.
- `docker-compose.yml`: local PostgreSQL/pgvector, Elasticsearch/Kibana, Neo4j, Redis, RustFS, Mem0, Langfuse, ClickHouse, and admin tools.
- `docker-compose.prod.yml`: containerized backend, a separate ingestion worker, frontend, and production infrastructure.

The current RAG design uses each store for a distinct purpose:

- PostgreSQL is the source of truth for documents, chunks, conversations, messages, graph-run state, LangGraph checkpoints, and chunk vectors through pgvector.
- Elasticsearch provides keyword/full-text retrieval.
- Neo4j stores novel structure and relationships, not chunk embeddings.
- RustFS stores original uploaded files and temporary ingestion artifacts.
- Mem0 stores user-level and conversation-level semantic memory.

## Repository Layout

```text
.
|-- backend/
|   |-- src/
|   |   |-- ai/                     # chat, retrieval graph, RAG chat graph, token budgets
|   |   |-- common/                 # structured logger, filters, interceptors
|   |   |-- config/                 # TypeORM configuration
|   |   |-- conversations/          # conversations and persisted messages
|   |   |-- documents/              # upload, parsing, ingestion graph/worker, novel graph extraction
|   |   |-- entities/               # TypeORM entities
|   |   |-- graph/                  # graph runs and PostgreSQL LangGraph checkpoints
|   |   |-- infrastructure/
|   |   |   |-- elasticsearch/      # keyword index/search
|   |   |   |-- file-processor/     # structured multi-format extraction
|   |   |   |-- langfuse/           # traces and scores
|   |   |   |-- mem0/               # long-term memory client
|   |   |   |-- neo4j/              # novel entity/relationship graph
|   |   |   |-- postgres-vector/    # pgvector cosine search and index checks
|   |   |   |-- redis/              # Redis integration
|   |   |   |-- rustfs/             # S3-compatible object storage
|   |   |   `-- speech/             # Tencent ASR/TTS
|   |   |-- memory/
|   |   |-- migrations/
|   |   `-- cli/                    # ingestion worker and RAG maintenance commands
|   `-- test/
|-- frontend/
|   `-- src/
|       |-- components/
|       |-- composables/
|       |-- core/http.ts
|       |-- pages/
|       `-- types/
|-- docker/
|-- docs/
|-- scripts/
|-- .env.example
|-- docker-compose.yml
|-- docker-compose.prod.yml
|-- package.json
`-- pnpm-workspace.yaml
```

## Core Runtime Flows

### Document ingestion

`POST /api/documents` stores an upload in RustFS (or records a URL), creates a `Document`, and creates an idempotent `graph_runs` row. `DocumentIngestionWorker` claims runs from PostgreSQL with `FOR UPDATE SKIP LOCKED`, maintains a lease/heartbeat, retries with exponential backoff, and resumes through a PostgreSQL LangGraph checkpoint.

`DocumentIngestionGraph` currently runs:

1. `prepare`
2. `cleanupPrevious`
3. `extract`
4. `validateDocument`
5. `chunk`
6. `embedAndStage`
7. `extractNovelGraph` and `indexElasticsearch` in parallel
8. `finalize`
9. `cleanupArtifacts`

`embedAndStage` persists chunk records and 1536-dimensional embeddings in PostgreSQL. The pgvector HNSW cosine index is `IDX_chunks_embedding_hnsw`. Novel graph extraction is best-effort: a graph failure is recorded on the document but does not discard otherwise valid text indexes. Terminal ingestion failures trigger compensating cleanup.

In development, the API starts the worker automatically unless `INGESTION_WORKER_AUTOSTART=false`. Production Compose disables it in the API container and runs the `ingestion-worker` service separately.

### Retrieval and chat

`RetrievalGraph` analyzes a question into `text`, `graph`, or `hybrid` mode. It can run three retrieval branches in parallel:

- PostgreSQL pgvector cosine search for semantic chunk recall.
- Elasticsearch for keyword recall.
- Neo4j for novel entities, chapters, events, and relationships.

Text hits are fused with RRF, reranked with `gte-rerank-v2`, filtered to the top relevant chunks, and expanded with neighboring chunks within a token budget. Graph evidence is attached using its source chunk IDs. Individual branches degrade independently; the request fails only when every branch required by the selected mode is unavailable.

`RagChatGraph` combines retrieved chunks, graph evidence, Mem0 memories, and persisted conversation history. It streams AI SDK-compatible events, persists the assistant response and citations, updates both memory scopes, and can asynchronously score groundedness in Langfuse when agentic mode is enabled.

## Important Backend APIs

All routes use the global `/api` prefix.

- `POST /api/documents`: upload one multipart `file` or submit a `url`; returns HTTP 202 and a `jobId`.
- `GET /api/documents`: paginated list with optional `name`, `page`, and `limit`.
- `GET /api/documents/:id`: document with chunks.
- `GET /api/documents/:id/ingestion`: run progress plus novel graph status.
- `GET /api/documents/:id/download`: download the original uploaded object.
- `DELETE /api/documents/:id`: delete document data and associated artifacts/indexes.
- `GET|PUT|DELETE /api/chunks/:id` and `GET /api/chunks?documentId=...`: chunk management.
- `GET /api/conversations`, `GET /api/conversations/get/:id`, `DELETE /api/conversations/delete/:id`: conversation management.
- `POST /api/conversations/chat`: streaming RAG chat.

Supported uploads are PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX, TXT, Markdown, JSON, JPG/JPEG/PNG/GIF/WebP, MP3/WAV/M4A, and MP4. Uploads are limited to 50 MiB and checked against basic file signatures.

## Environment

The root `.env.example` is authoritative. `ConfigModule` resolves the root `.env` by absolute path, including for CLI entry points.

Critical groups:

- API/UI: `BACKEND_HOST`, `BACKEND_PORT`, `VITE_API_BASE_URL`.
- Model access: `QWEN_API_KEY`, `QWEN_API_BASE_URL`, `QWEN_VISION_MODEL`, `QWEN_RERANK_MODEL`.
- Stores: `POSTGRES_*`, `ELASTICSEARCH_*`, `NEO4J_*`, `RUSTFS_*`, `REDIS_*`.
- Ingestion: `RAG_PARSER_VERSION`, `GRAPH_WORKER_*`, `GRAPH_NODE_TIMEOUT_MS`, `INGESTION_WORKER_AUTOSTART`.
- Novel graph: `NOVEL_GRAPH_*`.
- Retrieval/context: `EMBEDDING_DIMENSIONS`, `RAG_MIN_SCORE`, `RAG_CONTEXT_TOKEN_BUDGET`, `RAG_GRAPH_CONTEXT_TOKEN_BUDGET`, `RAG_AGENTIC_*`.
- Memory/observability: `MEM0_*`, `LANGFUSE_*`, `CLICKHOUSE_*`.
- Media processing: `FFMPEG_PATH`, `LIBREOFFICE_PATH`, `TENCENT_*`.

Do not reveal or copy real values from `.env`. `QWEN_API_KEY` is required at backend initialization. The configured embedding model and `EMBEDDING_DIMENSIONS` must agree with the `vector(1536)` column and HNSW index; changing dimensions requires a schema/data migration, not only an env change.

The example currently sets `BACKEND_PORT=3001` but `VITE_API_BASE_URL=http://localhost:3000`. Align these values locally, for example by setting `VITE_API_BASE_URL=http://localhost:3001` when the backend listens on 3001.

## Commands

From the repository root:

```powershell
pnpm install
pnpm docker:up
pnpm docker:down
pnpm db:reset:check
pnpm db:reset
pnpm lint
```

Backend:

```powershell
cd backend
pnpm run start:dev
pnpm run start:ingestion-worker
pnpm run build
pnpm run typecheck
pnpm run test
pnpm run test:e2e
pnpm run lint
```

Frontend:

```powershell
cd frontend
pnpm run dev
pnpm run build
pnpm run lint:check
pnpm run format:check
```

RAG maintenance, from `backend/`:

```powershell
pnpm run rag:check
pnpm run rag:reindex
pnpm run rag:reindex-one -- <documentId>
pnpm run rag:graph-rebuild
pnpm run rag:graph-rebuild-one -- <documentId>
pnpm run rag:cleanup-legacy-neo4j
```

`rag:check` verifies PostgreSQL chunk counts, populated vectors, the cosine HNSW index, Elasticsearch counts, and the presence of graph nodes for graph-ready documents. `rag:cleanup-legacy-neo4j` permanently removes old Neo4j `DocumentChunk` nodes/vector indexes; use it only after pgvector reindexing has been verified.

## Database and Migration Notes

- Local PostgreSQL uses `pgvector/pgvector:pg16`; plain `postgres:16` is no longer sufficient.
- Migration `1784200000000-NovelHybridRag.ts` enables `vector`, converts `chunks.embedding` to `vector(1536)`, creates the HNSW index, and adds document graph-status fields.
- Migration `1784100000000-LangGraphRuns.ts` creates `graph_runs` and chunk-run/idempotency indexes.
- TypeORM `synchronize` is enabled outside production. Production runs migrations unless `TYPEORM_MIGRATIONS_RUN=false`.
- LangGraph checkpoints live under PostgreSQL schema `langgraph` and completed/failed checkpoints are retained according to `GRAPH_CHECKPOINT_RETENTION_DAYS`.
- Reset and cleanup commands can destroy local data in `volumes/`; inspect their targets before running them.

## Frontend Notes

- Use Vue 3 Composition API and `<script setup lang="ts">`.
- `App.vue` switches between the conversation and data-management pages with local state. Vue Router is installed but is not currently used for page routing.
- API state belongs in composables such as `useConversation` and `useDocument`.
- `frontend/src/core/http.ts` uses `VITE_API_BASE_URL`; request paths already include `/api`.
- Use the existing UnoCSS utilities and `lucide-vue-next` icons.
- There is no frontend test runner. Verify frontend changes with build, check-only lint, and Prettier check.

## Testing and Agent Rules

- This is a Windows/PowerShell workspace. Before pnpm/npm/npx/Jest/ESLint/TypeScript/build, Docker, background-server, destructive-cleanup, or Codex-session scanning commands, read and follow the project `project-permission-guard` skill when available.
- If any code file is created, edited, renamed, or deleted, run the `code-log-checker` skill when available.
- For NestJS work, use the `nestjs-best-practices` skill. For Vue work, use `vue-best-practices`. For Jest work, use `javascript-typescript-jest`.
- Inspect `git status` first and preserve unrelated user changes. Never assume a dirty worktree is disposable.
- Use `rg`/`rg --files` for discovery and `apply_patch` for manual edits.
- Prefer focused changes that follow current module/controller/service patterns.
- Backend `lint` and root `lint` run ESLint with `--fix`; use check-only or targeted commands when you do not intend to modify files.
- Unit specs are colocated as `*.spec.ts`; Jest's `rootDir` is `backend/src`.
- When changing retrieval, inspect `retrieval.graph.ts`, `retrieval.service.ts`, all three backing stores, `rag-chat.graph.ts`, and citations.
- When changing ingestion, inspect the ingestion graph, worker, graph-run/checkpoint services, chunk service, artifact cleanup, and all destination indexes.
- Keep PostgreSQL as the business source of truth. Do not reintroduce Neo4j chunk vectors or treat Mem0 as the full conversation record.

## Known Gotchas

- Older docs and articles may describe Neo4j vector retrieval or BullMQ ingestion. The current implementation uses PostgreSQL pgvector and PostgreSQL-backed graph runs.
- Novel graph extraction currently runs for every ingested document; it may record `graphStatus=failed` for non-novel or unsuitable content while text ingestion still succeeds.
- `embedAndStage` feeds both PostgreSQL vector storage and the later Elasticsearch branch; there is no separate Neo4j vector-index stage.
- A production API container does not process queued documents by itself because `INGESTION_WORKER_AUTOSTART=false`; the separate worker must be healthy.
- `rag:reindex` and `rag:graph-rebuild` enqueue/process all documents and can incur substantial model cost.
- Do not change the embedding dimension by environment variable alone.
