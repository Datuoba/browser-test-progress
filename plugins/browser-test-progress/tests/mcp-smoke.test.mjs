import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverPath = resolve(root, process.argv[2] ?? "server.mjs");
const stateDirectory = mkdtempSync(
  join(tmpdir(), "browser-test-progress-smoke-")
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: root,
  env: {
    ...getDefaultEnvironment(),
    BROWSER_TEST_PROGRESS_STATE_DIR: stateDirectory,
  },
  stderr: "pipe",
});
const client = new Client(
  { name: "browser-test-progress-smoke", version: "0.1.0" },
  { capabilities: {} }
);

try {
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  assert.equal(serverVersion?.name, "浏览器验收进度");
  assert.equal(serverVersion?.title, "浏览器验收进度");
  assert.equal(serverVersion?.icons?.[0]?.mimeType, "image/svg+xml");
  assert.match(
    serverVersion?.icons?.[0]?.src ?? "",
    /^data:image\/svg\+xml;base64,/
  );

  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  for (const name of [
    "start_browser_test_progress",
    "update_browser_test_progress",
    "attach_browser_test_report",
    "acknowledge_browser_test_result",
    "get_browser_test_progress",
    "show_browser_test_progress",
  ]) {
    assert.equal(toolNames.has(name), true, "missing tool " + name);
  }
  const startTool = tools.tools.find(
    (tool) => tool.name === "start_browser_test_progress"
  );
  assert.equal(startTool?.title, "开始浏览器验收进度");
  assert.equal(startTool?.annotations?.title, "开始浏览器验收进度");
  assert.equal(startTool?.icons?.[0]?.mimeType, "image/svg+xml");
  assert.match(
    startTool?.icons?.[0]?.src ?? "",
    /^data:image\/svg\+xml;base64,/
  );

  const resources = await client.listResources();
  const progressResource = resources.resources.find(
    (resource) => resource.uri === "ui://browser-test-progress/progress.html"
  );
  assert.equal(
    progressResource?.name,
    "浏览器验收进度"
  );
  assert.equal(progressResource?._meta?.ui?.prefersBorder, false);

  const resource = await client.readResource({
    uri: "ui://browser-test-progress/progress.html",
  });
  assert.match(resource.contents[0].text, /浏览器验收进度/);
  assert.equal(
    resource.contents[0].mimeType,
    "text/html;profile=mcp-app"
  );
  assert.equal(resource.contents[0]._meta?.ui?.prefersBorder, false);
  assert.match(resource.contents[0].text, /body\s*{[^}]*padding:\s*0;/s);
  assert.doesNotMatch(resource.contents[0].text, /class="panel"/);
  assert.doesNotMatch(resource.contents[0].text, /box-shadow:\s*0 12px 34px/);

  const taskId = "BROWSER_ACCEPTANCE_20260716123000_smoke";
  const started = await client.callTool({
    name: "start_browser_test_progress",
    arguments: {
      taskId,
      title: "MCP 冒烟验收",
      nodes: [{ id: "route", title: "检查目标路由" }],
    },
  });
  assert.equal(started.structuredContent.progress.summary.total, 3);

  await client.callTool({
    name: "update_browser_test_progress",
    arguments: { taskId, nodeId: "route", status: "running" },
  });
  await client.callTool({
    name: "update_browser_test_progress",
    arguments: {
      taskId,
      nodeId: "route",
      status: "passed",
      message: "测试证据",
    },
  });
  await client.callTool({
    name: "attach_browser_test_report",
    arguments: {
      taskId,
      reportPath: "/tmp/browser-progress-smoke-report.md",
      conclusion: "冒烟测试通过",
      evidencePaths: [],
    },
  });
  const acknowledged = await client.callTool({
    name: "acknowledge_browser_test_result",
    arguments: {
      taskId,
      receiver: "smoke-test",
      receiptId: "smoke-receipt",
    },
  });
  assert.equal(acknowledged.structuredContent.progress.status, "completed");

  console.log("MCP smoke tests passed");
} finally {
  await client.close();
  rmSync(stateDirectory, { recursive: true, force: true });
}
