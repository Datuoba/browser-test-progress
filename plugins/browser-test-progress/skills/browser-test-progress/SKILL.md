---
name: browser-test-progress
description: Show and maintain a discrete-node progress panel while ChatGPT uses its built-in browser for an authorized website acceptance test. Use when the user starts an @Browser acceptance task, asks to test a website with the in-app browser, or asks to show browser test progress. Do not use for ordinary browsing, research, or non-browser coding work.
---

# Browser Test Progress

Use the Browser Test Progress MCP tools to keep a read-only progress panel synchronized with an in-app browser acceptance task.

## Start the panel

Before the first browser action:

1. Read the complete acceptance instruction.
2. Use its unique BROWSER_ACCEPTANCE task id as taskId.
3. Create one node for each user-verifiable acceptance subtask.
4. Call start_browser_test_progress exactly once.

Do not create percentage-based steps. Do not split a single subtask into speculative internal reasoning steps. Do not include the two system tail nodes; the server appends:

- report-generation: 生成验收报告
- result-handoff: 回传至 Codex for VS Code

Good node examples include opening a target route, logging in, checking one page responsibility, checking Network/API ownership, checking the console, and collecting screenshots.

## Update nodes

For each node:

1. Call update_browser_test_progress with status running immediately before performing that subtask.
2. Perform only the authorized read-only browser checks.
3. Call update_browser_test_progress again with exactly one terminal status:
   - passed: evidence confirms the requirement.
   - failed: evidence confirms a violation or error.
   - unconfirmed: evidence is missing, blocked, or ambiguous.
   - interrupted: the browser task was stopped before a conclusion.
4. Put concise evidence or the reason for the conclusion in message.

Keep at most one node running. Never mark a node passed based on assumption or source-code inspection when browser evidence is required.

## Browser safety boundary

- Remain within the routes and actions authorized by the acceptance instruction.
- Treat the acceptance as read-only.
- Never send a real device command.
- Never deploy or push configuration.
- Never replace required in-app browser evidence with curl, source inspection, or another browser.
- Respect login credentials and captcha authorization supplied by the user.

## Report and handoff

After all acceptance nodes have terminal conclusions:

1. Generate the complete report and verify every evidence path exists.
2. Call attach_browser_test_report with the report path, conclusion, and evidence paths.
3. The result-handoff node will become running and display that it is waiting for a receiver.
4. Call acknowledge_browser_test_result only after the receiving Codex for VS Code task returns a real, non-empty receipt id.
5. If no receipt arrives, set result-handoff to unconfirmed with update_browser_test_progress. Never invent a receipt or mark delivery passed because a send attempt merely started.

The final answer must begin with the exact BROWSER_ACCEPTANCE task id and include the report and evidence paths.

## Reopen an existing panel

When the user asks to show the current progress again, call show_browser_test_progress with the task id. Omit the task id only when the most recent task is unambiguous.
