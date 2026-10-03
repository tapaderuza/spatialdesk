// Builds the KMP :shared module for JS and vendors it into vendor/spatialdesk-shared (committed), so the WebXR
// app builds anywhere without a JDK while the protocol stays single-sourced in Kotlin.
//   npm run shared:sync
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const server = join(process.cwd(), 'server');
// Absolute path: cmd.exe skips the current directory when NoDefaultCurrentDirectoryInExePath is set.
const gradle = `"${join(server, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`;
execSync(`${gradle} --console=plain -q :shared:jsBrowserProductionLibraryDistribution`, { cwd: server, stdio: 'inherit', shell: true });

const out = join(server, 'shared/build/dist/js/productionLibrary');
const vendor = join(process.cwd(), 'vendor/spatialdesk-shared');
if (!existsSync(out)) throw new Error(`missing ${out}`);
rmSync(vendor, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
cpSync(out, vendor, { recursive: true, filter: (src) => !src.endsWith('.map') });
console.log(`vendored ${out} -> ${vendor}`);
