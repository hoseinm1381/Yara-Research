# Yara Research 1.1 validation

Date: 2026-11-01. This updates the existing application. Version 1.0's installer, source rollback and original `docs/evidence/` remain preserved. Current machine-readable records and screenshots are under `docs/evidence-v1.1/`.

## Executed checks

| Check                                                       | Result                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Strict TypeScript and ESLint                                | Passed                                                                                             |
| Frontend / parser / evidence / React tests                  | 46 passed                                                                                          |
| Rust / SQLite / filesystem / HTTP tests                     | 47 passed                                                                                          |
| Edge frontend workflows                                     | 16 passed; two affected inspector/viewport checks also rerun after final accessibility refinements |
| Native release Tauri / WebView2 smoke                       | 16 passed, no recorded page errors                                                                 |
| Real Chrome + Edge → Rust Native Messaging → desktop SQLite | 17 checks passed with saved IEEE fixtures; prior host registrations restored                       |
| Live OpenAlex through Rust backend                          | DOI lookup, singleton ID, citing list and references succeeded without a key                       |
| Rust formatting / compiler / optimized build                | Passed                                                                                             |
| npm dependency audit                                        | 0 known vulnerabilities reported, including development dependencies                               |
| Windows x64 NSIS installer and unpacked extension ZIP       | Built; version 1.1.0; checksums in `release/SHA256SUMS.txt`                                        |

The native smoke used isolated `YARA_DATA_DIR` data and exercised real UI/IPC, UTF-8 Markdown, external changes and conflicts, Cancel/Confirm behavior, status, coordinates, pinning, deduplication, shared citations, backup/restore, corrupt restore rejection, VS Code launch, process restart, native close protection, and 3,003 saved papers. In this run inserting 3,000 records and note files took about 24.4 seconds; a snapshot took about 2.1 seconds. These are storage timings on this machine, not graph frame-rate guarantees.

Live OpenAlex returned 1,218 citing works (first 50 retrieved) and 43 references for W2741809807. These are observed counts for this run, not completeness claims or stable scientific statistics. The first page of a larger set remains partial until all pages and distinct counts are accounted for.

## Interface acceptance

The redundant page heading is absent in graph, library and collection views. The Add Paper menu preserves manual entry, discovery and text import, supports keyboard opening, Escape and outside dismissal. Sidebar collapse produces a 64-pixel rail with usable navigation and persistent state. Inspector pointer/keyboard resizing honors its limits, reset and saved width; its accessible bounds reflect the available content width.

Tests compare the exact React Flow transform before and after selection, status and tag changes, note save, inspector tabs/closure, core selection, sidebar changes, filters, and manual import. The transform remains unchanged. The explicit Focus action moves it. The graph stays mounted across alternate views. Startup restores the saved viewport; explicit Fit/Reset/zoom and user pan gestures remain available.

Dark/light screenshots were rendered and visually inspected at 1366×768, 1920×1080 and 1100×720. The compact workspace has no retained header spacer or horizontal page overflow. The native window and source-comparison dialog were inspected separately. Fit is deliberately explicit, so an off-screen related node can stay off-screen until the user chooses to move or fit the view.

## Extension and source evidence acceptance

The harness uses the installed Chrome and Edge with fresh, isolated profiles. A real browser extension action grants activeTab. For stable automation the same extension UI is then opened in a background tab, while the article remains active. The real scripting API extracts the saved fixture, and the real nativeMessaging API launches the compiled Rust host registered under temporary per-user keys. The host writes the same SQLite databases read by the actual release Tauri application. No test-only permissions or alternative fake bridge are used.

Both browsers verified real named-workspace listing, chosen destination isolation, metadata-only provenance, explicit reference capture, independent partial citing capture, idempotent retry, forged-context / unknown-workspace / unknown-field rejection, and the official-export fallback when section DOM is unrecognized. Earlier complete captures remain after the partial export. Additional checks verified the native comparison UI, explicit graph import with canonical focal → reference direction and metadata source, and full native restart persistence. Registry rollback completed successfully. The current harness record includes the exact tested desktop and host SHA-256 values.

Deterministic frontend tests cover IEEE-only, OpenAlex-only and both-source relationships, exact matching, title-only uncertainty, historical observations, and unknown-versus-absence rules. Browser fixtures verify a new OpenAlex request on every opening, cached display and failed-refresh fallback while keeping IEEE rows. Metadata provenance never grants relationship badges.

Rust tests verify migration from genuine schema 1 with notes, settings and positions retained; format 1 archive restoration; source history after restart/failure; all-page completeness; selected-workspace isolation; capture identity collision rejection; repeated native delivery; backup format 2 evidence and restored identity separation. Bibliographic enrichment preserves existing corrections and research fields.

## Explicit limits

The representative live IEEE article `https://ieeexplore.ieee.org/document/726791` returned a JavaScript / verification barrier. It was not bypassed, and no live dynamically loaded reference/citing section was accepted as verified. The saved HTML fixture is hand-authored and labeled as such. Actual local browser communication is verified; compatibility with the current live IEEE DOM is still unverified. An unrecognized section produces Unknown coverage and supports a user-provided official BibTeX/RIS export rather than inventing a list.

The installer is unsigned. Its resource mapping and compiled installer include the desktop executable, native host, manifest, browser extension and Chrome/Edge per-user registration hooks. Actual host registry registration and restoration were exercised by the native integration harness. A clean-machine installer/uninstaller run and missing-WebView2 bootstrap remain separate, unexecuted distribution checks. Browser store publication is not part of this local unpacked release.

Vite emits a non-fatal advisory for the approximately 753 KB main JavaScript bundle. Local/native workflows tested successfully. No cloud service, AI analysis, cookie transfer, paid dependency, private IEEE API or access-control bypass was introduced.
