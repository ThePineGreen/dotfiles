# Project References

A [pi](https://pi.dev) extension that makes directories outside the current
project available to the agent by alias — documentation, shared libraries,
examples, or another repository.

References use the `#` sigil so they don't conflict with pi's built-in `@`
file references (which fuzzy-match files inside the current project).

## Setup

1. Install the extension at
   `~/.pi/agent/extensions/project-references.ts` (this directory is
   auto-discovered by pi).

2. Create `~/.pi/agent/references.json`:

   ```json
   {
     "docs": "/Users/pine/code/project-docs",
     "shared": "/Users/pine/code/shared-lib"
   }
   ```

   - Keys are aliases matching `[A-Za-z0-9_-]+` (no `/` or spaces, so
     `#alias/path` parses unambiguously).
   - Values are paths to directories. Relative paths resolve against your home
     directory; absolute paths work too.

3. Start pi (or run `/reload` if it's already running). Invalid aliases, missing
   paths, or non-directory values are skipped with a warning and don't block
   startup.

## Usage

The common case is **`#alias`** (no slash) — it just resolves to the reference
directory's absolute path as plain text. So:

> Check `#repo` for the references we talked about.

becomes:

> Check `/Users/pine/code/repo` for the references we talked about.

The model sees a real, navigable path and can `grep`, `ls`, or `read` inside it
with its built-in tools. Nothing is force-inlined; the model decides what to
look at.

The exceptional case is **`#alias/path/to/file`** — when you point at a specific
file, it gets inlined into the message so the model sees its contents directly:

```
<file name="/Users/pine/code/repo/docs/guide.md">
...file contents...
</file>
```

The absolute path is always included, so the model can still `grep` for usages,
list sibling files, or read related files in the reference directory.

### Rule

- Files → inlined as `<file name="...">contents</file>`.
- Everything else (bare `#alias`, `#alias/`, or a path that resolves to a
  directory) → resolved to its absolute path as plain text.
- Paths containing whitespace are wrapped in backticks so they stay
  unambiguous in the sentence.

### Autocomplete (TUI)

- **`#`** — shows the list of references (aliases), fuzzy-filtered as you
  type, with the real path shown as the description. Selecting one inserts
  `#alias ` (with a trailing space), ready for the common "just name the
  reference" case. `#` always shows references first — it never falls through
  to project files.
- **`#alias/`** — once you type the slash, browses that reference's top level
  (directories get a trailing `/`, files don't, same feel as pi's built-in `@`
  file picker). Files only appear at this point, not before the slash.
- **`#alias/sub/file`** — browses deeper; the last segment is prefix-matched
  against the parent directory's entries.
- **`#"alias/sub/a b.md"`** — quoted form for paths containing spaces.
- **`#unknown/...`** — an unknown alias with a slash returns no suggestions
  (it does not fall through to project files). Use pi's `@` for project file
  references.

`@` remains pi's native project file reference and is fully preserved — this
extension does not touch `@` at all.

Browsing uses plain `readdirSync` (no `fd` dependency). Full-tree fuzzy search
inside a reference is a possible future enhancement.

## Behavior notes

- Files over 50 KB are truncated inline with a note to use the `read` tool for
  the full file.
- Unreadable or missing files expand to an inline error marker and emit a user
  warning.
- The extension never re-expands its own injected messages, so chaining is
  safe.
- Input expansion works in all modes (interactive, print, JSON, RPC).
  Autocomplete only registers in TUI mode.
- There is no footer status line — the extension stays out of your way.
- Image inlining is not supported in this version — text files only.

## Reload after editing

`references.json` is read on `session_start`, so run `/reload` after editing
it to pick up changes. There is no file watcher by design.
