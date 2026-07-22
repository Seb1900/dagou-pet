const { createHash } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { version } = require("../package.json");

const releaseDirectory = join(__dirname, "..", "release");
const artifactNames = [
  `Dagou-Desktop-Pet-Setup-${version}-x64.exe`,
  `Dagou-Desktop-Pet-Setup-${version}-x64.exe.blockmap`,
  `Dagou-Desktop-Pet-Portable-${version}-x64.exe`,
  "latest.yml"
].filter((name) => existsSync(join(releaseDirectory, name)));
const lines = artifactNames.map((name) => {
  const digest = createHash("sha256")
    .update(readFileSync(join(releaseDirectory, name)))
    .digest("hex")
    .toUpperCase();
  return `${digest}  ${name}`;
});

writeFileSync(
  join(releaseDirectory, "SHA256SUMS.txt"),
  `${lines.join("\n")}\n`,
  "ascii"
);
