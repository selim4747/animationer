import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectRoot = new URL('../', import.meta.url);
const [html, packageJson, lockfile] = await Promise.all([
  readFile(new URL('index.html', projectRoot), 'utf8'),
  readFile(new URL('package.json', projectRoot), 'utf8').then(JSON.parse),
  readFile(new URL('package-lock.json', projectRoot), 'utf8').then(JSON.parse),
]);

test('the Vite HTML document loads the application module', () => {
  assert.match(html, /<script\s+type="module"\s+src="\/src\/main\.js"><\/script>/);
});

test('package-lock root metadata and direct dependencies match package.json', () => {
  const root = lockfile.packages?.[''];
  assert.ok(root, 'package-lock root package entry exists');
  assert.equal(lockfile.name, packageJson.name);
  assert.equal(root.name, packageJson.name);
  assert.equal(root.version, packageJson.version);

  for (const dependencyType of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.deepEqual(
      root[dependencyType] || {},
      packageJson[dependencyType] || {},
      `${dependencyType} in package-lock must match package.json`
    );
  }
});
