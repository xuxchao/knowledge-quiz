# Docker 容器化部署 — 问答问题集 (Q&A)

> **配套文档**：`docker-tutorial.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题 (Factual Questions)

**Q1.** Docker 中 Image（镜像）、Container（容器）、Dockerfile 三者分别是什么？  
<details><summary>答案</summary>Image 是只读模板，包含运行应用所需的一切；Container 是镜像的运行实例；Dockerfile 是构建镜像的指令文件。</details>

**Q2.** Docker 数据持久化有哪三种方式？  
<details><summary>答案</summary>Volume（Docker 管理的存储）、Bind Mount（宿主机路径挂载）、tmpfs（内存临时存储）。</details>

**Q3.** 在 Dockerfile 最佳实践中，为什么要将 `COPY package.json` 放在 `COPY . .` 之前？  
<details><summary>答案</summary>利用 Docker 构建缓存。当依赖文件（package.json）未变更时，`npm install` 层可直接使用缓存，不需要重新安装，大幅加速构建。</details>

**Q4.** Docker Compose 文件中 `depends_on` 的 `condition: service_healthy` 是什么意思？  
<details><summary>答案</summary>表示当前服务只有在依赖服务的 healthcheck 通过后才会启动，而非仅仅等待容器启动完成。</details>

**Q5.** Docker Compose 中 `networks` 字段设为 `internal: true` 的效果是什么？  
<details><summary>答案</summary>该网络内的容器无法访问外部网络，仅允许内部容器间通信。用于安全隔离敏感服务（如数据库）。</details>

**Q6.** Docker 网络驱动有哪几种？Overlay 网络适用于什么场景？  
<details><summary>答案</summary>bridge、host、overlay、macvlan、none。Overlay 网络适用于 Swarm 集群中跨多主机的容器通信。</details>

---

## 理解型问题 (Comprehension Questions)

**Q7.** 解释 Docker 多阶段构建的目的和工作原理。文档示例中减少最终镜像大小的关键步骤是什么？  
<details><summary>答案</summary>多阶段构建将构建环境和运行环境分离。第一阶段用完整 Node 镜像安装依赖和编译代码，第二阶段只复制构建产物（dist、node_modules）到 Alpine 精简镜像中运行。关键步骤：1) `npm ci --only=production` 仅安装生产依赖；2) `COPY --from=builder` 只复制必要文件到运行阶段；3) 使用 `node:20-alpine` 精简基础镜像。最终镜像不包含 devDependencies 和源代码。</details>

**Q8.** Docker Compose 配置中，为什么 postgres 的卷使用命名卷（`pgdata`）而 nginx 配置使用 bind mount？  
<details><summary>答案</summary>pgdata 使用命名卷是因为数据库数据需要 Docker 管理的持久化存储，数据量大且不应与宿主机路径耦合。nginx 配置使用 bind mount 是为了方便在宿主机上直接编辑配置文件，便于运维管理。结构化数据和配置文件的管理需求不同。</details>

**Q9.** 文档中的 HEALTHCHECK 指令如何工作？如果应用不返回 200 状态码会怎样？  
<details><summary>答案</summary>HEALTHCHECK 每 30 秒执行一次 `wget` 请求 `/health` 端点，超时时间 3 秒，连续失败 3 次后容器被标记为 `unhealthy`。在 Docker Compose 中，如果 postgres 的 healthcheck 失败，依赖它的 api 服务（`condition: service_healthy`）将不会启动。</details>

**Q10.** 为什么建议使用非 root 用户运行容器？文档中是如何实现的？  
<details><summary>答案</summary>以 root 运行容器存在安全风险——如果容器被攻破，攻击者可能获得宿主机 root 权限。文档通过 `RUN addgroup/adduser` 创建 appuser 用户，`COPY --chown` 设置文件归属，`USER appuser` 切换运行用户，并使用非特权端口（3000）。</details>

---

## 应用型问题 (Application Questions)

**Q11.** 你的 CI 流水线运行 `docker build` 每次都要 8 分钟。请根据文档中的最佳实践，分析可能的优化方案。  
<details><summary>答案</summary>1) 确保 `package.json` 在 `COPY . .` 之前单独复制，利用 Docker 缓存层；2) 使用 `.dockerignore` 排除 node_modules 等不必要文件减小构建上下文；3) GitHub Actions 中使用 `cache-from: type=gha` 将构建缓存跨 CI 运行复用；4) 考虑使用多阶段构建分离构建和运行环境；5) 优化 `npm ci --only=production` 而非 `npm install`。</details>

**Q12.** 分析文档中的 Docker Compose 配置，说明这个应用的整体网络拓扑和安全设计。  
<details><summary>答案</summary>应用分为两个网络：`frontend`（nginx + api）面向外部流量，`backend`（api + postgres + redis）设为 `internal: true` 完全隔离。外部流量通过 nginx（80/443 端口）进入，经过 frontend 网络到达 api，api 再通过 backend 网络访问数据库和缓存。数据库和缓存对外部网络完全不可见，符合纵深防御原则。</details>

**Q13.** 数据量增长后 Docker 磁盘空间不足。请给出清理方案并说明 `docker system prune -a` 和 `docker system df` 的区别。  
<details><summary>答案</summary>清理方案：1) `docker system df` 先查看空间使用情况；2) `docker system prune -a` 清理所有停止的容器、未使用的网络、悬空镜像和构建缓存。区别：`df` 是诊断工具（只读），`prune -a` 是清理工具（会删除数据）。更精细的清理还可以删除未使用的卷：`docker volume prune`。</details>

**Q14.** 需要开发新的功能分支，希望本地开发的代码修改实时反映到 Docker 环境中。请修改 Docker Compose 配置以支持热更新。  
<details><summary>答案</summary>在 api 服务中添加 bind mount：`volumes: ["./src:/app/src"]`，将本地源码目录挂载到容器内对应路径。如果开发框架支持文件监听（如 nodemon），容器内代码修改会触发重启。同时可以添加 `command: npm run dev` 启动带热更新的开发模式。</details>

**Q15.** 团队在部署到客户私有环境时，客户没有 Docker Hub 访问权限。请设计离线部署方案。  
<details><summary>答案</summary>1) 使用 `docker save` 将所需镜像导出为 tar 文件；2) 在离线环境使用 `docker load` 导入；3) 启用本地 Registry 镜像缓存：`docker run -d -p 5000:5000 registry:2`；4) 修改 docker-compose.yml 中所有 image/build 引用指向本地 Registry（如 `localhost:5000/myapp:latest`）；5) 将导出的镜像推入本地 Registry 供集群其他节点拉取。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+  
> 问题覆盖：核心概念、Dockerfile 编写、Compose 编排、网络存储、CI/CD 集成
