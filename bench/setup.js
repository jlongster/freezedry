"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { SPECS } = require("./libs/specs");
const { sha256, runInVm, runInFreshNode } = require("./harness");

const BENCH_DIR = __dirname;
const NM_DIR = path.join(BENCH_DIR, "node_modules");
const DIST_DIR = path.join(BENCH_DIR, "libs", "dist");
const MANIFEST_FILE = path.join(BENCH_DIR, "libs", "manifest.json");
const TMP_DIR = "/tmp/opencode/pp-bench-setup";

function needsInstall() {
  const benchPkg = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, "package.json"), "utf8"));
  const declared = Object.assign({}, benchPkg.dependencies, benchPkg.devDependencies);
  for (const [name, wanted] of Object.entries(declared)) {
    const installedPkgPath = path.join(NM_DIR, name, "package.json");
    if (!fs.existsSync(installedPkgPath)) return true;
    if (/^\d+\.\d+\.\d+/.test(wanted)) {
      const installed = JSON.parse(fs.readFileSync(installedPkgPath, "utf8"));
      if (installed.version !== wanted) return true;
    }
  }
  return false;
}

function ensureInstalled() {
  if (needsInstall()) {
    console.log("Installing bench dependencies inside bench/node_modules ...");
    const r = childProcess.spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: BENCH_DIR,
      stdio: "inherit",
    });
    if (r.status !== 0) {
      throw new Error("npm install inside bench/ failed");
    }
  }
}

function readPkgMeta(pkgName) {
  const pkgJsonPath = path.join(NM_DIR, pkgName, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  return {
    name: pkg.name,
    version: pkg.version,
    license: typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license),
    homepage: pkg.homepage || null,
  };
}

function buildCorpus() {
  ensureInstalled();
  const esbuild = require(path.join(NM_DIR, "esbuild"));
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const entries = [];
  for (const spec of SPECS) {
    const code = spec.build(NM_DIR, esbuild);
    const outFile = path.join(DIST_DIR, `${spec.id}.js`);
    fs.writeFileSync(outFile, code, "utf8");

    // Verify plain determinism across two fresh Node runs and two fresh VM runs.
    const vm1 = runInVm(code, spec.smokeCode, 60000);
    const vm2 = runInVm(code, spec.smokeCode, 60000);
    const node1 = runInFreshNode(code, spec.smokeCode, TMP_DIR, `${spec.id}-1`, 60000);
    const node2 = runInFreshNode(code, spec.smokeCode, TMP_DIR, `${spec.id}-2`, 60000);

    if (!vm1.ok || !vm2.ok || !node1.ok || !node2.ok) {
      throw new Error(
        `[${spec.id}] plain smoke test failed: vm1=${JSON.stringify(vm1)} node1=${JSON.stringify(node1)}`
      );
    }
    if (vm1.digest !== vm2.digest || node1.digest !== node2.digest || vm1.digest !== node1.digest) {
      throw new Error(
        `[${spec.id}] nondeterministic or mismatched digest!\nvm1=${vm1.json}\nvm2=${vm2.json}\nnode1=${node1.json}\nnode2=${node2.json}`
      );
    }

    const pkgMeta = spec.packages.map(readPkgMeta);
    const bytes = Buffer.byteLength(code, "utf8");
    const tier = spec.tier || (bytes >= 750 * 1024 ? "large" : "standard");
    entries.push({
      id: spec.id,
      name: spec.name,
      kind: spec.kind,
      tier,
      buildType: spec.buildType,
      description: spec.description,
      file: `libs/dist/${spec.id}.js`,
      bytes,
      sha256: sha256(code),
      expectedDigest: node1.digest,
      expectedPreview: node1.json.slice(0, 180),
      packages: pkgMeta,
    });
    const vers = pkgMeta.map(p => `${p.name}@${p.version} (${p.license})`).join(", ");
    console.log(
      `ok  ${spec.id.padEnd(18)} ${(bytes / 1024).toFixed(1).padStart(7)} KB  [${tier.padEnd(8)}]  digest=${node1.digest.slice(0, 12)}  [${vers}]`
    );
  }

  const manifest = {
    generatedBy: "bench/setup.js",
    count: entries.length,
    totalBytes: entries.reduce((s, e) => s + e.bytes, 0),
    libraries: entries,
  };
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log(
    `\nBuilt ${entries.length} real-world workloads (${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB total) -> bench/libs/manifest.json`
  );
  return manifest;
}

if (require.main === module) {
  buildCorpus();
}

module.exports = { buildCorpus, ensureInstalled };
