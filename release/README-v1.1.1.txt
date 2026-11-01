Yara Research 1.1.1 — IEEE metadata repair

Install Yara Research_1.1.1_x64-setup.exe. Your research data is preserved.

Then open chrome://extensions or edge://extensions and Reload Send to Yara.
If using the ZIP, extract Yara-browser-extension-1.1.1.zip to a permanent folder
and Load unpacked from the folder containing manifest.json.
The installed extension folder is normally:
%LOCALAPPDATA%\Yara Research\browser-extension

Refresh an already-open IEEE article tab, then Read paper metadata. Review
authors, DOI, year/date, venue, publisher, keywords and the collapsible abstract.
Choose the real destination workspace and confirm.

Re-import a previously title-only IEEE article to fill its missing fields.
Existing notes, corrections, status, tags, coordinates, pinning and connections
remain intact. Keywords/index terms are displayed in the Paper Inspector.

No new permissions, external services, production dependencies or database
migrations are required. The extension ID and native protocol are unchanged.
Both desktop and extension updates are included; install both for the full fix.

Full report: ../docs/IEEE-METADATA-FIX.md
Checksums: SHA256SUMS.txt

59 frontend tests, 48 Rust tests, 16 browser workflows and 21 actual Chrome/Edge
native integration checks passed. Four live IEEE pages were inspected in the
in-app browser. Direct live-Chrome imports remain unverified because that test
browser did not expose their metadata; source-inspection and fixture proof are
reported separately. No verification barrier was bypassed.

This installer is unsigned. Clean-machine install/uninstall and WebView2
bootstrap remain separate, unverified distribution checks.
