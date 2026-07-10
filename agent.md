# Agent Guide

This file is written for future AI/coding agents working in this repository. It summarizes the current project shape, useful commands, and conventions so project questions can be answered with less rediscovery.

## Project Summary

`knowledge-quiz2` is a pnpm workspace for an AI knowledge document system. It has:

- `backend/`: NestJS 11 + TypeScript API service.
- `frontend/`: Vue 3 + TypeScript + Vite single-page UI.
- `docker-compose.yml`: local infrastructure for PostgreSQL, Redis, Elasticsearch, Neo4j, ClickHouse, RustFS, Langfuse, and admin tools.

Core product flow:

1. Users upload files or URLs.
2. The backend stores source files in RustFS, extracts text, chunks content, creates embeddings, and stores metadata/chunks.
3. Chat requests combine the latest user message with relevant Neo4j vector search results and short/long-term memory, then stream a Chinese answer through the AI SDK transport.
4. The frontend offers two main views: AI conversation and backend/data management.

## Repository Layout

```text
.
├── backend/
│   ├── src/
│   │   ├── ai/                    # Qwen/OpenAI-compatible chat and embeddings
│   │   ├── common/                # logger, filters, interceptors
│   │   ├── config/                # TypeORM config
│   │   ├── conversations/         # conversations and messages
│   │   ├── documents/             # document and chunk APIs
│   │   ├── entities/              # TypeORM entities
│   │   ├── infrastructure/        # Redis, Neo4j, RustFS, speech, file processing
│   │   ├── memory/                # memory services
│   │   ├── app.module.ts
│   │   └── main.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/            # conversation and document UI pieces
│   │   ├── composables/           # API/state logic for documents and conversations
│   │   ├── core/http.ts           # Axios client and backend base URL
│   │   ├── pages/                 # AI conversation and backend management pages
│   │   ├── types/
│   │   ├── App.vue
│   │   └── main.ts
│   └── package.json
├── docker/
├── scripts/
├── .env.example
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

## Tech Stack

Backend:

- NestJS 11, TypeScript, TypeORM.
- PostgreSQL for relational data.
- Neo4j vector index for document chunk retrieval.
- Redis for infrastructure/cache features.
- RustFS/S3-compatible storage for uploaded files.
- LangChain, `@langchain/openai`, and AI SDK integration.
- Qwen/DashScope through an OpenAI-compatible API base.
- Langfuse infrastructure is present in Docker.

Frontend:

- Vue 3 with Composition API and `<script setup>`.
- TypeScript, Vite, Pinia, Axios.
- UnoCSS and Tailwind reset.
- Lucide Vue icons.
- `@ai-sdk/vue` and `DefaultChatTransport` for streaming chat.

## Environment

Use `.env.example` as the reference. The backend loads env vars from `../.env` through `ConfigModule.forRoot({ envFilePath: '../.env' })`, so running backend scripts from `backend/` expects the root `.env`.

Important variables:

- `BACKEND_PORT`, default behavior differs by place:
  - `.env.example` uses `3001`.
  - `backend/src/main.ts` falls back to `3000` when unset.
  - `frontend/src/core/http.ts` falls back to `VITE_BACKEND_PORT=3000`.
- `QWEN_API_KEY` is required by `AiService.onModuleInit()`. The backend will fail during startup if it is missing.
- `QWEN_API_BASE_URL` defaults to `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- PostgreSQL defaults: database `knowledge_doc`, user `admin`, password `password`.
- Neo4j defaults: `bolt://localhost:7687`, user `neo4j`, password `password`.
- RustFS defaults are configured in `docker-compose.yml`.

Do not expose real values from `.env` in answers or generated files.

## Common Commands

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
pnpm run build
pnpm run lint
pnpm run test
pnpm run test:e2e
```

Frontend:

```powershell
cd frontend
pnpm run dev
pnpm run build
pnpm run lint:check
pnpm run format:check
```

Notes for agents:

- This is a Windows/PowerShell workspace.
- Backend `start:*` scripts use `set NODE_OPTIONS=... && ...`, which is Windows `cmd` syntax. Run them through pnpm as written.
- Before running package-manager, Docker, Jest, ESLint, TypeScript, or dev-server commands in Codex, check the project permission guard skill if available.

## Backend Architecture

`backend/src/main.ts`:

- Creates the Nest app.
- Enables CORS.
- Sets global API prefix to `/api`.
- Adds `ValidationPipe({ whitelist: true, transform: true })`.
- Installs HTTP and catch-all exception filters.
- Uses the custom `LoggerService`.

`backend/src/app.module.ts` imports:

- `ConfigModule` globally.
- Custom `LoggerModule`.
- TypeORM async config.
- `ConversationModule`.
- `DocumentModule`.
- `AiModule`.
- `MemoryModule`.

Database entities:

- `Document`: file or URL metadata, status, path/url, chunk count, metadata.
- `Chunk`: document chunk text, token count, metadata, embedding string, search text.
- `Conversation`: user conversation with message count and metadata.
- `Message`: user/assistant/system message content and optional references.

Important backend routes, all under `/api` because of the global prefix:

- `POST /api/documents`: upload a multipart `file` or JSON/body `url`.
- `GET /api/documents`: list documents, supports `name`, `page`, `limit`.
- `GET /api/documents/:id`: get document with chunks.
- `DELETE /api/documents/:id`: delete a document.
- `GET /api/chunks?documentId=...`: list chunks for a document.
- `GET /api/chunks/:id`: get one chunk.
- `PUT /api/chunks/:id`: update chunk content.
- `DELETE /api/chunks/:id`: delete chunk.
- `GET /api/conversations`: list conversations, optional `userId`.
- `GET /api/conversations/get/:id`: get a conversation.
- `DELETE /api/conversations/delete/:id`: delete a conversation.
- `POST /api/conversations/chat`: stream chat responses using AI SDK UI message streams.

AI/chat behavior:

- `AiService` initializes a `ChatOpenAI` model using Qwen-compatible settings.
- Chat model: `qwen-plus`.
- Embedding model: `text-embedding-v2`.
- Chat controller creates a conversation when `conversationId` is missing.
- User messages and assistant responses are persisted.
- Short-term memory is saved synchronously. Long-term memory save is started without awaiting.
- Relevant document chunks come from Neo4j vector search using a `DocumentChunk` vector index with 1536 dimensions.

Document processing behavior:

- File names are normalized and non-ASCII multipart filenames are decoded from latin1 when needed.
- Files are uploaded to RustFS under `documentId/fileName`.
- Processing extracts text, splits it, stores embeddings/chunks, creates DB chunk records, then updates document status/count.
- Supported file type mapping is in `DocumentController.FILE_TYPE_MAP`.

## Frontend Architecture

`frontend/src/main.ts`:

- Creates the Vue app.
- Installs Pinia.
- Imports UnoCSS reset and generated `uno.css`.
- Mounts `App.vue`.

`frontend/src/App.vue`:

- Keeps local page state only.
- Switches between `AiConversationPage` and `BackendManagementPage`.
- There is no Vue Router route table currently, despite README mentioning routes.

HTTP:

- `frontend/src/core/http.ts` builds `baseURL` from `VITE_BACKEND_HOST` and `VITE_BACKEND_PORT`.
- Composables include `/api/...` in request paths.
- Chat uses `${baseURL}/api/conversations/chat`.

State/API composables:

- `useConversation`: wraps `@ai-sdk/vue` `useChat`, conversation list loading, selection, creation, deletion.
- `useDocument`: wraps document list/search, upload, URL processing, chunk viewing/editing/deletion.

Frontend conventions:

- Prefer Vue 3 Composition API with `<script setup lang="ts">`.
- Keep API logic in composables when it is shared or stateful.
- Use existing UnoCSS utility style before adding new styling systems.
- Use `lucide-vue-next` icons for action buttons/icons when an icon is needed.

## Testing And Quality

Backend:

- Jest config lives in `backend/package.json`.
- Unit specs live beside backend code as `*.spec.ts`.
- E2E config is `backend/test/jest-e2e.json`.
- Mocks exist for `uuid` and `node-fetch`.

Frontend:

- No test runner is currently configured.
- Use `pnpm run build`, `pnpm run lint:check`, and `pnpm run format:check` for verification.

Linting:

- Root `pnpm lint` runs backend and frontend lint in parallel.
- Backend `lint` and frontend `lint` use `--fix`, so prefer check-only commands where available if you only want validation.
- Frontend has `lint:check`; backend currently does not expose a check-only lint script.

## Local Infrastructure

`docker-compose.yml` defines:

- Redis on `6379`, RedisInsight on `5540`.
- PostgreSQL on `5432`, pgAdmin on `8086`.
- Elasticsearch on `9200` and `9300`.
- Neo4j browser on `7474`, Bolt on `7687`.
- ClickHouse on `8123` and `9000`.
- RustFS S3 API on `9004` and console on `9005`.
- RustFS on `9004` and console `9005`.
- Langfuse on `3005` and `8085`.

The compose file mounts persistent data under `volumes/` plus named volumes. Be careful with cleanup/reset operations; they may destroy local data.

## Development Guidelines For Agents

- First inspect existing code patterns before editing.
- Do not revert unrelated user changes. This worktree may be dirty.
- Prefer focused changes in the relevant module instead of broad refactors.
- Use `rg`/`rg --files` for repository search.
- Use `apply_patch` for manual file edits.
- For NestJS changes, follow module/controller/service patterns already present.
- For Vue changes, use Composition API and TypeScript.
- If editing TypeScript/JavaScript service, controller, or infrastructure code, run the project `code-log-checker` skill if available.
- Avoid committing secrets or copying real `.env` values into docs.
- If changing API paths, remember the backend global prefix `/api` and update frontend composables together.
- If changing AI/chat behavior, check both `backend/src/ai/*` and `frontend/src/composables/useConversation.ts`.
- If changing document upload/chunking, check `DocumentController`, `DocumentService`, `ChunkService`, `FileProcessorService`, `RustfsService`, and `Neo4jService`.

## Known Gotchas

- The README is slightly ahead/behind the current frontend: it mentions routes/stores, but the current app switches pages locally in `App.vue` and has no router setup.
- Backend defaults to port `3000` if `BACKEND_PORT` is unset, while `.env.example` suggests `3001`.
- `QWEN_API_KEY` is mandatory at backend startup.
- Neo4j vector index assumes 1536-dimensional embeddings. If the embedding model changes dimensions, update the index configuration and existing data.
- TypeORM `synchronize` is enabled outside production. Schema changes can apply automatically in development.
- Root `pnpm lint` and package lint scripts may modify files because they run ESLint with `--fix`.
- `frontend/src/core/http.ts` defaults to `localhost:3000`; set `VITE_BACKEND_PORT` if backend uses `3001`.
