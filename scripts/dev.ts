// 同时启动后端（node 原生跑 TS，--watch 自动重启）与 Vite 前端
import { spawn } from "node:child_process";

const procs = [
  spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--use-env-proxy", "--env-file-if-exists=.env", "--watch", "server/index.ts"], { stdio: "inherit" }),
  spawn("npx vite", { stdio: "inherit", shell: true }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && stop());
