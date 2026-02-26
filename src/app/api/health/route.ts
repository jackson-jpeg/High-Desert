import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";

export async function GET() {
  let gitCommit = "unknown";
  
  // Try to get git commit from environment first
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    gitCommit = process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  } else if (process.env.GIT_COMMIT_SHA) {
    gitCommit = process.env.GIT_COMMIT_SHA.slice(0, 7);
  } else {
    // Fallback: try to read from git directly
    try {
      const { execSync } = require("child_process");
      gitCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      // Ignore errors if git is not available
    }
  }

  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    build: {
      version: packageJson.version,
      name: packageJson.name,
      commit: gitCommit,
    },
    dependencies: {
      next: packageJson.dependencies.next,
      react: packageJson.dependencies.react,
      typescript: packageJson.devDependencies.typescript,
    },
    node: process.version,
  };

  return NextResponse.json(health);
}