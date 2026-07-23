const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { version } = require("../package.json");

const DEFAULT_SMOKE_TIMEOUT_MS = 60_000;
const WRAPPER_CLEANUP_GRACE_MS = 5_000;
const FORCED_EXIT_GRACE_MS = 5_000;
const SYSTEM_COMMAND_TIMEOUT_MS = 5_000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const smokeTimeoutMs = positiveNumber(
  process.env.DAGOU_SMOKE_TIMEOUT_MS,
  DEFAULT_SMOKE_TIMEOUT_MS
);

function windowsSystemExecutable(...parts) {
  const windowsDirectory = process.env.SystemRoot || process.env.WINDIR;
  return windowsDirectory
    ? join(windowsDirectory, "System32", ...parts)
    : parts.at(-1);
}

function commandFailure(result) {
  if (result.error) return result.error.message;
  const stderr = String(result.stderr || "").trim();
  if (stderr) return stderr;
  return `exit status ${result.status ?? result.signal ?? "unknown"}`;
}

function terminateProcessTree(pid) {
  if (!pid || process.platform !== "win32") {
    return { ok: false, detail: "Windows process-tree termination is unavailable" };
  }
  const result = spawnSync(
    windowsSystemExecutable("taskkill.exe"),
    ["/PID", String(pid), "/T", "/F"],
    {
      encoding: "utf8",
      timeout: SYSTEM_COMMAND_TIMEOUT_MS,
      windowsHide: true
    }
  );
  return result.status === 0
    ? { ok: true, detail: `terminated process tree ${pid}` }
    : { ok: false, detail: `taskkill ${pid} failed: ${commandFailure(result)}` };
}

function directChildProcessIds(parentPid) {
  if (!parentPid || process.platform !== "win32") {
    return { pids: [], detail: "Windows process discovery is unavailable" };
  }
  const command =
    "$ErrorActionPreference='Stop'; " +
    `@(Get-CimInstance Win32_Process -Filter \"ParentProcessId = ${parentPid}\" | ` +
    "ForEach-Object { $_.ProcessId }) -join ','";
  const result = spawnSync(
    windowsSystemExecutable("WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      timeout: SYSTEM_COMMAND_TIMEOUT_MS,
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    return {
      pids: [],
      detail: `could not discover child processes: ${commandFailure(result)}`
    };
  }
  const pids = String(result.stdout || "")
    .trim()
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return {
    pids,
    detail: pids.length > 0
      ? `found Portable child processes ${pids.join(", ")}`
      : "Portable wrapper has no running child process"
  };
}

function terminatePortableChildren(wrapperPid) {
  const discovered = directChildProcessIds(wrapperPid);
  const details = [discovered.detail];
  for (const pid of discovered.pids) {
    details.push(terminateProcessTree(pid).detail);
  }
  return details;
}

function runProcess(executable, args, options, overrides = {}) {
  const spawnProcess = overrides.spawnProcess || spawn;
  const terminateTree = overrides.terminateTree || terminateProcessTree;
  const terminatePortable =
    overrides.terminatePortable || terminatePortableChildren;
  const timeoutMs = positiveNumber(overrides.timeoutMs, smokeTimeoutMs);
  const wrapperCleanupGraceMs = positiveNumber(
    overrides.wrapperCleanupGraceMs,
    WRAPPER_CLEANUP_GRACE_MS
  );
  const forcedExitGraceMs = positiveNumber(
    overrides.forcedExitGraceMs,
    FORCED_EXIT_GRACE_MS
  );
  const isPortable = overrides.isPortable === true;

  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawnProcess(executable, args, options);
    } catch (error) {
      resolveResult({
        error: error instanceof Error ? error : new Error(String(error)),
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        terminationDetails: []
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const terminationDetails = [];
    let timeoutId = null;
    let escalationId = null;
    let forcedExitId = null;

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (escalationId) clearTimeout(escalationId);
      if (forcedExitId) clearTimeout(forcedExitId);
      resolveResult({
        ...result,
        stdout,
        stderr,
        timedOut,
        terminationDetails
      });
    };

    const forceTerminate = () => {
      if (settled) return;
      const termination = terminateTree(child.pid);
      terminationDetails.push(termination.detail);
      if (!termination.ok) {
        try {
          const signalSent = child.kill("SIGKILL");
          terminationDetails.push(
            signalSent
              ? `sent fallback SIGKILL to process ${child.pid}`
              : `fallback SIGKILL was not delivered to process ${child.pid}`
          );
        } catch (error) {
          terminationDetails.push(
            `fallback SIGKILL failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
      forcedExitId = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref?.();
        finish({
          error: new Error(
            `${basename(executable)} did not close after forced termination`
          ),
          status: child.exitCode ?? null,
          signal: child.signalCode ?? null
        });
      }, forcedExitGraceMs);
    };

    timeoutId = setTimeout(() => {
      timedOut = true;
      if (isPortable) {
        terminationDetails.push(...terminatePortable(child.pid));
        // Leave the NSIS wrapper alive briefly so ExecWait can return and it can
        // remove only the temporary directories that belong to this invocation.
        escalationId = setTimeout(forceTerminate, wrapperCleanupGraceMs);
        return;
      }
      forceTerminate();
    }, timeoutMs);

    child.on("error", (error) => {
      finish({ error, status: null, signal: null });
    });
    child.on("close", (status, signal) => {
      finish({ error: null, status, signal });
    });
  });
}

function smokeStage(marker) {
  if (!existsSync(marker)) return "no marker written";
  try {
    return readFileSync(marker, "utf8");
  } catch (error) {
    return `unreadable marker: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function cleanupSmokeArtifacts(paths, remove = rmSync) {
  const failures = [];
  for (const path of paths) {
    try {
      remove(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      });
    } catch (error) {
      failures.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return failures;
}

function addCleanupFailures(error, failures) {
  if (failures.length === 0) return error;
  const detail = `cleanup also failed: ${failures.join("; ")}`;
  if (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    original.message = `${original.message}; ${detail}`;
    return original;
  }
  return new Error(detail);
}

function writeCapturedOutput(result) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function runSmoke(executable) {
  const marker = join(
    tmpdir(),
    `dagou-smoke-${process.pid}-${Math.random().toString(16).slice(2)}.json`
  );
  const userData = `${marker}.user-data`;
  let failure = null;

  try {
    mkdirSync(userData, { recursive: true });
    const result = await runProcess(executable, [
      "--smoke-test",
      "--disable-gpu",
      "--in-process-gpu",
      "--no-sandbox"
    ], {
      env: {
        ...process.env,
        DAGOU_SMOKE_RESULT: marker,
        DAGOU_SMOKE_USER_DATA: userData
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    }, {
      isPortable: basename(executable).includes("-Portable-")
    });

    if (result.timedOut) {
      writeCapturedOutput(result);
      const termination = result.terminationDetails.length > 0
        ? `; termination: ${result.terminationDetails.join("; ")}`
        : "";
      const forcedExit = result.error ? `; ${result.error.message}` : "";
      throw new Error(
        `${basename(executable)} timed out after ${smokeTimeoutMs}ms; ` +
        `last stage: ${smokeStage(marker)}${termination}${forcedExit}`
      );
    }
    if (result.error) {
      writeCapturedOutput(result);
      throw result.error;
    }
    if (result.status !== 0) {
      writeCapturedOutput(result);
      throw new Error(
        `${basename(executable)} exited with ${result.status ?? result.signal}; ` +
        `last stage: ${smokeStage(marker)}`
      );
    }
    if (!existsSync(marker)) {
      throw new Error(
        `${basename(executable)} exited before renderer/audio became ready`
      );
    }

    const status = JSON.parse(readFileSync(marker, "utf8"));
    if (
      !status.rendererReady ||
      !status.settingsReady ||
      !status.audioReady ||
      !status.keyStateReady
    ) {
      throw new Error(
        `${basename(executable)} reported an incomplete ready state: ` +
        `${status.error || JSON.stringify(status)}`
      );
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  failure = addCleanupFailures(
    failure,
    cleanupSmokeArtifacts([marker, userData])
  );
  if (failure) throw failure;

  process.stdout.write(
    `${basename(executable)} renderer, settings, audio and key-state probe are ready\n`
  );
}

function packagedExecutables(releaseDirectory) {
  return [
    join(releaseDirectory, "win-unpacked", "大狗桌宠.exe"),
    join(releaseDirectory, `Dagou-Desktop-Pet-Portable-${version}-x64.exe`)
  ].filter(existsSync);
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Packaged smoke tests currently support Windows artifacts only");
  }
  const releaseDirectory = process.argv[2]
    ? resolve(process.argv[2])
    : join(__dirname, "..", "release");
  const executables = packagedExecutables(releaseDirectory);
  if (executables.length === 0) {
    throw new Error("No packaged executable found; run npm run pack or dist:win first");
  }
  for (const executable of executables) await runSmoke(executable);
}

module.exports = {
  addCleanupFailures,
  cleanupSmokeArtifacts,
  runProcess
};

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
