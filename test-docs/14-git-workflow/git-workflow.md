# Git 高级协作工作流完全指南

> **文档类型**：工具进阶指南  
> **适用读者**：中级 - 高级开发者  
> **前置知识**：Git 基础操作（commit/push/pull/branch）  
> **最后更新**：2026-07-02  

---

## 1. 分支策略

### 1.1 Git Flow vs GitHub Flow vs Trunk-Based

| 维度 | Git Flow | GitHub Flow | Trunk-Based |
|------|----------|-------------|-------------|
| 核心分支 | `main` + `develop` | 仅 `main` | 仅 `main` (trunk) |
| Feature 分支 | ✅ 从 develop 创建 | ✅ 从 main 创建 | ✅ 短期（< 1 天） |
| Release 分支 | ✅ `release/` | ❌ 用 Tag | ❌ Release Flag |
| Hotfix 分支 | ✅ `hotfix/` | ✅ 直接修 | ✅ Cherry-pick |
| 发布频率 | 按版本周期 | 持续部署 | 持续部署 |
| 适用团队 | 版本化软件 | SaaS 服务 | 高节奏团队 |

### 1.2 分支命名规范

```bash
# ✅ 推荐的命名规范
feature/SHOP-1234-add-cart-checkout     # Jira 单号 + 简短描述
bugfix/SHOP-2345-fix-price-rounding     # 修复 Bug
hotfix/SHOP-3456-critical-auth-patch    # 紧急修复
release/v2.3.0                          # 发布分支
chore/update-eslint-config              # 杂项维护
docs/api-v2-migration-guide             # 文档变更

# ❌ 不推荐的命名
my-branch
fix2
test
wip
```

---

## 2. Commit 规范

### 2.1 Conventional Commits

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**支持的 Type：**

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(order): add order cancellation API` |
| `fix` | Bug 修复 | `fix(payment): handle zero-amount edge case` |
| `docs` | 文档变更 | `docs(api): update rate-limit section` |
| `style` | 代码格式 | `style: format with prettier 3.x` |
| `refactor` | 重构 | `refactor(auth): extract token validation` |
| `perf` | 性能优化 | `perf(query): add composite index for user search` |
| `test` | 测试 | `test(order): add parallel concurrency tests` |
| `chore` | 构建/工具 | `chore(deps): bump axios to 1.6.0` |
| `ci` | CI/CD | `ci: add staging deploy workflow` |

### 2.2 Commit Message 反例

```bash
# ❌ 不合格的 Commit Message
git commit -m "fix"
git commit -m "update"
git commit -m "wip"
git commit -m "fix bug 修复了那个问题"
git commit -m "."
git commit -m "asdfasdf"

# ✅ 合格的 Commit Message
git commit -m "fix(payment): prevent duplicate charge on network retry

When the payment provider responds with a network timeout, the client
may retry the request. This fix adds an idempotency key check to
prevent creating duplicate charges for the same order.

Closes SHOP-2345"
```

---

## 3. 高级 Git 操作

### 3.1 Interactive Rebase 实战

```bash
# 场景：整理最近 5 个 commit
git rebase -i HEAD~5

# 交互式 rebase 命令说明：
# pick   = 保留该 commit
# reword = 保留，但修改 message
# squash = 合并到上一个 commit（保留 message）
# fixup  = 合并到上一个 commit（丢弃 message）
# drop   = 删除该 commit
# edit   = 保留，但暂停以修改内容
```

**操作示例**：

```
pick a1b2c3d feat(order): add order creation API
squash b2c3d4e fix(order): address review comments   # 合并到上一个
pick c3d4e5f feat(order): add order list API
reword d4e5f6g feat(order): add order detail API     # 修改 message
squash e5f6g7h fix(order): fix pagination bug        # 合并到上一个
pick f6g7h8i docs(order): add API documentation
```

### 3.2 Cherry-Pick 选择合并

```bash
# 将特定 commit 应用到另一个分支
git checkout release/v2.2
git cherry-pick a1b2c3d

# 选择多个 commit
git cherry-pick a1b2c3d e5f6g7h i9j0k1l

# 批量选择范围（不包含 start，包含 end）
git cherry-pick a1b2c3d..e5f6g7h

# 解决冲突后继续
git cherry-pick --continue
# 放弃 cherry-pick
git cherry-pick --abort
```

### 3.3 Git Bisect 二分定位 Bug

```bash
# 启动二分查找
git bisect start
git bisect bad HEAD           # 当前版本有问题
git bisect good v2.0.0        # 这个版本没问题

# Git 会在中间检出某个 commit
# 运行测试，标记结果
git bisect bad   # 如果这个版本有问题
# 或
git bisect good  # 如果这个版本没问题

# 重复几次后，Git 定位到引入 Bug 的 commit
# a1b2c3d is the first bad commit

# 结束二分查找
git bisect reset
```

---

## 4. 合并策略

### 4.1 Merge vs Rebase vs Squash

| 策略 | 历史记录 | 适用场景 | 注意事项 |
|------|----------|----------|----------|
| `git merge` | 保留完整分支历史 | 合并长期分支（release → main） | 产生 merge commit |
| `git rebase` | 线性历史 | Feature 分支同步 main 更新 | 不要 rebase 已推送的 commit |
| `git merge --squash` | 单 commit 合并 | Feature 合并到 main（简洁历史） | 丢失分 commit 信息 |

### 4.2 冲突解决策略

```bash
# 使用 ours 策略（保留当前分支）
git merge feature/new-ui -s ours

# 递归策略 + 偏好选项
git merge feature/new-ui -X ours     # 冲突时默认选择当前分支
git merge feature/new-ui -X theirs   # 冲突时默认选择对方分支

# 使用专用合并工具
git mergetool --tool=vscode

# 取消正在进行的合并
git merge --abort
```

---

## 5. 团队协作最佳实践

### 5.1 Pull Request 规范

```markdown
## PR 标题格式
[SHOP-1234] feat: add shopping cart checkout flow

## PR 描述模板

### 📝 变更概述
实现购物车结算全流程：地址选择 → 优惠券应用 → 支付拉起

### 🔗 关联 Issue
- Closes SHOP-1234
- Related to SHOP-1200

### ✅ 自测清单
- [ ] 单元测试通过 (`npm test`)
- [ ] 集成测试通过 (`npm run test:e2e`)
- [ ] 手动测试：正常支付/余额不足/网络超时
- [ ] 无 ESLint / TypeScript 错误

### 📸 截图/录屏
（UI 变更时必填）

### ⚠️ 破坏性变更
- 支付接口请求参数新增 `idempotency_key`（必填）
```

### 5.2 Code Review 关注点

| 关注维度 | 检查要点 |
|----------|----------|
| 正确性 | 逻辑是否正确？边界条件是否覆盖？ |
| 安全性 | 是否存在注入/越权风险？ |
| 性能 | 是否有 N+1 查询？是否有不必要的循环？ |
| 可维护性 | 代码是否清晰易懂？命名是否合理？ |
| 测试覆盖 | 核心逻辑是否有测试？边界用例是否覆盖？ |

---

## 6. Git Hooks

### 6.1 常用 Hook 场景

```bash
# .git/hooks/pre-commit
#!/bin/sh
# 提交前自动运行 lint-staged

npx lint-staged

# .git/hooks/commit-msg
#!/bin/sh
# 验证 commit message 是否符合规范

COMMIT_MSG_FILE=$1
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

PATTERN="^(feat|fix|docs|style|refactor|perf|test|chore|ci)(\(.+\))?: .+"

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo "❌ Commit message 不符合 Conventional Commits 规范"
  echo "格式: type(scope): description"
  exit 1
fi

# .git/hooks/pre-push
#!/bin/sh
# 推送前运行单元测试

echo "Running tests before push..."
npm test -- --bail
```

### 6.2 Husky + lint-staged 配置

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "commit-msg": "commitlint -E HUSKY_GIT_PARAMS",
      "pre-push": "npm test -- --bail"
    }
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yaml}": ["prettier --write"]
  }
}
```

---

## 7. 常见问题与恢复

### 7.1 常见误操作恢复

| 误操作 | 恢复命令 | 说明 |
|--------|----------|------|
| 错误的 commit | `git reset --soft HEAD~1` | 撤销 commit，保留更改 |
| 错误的 amend | `git reflog` + `git reset` | 找回之前的 commit |
| 删除未合并分支 | `git reflog` + `git checkout -b` | 30 天内可恢复 |
| 强制推送覆盖他人 | `git push -f` 前确认！ | 无法直接恢复 |
| 误删文件 | `git checkout HEAD -- <file>` | 恢复到最后一次提交状态 |
| Merge 到错误分支 | `git reset --merge ORIG_HEAD` | 撤销最近一次 merge |

### 7.2 reflog 救命指南

```bash
# reflog 记录了 HEAD 的所有变更历史
git reflog

# 输出示例：
# abc1234 HEAD@{0}: commit: feat(order): add checkout
# def5678 HEAD@{1}: commit: fix(cart): handle empty state
# ghi9012 HEAD@{2}: reset: moving to HEAD~3

# 恢复到 3 步前的状态
git reset --hard HEAD@{2}

# 恢复被删除的分支
git checkout -b recovered-branch HEAD@{5}
```

---

## 8. 总结

掌握 Git 高级工作流是团队高效协作的关键。核心原则：

1. **清晰的提交历史**是团队的共同资产
2. **Conventional Commits** 让变更意图一目了然
3. **Rebase** 用于保持 Feature 分支同步，**Merge** 用于合并长期分支
4. **reflog** 是最后的救命稻草，善用它

> 💡 **提高建议**：每周花 30 分钟练习一次交互式 rebase，直到操作完全熟练。

---

*本文档采用 CC BY-SA 4.0 许可。欢迎提交 PR 补充更多技巧。*
