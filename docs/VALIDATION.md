# Validation record

Implementation date: 2026-11-01. Machine-readable evidence is stored under `docs/evidence/`.

## Executed results

| Check | Final result |
| --- | --- |
| Strict TypeScript | Passed |
| ESLint | Passed |
| Frontend production build | Passed |
| Rust compiler and optimized Windows build | Passed |
| Rust formatting | Passed |
| Vitest / React Testing Library | 31 passed, 0 failed |
| Rust SQLite / filesystem / HTTP integration | 34 passed, 0 failed |
| Edge / Playwright browser workflows | 8 passed, 0 failed |
| Packaged Windows / WebView2 smoke checks | 16 passed, no recorded page errors |
| npm audit, including development dependencies | 0 known vulnerabilities reported |
| Windows NSIS installer | Built and copied to `release/Yara Research_1.0.0_x64-setup.exe` |
| Live OpenAlex, through native backend | DOI lookup, singleton work ID, citing papers, referenced papers all succeeded without a key |

Native checks use the actual release executable and an isolated workspace, not the browser adapter. They verify UI creation and status changes, real Markdown saves, external edits, conflicting edits, canceled reload, positions/pinning, duplicate prevention, shared citations, complete backup/restore, corrupt-restore recovery, VS Code launch, native restart, 3,003 saved papers, and native window-close Cancel/Confirm behavior. Earlier defects were corrected and the final run is recorded in `evidence/native-smoke.json`.

Live provider example: work W2741809807 returned 1,218 citing results (50 fetched) and 43 references. These are observed provider counts from this run, not completeness claims or stable scientific statistics.

Headless Edge measurements rendered 100, 300, and 500 nodes before zoom. Load plus an explicit 500 ms fit-animation wait took approximately 1.17, 1.37, and 1.72 seconds respectively. Five zoom events plus a screenshot took 248–320 ms. Viewport culling reduced rendered nodes after zoom. This is a test-machine timing sample, not a guaranteed frame rate on other laptops. Native storage measurement and snapshot timing are recorded separately in `evidence/native-smoke.json`.

The source bundle is approximately 737 KB of JavaScript before compression; Vite emits a non-fatal chunk-size advisory. No runtime failure was observed from it. No known critical data-loss defect remained in the exercised workflows.

Visual review inspected the empty workspace, populated dark and light themes at 1366×768, the manual-entry dialog, and the actual native webview. Screenshots are retained in `evidence/`. At focal zoom, neighboring nodes can extend outside the canvas; Fit graph to view reveals the whole network without changing saved coordinates.

## Acceptance workflow mapping

| Workflow | Implementation and validation |
| --- | --- |
| A. Initial paper | Manual form → native IPC → SQLite, status, node and note creation |
| B. Forward exploration | OpenAlex `cites`, deliberate preview import, right-side placement, citing → focal |
| C. Backward exploration | OpenAlex `cited_by`, left-side placement, focal → reference |
| D. Recursive exploration | Any node, independent of status, offers either direction or both tabs; no depth limit |
| E. Shared citations | Stable identifiers and unique edge pairs; one paper can cite multiple core papers |
| F. Archive | Status and visibility filters preserve records, relationships and notes |
| G. Manual IEEE | Deterministic pasted-text extraction → corrected editable preview → persistent import |
| H. VS Code | Actual Markdown files, separate executable arguments, missing-editor message and default association action |
| I. Offline | No network dependency for saved data, manual papers, statuses, notes, layout or backups |
| J. Backup/restore | Consistent SQLite + Markdown archive, validated separate restore, previous workspace retained |

## Distribution boundaries

The Windows installer is an unsigned current-user NSIS executable. A clean-machine install/uninstall and missing-WebView2 bootstrap cannot be established by building an installer on this already configured machine. These are separate distribution acceptance checks.

No external paid services, authentication accounts, cloud backend, AI analysis, PDF ingestion, or synchronization are implemented or required. Crossref is an optional fallback in the request and was not added; OpenAlex plus manual entry supply the requested core workflow.
