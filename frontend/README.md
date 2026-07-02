# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).

## 代码格式化与校验

### Prettier 格式化

项目使用 Prettier 进行代码格式化，与后端项目保持一致的规则配置。

```bash
# 格式化所有文件
pnpm run format

# 检查未格式化文件（不修改）
pnpm run format:check
```

支持的文件类型：`.js`, `.jsx`, `.ts`, `.tsx`, `.vue`, `.css`, `.scss`, `.json`, `.md`

### ESLint 代码校验

项目使用 ESLint 进行代码质量校验，采用 flat config 写法，与后端项目保持一致的配置形态。

```bash
# 检查并自动修复问题
pnpm run lint

# 仅检查不修复
pnpm run lint:check
```

支持的文件类型：`.js`, `.jsx`, `.ts`, `.tsx`, `.vue`

### VS Code 编辑器集成

1. **安装必要插件**（已在 `.vscode/extensions.json` 中推荐）：
   - [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
   - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
   - [Vue Language Features (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

2. **自动格式化配置**：
   - 保存文件时自动执行 Prettier 格式化
   - 保存文件时自动执行 ESLint 修复

配置文件位于 `.vscode/settings.json`，已默认开启上述功能。

### 配置文件说明

| 文件 | 说明 |
|------|------|
| `.prettierrc` | Prettier 格式化规则配置 |
| `eslint.config.js` | ESLint flat config 配置 |
| `.vscode/settings.json` | VS Code 编辑器格式化配置 |
| `.vscode/extensions.json` | VS Code 推荐插件配置 |
