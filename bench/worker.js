"use strict";

const fs = require("fs");
const vm = require("vm");
const childProcess = require("child_process");
const {
  LAZY_RUNTIME_NAME,
  makeSandbox,
  buildVmRunnerSource,
  wrapWithLazyObjectsRuntime,
  runInVm,
  runInFreshNode,
} = require("./harness");

const OPTION_PROFILES = [
  {
    name: "default",
    cliFlags: "(defaults: --compatibility browser)",
    eligibleForNodePerf: true,
    options: {},
  },
  {
    name: "browser-opt",
    cliFlags: "--compatibility browser --delayInitializations --inlineExpressions",
    eligibleForNodePerf: true,
    options: {
      compatibility: "browser",
      delayInitializations: true,
      inlineExpressions: true,
    },
  },
  {
    name: "browser-seed",
    cliFlags: "--compatibility browser --mathRandomSeed 0 --delayInitializations --inlineExpressions",
    eligibleForNodePerf: true,
    options: {
      compatibility: "browser",
      mathRandomSeed: "0",
      delayInitializations: true,
      inlineExpressions: true,
    },
  },
  {
    name: "jsc",
    cliFlags: "--compatibility jsc-600-1-4-17 --mathRandomSeed 0",
    eligibleForNodePerf: true,
    options: {
      compatibility: "jsc-600-1-4-17",
      mathRandomSeed: "0",
    },
  },
  {
    name: "node-react",
    cliFlags: "--compatibility node-react --reactEnabled --mathRandomSeed 0 --delayInitializations --inlineExpressions",
    eligibleForNodePerf: true,
    options: {
      compatibility: "node-react",
      reactEnabled: true,
      mathRandomSeed: "0",
      delayInitializations: true,
      inlineExpressions: true,
    },
  },
  {
    name: "lazy-objects",
    cliFlags: `--compatibility browser --mathRandomSeed 0 --lazyObjectsRuntime ${LAZY_RUNTIME_NAME}`,
    eligibleForNodePerf: false,
    lazyRuntime: LAZY_RUNTIME_NAME,
    options: {
      compatibility: "browser",
      mathRandomSeed: "0",
      lazyObjectsRuntime: LAZY_RUNTIME_NAME,
    },
  },
];

function extractSourceExcerpt(code, loc) {
  if (!loc || !loc.start || typeof loc.start.line !== "number") return null;
  const lines = code.split("\n");
  const idx = loc.start.line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const rawLine = lines[idx];
  const col = typeof loc.start.column === "number" ? loc.start.column : 0;
  const start = Math.max(0, col - 50);
  const end = Math.min(rawLine.length, col + 90);
  const snippet = (start > 0 ? "..." : "") + rawLine.slice(start, end).trim() + (end < rawLine.length ? "..." : "");
  return {
    line: loc.start.line,
    column: col + 1,
    snippet,
  };
}

function extractInternalFrame(stack) {
  if (!stack) return null;
  const lines = String(stack).split("\n").slice(1);
  for (const l of lines) {
    const trimmed = l.trim();
    if (trimmed.includes("/lib/") || trimmed.includes("/src/")) {
      const m = trimmed.match(/at\s+(.+?)\s+\(.*?\/((?:lib|src)\/[^)]+)\)/) || trimmed.match(/\/((?:lib|src)\/\S+)/);
      if (m) return m[2] ? `${m[1]} (${m[2]})` : m[1];
    }
  }
  return lines[0] ? lines[0].trim() : null;
}

function quickVmScoreMs(execCode, smokeCode) {
  const src = buildVmRunnerSource(execCode, smokeCode);
  const script = new vm.Script(src);
  // 1 warmup + median of 3 quick runs
  script.runInNewContext(makeSandbox(), { timeout: 60000 });
  const times = [];
  for (let i = 0; i < 3; i++) {
    const ctx = vm.createContext(makeSandbox());
    const t0 = process.hrtime.bigint();
    script.runInContext(ctx, { timeout: 60000 });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[1];
}

function readSelfPeakRssMb(memBefore, memAfter) {
  if (typeof process.resourceUsage === "function") {
    const ru = process.resourceUsage();
    if (ru && typeof ru.maxRSS === "number" && ru.maxRSS > 0) {
      const mb = process.platform === "darwin" ? ru.maxRSS / (1024 * 1024) : ru.maxRSS / 1024;
      return Math.round(mb * 10) / 10;
    }
  }
  return Math.round((Math.max(memBefore.rss, memAfter.rss) / (1024 * 1024)) * 10) / 10;
}

function readLinuxPidPeakRssMb(pid) {
  if (!pid || process.platform !== "linux") return null;
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const hwm = status.match(/^VmHWM:\s+(\d+)\s+kB/m);
    const rss = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    const kb = hwm ? parseInt(hwm[1], 10) : rss ? parseInt(rss[1], 10) : 0;
    return kb > 0 ? Math.round((kb / 1024) * 10) / 10 : null;
  } catch (_e) {
    return null;
  }
}

function executeProfileInProcess(task) {
  const { id, smokeCode, expectedDigest, compilerPath, profile, tmpDir, outCodeFile } = task;
  const code = task.codeFile ? fs.readFileSync(task.codeFile, "utf8") : task.code;
  const smokeTimeoutMs = task.smokeTimeoutMs || 120000;
  const compiler = require(compilerPath);
  const diagnostics = [];
  const options = Object.assign(
    {
      serialize: true,
      timeout: task.timeoutMs || 900000,
      errorHandler(diag) {
        diagnostics.push({
          severity: diag.severity,
          errorCode: diag.errorCode,
          message: diag.message,
          location: extractSourceExcerpt(code, diag.location),
        });
        return diag.severity === "FatalError" ? "Fail" : "Recover";
      },
    },
    profile.options
  );

  // Silence the compiler's direct console chatter inside the worker while running
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;
  const origLog = console.log;
  let capturedStderr = "";
  const capture = (...args) => {
    capturedStderr += args.join(" ") + "\n";
    if (capturedStderr.length > 8000) capturedStderr = capturedStderr.slice(-8000);
  };
  console.warn = capture;
  console.error = capture;
  console.info = capture;
  console.log = capture;

  const memBefore = process.memoryUsage();
  let serialized;
  let thrownError = null;
  const t0 = Date.now();
  try {
    serialized = compiler.prepackSources([{ filePath: `${id}.js`, fileContents: code, sourceMapContents: "" }], options);
  } catch (e) {
    thrownError = e;
  } finally {
    console.warn = origWarn;
    console.error = origError;
    console.info = origInfo;
    console.log = origLog;
  }
  const compileMs = Date.now() - t0;
  const memAfter = process.memoryUsage();
  const peakRssMb = readSelfPeakRssMb(memBefore, memAfter);
  const heapUsedMb = Math.round((memAfter.heapUsed / (1024 * 1024)) * 10) / 10;

  const fatalOrRecoverable = diagnostics.filter(
    d => d.severity === "FatalError" || d.severity === "RecoverableError"
  );
  const warnings = diagnostics.filter(d => d.severity === "Warning");
  const infos = diagnostics.filter(d => d.severity === "Information");

  if (thrownError || fatalOrRecoverable.length > 0 || !serialized || typeof serialized.code !== "string") {
    const isTimedOut =
      thrownError &&
      (thrownError.name === "TimedOut" ||
        thrownError.code === "ETIMEDOUT" ||
        String(thrownError.message || "").includes("exceeded the timeout time"));
    if (isTimedOut) {
      return {
        profile: profile.name,
        cliFlags: profile.cliFlags,
        eligibleForNodePerf: profile.eligibleForNodePerf,
        status: "TIMEOUT",
        compileMs,
        peakRssMb,
        heapUsedMb,
        errorCode: "TIMEOUT",
        message: String(thrownError.message || "Compiler timed out"),
        location: null,
      };
    }
    const primary = fatalOrRecoverable[0] || null;
    const isInvariant =
      thrownError &&
      (String(thrownError.name).includes("Invariant") || String(thrownError.message).includes("Invariant Violation"));
    const errorCode = primary
      ? primary.errorCode
      : isInvariant
        ? "INVARIANT"
        : thrownError && thrownError.constructor && thrownError.constructor.name === "FatalError"
          ? "UNDIAGNOSED_FATAL"
          : "INTERNAL_ERROR";
    const message = primary
      ? primary.message
      : thrownError
        ? String(thrownError.message || thrownError).split("\n")[0]
        : "Unknown compiler failure";
    return {
      profile: profile.name,
      cliFlags: profile.cliFlags,
      eligibleForNodePerf: profile.eligibleForNodePerf,
      status: "FAIL",
      compileMs,
      peakRssMb,
      heapUsedMb,
      errorCode,
      message,
      location: primary ? primary.location : null,
      internalFrame: thrownError ? extractInternalFrame(thrownError.stack) : null,
      diagnosticsCount: diagnostics.length,
      errorCodes: [...new Set(fatalOrRecoverable.map(d => d.errorCode))],
      warningCodes: [...new Set(warnings.map(d => d.errorCode))],
      diagnostics: diagnostics.slice(0, 8),
    };
  }

  const outBytes = Buffer.byteLength(serialized.code, "utf8");
  const runtimeCode = profile.lazyRuntime
    ? wrapWithLazyObjectsRuntime(serialized.code, profile.lazyRuntime)
    : serialized.code;

  const vmCheck = runInVm(runtimeCode, smokeCode, smokeTimeoutMs);
  const nodeCheck = runInFreshNode(runtimeCode, smokeCode, tmpDir, `${id}-${profile.name}`, smokeTimeoutMs);

  const vmMatches = vmCheck.ok && vmCheck.digest === expectedDigest;
  const nodeMatches = nodeCheck.ok && nodeCheck.digest === expectedDigest;

  if (!vmMatches || !nodeMatches) {
    const reason = !vmCheck.ok
      ? `VM runtime threw: ${vmCheck.error}`
      : !nodeCheck.ok
        ? `Node runtime threw: ${nodeCheck.error}`
        : !vmMatches
          ? `VM digest mismatch (got ${vmCheck.digest.slice(0, 12)}, expected ${expectedDigest.slice(0, 12)})`
          : `Node digest mismatch (got ${nodeCheck.digest.slice(0, 12)}, expected ${expectedDigest.slice(0, 12)})`;
    return {
      profile: profile.name,
      cliFlags: profile.cliFlags,
      eligibleForNodePerf: profile.eligibleForNodePerf,
      status: "WRONG",
      compileMs,
      peakRssMb,
      heapUsedMb,
      outBytes,
      errorCode: warnings[0] ? warnings[0].errorCode : "SILENT_MISCOMPILE",
      message: reason,
      location: warnings[0] ? warnings[0].location : null,
      warningCodes: [...new Set(warnings.map(d => d.errorCode))],
      diagnostics: diagnostics.slice(0, 8),
      vmResult: vmCheck.ok ? vmCheck.json.slice(0, 200) : vmCheck.error,
      nodeResult: nodeCheck.ok ? nodeCheck.json.slice(0, 200) : nodeCheck.error,
    };
  }

  if (outCodeFile) {
    fs.writeFileSync(outCodeFile, serialized.code, "utf8");
  }

  let quickVmMs = null;
  if (profile.eligibleForNodePerf) {
    try {
      quickVmMs = Math.round(quickVmScoreMs(serialized.code, smokeCode) * 1000) / 1000;
    } catch (_e) {}
  }

  return {
    profile: profile.name,
    cliFlags: profile.cliFlags,
    eligibleForNodePerf: profile.eligibleForNodePerf,
    status: "OK",
    compileMs,
    peakRssMb,
    heapUsedMb,
    outBytes,
    quickVmMs,
    outCodeFile: outCodeFile || null,
    warningCodes: [...new Set(warnings.map(d => d.errorCode))],
    infoCodes: [...new Set(infos.map(d => d.errorCode))],
  };
}

function runProfileInChild(task, opts = {}) {
  const timeoutMs = opts.timeoutMs || 900000;
  const maxOldSpaceMb = opts.maxOldSpaceMb || 16384;
  const childTask = Object.assign({ timeoutMs }, task);
  const existingNodeOpts = process.env.NODE_OPTIONS || "";
  const childNodeOpts = existingNodeOpts.includes("max-old-space-size")
    ? existingNodeOpts
    : `${existingNodeOpts} --max-old-space-size=${maxOldSpaceMb}`.trim();
  return new Promise(resolve => {
    const child = childProcess.fork(__filename, ["--child"], {
      env: Object.assign({}, process.env, {
        TZ: "UTC",
        LANG: "C",
        LC_ALL: "C",
        NODE_OPTIONS: childNodeOpts,
      }),
      execArgv: ["--stack-size=10000", `--max-old-space-size=${maxOldSpaceMb}`],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    let observedPeakRssMb = null;
    const sampleRss = () => {
      const mb = readLinuxPidPeakRssMb(child.pid);
      if (mb !== null && (observedPeakRssMb === null || mb > observedPeakRssMb)) {
        observedPeakRssMb = mb;
      }
    };
    const rssPoll = setInterval(sampleRss, 500);
    if (typeof rssPoll.unref === "function") rssPoll.unref();

    child.stderr.on("data", chunk => {
      stderr += chunk;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    let finished = false;
    const t0 = Date.now();
    const done = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(rssPoll);
      sampleRss();
      if (observedPeakRssMb !== null) {
        result.peakRssMb =
          typeof result.peakRssMb === "number" ? Math.max(result.peakRssMb, observedPeakRssMb) : observedPeakRssMb;
      }
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
      resolve(result);
    };
    const timer = setTimeout(() => {
      sampleRss();
      done({
        profile: task.profile.name,
        cliFlags: task.profile.cliFlags,
        eligibleForNodePerf: task.profile.eligibleForNodePerf,
        status: "TIMEOUT",
        compileMs: Date.now() - t0,
        peakRssMb: observedPeakRssMb,
        errorCode: "TIMEOUT",
        message: `Compiler timed out after ${timeoutMs}ms`,
        location: null,
      });
    }, timeoutMs + 5000);
    child.on("message", msg => done(msg));
    child.on("exit", (code, signal) => {
      const tail = stderr.trim().split("\n").slice(-2).join(" | ");
      done({
        profile: task.profile.name,
        cliFlags: task.profile.cliFlags,
        eligibleForNodePerf: task.profile.eligibleForNodePerf,
        status: "FAIL",
        compileMs: Date.now() - t0,
        peakRssMb: observedPeakRssMb,
        errorCode: tail.includes("JavaScript heap out of memory") ? "OOM" : "WORKER_CRASH",
        message: `Worker exited (${code || signal})${tail ? `: ${tail}` : ""}`,
        location: null,
      });
    });
    child.send(childTask);
  });
}

if (require.main === module && process.argv[2] === "--child") {
  process.on("message", task => {
    let result;
    try {
      result = executeProfileInProcess(task);
    } catch (e) {
      result = {
        profile: task.profile.name,
        cliFlags: task.profile.cliFlags,
        eligibleForNodePerf: task.profile.eligibleForNodePerf,
        status: "FAIL",
        compileMs: 0,
        peakRssMb: null,
        errorCode: "HARNESS_ERROR",
        message: e && e.stack ? e.stack.split("\n")[0] : String(e),
        location: null,
      };
    }
    process.send(result, () => process.exit(0));
  });
}

module.exports = {
  OPTION_PROFILES,
  runProfileInChild,
};
