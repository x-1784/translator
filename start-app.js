// 桌面版启动器
// 背景：某些环境（如 VSCode 集成终端/扩展宿主进程）会泄漏 ELECTRON_RUN_AS_NODE=1，
// 导致 Electron 以纯 Node 模式启动，require("electron") 返回路径字符串而非模块对象，
// 从而出现 "Cannot read properties of undefined (reading 'requestSingleInstanceLock')" 之类的报错。
// 这里在启动前删除该变量，保证 npm start / npm run desktop 稳定可用。
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require("node:child_process");
const electronPath = require("electron");

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  env: process.env,
});

child.on("error", (error) => {
  console.error("启动 Electron 失败:", error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
