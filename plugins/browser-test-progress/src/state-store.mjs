import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const NODE_STATUSES = [
  "pending",
  "running",
  "passed",
  "failed",
  "unconfirmed",
  "interrupted",
];

export const REPORT_NODE_ID = "report-generation";
export const HANDOFF_NODE_ID = "result-handoff";

const TERMINAL_STATUSES = new Set([
  "passed",
  "failed",
  "unconfirmed",
  "interrupted",
]);

const FINAL_NODES = [
  { id: REPORT_NODE_ID, title: "生成验收报告" },
  { id: HANDOFF_NODE_ID, title: "回传至 Codex for VS Code" },
];

const cleanText = (value, label, maxLength = 240) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(label + "不能为空");
  }
  return value.trim().slice(0, maxLength);
};

const clone = (value) => structuredClone(value);

const readJsonFile = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("无法读取浏览器验收进度状态：" + path, {
      cause: error,
    });
  }
};

const writeJsonFileAtomically = (path, value) => {
  const parentDirectory = dirname(path);
  mkdirSync(parentDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    parentDirectory,
    "." + basename(path) + "." + process.pid + ".tmp"
  );
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
};

export class FileProgressPersistence {
  constructor(directory) {
    this.directory = cleanText(directory, "stateDirectory", 2048);
    this.latestPath = join(this.directory, "latest.json");
  }

  taskPath(taskId) {
    const fileName = Buffer.from(taskId, "utf8").toString("base64url");
    return join(this.directory, "tasks", fileName + ".json");
  }

  loadLatestTaskId() {
    const latest = readJsonFile(this.latestPath);
    return typeof latest?.taskId === "string" && latest.taskId.trim()
      ? latest.taskId.trim()
      : null;
  }

  load(taskId) {
    const normalizedTaskId = cleanText(taskId, "taskId", 160);
    const task = readJsonFile(this.taskPath(normalizedTaskId));
    if (!task) return null;
    if (task.taskId !== normalizedTaskId || !Array.isArray(task.nodes)) {
      throw new Error("浏览器验收进度状态文件无效：" + normalizedTaskId);
    }
    return task;
  }

  save(task) {
    writeJsonFileAtomically(this.taskPath(task.taskId), task);
    writeJsonFileAtomically(this.latestPath, { taskId: task.taskId });
  }
}

export class ProgressStore {
  constructor(now = () => new Date().toISOString(), persistence = null) {
    this.now = now;
    this.persistence = persistence;
    this.tasks = new Map();
    this.latestTaskId = this.persistence?.loadLatestTaskId() || null;
  }

  start({ taskId, title, nodes }) {
    const normalizedTaskId = cleanText(taskId, "taskId", 160);
    const existingTask = this.loadTask(normalizedTaskId);
    if (existingTask) {
      this.latestTaskId = normalizedTaskId;
      return clone(existingTask);
    }

    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error("nodes 至少需要一个浏览器验收子任务");
    }

    const seen = new Set();
    const normalizedNodes = nodes.map((node, index) => {
      const id = cleanText(node?.id, "nodes[" + index + "].id", 80);
      const nodeTitle = cleanText(
        node?.title,
        "nodes[" + index + "].title",
        120
      );
      if (seen.has(id)) {
        throw new Error("节点 id 重复：" + id);
      }
      if (id === REPORT_NODE_ID || id === HANDOFF_NODE_ID) {
        throw new Error("节点 id " + id + " 是系统保留节点");
      }
      seen.add(id);
      return {
        id,
        title: nodeTitle,
        status: "pending",
        message: null,
        updatedAt: null,
      };
    });

    for (const node of FINAL_NODES) {
      normalizedNodes.push({
        ...node,
        status: "pending",
        message: null,
        updatedAt: null,
      });
    }

    const timestamp = this.now();
    const task = {
      taskId: normalizedTaskId,
      title: cleanText(title || "浏览器验收", "title", 160),
      status: "running",
      nodes: normalizedNodes,
      report: null,
      delivery: null,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      summary: null,
    };

    this.recalculate(task);
    this.tasks.set(normalizedTaskId, task);
    this.latestTaskId = normalizedTaskId;
    this.persist(task);
    return clone(task);
  }

  get(taskId) {
    const persistedLatestTaskId = this.persistence?.loadLatestTaskId();
    const selectedTaskId =
      typeof taskId === "string" && taskId.trim()
        ? taskId.trim()
        : persistedLatestTaskId || this.latestTaskId;
    const task = selectedTaskId ? this.loadTask(selectedTaskId) : null;
    if (!selectedTaskId || !task) {
      throw new Error("未找到浏览器验收进度任务");
    }
    this.latestTaskId = selectedTaskId;
    return clone(task);
  }

  update({ taskId, nodeId, status, message = null }) {
    if (!NODE_STATUSES.includes(status)) {
      throw new Error("不支持的节点状态：" + status);
    }
    if (
      status === "passed" &&
      (nodeId === REPORT_NODE_ID || nodeId === HANDOFF_NODE_ID)
    ) {
      const action =
        nodeId === REPORT_NODE_ID
          ? "attach_browser_test_report"
          : "acknowledge_browser_test_result";
      throw new Error("系统节点通过状态只能由 " + action + " 设置");
    }

    const task = this.requireMutableTask(taskId);
    this.setNode(task, nodeId, status, message);
    this.recalculate(task);
    this.advanceRevision(task);
    this.persist(task);
    return clone(task);
  }

  attachReport({ taskId, reportPath, conclusion, evidencePaths = [] }) {
    const task = this.requireMutableTask(taskId);
    const timestamp = this.now();
    const normalizedEvidence = Array.isArray(evidencePaths)
      ? evidencePaths
          .filter((value) => typeof value === "string" && value.trim())
          .slice(0, 60)
          .map((value) => value.trim().slice(0, 1024))
      : [];

    task.report = {
      path: cleanText(reportPath, "reportPath", 1024),
      conclusion: cleanText(conclusion, "conclusion", 500),
      evidencePaths: normalizedEvidence,
      generatedAt: timestamp,
    };
    this.setNode(
      task,
      REPORT_NODE_ID,
      "passed",
      "报告已生成：" + task.report.path,
      { allowProtectedPass: true }
    );
    this.setNode(task, HANDOFF_NODE_ID, "running", "等待接收确认");
    this.recalculate(task);
    this.advanceRevision(task);
    this.persist(task);
    return clone(task);
  }

  acknowledge({ taskId, receiver, receiptId, message = null }) {
    const task = this.requireMutableTask(taskId);
    const reportNode = task.nodes.find((node) => node.id === REPORT_NODE_ID);
    if (reportNode?.status !== "passed" || !task.report) {
      throw new Error("报告尚未生成，不能确认回传结果");
    }

    const timestamp = this.now();
    task.delivery = {
      receiver: cleanText(receiver, "receiver", 160),
      receiptId: cleanText(receiptId, "receiptId", 240),
      receivedAt: timestamp,
    };
    this.setNode(
      task,
      HANDOFF_NODE_ID,
      "passed",
      message || "接收方已确认：" + task.delivery.receiver,
      { allowProtectedPass: true }
    );
    this.recalculate(task);
    this.advanceRevision(task);
    this.persist(task);
    return clone(task);
  }

  requireMutableTask(taskId) {
    const normalizedTaskId = cleanText(taskId, "taskId", 160);
    const task = this.loadTask(normalizedTaskId);
    if (!task) {
      throw new Error("未找到任务：" + normalizedTaskId);
    }
    this.latestTaskId = normalizedTaskId;
    return task;
  }

  loadTask(taskId) {
    const persistedTask = this.persistence?.load(taskId);
    if (persistedTask) {
      this.tasks.set(taskId, persistedTask);
      return persistedTask;
    }
    return this.tasks.get(taskId) || null;
  }

  advanceRevision(task) {
    task.revision = Number.isInteger(task.revision) ? task.revision + 1 : 1;
  }

  persist(task) {
    this.persistence?.save(task);
  }

  setNode(task, nodeId, status, message, options = {}) {
    const normalizedNodeId = cleanText(nodeId, "nodeId", 80);
    if (
      status === "passed" &&
      !options.allowProtectedPass &&
      (normalizedNodeId === REPORT_NODE_ID ||
        normalizedNodeId === HANDOFF_NODE_ID)
    ) {
      throw new Error("不能直接完成系统保留节点");
    }

    const node = task.nodes.find((item) => item.id === normalizedNodeId);
    if (!node) {
      throw new Error("未找到节点：" + normalizedNodeId);
    }

    const timestamp = this.now();
    if (status === "running") {
      for (const item of task.nodes) {
        if (item.id !== node.id && item.status === "running") {
          item.status = "unconfirmed";
          item.message = item.message || "切换到下一节点前未收到完成结论";
          item.updatedAt = timestamp;
        }
      }
    }

    node.status = status;
    node.message =
      typeof message === "string" && message.trim()
        ? message.trim().slice(0, 600)
        : null;
    node.updatedAt = timestamp;
    task.updatedAt = timestamp;
  }

  recalculate(task) {
    const terminalNodes = task.nodes.filter((node) =>
      TERMINAL_STATUSES.has(node.status)
    );
    const runningNode = task.nodes.find((node) => node.status === "running");
    const allTerminal = terminalNodes.length === task.nodes.length;

    if (!allTerminal) {
      task.status = "running";
    } else if (task.nodes.some((node) => node.status === "failed")) {
      task.status = "failed";
    } else if (task.nodes.some((node) => node.status === "interrupted")) {
      task.status = "interrupted";
    } else if (task.nodes.some((node) => node.status === "unconfirmed")) {
      task.status = "unconfirmed";
    } else {
      task.status = "completed";
    }

    task.summary = {
      completed: terminalNodes.length,
      total: task.nodes.length,
      currentNodeId: runningNode?.id || null,
      currentNodeTitle: runningNode?.title || null,
      passed: task.nodes.filter((node) => node.status === "passed").length,
      failed: task.nodes.filter((node) => node.status === "failed").length,
      unconfirmed: task.nodes.filter(
        (node) => node.status === "unconfirmed"
      ).length,
    };
  }
}
