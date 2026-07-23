import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

interface TerminationResult {
  ok: boolean;
  detail: string;
}

interface ProcessResult {
  error: Error | null;
  status: number | null;
  signal: string | null;
  timedOut: boolean;
  terminationDetails: string[];
}

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  exitCode: number | null;
  signalCode: string | null;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
}

interface SmokeRunner {
  addCleanupFailures(error: Error | null, failures: string[]): Error | null;
  cleanupSmokeArtifacts(
    paths: string[],
    remove?: (path: string, options: Record<string, unknown>) => void
  ): string[];
  runProcess(
    executable: string,
    args: string[],
    options: Record<string, unknown>,
    overrides: {
      spawnProcess: () => FakeChild;
      terminateTree: (pid: number) => TerminationResult;
      terminatePortable?: (pid: number) => string[];
      timeoutMs: number;
      wrapperCleanupGraceMs: number;
      forcedExitGraceMs: number;
      isPortable: boolean;
    }
  ): Promise<ProcessResult>;
}

const require = createRequire(import.meta.url);
const runner = require("../scripts/smoke-packaged.cjs") as SmokeRunner;

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => true);
  child.unref = vi.fn();
  return child;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("packaged smoke process runner", () => {
  it("lets a Portable wrapper close after terminating only its child tree", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const terminateTree = vi.fn(() => ({ ok: true, detail: "forced wrapper" }));
    const terminatePortable = vi.fn(() => {
      setTimeout(() => child.emit("close", 7, null), 1);
      return ["terminated Electron child tree"];
    });

    const resultPromise = runner.runProcess("Portable.exe", [], {}, {
      spawnProcess: () => child,
      terminateTree,
      terminatePortable,
      timeoutMs: 10,
      wrapperCleanupGraceMs: 20,
      forcedExitGraceMs: 20,
      isPortable: true
    });
    await vi.advanceTimersByTimeAsync(11);
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(result.status).toBe(7);
    expect(result.terminationDetails).toEqual(["terminated Electron child tree"]);
    expect(terminatePortable).toHaveBeenCalledWith(child.pid);
    expect(terminateTree).not.toHaveBeenCalled();
  });

  it("settles after a second deadline when forced termination cannot close", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    child.kill.mockReturnValue(false);
    const terminateTree = vi.fn(() => ({
      ok: false,
      detail: "taskkill failed"
    }));

    const resultPromise = runner.runProcess("unpacked.exe", [], {}, {
      spawnProcess: () => child,
      terminateTree,
      timeoutMs: 10,
      wrapperCleanupGraceMs: 20,
      forcedExitGraceMs: 20,
      isPortable: false
    });
    await vi.advanceTimersByTimeAsync(31);
    const result = await resultPromise;

    expect(result.timedOut).toBe(true);
    expect(result.error?.message).toContain("did not close after forced termination");
    expect(terminateTree).toHaveBeenCalledWith(child.pid);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.unref).toHaveBeenCalledOnce();
  });
});

describe("packaged smoke cleanup", () => {
  it("uses retrying recursive cleanup for every owned path", () => {
    const remove = vi.fn();
    expect(runner.cleanupSmokeArtifacts(["marker", "user-data"], remove)).toEqual([]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenNthCalledWith(1, "marker", {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  });

  it("keeps the original failure and appends cleanup diagnostics", () => {
    const original = new Error("renderer initialization failed");
    const result = runner.addCleanupFailures(original, ["user-data: EBUSY"]);

    expect(result).toBe(original);
    expect(result?.message).toContain("renderer initialization failed");
    expect(result?.message).toContain("cleanup also failed: user-data: EBUSY");
  });
});
