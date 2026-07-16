# 浏览器验收进度

这是一个 ChatGPT/Codex 插件，用离散节点展示内置浏览器验收任务的执行状态。它不估算节点内部百分比。

插件通过仓库根目录的 Codex marketplace 分发，安装包使用已经构建好的 `dist/server.mjs`，无需在安装阶段下载 Node.js 依赖。

源码仓库：[Datuoba/browser-test-progress](https://github.com/Datuoba/browser-test-progress)

## 界面

插件通过 MCP Apps 组件请求 PiP 显示模式。支持 PiP 的 ChatGPT 宿主会把组件保持为悬浮窗口；不支持或拒绝 PiP 时，组件保持在对话内嵌位置。公开 Apps SDK 不保证固定停靠到原生右侧栏。

节点状态包括：

- 等待执行
- 正在执行
- 通过
- 不通过
- 未确认
- 已中断

每项验收任务都会自动追加“生成验收报告”和“回传至 Codex for VS Code”两个系统节点。

## 工具

- start_browser_test_progress：创建节点并显示进度窗口。
- update_browser_test_progress：更新一个普通节点。
- attach_browser_test_report：登记已经生成且证据存在的报告。
- acknowledge_browser_test_result：凭真实回执完成结果回传节点。
- get_browser_test_progress：供组件轮询当前状态。
- show_browser_test_progress：重新打开现有任务。

任务状态会按验收任务编号持久化到
`~/.codex/browser-test-progress/`。关闭并重新打开组件或插件进程重启后，
组件会重新读取最新任务结果，不会回退到首次启动时的节点快照。

## 本地验证

在插件目录安装开发依赖后运行：

```bash
npm ci
npm run check
```

`npm run check` 会重新构建分发文件，并分别对源码服务和 `dist/server.mjs` 执行 MCP 冒烟测试。

## 使用约束

进度窗口只反馈状态，不替代浏览器验收本身。执行验收的代理必须遵守只读边界，不得发送真实设备命令或执行配置下发。没有真实接收回执时，回传节点必须保持“执行中”或标记为“未确认”。
