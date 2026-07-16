import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const marketplacePath = resolve(root, ".agents/plugins/marketplace.json");
const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
const allowedInstallation = new Set([
  "NOT_AVAILABLE",
  "AVAILABLE",
  "INSTALLED_BY_DEFAULT",
]);
const allowedAuthentication = new Set(["ON_INSTALL", "ON_USE"]);
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

assert.match(marketplace.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
assert.equal(typeof marketplace.interface?.displayName, "string");
assert.ok(marketplace.interface.displayName.trim());
assert.ok(Array.isArray(marketplace.plugins));
assert.ok(marketplace.plugins.length > 0);

for (const entry of marketplace.plugins) {
  assert.match(entry.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(entry.source?.source, "local");
  assert.ok(entry.source.path.startsWith("./"));
  assert.ok(allowedInstallation.has(entry.policy?.installation));
  assert.ok(allowedAuthentication.has(entry.policy?.authentication));
  assert.ok(entry.category);

  const pluginRoot = resolve(root, entry.source.path);
  assert.ok(
    pluginRoot === root || pluginRoot.startsWith(root + sep),
    `${entry.name}: source.path escapes the marketplace root`
  );

  const manifestPath = resolve(pluginRoot, ".codex-plugin/plugin.json");
  assert.ok(existsSync(manifestPath), `${entry.name}: plugin.json is missing`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.name, entry.name);
  assert.match(manifest.version, semver);
  assert.ok(manifest.description);
  assert.ok(manifest.author?.name);
  assert.ok(manifest.interface?.displayName);
  assert.ok(manifest.interface?.shortDescription);
  assert.ok(manifest.interface?.longDescription);
  assert.ok(manifest.interface?.developerName);
  assert.ok(manifest.interface?.category);

  for (const relativePath of [
    manifest.skills,
    manifest.mcpServers,
    manifest.interface?.composerIcon,
    manifest.interface?.logo,
  ].filter(Boolean)) {
    assert.ok(relativePath.startsWith("./"));
    assert.ok(
      existsSync(resolve(pluginRoot, relativePath)),
      `${entry.name}: missing ${relativePath}`
    );
  }
}

console.log(
  `Marketplace ${marketplace.name} validated (${marketplace.plugins.length} plugin).`
);
