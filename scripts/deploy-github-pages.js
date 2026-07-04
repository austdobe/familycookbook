const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const publishDir = path.join(rootDir, "tmp", "gh-pages-publish");
const branch = process.env.PAGES_BRANCH || "gh-pages";
const remote = process.env.PAGES_REMOTE || "origin";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    stdio: options.stdio || "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed`,
        result.stdout && result.stdout.trim(),
        result.stderr && result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return result.stdout ? result.stdout.trim() : "";
}

function assertInsideRoot(targetPath) {
  const relative = path.relative(rootDir, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside repo: ${targetPath}`);
  }
}

function copyDist() {
  assertInsideRoot(publishDir);
  fs.rmSync(publishDir, { recursive: true, force: true });
  fs.mkdirSync(publishDir, { recursive: true });
  fs.cpSync(distDir, publishDir, { recursive: true });
  fs.writeFileSync(path.join(publishDir, ".nojekyll"), "");
  fs.writeFileSync(
    path.join(publishDir, "deploy-meta.json"),
    `${JSON.stringify({ deployedAt: new Date().toISOString() }, null, 2)}\n`
  );
}

function main() {
  console.log("Building GitHub Pages bundle...");
  run("npm.cmd", ["run", "build:pages"], { stdio: "inherit" });

  if (!fs.existsSync(distDir)) {
    throw new Error("dist/ was not created.");
  }

  console.log(`Preparing ${branch} publish folder...`);
  copyDist();

  run("git", ["init"], { cwd: publishDir });
  run("git", ["checkout", "-B", branch], { cwd: publishDir });
  const remoteUrl = run("git", ["remote", "get-url", remote], { cwd: rootDir });
  run("git", ["remote", "add", remote, remoteUrl], { cwd: publishDir });
  run("git", ["add", "."], { cwd: publishDir });

  const status = run("git", ["status", "--short"], { cwd: publishDir });
  if (!status) {
    console.log("No publish changes to deploy.");
    return;
  }

  run("git", ["commit", "-m", "Deploy Family Cookbook app"], { cwd: publishDir });
  console.log(`Pushing ${branch} to ${remote}...`);
  run("git", ["push", remote, `${branch}:${branch}`, "--force"], { cwd: publishDir, stdio: "inherit" });
  console.log("GitHub Pages deploy complete.");
}

try {
  main();
} catch (error) {
  console.error(`Deploy failed: ${error.message}`);
  process.exit(1);
}
