import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const relayEntry = resolve(import.meta.dirname, "coop-server.mjs");
const viteEntry = resolve(import.meta.dirname, "../node_modules/vite/bin/vite.js");
const relay = spawn(process.execPath, [relayEntry], {
  env: process.env,
  stdio: "inherit",
});
const vite = spawn(process.execPath, [viteEntry, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});
let shuttingDown = false;

/** 终止开发服务和联机中继，避免残留端口进程。 */
function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  relay.kill(signal);
  vite.kill(signal);
}

relay.once("exit", (code) => {
  if (!shuttingDown) {
    shutdown();
    process.exitCode = code ?? 1;
  }
});
vite.once("exit", (code) => {
  if (!shuttingDown) {
    shutdown();
    process.exitCode = code ?? 0;
  }
});
process.once("SIGINT", () => { shutdown("SIGINT"); });
process.once("SIGTERM", () => { shutdown("SIGTERM"); });
