# Send to Yara 1.1.1 — Chrome and Edge

The 1.1.1 metadata repair reads the bibliographic JSON confirmed on live IEEE pages, preserves full abstracts, authors and dates, and adds keyword preview/display. Install the desktop update and reload the extension. [Repair details, test boundaries and instructions](IEEE-METADATA-FIX.md).

The extension is optional. OpenAlex stays Yara's default discovery provider. Nothing reads IEEE automatically, and the browser session's cookies or credentials are never transferred to Yara.

## Install and load

1. Install `release/Yara Research_1.1.1_x64-setup.exe` and open Yara once. Existing research is migrated in place; its initial workspace name is **My research**. Create additional named workspaces from the sidebar if needed.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge. Enable **Developer mode**, then choose **Load unpacked**.
3. Select the installed `browser-extension` folder. The default location is `%LOCALAPPDATA%\Yara Research\browser-extension`; use your chosen installation folder if different. Alternatively extract `release/Yara-browser-extension-1.1.1.zip` to a permanent location and select the extracted folder containing `manifest.json`.
4. Pin **Send to Yara** using the browser's Extensions menu. Its fixed ID is `nbdapgcnfoohpiimganaopljfmipmgam` in both browsers. Keep the supplied manifest key; changing the ID breaks the native-host allowlist.

The installer supplies `yara-native-host.exe` and `native-host.json` beside the desktop executable. It registers that manifest under the current Windows user's keys:

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\org.yara.research
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\org.yara.research
```

No administrator account is required. The host can save an explicit import while Yara's window is closed; the desktop app reads the same workspace when reopened. Loading the extension alone without installing the host shows a recoverable connection error. **Retry connection** lists the real databases again. Reinstall v1.1 if the installation folder was moved or host registration is missing. Uninstall removes only host registrations still owned by that installation; research remains under `%APPDATA%\org.yara.research`.

After updating an unpacked extension, choose **Reload** on its browser extensions page. This package is for local developer-mode loading, not a Chrome Web Store / Edge Add-ons publication.

## Import the current paper

Open a publisher article in your normal browser, click **Send to Yara**, and review the extracted title, authors, year and DOI. Choose the actual destination workspace, then **Confirm paper import**. The IEEE article ID is read-only and must agree with the IEEE article page URL. On other sites, bibliographic meta tags and JSON-LD are used where available and the result is labeled generic Web metadata. Review missing or ambiguous fields before confirming.

Exact DOI, OpenAlex or IEEE identifiers identify an existing saved paper. Re-import preserves its corrections, notes, status, tags, coordinates, visibility and pinning, while filling eligible missing metadata. A repeated identical delivery is safe. Title similarity alone never merges records.

## Capture IEEE relationships

1. In Yara, open **Find Referenced Papers** or **Find Citing Papers**, then **Check with IEEE**. This opens the known IEEE article, or an IEEE search when its ID is not yet known. You may also open the article directly in your browser.
2. Open the relevant article section and wait for its entries to load. Click **Send to Yara**, then **Capture loaded references** or **Capture loaded citing papers** explicitly.
3. Review the focal identity, direction, captured entries, known total and coverage. References mean focal → referenced paper; citing papers mean citing paper → focal.
4. Choose the intended workspace and **Confirm IEEE capture**. This saves evidence, not graph nodes. Yara updates its comparison from the local database. Select and add related papers deliberately in Yara when you want graph nodes.

The IEEE adapter first reads bibliographic metadata / JSON-LD and then recognized section entries. If the section cannot be recognized, it reports unknown coverage and keeps an empty preview. You can open **Use an official BibTeX / RIS export instead**, paste an official export of the current section, and review its entries. Export parsing does not establish completeness by itself. Do not paste an unrelated bibliography or the focal article's own citation as if it were its references.

Only explicitly declared single-page sections with matching totals are automatically marked complete. Otherwise choose Partial or Unknown. Mark Complete only after personally verifying that all entries across every page are present; an explicit confirmation and matching total are required. Selecting only a subset requires Partial or Unknown. The extension reads up to 200 recognized DOM entries in a capture and the host accepts bounded batches of at most 500 entries / 512 KiB. Split larger exports into partial captures. Historical observations remain available.

For v1.1.1, four live IEEE article pages were inspected in the in-app browser and their bibliographic JSON structure was confirmed. Complete metadata imports were verified through actual Chrome, the native host and desktop SQLite using a minimal sanitized snapshot of that structure. The isolated Chrome run could not obtain the metadata on the four live pages, so direct live-Chrome imports remain unverified. Live relationship-section capture is also a separate, unverified check. No verification barrier was bypassed. If a current relationship layout differs, use the official export fallback or keep coverage Unknown. See the [metadata repair report](IEEE-METADATA-FIX.md) for the exact boundaries.

## Understand the source badges

| State                    | Meaning                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAlex observed        | This particular focal/direction/related-paper relationship was returned by OpenAlex.                                                                            |
| IEEE observed            | This relationship was explicitly captured from the relevant IEEE article section.                                                                               |
| Reported by both sources | Exact identifiers match observations from both providers; agreement does not prove the paper's findings.                                                        |
| Observed earlier         | An older saved capture contains the relationship; the latest check may be partial, failed or different. The earlier observation is retained with its timestamp. |
| Not observed             | The relationship was absent from the latest **complete** source snapshot. This is limited to that source list and timestamp.                                    |
| Unknown                  | The source is unchecked, failed, partially loaded, or completeness has not been established. It says nothing about absence.                                     |

Paper metadata provenance is shown separately in the inspector. Importing IEEE bibliographic fields does not grant an IEEE relationship badge. IEEE-only relationships remain visible even when absent from OpenAlex's current page. Similar titles without exact identifiers remain separate, with a review suggestion. Missing titles must be supplied before adding a captured reference to the graph.

Each time a relationship list opens, Yara requests fresh OpenAlex data and displays its last successful cache immediately when available. Refreshing, fresh, stale-cache, failed and partial states are visible. Opening the list never contacts IEEE. Incomplete or failed recaptures preserve earlier source evidence. Backup format 2 includes this evidence; old format 1 backups remain supported.

## Privacy and boundaries

The only browser permissions are activeTab, scripting and nativeMessaging. There are no broad host permissions, background crawlers, cookie access, cloud relay or private IEEE endpoint calls. Page text, imported HTML and scripts are never executed as research content. The native host restricts the sender origin, validates the message and actual workspace identity, and rejects inconsistent IEEE source context. These checks establish captured source context, not cryptographic proof of what IEEE reported.

For developer builds, run `pwsh -File scripts/native.ps1 build`; it builds the extension, release Rust host, desktop app and installer together. Extension source is in `extension/`, protocol handling in `src-tauri/src/bridge.rs`, and the reproducible actual-browser integration harness in `scripts/extension-native-smoke.mjs`. The test harness uses separate profiles and data, temporarily registers its own host manifest and restores prior registry values. It never loads the extension into your normal browser profile.

References: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging), [Chrome extension end-to-end testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing), [DevTools extension test interface](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/).
