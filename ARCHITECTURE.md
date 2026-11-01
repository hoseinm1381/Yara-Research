# Architecture

## Runtime boundary

React renders the desktop interface and React Flow canvas. The Rust backend owns all persistent desktop research, filesystem access, discovery requests, URL opening, and editor execution. Typed Tauri IPC commands connect them; no HTTP server is part of the installed application. The browser development adapter is explicitly labeled and separate.

The main window has Tauri core, file-selection dialog capabilities, and permission to destroy its own window after unsaved-change confirmation. There are no general frontend filesystem, shell, or HTTP plugin permissions. Confirmation uses an asynchronous in-app dialog service, avoiding Tauri's asynchronous replacement of browser `window.confirm`. The native close event is prevented before waiting for the user's decision. The CSP blocks remote scripts, frames, and arbitrary network access from the webview. Provider traffic goes through Rust to a fixed OpenAlex HTTPS endpoint. HTTP test endpoints exist only as arguments to an internal Rust function, never an IPC command or user preference.

## Database

`src-tauri/migrations/001_initial.sql` establishes schema version 1. Version 1.1 applies `002_workspaces_evidence.sql` transactionally to advance to schema 2; existing data is not reset. Initialization rejects newer schemas.

| Table              | Responsibility                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| papers             | Stable UUID, unique normalized DOI and OpenAlex ID, title, status, serialized extensible metadata           |
| layout             | Authoritative coordinates, pinned state, hidden state per paper                                             |
| citations          | Canonical `(citing, cited)` primary key, source, verification flag, timestamp                               |
| tags / paper_tags  | Normalized tag names and paper associations                                                                 |
| notes              | Stable relative UUID-based note paths                                                                       |
| discovery_cache    | Query identity, parsed response, fetch timestamp                                                            |
| settings           | Theme, viewport, sidebar state, inspector width, optional VS Code executable path; no API secrets           |
| workspace_meta     | Stable workspace UUID, display name, optional restore provenance                                            |
| metadata_sources   | Independent bibliographic snapshots by saved paper, provider and source URL                                 |
| evidence_snapshots | Focal paper, citation direction, provider, source URL, timestamp, method, raw capture, coverage and failure |
| evidence_pages     | Captured items by snapshot and page; preserves incomplete pagination                                        |
| extension_receipts | Request UUID, payload hash and original response for idempotent native delivery                             |

Parameterized SQL, foreign keys, checks, and unique constraints protect integrity. Metadata JSON holds authors, dates, abstract, identifiers, assessment fields, raw import text, and referenced work IDs. Tags and layout have normalized tables as well. Snapshot reads overlay authoritative layout coordinates; dragging updates only layout. A process mutex serializes desktop data operations, and SQLite's busy timeout handles temporary locks.

Paper save uses a savepoint; batch imports use an outer savepoint so any failure rolls back the database batch. Note creation uses create-new before database commit: a failed import can leave an orphan Markdown template, which is harmless and never overwrites existing notes. There is deliberately no automatic orphan cleanup.

## Citation semantics and layout

Every connection is **CITING → CITED**. If B cites A, the stored edge is B → A, even though B initially appears on A's right. If A references X, the stored edge is A → X and X initially appears on A's left. References returned with imported records are matched against known OpenAlex IDs to infer only verifiable local edges. Edges never depend on publication year. Cycles are allowed; self-citations within a single paper record are rejected.

New records are placed in free slots near the selected anchor. Existing records keep their coordinates. There is no continuous force simulation. Pinning protects a node from explicit reorganization and archive-area moves, while manual dragging remains available. Only an explicit layout action changes other nodes. Hidden records and filters never delete citations. Manual connections use dashed edges and imported verified connections use solid edges.

Viewport changes are separately controlled: Graph has no automatic focus effect or fit-on-mount option. It remains mounted when a library/filter view or empty state is shown, preserving its transform. Workspace switching remounts it with that workspace's saved viewport. Ordinary selection, imports, evidence polling and panel resize never call the viewport API. Inspector drag paints once per animation frame and persists only at the end of the gesture.

## Deduplication

Exact normalized DOI, canonical OpenAlex IDs, and IEEE article IDs are unique. Conflicting identifiers pointing at different saved records produce an error. Imports preserve existing user fields and enrich missing metadata and identifiers. Referenced IDs are unioned. Title-only matches are suggestions; there is no automatic fuzzy merge or destructive merge engine.

## Notes

Files use stable UUID names under the active workspace's notes folder. Titles never become paths. Notes are ordinary UTF-8 Markdown; metadata refresh does not rewrite them. The editor loads content and a SHA-256 revision. Saves compare the on-disk revision, preserve the previous bytes, write and sync a temporary file, recheck the revision, then rename. External changes are detected by polling and focus events. A missing file is distinguishable from an empty file.

Revision checks handle normal editing conflicts; an external writer that writes in the tiny interval between the final revision check and replacement cannot be fully coordinated without cooperation from that editor. The previous saved bytes and the external editor's own history remain the recovery mechanisms. Save your work before bulk filesystem renames or external synchronization.

Markdown rendering skips raw HTML and does not load remote images. External links use URL-validated Rust opening. VS Code launches `Code.exe` with separately passed arguments, without a shell. Notes can also open through the OS default association.

## Discovery

Official API reference checked during implementation: [OpenAlex API](https://help.openalex.org/api/) and [authentication](https://help.openalex.org/api/authentication/). Citation filter semantics also verified with the [official OpenAlex documentation repository](https://github.com/ourresearch/openalex-docs/blob/main/api-entities/works/filter-works.md) and live API queries.

`cites:W…` retrieves citing works; `cited_by:W…` retrieves referenced works. DOI filters, singleton IDs, text search, and up-to-100-ID batch queries are implemented. Basic pages are controlled at 50 works, capped at the provider's 10,000-result basic-pagination boundary; narrow searches beyond it. Users never automatically import a full network. Both-direction exploration retains separate direction tabs and deliberate imports.

Two concurrent requests, timeouts, bounded retries, rate-limit messages, session-only bearer credentials, cancellation generation tokens, and persistent query caching keep discovery optional and recoverable. Failed refreshes can return a clearly marked stale cache. API bodies and external text remain untrusted metadata, never executable code.

Each relationship dialog opening creates a fresh OpenAlex session. Cached page one and saved IEEE captures render before the new request. Controlled pagination is complete only if every expected page is present and distinct item count equals the provider total. A failed request creates a separate failed observation without deleting older observations. IEEE captures are independent snapshots; partial recaptures retain earlier evidence. Comparison uses exact identifiers; metadata_sources never grants relationship badges. A latest complete list can support “not observed in complete snapshot”; partial, failed and unchecked lists remain unknown. Historical observations are explicitly labeled.

## Browser bridge and workspaces

The MV3 extension declares only activeTab, scripting and nativeMessaging. The isolated capture function reads meta tags, bounded JSON-LD and explicit IEEE section DOM after a user action. It never fetches IEEE, executes page scripts, or copies cookies. Unrecognized sections remain unknown and allow a user-provided official BibTeX/RIS export. Generic page metadata is labeled Web.

The separate Rust `yara-native-host.exe` implements supported uint32-length-prefixed JSON over stdio. Both its manifest and runtime restrict the fixed extension origin. Envelopes reject unknown fields, invalid versions and requests above 512 KiB. The host validates identifiers, HTTP(S) URLs, expected HTTPS IEEE article context and an existing unique workspace UUID. An IEEE label is captured evidence, not cryptographic attestation. No input becomes executable code or a shell command.

The native host opens the same SQLite workspace as the desktop app; no server or running GUI is required. Native delivery uses an immediate transaction with a request receipt. Identical retries return the original result; changed content under the same request ID is rejected. Each capture ID is bound to one focal identity, provider and direction. A 2.5-second desktop data_version poll notices external host commits without moving the viewport.

Workspaces use the existing base directory and `workspace` / `workspace-<uuid>` folders with separate databases and Markdown folders. A stable identity and name are initialized non-destructively. The extension lists real folders, and ambiguous identities are rejected. The installer packages the host, manifest and unpacked extension, registers per-user Chrome/Edge host keys, and unregisters only keys that still point to that installation. No admin rights are needed.

## Backups

`.yara` is a versioned ZIP with `manifest.json`, a SQLite backup API snapshot, and current linked Markdown notes. SHA-256 detects damaged files. Import checks names, sizes, symlinks, duplicate entries, checksums, version, SQLite integrity/foreign keys, paper validation, and note completeness. Entries are written only to a newly created, app-owned staging workspace. An atomic active-workspace pointer switch occurs after validation; the previous workspace is never removed. Secrets, orphan notes, and note-version history are excluded as documented.

Backup format 2 includes all new tables. Format 1 archives and schema 1 databases are accepted and migrated. A restored copy receives a new workspace UUID, records restoredFrom, and appends “(restored)” to its name so native messages cannot silently route to duplicate identities.
