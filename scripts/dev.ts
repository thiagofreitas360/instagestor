import { spawn } from "node:child_process";

function run(script: string) {
  return process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `pnpm ${script}`], { stdio: "inherit", env: process.env })
    : spawn("pnpm", [script], { stdio: "inherit", env: process.env });
}

const children = [
  run("dev:web"),
  run("dev:worker"),
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
