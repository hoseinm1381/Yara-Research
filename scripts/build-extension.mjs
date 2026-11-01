import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--config",
    "extension/vite.config.ts",
  ],
  { stdio: "inherit", cwd: root },
);
if (result.status !== 0) process.exit(result.status || 1);
const id = fs.readFileSync("extension/extension-id.txt", "utf8").trim();
const key = fs.readFileSync("extension/public-key.txt", "utf8").trim();
const manifest = {
  manifest_version: 3,
  name: "Send to Yara",
  version,
  description:
    "Explicit paper imports and IEEE relationship captures into your local Yara workspace.",
  key,
  permissions: ["activeTab", "scripting", "nativeMessaging"],
  action: { default_title: "Send to Yara", default_popup: "popup.html" },
  icons: { 32: "icon.png" },
};
fs.writeFileSync(
  ".tooling/extension-build/manifest.json",
  JSON.stringify(manifest, null, 2),
);
fs.copyFileSync(
  "src-tauri/icons/32x32.png",
  ".tooling/extension-build/icon.png",
);
const host = {
  name: "org.yara.research",
  description: "Yara Research local browser bridge",
  path: "yara-native-host.exe",
  type: "stdio",
  allowed_origins: [`chrome-extension://${id}/`],
};
fs.writeFileSync("extension/native-host.json", JSON.stringify(host, null, 2));
console.log(
  `Built Send to Yara ${version} · ${id}\nLoad unpacked from ${path.join(root, ".tooling", "extension-build")}`,
);
