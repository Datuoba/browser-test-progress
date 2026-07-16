# Datuoba Codex Plugins

这是一个可由 Codex CLI 和 ChatGPT 桌面端发现、安装的仓库级 marketplace。

仓库地址：[Datuoba/browser-test-progress](https://github.com/Datuoba/browser-test-progress)

## 可用插件

| 插件 | 说明 |
| --- | --- |
| `browser-test-progress` | 用离散节点展示 ChatGPT 内置浏览器验收进度，并跟踪报告生成和结果回传。 |

插件源码和详细用法见 [`plugins/browser-test-progress`](./plugins/browser-test-progress)。

## 安装

从 GitHub 分发后，可将仓库注册为 marketplace：

```bash
codex plugin marketplace add Datuoba/browser-test-progress
codex plugin add browser-test-progress@datuoba
```

也可以直接验证本地检出：

```bash
codex plugin marketplace add /absolute/path/to/browser-test-progress
codex plugin add browser-test-progress@datuoba
```

安装或更新后，请新建一个 Codex 会话，使新技能和 MCP 工具进入会话上下文。

## 仓库结构

```text
.
├── .agents/plugins/marketplace.json
├── plugins/browser-test-progress/
│   ├── .codex-plugin/plugin.json
│   ├── .mcp.json
│   ├── dist/server.mjs
│   └── skills/browser-test-progress/SKILL.md
└── scripts/validate-marketplace.mjs
```

marketplace 使用仓库内相对路径，因此从 Git 或本地目录添加时采用同一份清单。

## 开发与验证

```bash
cd plugins/browser-test-progress
npm ci
npm run check
cd ../..
node scripts/validate-marketplace.mjs
```

`dist/server.mjs` 是需要提交的独立运行构建产物。Codex 安装本地或 Git marketplace 插件时不会替它执行项目构建，因此修改 MCP 服务后应重新运行 `npm run build`。

## 许可证

[MIT](./LICENSE)
