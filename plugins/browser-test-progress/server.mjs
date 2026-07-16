import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import {
  FileProgressPersistence,
  HANDOFF_NODE_ID,
  NODE_STATUSES,
  ProgressStore,
  REPORT_NODE_ID,
} from "./src/state-store.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRoot =
  basename(moduleDirectory) === "dist"
    ? dirname(moduleDirectory)
    : moduleDirectory;
const WIDGET_URI = "ui://browser-test-progress/progress.html";
const widgetHtml = readFileSync(
  join(pluginRoot, "public", "progress-widget.html"),
  "utf8"
);
const iconSvg = readFileSync(join(pluginRoot, "assets", "icon.svg"), "utf8");
const APP_ICONS = [
  {
    src:
      "data:image/svg+xml;base64," +
      Buffer.from(iconSvg, "utf8").toString("base64"),
    mimeType: "image/svg+xml",
    sizes: ["any"],
  },
];
const stateDirectory =
  process.env.BROWSER_TEST_PROGRESS_STATE_DIR?.trim() ||
  join(homedir(), ".codex", "browser-test-progress");
const store = new ProgressStore(
  undefined,
  new FileProgressPersistence(stateDirectory)
);

const nodeInputSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .describe("Stable lower-case node id for one acceptance subtask."),
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Short user-facing subtask title in Chinese or the task language."),
});

const statusSchema = z.enum(NODE_STATUSES);

const reply = (progress, message) => ({
  content: [{ type: "text", text: message }],
  structuredContent: { progress },
});

function withToolPresentationMetadata(transport) {
  const send = transport.send.bind(transport);

  transport.send = (message, options) => {
    const tools = message?.result?.tools;

    if (!Array.isArray(tools)) {
      return send(message, options);
    }

    return send(
      {
        ...message,
        result: {
          ...message.result,
          tools: tools.map((tool) => ({
            ...tool,
            icons: APP_ICONS,
            annotations: tool.title
              ? { ...tool.annotations, title: tool.title }
              : tool.annotations,
          })),
        },
      },
      options
    );
  };

  return transport;
}

function createServer() {
  const server = new McpServer(
    {
      name: "浏览器验收进度",
      title: "浏览器验收进度",
      version: "0.1.0",
      icons: APP_ICONS,
    },
    {
      instructions:
        "Use this server only to show discrete browser acceptance subtasks. " +
        "Call start_browser_test_progress once before browser work, then set exactly one node to running before each subtask and record passed, failed, unconfirmed, or interrupted after it. " +
        "Never invent percentages. The server appends report generation and result handoff nodes. " +
        "Use attach_browser_test_report only after the report and evidence exist. " +
        "Use acknowledge_browser_test_result only after a real receiver supplies a receipt id. " +
        "If delivery is not acknowledged, mark result-handoff unconfirmed instead of passed.",
    }
  );

  registerAppResource(
    server,
    "浏览器验收进度",
    WIDGET_URI,
    {
      description: "ChatGPT 内置浏览器只读验收任务进度面板。",
      _meta: {
        ui: {
          prefersBorder: false,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: false,
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "start_browser_test_progress",
    {
      title: "开始浏览器验收进度",
      description:
        "Create one discrete node per browser acceptance subtask and open the persistent progress panel. Do not include percentages or the two system tail nodes.",
      inputSchema: {
        taskId: z
          .string()
          .min(1)
          .max(160)
          .describe("Unique BROWSER_ACCEPTANCE_... task id."),
        title: z.string().min(1).max(160).default("浏览器验收"),
        nodes: z.array(nodeInputSchema).min(1).max(30),
      },
      annotations: {
        title: "开始浏览器验收进度",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "正在打开浏览器验收进度…",
        "openai/toolInvocation/invoked": "浏览器验收进度已打开",
      },
    },
    async ({ taskId, title, nodes }) => {
      const progress = store.start({ taskId, title, nodes });
      return reply(
        progress,
        "已创建 " +
          progress.summary.total +
          " 个进度节点，并打开浏览器验收进度窗口。"
      );
    }
  );

  server.registerTool(
    "update_browser_test_progress",
    {
      title: "更新浏览器验收节点",
      description:
        "Set one existing acceptance node to pending, running, passed, failed, unconfirmed, or interrupted. Set running before the work and a terminal status after it.",
      inputSchema: {
        taskId: z.string().min(1).max(160),
        nodeId: z.string().min(1).max(80),
        status: statusSchema,
        message: z.string().max(600).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { visibility: ["model"] },
        "openai/toolInvocation/invoking": "正在更新验收节点…",
        "openai/toolInvocation/invoked": "验收节点已更新",
      },
    },
    async ({ taskId, nodeId, status, message }) => {
      const progress = store.update({ taskId, nodeId, status, message });
      const node = progress.nodes.find((item) => item.id === nodeId);
      return reply(
        progress,
        "节点“" + node.title + "”已更新为 " + node.status + "。"
      );
    }
  );

  server.registerTool(
    "attach_browser_test_report",
    {
      title: "登记浏览器验收报告",
      description:
        "Mark report generation complete only after the report and all claimed evidence files exist. This starts the result-handoff node in waiting-for-ack state.",
      inputSchema: {
        taskId: z.string().min(1).max(160),
        reportPath: z.string().min(1).max(1024),
        conclusion: z.string().min(1).max(500),
        evidencePaths: z.array(z.string().min(1).max(1024)).max(60).default([]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { visibility: ["model"] },
        "openai/toolInvocation/invoking": "正在登记验收报告…",
        "openai/toolInvocation/invoked": "验收报告已登记",
      },
    },
    async ({ taskId, reportPath, conclusion, evidencePaths }) => {
      const progress = store.attachReport({
        taskId,
        reportPath,
        conclusion,
        evidencePaths,
      });
      return reply(progress, "验收报告已生成，正在等待回传接收确认。");
    }
  );

  server.registerTool(
    "acknowledge_browser_test_result",
    {
      title: "确认浏览器验收结果已接收",
      description:
        "Complete the handoff node only when the actual receiver has returned a non-empty receipt id. Never fabricate the receipt.",
      inputSchema: {
        taskId: z.string().min(1).max(160),
        receiver: z.string().min(1).max(160),
        receiptId: z.string().min(1).max(240),
        message: z.string().max(600).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: { visibility: ["model"] },
        "openai/toolInvocation/invoking": "正在确认结果回传…",
        "openai/toolInvocation/invoked": "结果接收已确认",
      },
    },
    async ({ taskId, receiver, receiptId, message }) => {
      const progress = store.acknowledge({
        taskId,
        receiver,
        receiptId,
        message,
      });
      return reply(progress, "验收结果已由 " + receiver + " 确认接收。");
    }
  );

  registerAppTool(
    server,
    "get_browser_test_progress",
    {
      title: "读取浏览器验收进度",
      description:
        "Read the current progress. This tool is reserved for the progress component.",
      inputSchema: {
        taskId: z.string().max(160).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
        "openai/visibility": "private",
      },
    },
    async ({ taskId }) => {
      const progress = store.get(taskId);
      return reply(progress, "浏览器验收进度已同步。");
    }
  );

  registerAppTool(
    server,
    "show_browser_test_progress",
    {
      title: "显示浏览器验收进度",
      description:
        "Reopen the progress panel for an existing browser acceptance task.",
      inputSchema: {
        taskId: z.string().max(160).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "正在读取浏览器验收进度…",
        "openai/toolInvocation/invoked": "浏览器验收进度已显示",
      },
    },
    async ({ taskId }) => {
      const progress = store.get(taskId);
      return reply(progress, "已重新显示浏览器验收进度。");
    }
  );

  return server;
}

const server = createServer();
const transport = withToolPresentationMetadata(new StdioServerTransport());

await server.connect(transport);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export {
  HANDOFF_NODE_ID,
  REPORT_NODE_ID,
  WIDGET_URI,
  createServer,
  store,
};
