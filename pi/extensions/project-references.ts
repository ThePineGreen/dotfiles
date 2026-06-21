/**
 * Project References
 *
 * Makes directories outside the current project available to pi by alias.
 * Configure them in ~/.pi/agent/references.json:
 *
 *   {
 *     "docs": "/Users/pine/code/project-docs",
 *     "shared": "/Users/pine/code/shared-lib"
 *   }
 *
 * In the TUI, reference an alias like `#docs` or browse files inside a
 * reference with `#docs/path/to/file` (autocomplete included). On submit,
 * `#alias/path` tokens are expanded inline into:
 *
 *   <file name="/abs/real/path">
 *   ...file contents...
 *   </file>
 *
 * so the model sees the file contents AND the absolute path, which it can
 * then grep, ls, or read with its built-in tools.
 *
 * Quoted form for paths with spaces: `#"alias/path/to file.md"`.
 *
 * Reload after editing references.json: run `/reload`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { readFile, stat } from "node:fs/promises";
import { readdirSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const ALIAS_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_INLINE_BYTES = 50_000;
const MAX_SUGGESTIONS = 50;

type References = ReadonlyMap<string, string>;

/** Token found in input text that points into a reference. */
interface ReferenceToken {
	/** Start index in the original text. */
	start: number;
	/** End index (exclusive) in the original text. */
	end: number;
	/** Raw matched text, e.g. `#docs/src/x.ts` or `#"docs/a b.md"`. */
	raw: string;
	/** Alias portion, e.g. `docs`. */
	alias: string;
	/** Relative path within the alias, e.g. `src/x.ts` or `a b.md`. May be "". */
	relPath: string;
	/** Whether the token was quoted. */
	quoted: boolean;
}

/**
 * Load and validate references from ~/.pi/agent/references.json.
 * Returns a map of alias -> absolute directory path. Invalid entries are
 * skipped silently here; the caller reports them.
 */
async function loadReferences(): Promise<{
	references: References;
	warnings: string[];
}> {
	const configPath = join(homedir(), ".pi", "agent", "references.json");
	let raw: string;
	try {
		raw = await readFile(configPath, "utf8");
	} catch {
		// No config file = no references. Not an error.
		return { references: new Map(), warnings: [] };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			references: new Map(),
			warnings: [`references.json is invalid JSON: ${message}`],
		};
	}

	const warnings: string[] = [];
	const references = new Map<string, string>();

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {
			references,
			warnings: ["references.json must be an object of { alias: path }"],
		};
	}

	for (const [alias, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (!ALIAS_PATTERN.test(alias)) {
			warnings.push(`skipping invalid alias "${alias}" (must match ${ALIAS_PATTERN.source})`);
			continue;
		}
		if (typeof value !== "string" || value.length === 0) {
			warnings.push(`skipping alias "${alias}" (path must be a non-empty string)`);
			continue;
		}
		const absPath = resolve(homedir(), value);
		try {
			if (!statSync(absPath).isDirectory()) {
				warnings.push(`skipping alias "${alias}": not a directory: ${absPath}`);
				continue;
			}
		} catch {
			warnings.push(`skipping alias "${alias}": not found or inaccessible: ${absPath}`);
			continue;
		}
		if (references.has(alias)) {
			warnings.push(`skipping duplicate alias "${alias}"`);
			continue;
		}
		references.set(alias, absPath);
	}

	return { references, warnings };
}

/**
 * Match a reference token at the start of `text.slice(from)`.
 * Returns the token and the absolute char offset where it began, or null.
 *
 * Mirrors pi's built-in # tokenization:
 * - `#alias` or `#alias/rel/path` (no whitespace inside)
 * - `#"alias/rel/path with spaces"` (quoted form; alias itself still has no spaces)
 */
function matchToken(text: string, from: number): { token: ReferenceToken; start: number } | null {
	const atIdx = text.indexOf("#", from);
	if (atIdx === -1) return null;

	// Token must be at a boundary: start of text or preceded by whitespace.
	const prev = atIdx === 0 ? "" : text[atIdx - 1];
	if (prev !== "" && !/\s/.test(prev)) {
		return matchToken(text, atIdx + 1);
	}

	// Quoted form: #"alias/rel/path"
	if (text[atIdx + 1] === '"') {
		const closeIdx = text.indexOf('"', atIdx + 2);
		if (closeIdx === -1) return matchToken(text, atIdx + 1); // no closing quote, not a token
		const inner = text.slice(atIdx + 2, closeIdx);
		const slashIdx = inner.indexOf("/");
		// Alias is everything before the first slash; relPath is the rest.
		// If no slash, the whole inner is an alias reference with no path.
		const alias = slashIdx === -1 ? inner : inner.slice(0, slashIdx);
		const relPath = slashIdx === -1 ? "" : inner.slice(slashIdx + 1);
		if (!ALIAS_PATTERN.test(alias)) return matchToken(text, closeIdx + 1);
		const token: ReferenceToken = {
			start: atIdx,
			end: closeIdx + 1,
			raw: text.slice(atIdx, closeIdx + 1),
			alias,
			relPath,
			quoted: true,
		};
		return { token, start: atIdx };
	}

	// Bare form: #alias or #alias/rel/path. Token ends at whitespace or end of text.
	let end = atIdx + 1;
	while (end < text.length && !/\s/.test(text[end]!)) end++;
	const inner = text.slice(atIdx + 1, end);
	if (inner.length === 0) return matchToken(text, atIdx + 1);

	const slashIdx = inner.indexOf("/");
	const alias = slashIdx === -1 ? inner : inner.slice(0, slashIdx);
	const relPath = slashIdx === -1 ? "" : inner.slice(slashIdx + 1);
	if (!ALIAS_PATTERN.test(alias)) return matchToken(text, end);

	const token: ReferenceToken = {
		start: atIdx,
		end,
		raw: text.slice(atIdx, end),
		alias,
		relPath,
		quoted: false,
	};
	return { token, start: atIdx };
}

/** Find every reference token in the text, in order. */
function findTokens(text: string, references: References): ReferenceToken[] {
	const tokens: ReferenceToken[] = [];
	let from = 0;
	while (true) {
		const match = matchToken(text, from);
		if (!match) break;
		if (references.has(match.token.alias)) {
			tokens.push(match.token);
		}
		from = match.token.end;
	}
	return tokens;
}

/** Format an absolute path for inline substitution. Paths containing
 * whitespace are wrapped in backticks so they stay unambiguous in the
 * surrounding sentence. */
function formatPathRef(absPath: string): string {
	return /\s/.test(absPath) ? `\`${absPath}\`` : absPath;
}

/** Build the inline expansion for a single token.
 *
 * Rule: files get inlined as `<file name="...">contents</file>`; everything
 * else (bare `#alias`, `#alias/`, or a path that resolves to a directory)
 * just resolves to its absolute path as plain text, so the model can grep,
 * ls, or read it with its built-in tools. */
async function expandToken(
	token: ReferenceToken,
	aliasDir: string,
): Promise<{ replacement: string; warning?: string }> {
	const relPath = token.relPath;
	if (relPath === "") {
		// `#alias` or `#alias/` with no path: resolve to the directory path.
		return { replacement: formatPathRef(aliasDir) };
	}

	const absPath = join(aliasDir, relPath);

	let stats;
	try {
		stats = await stat(absPath);
	} catch {
		return {
			replacement: `<file name="${absPath}">[not found: ${relPath} under reference "${token.alias}"]</file>`,
			warning: `reference "${token.alias}": not found: ${relPath}`,
		};
	}

	if (stats.isDirectory()) {
		// Path points at a directory: resolve to its absolute path only.
		return { replacement: formatPathRef(absPath) };
	}

	let content: string;
	try {
		content = await readFile(absPath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			replacement: `<file name="${absPath}">[could not read file: ${message}]</file>`,
			warning: `reference "${token.alias}": could not read ${relPath}: ${message}`,
		};
	}

	if (Buffer.byteLength(content, "utf8") > MAX_INLINE_BYTES) {
		const truncated = content.slice(0, MAX_INLINE_BYTES);
		return {
			replacement: `<file name="${absPath}">\n${truncated}\n\n[... truncated: file exceeds ${MAX_INLINE_BYTES} bytes; use the read tool to view the full file ...]\n</file>`,
		};
	}

	return {
		replacement: `<file name="${absPath}">\n${content}\n</file>`,
	};
}

/** Expand all reference tokens in the input text. */
async function expandReferences(text: string, references: References): Promise<{
	text: string;
	warnings: string[];
}> {
	const tokens = findTokens(text, references);
	if (tokens.length === 0) {
		return { text, warnings: [] };
	}

	const warnings: string[] = [];
	const parts: string[] = [];
	let cursor = 0;
	for (const token of tokens) {
		parts.push(text.slice(cursor, token.start));
		const aliasDir = references.get(token.alias)!;
		const { replacement, warning } = await expandToken(token, aliasDir);
		parts.push(replacement);
		if (warning) warnings.push(warning);
		cursor = token.end;
	}
	parts.push(text.slice(cursor));

	return { text: parts.join(""), warnings };
}

// ---- Autocomplete ----------------------------------------------------------

/**
 * Extract the # token at the cursor, including quoted form. Mirrors pi's
 * CombinedAutocompleteProvider.extractAtPrefix but also returns the alias
 * and relPath components.
 */
function extractAtToken(
	textBeforeCursor: string,
): { raw: string; alias: string; relPath: string; quoted: boolean } | null {
	// Quoted form: #"... (must be unclosed, i.e. cursor is inside the quotes)
	const quoteIdx = textBeforeCursor.lastIndexOf('#"');
	if (quoteIdx !== -1) {
		const prev = quoteIdx === 0 ? "" : textBeforeCursor[quoteIdx - 1];
		if (prev === "" || /\s/.test(prev)) {
			const inner = textBeforeCursor.slice(quoteIdx + 2);
			const slashIdx = inner.indexOf("/");
			return {
				raw: textBeforeCursor.slice(quoteIdx),
				alias: slashIdx === -1 ? inner : inner.slice(0, slashIdx),
				relPath: slashIdx === -1 ? "" : inner.slice(slashIdx + 1),
				quoted: true,
			};
		}
	}

	// Bare form: #... up to cursor, token must be at a boundary.
	const atIdx = textBeforeCursor.lastIndexOf("#");
	if (atIdx === -1) return null;
	const prev = atIdx === 0 ? "" : textBeforeCursor[atIdx - 1];
	if (prev !== "" && !/\s/.test(prev)) return null;
	const inner = textBeforeCursor.slice(atIdx + 1);
	if (inner.length === 0) {
		return { raw: textBeforeCursor.slice(atIdx), alias: "", relPath: "", quoted: false };
	}
	// Bare token can't contain whitespace.
	if (/\s/.test(inner)) return null;
	const slashIdx = inner.indexOf("/");
	return {
		raw: textBeforeCursor.slice(atIdx),
		alias: slashIdx === -1 ? inner : inner.slice(0, slashIdx),
		relPath: slashIdx === -1 ? "" : inner.slice(slashIdx + 1),
		quoted: false,
	};
}

function normalizeSlashes(p: string): string {
	return sep === "\\" ? p.replace(/\\/g, "/") : p;
}

/** List immediate children of a directory, prefix-matched by `filePrefix`. */
function listDirEntries(dir: string, filePrefix: string): AutocompleteItem[] {
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
	} catch {
		return [];
	}

	const lowerPrefix = filePrefix.toLowerCase();
	const items: AutocompleteItem[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (!entry.name.toLowerCase().startsWith(lowerPrefix)) continue;

		let isDirectory = entry.isDirectory();
		if (!isDirectory && entry.isSymbolicLink()) {
			try {
				isDirectory = statSync(join(dir, entry.name)).isDirectory();
			} catch {
				// treat as file
			}
		}

		items.push({
			value: isDirectory ? `${entry.name}/` : entry.name,
			label: entry.name + (isDirectory ? "/" : ""),
		});
	}

	// Directories first, then alphabetical.
	items.sort((a, b) => {
		const aDir = a.value.endsWith("/");
		const bDir = b.value.endsWith("/");
		if (aDir && !bDir) return -1;
		if (!aDir && bDir) return 1;
		return a.label.localeCompare(b.label);
	});
	return items;
}

/**
 * Build autocomplete suggestions for a reference token. Returns null to
 * signal "delegate to the built-in provider".
 */
function referenceSuggestions(
	token: { raw: string; alias: string; relPath: string; quoted: boolean },
	references: References,
): AutocompleteSuggestions | null {
	const { alias, relPath, quoted } = token;

	// No slash yet: completing the alias name.
	if (alias.length === 0 || (relPath === "" && !token.raw.slice(1).includes("/"))) {
		const query = alias;
		const all = [...references.keys()].map((name) => ({
			name,
			path: references.get(name)!,
		}));
		const filtered = query
			? fuzzyFilter(all, query, (item) => item.name)
			: all;
		const items = filtered.slice(0, MAX_SUGGESTIONS).map((item) => ({
			value: quoted ? `#"${item.name}"` : `#${item.name}`,
			label: item.name,
			description: item.path,
		}));
		if (items.length === 0) return null;
		return { items, prefix: token.raw };
	}

	// Slash present: alias must be known, then browse inside it.
	const aliasDir = references.get(alias);
	if (!aliasDir) return null;

	if (relPath === "" || relPath.endsWith("/")) {
		// Browsing the alias root or a subdirectory: list its contents.
		const dir = relPath === "" ? aliasDir : resolve(aliasDir, relPath);
		try {
			if (!statSync(dir).isDirectory()) return null;
		} catch {
			return null;
		}
		const items = listDirEntries(dir, "").slice(0, MAX_SUGGESTIONS);
		if (items.length === 0) return null;
		const displayBase = relPath === "" ? "" : normalizeSlashes(relPath);
		const base = `${alias}/${displayBase}`;
		const mapped = items.map((item) => ({
			value: quoted
				? `#"${base}${item.value}"`
				: `#${base}${item.value}`,
			label: item.label,
		}));
		return { items: mapped, prefix: token.raw };
	}

	// relPath has a trailing segment: list the parent dir, prefix-match the last bit.
	const normalizedRel = normalizeSlashes(relPath);
	const lastSlash = normalizedRel.lastIndexOf("/");
	const dirRel = lastSlash === -1 ? "" : normalizedRel.slice(0, lastSlash + 1);
	const filePrefix = lastSlash === -1 ? normalizedRel : normalizedRel.slice(lastSlash + 1);

	const dir = dirRel === "" ? aliasDir : resolve(aliasDir, dirRel);
	try {
		if (!statSync(dir).isDirectory()) return null;
	} catch {
		return null;
	}

	const entries = listDirEntries(dir, filePrefix).slice(0, MAX_SUGGESTIONS);
	if (entries.length === 0) return null;
	const base = `${alias}/${dirRel}`;
	const mapped = entries.map((item) => ({
		value: quoted ? `#"${base}${item.value}"` : `#${base}${item.value}`,
		label: item.label,
	}));
	return { items: mapped, prefix: token.raw };
}

/**
 * Wrap the built-in autocomplete provider so reference tokens are handled by
 * us and everything else falls through unchanged.
 */
function createReferenceAutocompleteProvider(
	current: AutocompleteProvider,
	references: References,
): AutocompleteProvider {
	return {
		triggerCharacters: ["#"],
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			const token = extractAtToken(beforeCursor);
			if (!token) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			// A slash after the #-token means we're browsing INSIDE a reference
			// (or, if the alias is unknown, a normal #-file path like #src/x).
			// No slash means we're completing a reference alias name — that case
			// is always ours, never the built-in #-file picker, so typing `#`
			// always shows the list of references first.
			const hasSlash = token.raw.indexOf("/", 1) !== -1;

			if (hasSlash && token.alias.length > 0 && !references.has(token.alias)) {
				// Unknown alias with a slash: treat as a normal #-file reference
				// (e.g. #src/foo.ts) and let the built-in provider handle it.
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			if (options.signal.aborted) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const suggestions = referenceSuggestions(token, references);
			// For no-slash tokens (alias completion), do NOT fall through to the
			// built-in provider when there are no matches — `#` should show refs
			// or nothing, never project files. For slash tokens whose alias is
			// known but whose directory is empty/missing, falling through is fine.
			if (!suggestions || suggestions.items.length === 0) {
				if (hasSlash) {
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				}
				return null;
			}
			return suggestions;
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			// Handle #-prefixed completions ourselves so we control insertion
			// (space after files, no space after directories). Pi's built-in
			// applyCompletion only special-cases `@`-prefixed attachments, so
			// delegating would lose that behavior for `#`.
			if (!prefix.startsWith("#")) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const currentLine = lines[cursorLine] || "";
			const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
			const afterCursor = currentLine.slice(cursorCol);
			const isQuotedPrefix = prefix.startsWith('#"');
			const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
			const hasTrailingQuoteInItem = item.value.endsWith('"');
			const adjustedAfterCursor =
				isQuotedPrefix && hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor
					? afterCursor.slice(1)
					: afterCursor;
			const isDirectory = item.label.endsWith("/");
			const suffix = isDirectory ? "" : " ";
			const newLine = `${beforePrefix + item.value}${suffix}${adjustedAfterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			const cursorOffset = isDirectory && hasTrailingQuoteInItem ? item.value.length - 1 : item.value.length;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + cursorOffset + suffix.length,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

// ---- Extension entry point -------------------------------------------------

export default function (pi: ExtensionAPI): void {
	let references: References = new Map();

	pi.on("session_start", async (_event, ctx) => {
		const loaded = await loadReferences();
		references = loaded.references;
		for (const warning of loaded.warnings) {
			ctx.ui.notify(`project-references: ${warning}`, "warning");
		}

		if (ctx.mode === "tui") {
			ctx.ui.addAutocompleteProvider((current) =>
				createReferenceAutocompleteProvider(current, references),
			);
		}
	});

	pi.on("input", async (event, ctx) => {
		// Never re-expand our own injected messages.
		if (event.source === "extension") {
			return { action: "continue" };
		}
		if (references.size === 0) {
			return { action: "continue" };
		}

		const { text, warnings } = await expandReferences(event.text, references);
		for (const warning of warnings) {
			ctx.ui.notify(`project-references: ${warning}`, "warning");
		}

		if (text === event.text) {
			return { action: "continue" };
		}
		return { action: "transform", text };
	});
}
