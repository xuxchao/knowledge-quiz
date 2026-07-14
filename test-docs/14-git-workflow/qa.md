# Git 高级工作流 — 问答问题集 (Q&A)

> **配套文档**：`git-workflow.md`  
> **难度分层**：⭐ 事实型 | ⭐⭐ 理解型 | ⭐⭐⭐ 应用型  

---

## 事实型问题

**Q1.** 文档对比了哪三种分支策略？  
<details><summary>答案</summary>Git Flow、GitHub Flow、Trunk-Based Development。</details>

**Q2.** Conventional Commits 中 `feat` 和 `fix` 类型有什么区别？  
<details><summary>答案</summary>`feat` 表示新功能，`fix` 表示 Bug 修复。</details>

**Q3.** `git rebase -i HEAD~5` 命令中 `squash` 和 `fixup` 的区别是什么？  
<details><summary>答案</summary>squash 合并到上一个 commit 但保留 message；fixup 合并且丢弃 message。</details>

**Q4.** `git bisect` 命令的用途是什么？  
<details><summary>答案</summary>二分法定位引入 Bug 的 commit，通过标记 good/bad 缩小范围，快速定位问题 commit。</details>

**Q5.** `git reflog` 记录的保存期限通常是多少天？  
<details><summary>答案</summary>默认 30 天（90 天对可达对象）。</details>

---

## 理解型问题

**Q6.** 为什么 Git Flow 需要单独的 develop 和 release 分支，而 GitHub Flow 不需要？  
<details><summary>答案</summary>Git Flow 面向版本化软件发布，需要 release 分支做发布前的最后测试和修复，develop 分支积累待发布功能。GitHub Flow 面向持续部署的 SaaS，功能开发完即合并到 main 并部署，不需要预发布隔离。</details>

**Q7.** "不要 rebase 已经推送的 commit"——违反这条规则会发生什么？  
<details><summary>答案</summary>Rebase 会重写 commit 历史（生成新的 commit hash）。如果其他人已经基于旧 commit 开发，你的 force push 会造成他们的本地分支与远程完全不一致，解决冲突时可能丢失他们的工作。</details>

**Q8.** `git merge --squash` 合并后为什么"丢失分 commit 信息"有时是好的？  
<details><summary>答案</summary>如果 feature 分支上有大量"wip"、"fix typo"等无意义的中间 commit，squash 将它们合并为一个描述清晰的 commit，保持 main 分支历史整洁。分 commit 的细节可保留在 PR 页面中查询。</details>

---

## 应用型问题

**Q9.** 你的团队使用 Trunk-Based，每天合并多次。某天发布后发现了一个严重 bug，热修复应怎么做？  
<details><summary>答案</summary>直接从 main 创建 hotfix 分支修复；测试通过后合并到 main 并立即部署；如果上一个 release tag 也需要修复，cherry-pick 热修复 commit 到 release 分支。</details>

**Q10.** Code Review 发现 PR 中有 12 个 commit，其中 5 个是 typo fix。如何处理？  
<details><summary>答案</summary>要求开发者用 `git rebase -i` 将 typo fix 合并（fixup）到对应 commit 中，最终保留 4-5 个意义明确的 commit。也可以全部 squash 成 1 个。</details>

**Q11.** 错误地执行了 `git reset --hard HEAD~3`，如何恢复？  
<details><summary>答案</summary>`git reflog` 找到 reset 前的 HEAD 位置（通常是 `HEAD@{1}`），然后 `git reset --hard HEAD@{1}` 恢复。</details>

**Q12.** 你的 `feat/api-v2` 分支基于 2 周前的 main，现在 main 上有很多更新。如何同步并保持分支整洁？  
<details><summary>答案</summary>`git checkout feat/api-v2 && git rebase main`。rebase 会将 feat/api-v2 的 commit 重放到最新 main 上，保持线性历史。如果有冲突，逐个解决后 `git rebase --continue`。</details>

---

> **自信度评级**：事实型 95%+ | 理解型 85%+ | 应用型 80%+
