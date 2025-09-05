import { readFileSync, writeFileSync } from 'fs';

function bumpAppendStyle(ver){
  const parts = ver.split('.');
  if (parts.length !== 3) return ver; // keep as-is if unexpected
  const patchStr = parts[2];
  let nextPatch;
  if (/^\d+$/.test(patchStr)) {
    if (patchStr.length === 1) {
      // first time adding build digit
      nextPatch = patchStr + '1';
    } else {
      const base = patchStr[0]; // assume single-digit base
      const buildPart = patchStr.slice(1);
      const buildNum = parseInt(buildPart, 10) + 1;
      nextPatch = base + buildNum.toString();
    }
  } else {
    // fallback to normal semantic patch +1 if non-numeric
    const n = parseInt(patchStr, 10);
    if (!isNaN(n)) nextPatch = String(n + 1); else nextPatch = patchStr;
  }
  parts[2] = nextPatch;
  return parts.join('.');
}

const pkg = JSON.parse(readFileSync('package.json','utf8'));
const manifest = JSON.parse(readFileSync('manifest.json','utf8'));
const versions = JSON.parse(readFileSync('versions.json','utf8'));

const oldVersion = pkg.version;
const newVersion = bumpAppendStyle(oldVersion);

pkg.version = newVersion;
manifest.version = newVersion;
if (!versions[newVersion]) versions[newVersion] = manifest.minAppVersion || '0.15.0';

writeFileSync('package.json', JSON.stringify(pkg, null, '\t'));
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));

console.log(`[append-build-version] ${oldVersion} -> ${newVersion}`);