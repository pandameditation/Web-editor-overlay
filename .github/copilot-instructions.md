<!-- kirograph:copilot:start -->
## KiroGraph

# KiroGraph

KiroGraph builds a local semantic knowledge graph of this codebase. When the `kirograph` MCP server is available, prefer its tools over broad grep/glob/file-read exploration.

## Quick decision guide

| Question | Tool |
|----------|------|
| Where do I start on this task? | `kirograph_context` |
| What is this symbol / show me its code | `kirograph_node` with `detail: "signatures"` |
| Find a symbol by name | `kirograph_search` |


## Tool selection

- Start code tasks with `kirograph_context`; use `detail: "signatures"` to reduce tokens when full source isn't needed yet.
- Find symbols by name with `kirograph_search`.
- Inspect a symbol with `kirograph_node`; use `detail: "full"` only when source is needed.


## Workflow

1. Call `kirograph_context` for orientation.
2. Drill into specific symbols with `kirograph_node`.
3. Use graph traversal tools before reading unrelated files.
4. Fall back to normal filesystem tools only when the graph is missing, stale, or lacks the needed detail.

If `.kirograph/` does not exist, ask whether to run `kirograph init --index`.

## Session Hygiene

This tool does not have automatic sync hooks. To keep the index fresh:
- Run `kirograph sync` at the **start** of each session if files changed outside the agent.
- Run `kirograph sync` at the **end** of each session after making changes.
- If results from graph tools seem stale, run `kirograph sync` before retrying.
<!-- kirograph:copilot:end -->
