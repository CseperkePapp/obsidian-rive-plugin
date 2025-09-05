import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

function incPatch(v){
  const parts = v.split('.').map(Number);
  if (parts.some(isNaN)) return v + '.1';
  if (parts.length === 2) { // two-part version like 1.11
    parts[1] += 1; return parts.join('.');
  }
  if (parts.length === 3) {
    // If middle already > 9 and patch is 0, allow collapsing to two-part scheme on next manual edit; else normal patch bump
    parts[2] += 1; return parts.join('.');
  }
  return v + '.1';
}

const pkgPath = path.resolve('package.json');
const manifestPath = path.resolve('manifest.json');
const versionsPath = path.resolve('versions.json');

const pkg = JSON.parse(readFileSync(pkgPath,'utf8'));
const oldVersion = pkg.version;
const newVersion = incPatch(oldVersion);
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, '\t'));

// Manifest sync
const manifest = JSON.parse(readFileSync(manifestPath,'utf8'));
manifest.version = newVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));

// versions.json update (preserve existing)
try {
  const versions = JSON.parse(readFileSync(versionsPath,'utf8'));
  if (!versions[newVersion]) versions[newVersion] = manifest.minAppVersion || '0.15.0';
  writeFileSync(versionsPath, JSON.stringify(versions, null, '\t'));
} catch {}

console.log(`[auto-version] ${oldVersion} -> ${newVersion}`);
