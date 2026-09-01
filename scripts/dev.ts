import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [
  spawn(command, ["dev:web"], { stdio: "inherit", env: process.env }),
  spawn(command, ["dev:worker"], { stdio: "inherit", env: process.env }),
];

let stopping = false;
function stop(signal: NodeJS.Signals = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
for (const child of children) {
  child.once("exit", (code) => {
    if (!stopping && code) process.exitCode = code;
    stop();
  });
}
