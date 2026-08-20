---
inclusion: always
---

# KiroGraph

KiroGraph builds a semantic knowledge graph of your codebase. Use its MCP tools instead of grep/glob/file reads whenever `.kirograph/` exists in the project.

## Quick decision guide

| Question | Tool |
|----------|------|
| Where do I start on this task? | `kirograph_context` |
| What is this symbol / show me its code | `kirograph_node` with `includeCode: true` |
| Find a symbol by name | `kirograph_search` |

---

## Tool reference

### `kirograph_context`: **start here for any code task**

Returns entry points, related symbols, and code snippets for a natural-language task description. Usually enough to orient without any additional tool calls.

```
kirograph_context(task: "fix the auth token expiry bug")
kirograph_context(task: "add dark mode", maxNodes: 30)
kirograph_context(task: "refactor payment service", includeCode: false)
```

### `kirograph_search`: find symbols by name

Exact match → FTS → LIKE fallback → vector (last resort). Use instead of grep.

```
kirograph_search(query: "signIn")
kirograph_search(query: "UserService", kind: "class")
kirograph_search(query: "auth", limit: 20)
```

Supported kinds: `function`, `method`, `class`, `interface`, `type_alias`, `variable`, `route`, `component`

### `kirograph_node`: inspect a symbol

Returns kind, file, signature, docstring. Add `includeCode: true` to get the full source.

```
kirograph_node(symbol: "validateToken")
kirograph_node(symbol: "AuthService", includeCode: true)
```




---

## Workflows

**Bug fix or feature:**
1. `kirograph_context`: orient, find entry points.
2. `kirograph_node` with `includeCode: true`: read the relevant symbol.
3. `kirograph_impact`: check blast radius before editing.


---

## Workflow steering files

KiroGraph installs task-specific steering files in `.kiro/steering/`. They are not always active — load them on demand.

**In Kiro IDE:** type `/kirograph-review`, `/kirograph-security`, etc. to activate a workflow for the current session.

**In Kiro CLI / other agents:** when the user asks for a specific workflow or you recognize the intent, read the file directly:

```
Read file: .kiro/steering/kirograph-security.md
Read file: .kiro/steering/kirograph-review.md
```

| User intent | File to load |
|-------------|-------------|


Each file contains numbered steps, exact tool calls, and an interpretation reference. Follow the steps in order.

---

## If `.kirograph/` does NOT exist

Ask the user: "This project doesn't have KiroGraph initialized. Run `kirograph init -i` to build a code knowledge graph for faster exploration?"
