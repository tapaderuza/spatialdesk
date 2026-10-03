// cdk.json entry point: runs the Kotlin CDK app through the repo's Gradle wrapper on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Absolute path: cmd.exe skips the current directory when NoDefaultCurrentDirectoryInExePath is set.
const wrapper = path.join(root, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const result = spawnSync(process.platform === "win32" ? `"${wrapper}"` : wrapper, ["-q", "--console=plain", ":infra:run"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
