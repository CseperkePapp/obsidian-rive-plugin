import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

function incPatch(v){
  const parts = v.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return v + '.1';
  parts[2] += 1;
  return parts.join('.');
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
