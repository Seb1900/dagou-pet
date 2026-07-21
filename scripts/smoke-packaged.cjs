const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { version } = require("../package.json");

const releaseDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : join(__dirname, "..", "release");
const executables = [
  join(releaseDirectory, "win-unpacked", "Dagou Desktop Pet.exe"),
  join(releaseDirectory, `Dagou-Desktop-Pet-Portable-${version}-x64.exe`)
].filter(existsSync);

if (executables.length === 0) {
  throw new Error("No packaged executable found; run npm run pack or dist:win first");
}

for (const executable of executables) {
  const marker = join(
    tmpdir(),
    `dagou-smoke-${process.pid}-${Math.random().toString(16).slice(2)}.json`
  );
  const userData = `${marker}.user-data`;
  mkdirSync(userData, { recursive: true });
  const result = spawnSync(
    executable,
    [
      "--smoke-test",
      "--disable-gpu",
      "--in-process-gpu",
      "--no-sandbox"
    ],
    {
    encoding: "utf8",
    env: {
      ...process.env,
      DAGOU_SMOKE_RESULT: marker,
      DAGOU_SMOKE_USER_DATA: userData
    },
    timeout: 60_000,
      windowsHide: true
    }
  );

  if (result.error) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (existsSync(marker)) {
      process.stderr.write(`Smoke stage: ${readFileSync(marker, "utf8")}\n`);
    }
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Packaged smoke test failed\n");
    process.exit(result.status ?? 1);
  }
  if (!existsSync(marker)) {
    process.stderr.write(`${basename(executable)} exited before renderer/audio became ready\n`);
    process.exit(1);
  }

  const status = JSON.parse(readFileSync(marker, "utf8"));
  unlinkSync(marker);
  rmSync(userData, { recursive: true, force: true });
  if (!status.rendererReady || !status.settingsReady || !status.audioReady) {
    process.stderr.write(
      `${basename(executable)} reported an incomplete ready state: ` +
        `${status.error || "unknown error"}\n`
    );
    process.exit(1);
  }
  process.stdout.write(
    `${basename(executable)} renderer, settings and audio are ready\n`
  );
}
