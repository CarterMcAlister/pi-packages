---
name: lsp-navigation
description: Navigate code with IDE features - definitions, references, types, call hierarchy. Use as PRIMARY for code intelligence.
---

# LSP Navigation

Use `lsp_navigation` as **PRIMARY** for code intelligence. Do NOT use grep/glob/ast-grep first.

**Requires:** `--lens-lsp` flag

## When to Use (Code Intelligence)

| Question | Operation | Parameters |
|----------|-----------|------------|
| "Where is this defined?" | `definition` | filePath, line, character |
| "Find all usages" | `references` | filePath, line, character |
| "What type is this?" | `hover` | filePath, line, character |
| "Show call signature here" | `signatureHelp` | filePath, line, character (at call-site args) |
| "What symbols in this file?" | `documentSymbol` | filePath |
| "Find symbol across project" | `workspaceSymbol` | query + **filePath strongly recommended** |
| "What quick fixes are available?" | `codeAction` | filePath, line, character, endLine, endCharacter |
| "Rename symbol safely" | `rename` | filePath, line, character, newName |
| "Who implements this interface?" | `implementation` | filePath, line, character |
| "Who calls this function?" | `prepareCallHierarchy` → `incomingCalls` | filePath, line, character |
| "What does this function call?" | `prepareCallHierarchy` → `outgoingCalls` | filePath, line, character |
| "Show tracked LSP diagnostics" | `workspaceDiagnostics` | optional filePath (snapshot, not full pull workspace) |

## Operational Guidance (From Field Tests)

- Always pass `filePath` for `workspaceSymbol` when possible. Unscoped queries are best-effort and often empty.
- For `references`, prefer querying from the definition site for broader cross-file coverage; usage-site queries can be partial.
- Use `signatureHelp` only at call-site argument positions; declaration positions often return empty.
- Treat `workspaceDiagnostics` as tracked push snapshot (`publishDiagnostics`), not protocol pull `workspace/diagnostic` coverage.
- For `codeAction`, separate `quickfix` from generic refactors (for example "Move to new file"). Do not treat generic refactors as error fixes.
- `prepareCallHierarchy` is server-capability dependent; if unsupported, skip incoming/outgoing calls.
- If TypeScript returns `No Project` on `workspaceSymbol`, retry after opening the scoped file context.

## Call Hierarchy Pattern

```typescript
// Step 1: Prepare (get the callable item)
const items = await lsp_navigation({
  operation: "prepareCallHierarchy",
  filePath: "src/api.ts",
  line: 42,
  character: 10
});

// Step 2: Get callers (who calls this function)
const callers = await lsp_navigation({
  operation: "incomingCalls",
  callHierarchyItem: items[0]
});

// Step 2: Get callees (what this function calls)
const callees = await lsp_navigation({
  operation: "outgoingCalls",
  callHierarchyItem: items[0]
});
```

## When NOT to Use LSP

| Task | Use Instead | Why |
|------|-------------|-----|
| Find patterns (console.log) | `ast_grep_search` | Pattern matching |
| Find text/TODOs | `grep` | Text search |
| Find files by name | `glob` | File discovery |
| Read file content | `read` | Direct access |

## Golden Rule

**Code intelligence → LSP first. Text/pattern search → grep/ast-grep.**
