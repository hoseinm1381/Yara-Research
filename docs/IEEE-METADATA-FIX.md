# IEEE metadata repair — Yara Research 1.1.1

## Confirmed root cause

The v1.1.0 extractor examined selected citation meta tags and JSON-LD. Live IEEE article pages inspected in the in-app browser expose their bibliographic record as a literal JSON object assigned to `xplGlobal.document.metadata` in an inline script. The older extractor never read that object. On the inspected 1998 article, social tags exposed the title, while authors, DOI, year, venue and publisher were in the ignored bibliographic JSON. The generic Description tag was a shortened preview even though a full abstract existed elsewhere.

Separate code defects compounded this gap: publicationDate and keywords were absent from the capture shape; empty citation tags overwrote JSON-LD venue/publisher fallbacks; there was no bounded retry for delayed metadata; duplicate enrichment did not fill keywords; and the inspector did not render keywords. The native message protocol and complete-paper SQLite serialization already supported the core fields and were not responsible for dropping authors/DOI/abstract on new imports.

## Targeted changes

- Parse only the balanced literal JSON object for the observed IEEE assignment, with JSON.parse. Never evaluate surrounding JavaScript, read private endpoints, copy cookies, or require MAIN-world injection.
- Keep citation metadata, article JSON-LD and verified article elements as fallbacks. Collect ordered authors from the authors array or author links, not affiliations or ORCID links. Retain full abstracts instead of description previews.
- Normalize Unicode/entities/whitespace, DOI URLs, dates, author lists and keyword groups. Preserve abstract paragraphs. Never synthesize a missing date, abstract or author.
- Preserve the bibliographic publication date/year together. For example, article 10818533 has a March 2025 issue date and a 30 December 2024 online date; the issue date is not replaced by the earlier online date. Other observed bibliographic details and date context remain in the source record.
- Explicitly map authors, DOI, year, publicationDate, journal, publisher, abstract, keywords and citationCount into the existing Paper model. Keep the protocol at version 1 and schema at version 2.
- Retry briefly for late metadata, stopping once a meaningful record is available. There is no continuous observer. Reject stale article/canonical identities, clear failed previews, and recheck the active article immediately before import.
- Show editable venue/publisher/date/keywords and a collapsible abstract preview. Label partial extraction honestly, allow intentional title-only imports, and report messaging failures/timeouts without confirming success.
- Fill missing keywords on duplicate imports and preserve existing metadata/citation-count corrections. Render keywords/index terms in the desktop Publication record. Preserve notes, status, tags, coordinates, pinning, visibility and existing connections.

There are no new production dependencies, permissions, external metadata calls or database migrations. Page JSON is filtered to bibliography; userInfo, account tokens, purchase data and full scripts are not retained. Development diagnostics contain source names, field names and timing, not abstract bodies or account settings.

## Validation and its limits

| Verification                                  | Result                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Strict TypeScript and ESLint                  | Passed                                                                                                                               |
| Frontend tests                                | 59 passed, including 13 targeted metadata/mapping/retry/error regression tests                                                       |
| Rust SQLite/filesystem/provider tests         | 48 passed, including complete bridge persistence, restart, title-only enrichment and preservation of corrections/notes/layout/edges  |
| Existing frontend workflows                   | 16 passed                                                                                                                            |
| Actual Chrome/Edge native integration         | 21 checks passed: 17 relationship/workspace regressions plus four complete-metadata / inspector / preservation / title-only checks   |
| Live IEEE source inspection                   | Four real article pages accessible and inspected in the in-app browser; observed bibliography and DOM structures informed the repair |
| Direct live IEEE → Chrome extension → desktop | Unverified: the isolated Chrome run did not obtain the metadata object on those four pages; no barrier was bypassed                  |

The native fixture check uses the actual compiled extension, its actual scripting and nativeMessaging APIs, the real Rust host, an isolated desktop workspace and direct read-only SQLite verification. It checks known values, not just nonempty strings. The saved fixture is a minimal sanitized snapshot of observed IEEE structure with a shortened abstract and keyword lists; it is not labeled as a live Chrome import. Screenshots were visually inspected. Registry registrations used by the test were restored.

Live pages inspected independently:

| IEEE ID                                                   | Type / year      | Confirmed bibliography                                                                                                                |
| --------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [726791](https://ieeexplore.ieee.org/document/726791)     | Journal, 1998    | Four authors; DOI 10.1109/5.726791; Proceedings of the IEEE; November 1998; full abstract and keyword groups present                  |
| [9983528](https://ieeexplore.ieee.org/document/9983528)   | Journal, 2023    | Six authors; DOI 10.1109/TIM.2022.3227990; IEEE Transactions on Instrumentation and Measurement; issue year differs from online date  |
| [10818533](https://ieeexplore.ieee.org/document/10818533) | Journal, 2025    | Six authors; DOI 10.1109/TWC.2024.3520870; IEEE Transactions on Wireless Communications; March 2025 issue / December 2024 online date |
| [7780459](https://ieeexplore.ieee.org/document/7780459)   | Conference, 2016 | Four authors; DOI 10.1109/CVPR.2016.90; CVPR venue; conference date distinguished from date added to Xplore                           |

On these pages the core bibliography was present, so no fallback API requests were needed. This does not guarantee every IEEE document exposes every field. Missing values stay empty and are listed in the extraction warning. Live Chrome compatibility remains a separate acceptance check in the user's normal accessible session. Automated Chrome attempt details are in `evidence-v1.1.1/live-ieee-metadata.json`; native proof and exact binary hashes are in `evidence-v1.1.1/extension-native-smoke.json`.

## Install / reload

1. Install `release/Yara Research_1.1.1_x64-setup.exe`. The desktop update provides keyword enrichment/display and preservation of existing citation counts. No research database reset is required. The updated extension can send supported new-paper fields to the older v1.1 host, but install both for the complete repair.
2. If using the installed unpacked extension folder, open `chrome://extensions` or `edge://extensions` and click Reload on Send to Yara. The default folder remains `%LOCALAPPDATA%\Yara Research\browser-extension`.
3. If using the ZIP, extract `release/Yara-browser-extension-1.1.1.zip` to a permanent folder containing manifest.json. Reload that folder through Load unpacked. Keep the supplied manifest key so the extension ID remains `nbdapgcnfoohpiimganaopljfmipmgam`.
4. Refresh an already-open IEEE article tab. Open Send to Yara and choose Read paper metadata. Review authors, DOI, date, venue, publisher, abstract availability and keywords before confirming the actual destination workspace.
5. Re-import a previously title-only article to fill its empty fields. Existing corrections and research work are retained. Check the Paper Inspector's Abstract and Publication record; keyword/index terms now appear there.

Developer build: `npm run build:extension` writes `.tooling/extension-build/`. `pwsh -File scripts/native.ps1 build` builds the host, desktop, NSIS installer and extension ZIP together. The source changes are in `extension/capture.ts`, `extension/client.ts`, `extension/popup.tsx`, `src-tauri/src/database.rs` and `src/components/Inspector.tsx`. No background worker was added; the existing user-triggered MV3 action is retained.

The installer remains unsigned. Clean-machine installation/uninstallation and missing-WebView2 bootstrapping are still unverified distribution checks. Previous release installers and their checksums remain preserved.
