Yara Research 1.1.0 for Windows x64

Install Yara Research_1.1.0_x64-setup.exe. Existing research migrates in place.
SHA256SUMS.txt records the checksums. The v1.0 installer remains preserved.

New: compact workspace, Add Paper menu, collapsible sidebar, resizable inspector,
stable graph viewport, real named workspaces, independent relationship evidence,
and optional Chrome/Edge Send to Yara extension with a local Rust native host.

Optional extension:
1. Install and open Yara once.
2. Open chrome://extensions or edge://extensions and enable Developer mode.
3. Load unpacked from the installed browser-extension folder, normally:
   %LOCALAPPDATA%\Yara Research\browser-extension
   Or extract Yara-browser-extension-1.1.0.zip to a permanent folder and load it.
4. Open an article, click Send to Yara, review the metadata, choose the real
   destination workspace, and confirm. IEEE relationship captures are explicit.

The installer registers the local host for the current Windows user. No admin
account, Node.js, Rust, cloud account, or subscription is needed after installation.
WebView2 is required; the installer can download it if missing.

Full instructions: ../docs/EXTENSION.md
Validation and limitations: ../docs/VALIDATION-v1.1.md

Real Chrome/Edge-to-host-to-desktop communication was verified with saved fixtures.
Live IEEE extraction remains unverified because its page required verification;
no restriction was bypassed. An official BibTeX/RIS export fallback is provided.
Clean-machine installer/uninstaller and missing-WebView2 bootstrap remain untested.
This local installer is unsigned. Version 1.0 cannot open schema 2 databases;
returning to v1.0 requires a backup made with v1.0.
