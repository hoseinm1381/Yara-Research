# Version 1.1.0

- Removed redundant workspace page headings and consolidated creation actions under Add Paper.
- Added a persistent 64-pixel collapsed sidebar and an inspector with pointer/keyboard resize and double-click reset.
- Removed automatic graph focus/fit behavior from routine interactions; kept explicit navigation controls and viewport restoration.
- Added real named workspaces with independent SQLite stores, notes, layout, settings, cache and source evidence.
- Added fresh OpenAlex retrieval on relationship-list opening, immediate cached display, clear source freshness/coverage and offline fallback.
- Added persistent, independent OpenAlex/IEEE relationship observations, exact-identifier comparison, historical evidence, IEEE-only rows and cautious absence semantics.
- Added the optional Chrome/Edge Send to Yara extension, bibliographic preview, explicit IEEE direction capture and official BibTeX/RIS fallback.
- Added the Rust Native Messaging host, bounded validated messages, fixed sender allowlist, real workspace routing, transactions and idempotent receipts.
- Added schema 2 migration and backup format 2; preserved format 1 restoration, existing research fields and previous source evidence.
- Packaged the host, manifest and unpacked extension with per-user installer registration; retained the version 1.0 release.

See `VALIDATION-v1.1.md` for executed tests and the live IEEE / distribution acceptance limits.
