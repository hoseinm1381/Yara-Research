# Yara Research 1.1.1

Version 1.1.1 repairs IEEE metadata extraction: authors, DOI, dates, publication venue, publisher, full abstract and keyword groups now pass through the browser preview into the existing paper record. See [the repair report and reload instructions](docs/IEEE-METADATA-FIX.md). Re-import an existing title-only IEEE paper to fill its missing fields while preserving your notes and corrections.

A Windows desktop workspace for scientific papers, citation maps, and Markdown research notes. Built with React, TypeScript, React Flow, Tauri 2, Rust, and SQLite. No server, subscription, cloud account, or API key is needed for local research.

## Start using it

Download the [Windows installer](https://github.com/hoseinm1381/Yara-Research/releases/download/v1.1.1/Yara.Research_1.1.1_x64-setup.exe) and the optional [Chrome/Edge extension ZIP](https://github.com/hoseinm1381/Yara-Research/releases/download/v1.1.1/Yara-browser-extension-1.1.1.zip) from the [v1.1.1 release](https://github.com/hoseinm1381/Yara-Research/releases/tag/v1.1.1). Release binaries are attached to GitHub Releases; this repository contains the editable source, tests, build scripts and documentation. SHA-256 checksums are listed in the release notes and `release/SHA256SUMS.txt`.

After installation, launch **Yara Research** from the Start menu. The application does not require Node.js or Rust on the researcher's machine. Windows WebView2 is required; the installer can download it if missing. Older installers are retained in the original local workspace, outside this source upload; use a backup made with v1.0 when returning to that version because v1.0 cannot read the new database schema.

1. **Add Paper → Add Paper Manually** creates a paper; a title is the only required field. Choose Core for a focal work. Multiple Core papers are supported.
2. **Add Paper → Discover Papers** searches OpenAlex by DOI, work ID, or text. **Import from Text** reviews pasted citations. No results are imported automatically.
3. Select any node and choose **Find Citing Papers** or **Find Referenced Papers**. References initially appear on the left; citing works on the right. Arrows always mean **citing paper → cited paper**. Explore both directions provides a tab for each independently paginated set.
4. Use **Notes → Write / Preview** to edit the paper's Markdown file. Save explicitly, or press Ctrl+S while Notes is open. **VS Code** and the default-editor button open the actual file. External edits are checked every three seconds and when the app receives focus. Conflicts block saving until resolved; copy unsaved edits before reloading.
5. Use statuses, comma-separated tags, year filters, and the library to organize research. Hidden and archived records remain saved. Local search (Ctrl+K) selects a saved paper without moving the graph. Use the inspector's explicit **Focus** button to center it.
6. Use the link button above the graph to confirm that one paper cites another. Imported relationships are solid; manual relationships are dashed. Connections can be removed from the inspector's Connections tab.

The optional demonstration is offered only in an empty workspace and is explicitly marked as demo data. Its relationships illustrate the interface; use live metadata to verify scientific claims. A separate demo-only reset button removes that dataset after confirmation.

The redundant page heading has been removed throughout the workspace. Collapse the sidebar into its 64-pixel icon rail, or drag the inspector's left edge to resize it. Double-click the edge to reset it; the focused separator also supports Left/Right and Home. Width and sidebar state persist per workspace. Selection, metadata changes, imports, filters, expansion, and panel changes preserve your viewport. Only explicit Focus, Fit, Reset, zoom, and your own pan gestures move the view. The last saved viewport is restored on startup.

The sidebar workspace selector lists actual independent research databases. Create, name, and switch workspaces there. Existing research is migrated in place and initially named **My research**; it is not moved or reset. Each workspace has separate papers, notes, layout, settings, caches, and source evidence.

The optional **Send to Yara** Chrome/Edge extension imports the paper in your active browser tab into a chosen real workspace. It can also capture an explicitly loaded IEEE reference or citing list. Install/load instructions and coverage meanings are in [docs/EXTENSION.md](docs/EXTENSION.md). Yara works without the extension.

## Local files and data safety

The normal data directory is `%APPDATA%\org.yara.research\`. The Settings dialog shows the exact active workspace path. Inside the active workspace:

```text
workspace.sqlite           SQLite metadata, statuses, tags, layout, citations, cache, settings
notes/<paper-uuid>.md       UTF-8 editable notes
notes/<paper-uuid>.md.previous  Previous note version retained after an in-app save
```

The database uses versioned migrations, foreign keys, unique DOI/OpenAlex/IEEE IDs, transactions, and SQLite WAL with full synchronous writes. Version 1.1 adds migration 002 without resetting existing records, notes, positions, or settings. Node movement is written independently of metadata. Research is stored outside the installation directory.

**Settings & backups → Export backup** creates a `.yara` ZIP containing a consistent SQLite snapshot, every currently linked paper note, and SHA-256 checksums. Use a new filename; existing backups are never overwritten. Export outside the active workspace. Missing paper notes cause an explicit failure rather than an incomplete backup.

**Restore backup** validates the archive, paths, checksums, database integrity, paper metadata, and note presence in a new workspace folder. It switches only after validation. The original workspace remains on disk. Version 1.1 exports backup format 2, including workspace identity, metadata provenance, relationship captures and receipts; it also accepts format 1 backups and migrates them safely. A restored copy gets a new identity and a “(restored)” name so extension imports cannot silently target two databases with the same identity. Restores use an `active-workspace` pointer. Backups exclude session API keys, `.previous` files, and orphan notes retained after deleting records. Copy those separately if you need their history.

Delete paper removes its database record and edges after confirmation, retaining the Markdown file for recovery. Prefer Hide or Archived when you want to preserve the complete record.

## Online discovery

OpenAlex access is optional. Basic requests may work anonymously. For a larger free provider budget, get a key from [OpenAlex](https://openalex.org/settings/api) and enter it in **Settings → OpenAlex → Apply session key**. Yara keeps it in memory until exit, never in the database or backups. Do not enable paid provider billing for this application.

Requests use the official HTTPS API, a 20-second timeout per attempt, at most two concurrent requests, up to three attempts with backoff, and bounded `Retry-After` handling. Discovery can be canceled. Opening a references or citing list requests fresh OpenAlex results each time, immediately showing cached data if available. Refreshing, fresh, partial, stale and failed states are labeled. Offline refresh failure retains the last successful results and saved IEEE evidence. Clicking a saved paper does not make network calls. Provider counts are distinct from local connection counts. OpenAlex may omit references, abstracts, or other metadata.

Matching DOI/OpenAlex/IEEE imports preserve saved titles, corrections, statuses, tags, notes, positions, and pinning; missing identifiers and empty metadata fields can be enriched. Ambiguous title-only matches are suggested for review, never merged automatically. Independent OpenAlex and IEEE badges describe a specific relationship, not a paper's metadata source. “Reported by both sources” indicates agreement about that relationship, not scientific correctness. Unchecked, failed, partial and unknown source lists never imply absence. Manual records can be linked to OpenAlex by importing a matching DOI result or editing the work ID.

**Import text** supports multiple BibTeX and RIS records, quoted citations, labeled metadata, DOI strings, and copied HTML text. It retains the raw input and presents editable metadata before saving. Ambiguous plain-text bibliographies require correction; blank titles must be supplied. No AI service or scraping is used.

## Development

Prerequisites: Node.js 22.12+ or 24+, stable Rust for `x86_64-pc-windows-msvc`, Microsoft C++ Build Tools with Desktop development with C++, Windows SDK, and WebView2.

```powershell
npm ci
npm run dev                         # explicitly labeled browser preview
powershell -File scripts/native.ps1 dev    # actual desktop application
npm run typecheck
npm run lint
npm test
npm run test:e2e
powershell -File scripts/native.ps1 test
powershell -File scripts/native.ps1 fmt
powershell -File scripts/native.ps1 build
```

`scripts/native.ps1` detects the project-local Rust toolchain under `.tooling/` when present and imports the installed MSVC build environment. Otherwise it uses the standard Rust installation. Dependencies are locked in `package-lock.json` and `src-tauri/Cargo.lock`. The generated icon comes from the editable `app-icon.svg` (`npm run tauri -- icon app-icon.svg -o src-tauri/icons`). `.tooling/` and build outputs are not source dependencies.

The browser preview is for frontend development and stores a separate workspace in browser storage. It does **not** use the desktop database and has no native backup/editor integration. Browser tests alone are not native acceptance. Never treat browser preview data as a backup of desktop research.

## Troubleshooting

- **API unavailable / rate limited / key rejected:** use cached results or manual entry; retry later, clear the session key, or supply a verified free key. Saved data remains usable offline.
- **No work ID for expansion:** search the DOI/title and import a matching record to attach missing identifiers, or edit metadata and add its OpenAlex work ID.
- **VS Code not found:** enter the path to `Code.exe` in Settings. Common installation paths and PATH entries are detected. Alternatively use Notes → Open in default editor. The built-in editor remains available.
- **Note conflict:** copy unsaved text, reload the external version, and reconcile the edits. The application never intentionally overwrites a mismatched revision.
- **Missing note:** the Notes editor offers a template; save to recreate it, or restore the original file from your own backup first. Existing metadata is preserved.
- **Failed restore:** the active workspace remains in place. Check the archive/version and select a valid backup. Failed staging folders are retained for diagnosis.
- **Compiler cannot find `link.exe`:** install the C++ workload and SDK; use `scripts/native.ps1` or an x64 Native Tools terminal.
- **Unsigned installer prompt:** this local build has no purchased code-signing certificate. Verify the build checksum in the release evidence.

See [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md), and [docs/VALIDATION-v1.1.md](docs/VALIDATION-v1.1.md) for implementation boundaries and measured validation. The original [v1.0 validation](docs/VALIDATION.md) and evidence remain preserved.
