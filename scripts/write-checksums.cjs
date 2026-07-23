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
];
const missingArtifactNames = artifactNames.filter(
  (name) => !existsSync(join(releaseDirectory, name))
);

if (missingArtifactNames.length > 0) {
  throw new Error(
    `Missing required release artifacts:\n${missingArtifactNames
      .map((name) => `- ${name}`)
      .join("\n")}`
  );
}

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
