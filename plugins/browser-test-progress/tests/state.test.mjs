import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileProgressPersistence,
  HANDOFF_NODE_ID,
  ProgressStore,
  REPORT_NODE_ID,
} from "../src/state-store.mjs";

let tick = 0;
const store = new ProgressStore(
  () => "2026-07-16T04:00:" + String(tick++).padStart(2, "0") + ".000Z"
);

const started = store.start({
  taskId: "BROWSER_ACCEPTANCE_20260716120000_demo",
  title: "示例验收",
  nodes: [
    { id: "open-page", title: "打开页面" },
    { id: "network", title: "检查 Network" },
  ],
});

assert.equal(started.nodes.length, 4);
assert.equal(started.nodes.at(-2).id, REPORT_NODE_ID);
assert.equal(started.nodes.at(-1).id, HANDOFF_NODE_ID);
assert.equal(started.summary.completed, 0);

store.update({
  taskId: started.taskId,
  nodeId: "open-page",
  status: "running",
});
store.update({
  taskId: started.taskId,
  nodeId: "network",
  status: "running",
});

const switched = store.get(started.taskId);
assert.equal(
  switched.nodes.find((node) => node.id === "open-page").status,
  "unconfirmed"
);
assert.equal(switched.summary.currentNodeId, "network");

assert.throws(
  () =>
    store.update({
      taskId: started.taskId,
      nodeId: REPORT_NODE_ID,
      status: "passed",
    }),
  /attach_browser_test_report/
);

store.update({
  taskId: started.taskId,
  nodeId: "open-page",
  status: "passed",
  message: "页面可见",
});
store.update({
  taskId: started.taskId,
  nodeId: "network",
  status: "passed",
  message: "请求归属正确",
});

const withReport = store.attachReport({
  taskId: started.taskId,
  reportPath: "/tmp/report.md",
  conclusion: "通过",
  evidencePaths: ["/tmp/screenshot.png"],
});
assert.equal(
  withReport.nodes.find((node) => node.id === REPORT_NODE_ID).status,
  "passed"
);
assert.equal(
  withReport.nodes.find((node) => node.id === HANDOFF_NODE_ID).status,
  "running"
);

const completed = store.acknowledge({
  taskId: started.taskId,
  receiver: "Codex for VS Code",
  receiptId: "receipt-test-only",
});
assert.equal(completed.status, "completed");
assert.equal(completed.delivery.receiptId, "receipt-test-only");

const snapshot = store.get(started.taskId);
snapshot.nodes[0].title = "mutated";
assert.notEqual(store.get(started.taskId).nodes[0].title, "mutated");

const stateDirectory = mkdtempSync(
  join(tmpdir(), "browser-test-progress-state-")
);

try {
  let persistentTick = 0;
  const persistentNow = () =>
    "2026-07-16T05:00:" +
    String(persistentTick++).padStart(2, "0") +
    ".000Z";
  const persistence = new FileProgressPersistence(stateDirectory);
  const writer = new ProgressStore(persistentNow, persistence);
  const persistentTaskId = "BROWSER_ACCEPTANCE_20260716130000_persistence";

  writer.start({
    taskId: persistentTaskId,
    title: "持久化验收",
    nodes: [{ id: "visible", title: "检查可见状态" }],
  });

  const reopenedBeforeCompletion = new ProgressStore(
    persistentNow,
    new FileProgressPersistence(stateDirectory)
  );

  writer.update({
    taskId: persistentTaskId,
    nodeId: "visible",
    status: "passed",
    message: "页面可见",
  });
  writer.attachReport({
    taskId: persistentTaskId,
    reportPath: "/tmp/persistent-report.md",
    conclusion: "通过",
    evidencePaths: ["/tmp/persistent-screenshot.png"],
  });
  writer.update({
    taskId: persistentTaskId,
    nodeId: HANDOFF_NODE_ID,
    status: "unconfirmed",
    message: "没有真实接收回执",
  });

  const refreshed = reopenedBeforeCompletion.get(persistentTaskId);
  assert.equal(refreshed.status, "unconfirmed");
  assert.equal(refreshed.revision, 3);
  assert.equal(refreshed.summary.completed, refreshed.summary.total);
  assert.equal(
    refreshed.nodes.find((node) => node.id === "visible").status,
    "passed"
  );
  assert.equal(
    refreshed.nodes.find((node) => node.id === REPORT_NODE_ID).status,
    "passed"
  );
  assert.equal(
    refreshed.nodes.find((node) => node.id === HANDOFF_NODE_ID).status,
    "unconfirmed"
  );

  const reopenedAfterCompletion = new ProgressStore(
    persistentNow,
    new FileProgressPersistence(stateDirectory)
  );
  const reopened = reopenedAfterCompletion.get();
  assert.deepEqual(reopened, refreshed);

  const repeatedStart = reopenedAfterCompletion.start({
    taskId: persistentTaskId,
    title: "不应覆盖最终状态",
    nodes: [{ id: "replacement", title: "不应替换节点" }],
  });
  assert.deepEqual(repeatedStart, refreshed);
} finally {
  rmSync(stateDirectory, { recursive: true, force: true });
}

console.log("state tests passed");
