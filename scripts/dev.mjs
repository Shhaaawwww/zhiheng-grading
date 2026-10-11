import { spawn } from "node:child_process";
const server = spawn(process.execPath, ["server/index.mjs"], {
  stdio: "inherit",
});
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
  stdio: "inherit",
});
function stop() {
  server.kill();
  vite.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", () => vite.kill());
vite.on("exit", () => server.kill());
