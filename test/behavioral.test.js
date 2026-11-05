"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { verify, verifySmoke, verifyMutationProbe } = require("../lib/verify");

const DIST_DIR = path.resolve(__dirname, "../../bench/libs/dist");

describe("behavioral checks — smoke digests and post-init mutation probes", () => {
  it("matches bench smoke digests in VM and fresh Node on real corpus libraries", () => {
    for (const specId of ["crc-32", "underscore", "chroma-js", "yaml-router-app"]) {
      const src = fs.readFileSync(path.join(DIST_DIR, `${specId}.js`), "utf8");
      const res = verifySmoke(src, src, { specId, checkFreshNode: true });
      assert.equal(res.ok, true, `${specId} failed smoke check: ${res.firstDiff}`);
      assert.equal(res.origDigest.length, 64);
      assert.equal(res.origDigest, res.outDigest);
    }
  });

  it("detects smoke digest mismatch when runtime output subtly diverges", () => {
    const src = fs.readFileSync(path.join(DIST_DIR, "crc-32.js"), "utf8");
    const broken = src + "\n;globalThis.CRC32.version = '0.0.0-broken';\n";
    const res = verifySmoke(src, broken, { specId: "crc-32" });
    assert.equal(res.ok, false);
    assert.equal(res.firstDiff.kind, "smoke-digest");
  });

  it("catches lost closure sharing via post-init mutation probe (return values + mutated heap)", () => {
    const orig = `
      globalThis.acct = (function() {
        let balance = 100;
        let txCount = 0;
        return {
          deposit: function deposit(n) { txCount++; balance += (n || 10); return balance; },
          withdraw: function withdraw(n) { txCount++; balance -= (n || 5); return balance; },
          read: function read() { return { balance, txCount }; },
        };
      })();
    `;
    const brokenSharing = `
      globalThis.acct = {
        deposit: (function() { let balance = 100, txCount = 0; return function deposit(n) { txCount++; balance += (n || 10); return balance; }; })(),
        withdraw: (function() { let balance = 100, txCount = 0; return function withdraw(n) { txCount++; balance -= (n || 5); return balance; }; })(),
        read: (function() { let balance = 100, txCount = 0; return function read() { return { balance, txCount }; }; })(),
      };
    `;
    const probeRes = verifyMutationProbe(orig, brokenSharing);
    assert.equal(probeRes.ok, false);
    assert.ok(probeRes.callsRun >= 3);
    assert.match(probeRes.firstDiff.path, /acct\.(withdraw|deposit|read)/);
  });

  it("supports integrated verify() with smoke + explicit post-init mutation probes", () => {
    const orig = `
      (function() {
        const cache = new Map();
        globalThis.memoSquare = function(n) {
          if (!cache.has(n)) cache.set(n, n * n);
          return cache.get(n);
        };
      })();
    `;
    const out = `
      (function() {
        const cache = new Map();
        globalThis.memoSquare = function(n) {
          if (!cache.has(n)) cache.set(n, n * n);
          return cache.get(n);
        };
      })();
    `;
    const res = verify(orig, out, {
      probes: ["globalThis.memoSquare(4)", "globalThis.memoSquare(9)", "globalThis.memoSquare(4)"],
    });
    assert.equal(res.ok, true, `unexpected diff: ${res.firstDiff}`);
    assert.equal(res.stats.mutationProbesRun, 3);
  });
});
