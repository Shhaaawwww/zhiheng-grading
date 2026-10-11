import { createApp } from "./app.mjs";
const instance = createApp({ dataDir: process.env.ZHIHENG_DATA_DIR });
const port = Number(process.env.PORT || 4318);
const server = instance.app.listen(port, "127.0.0.1", () =>
  console.log(`知衡本地服务 http://127.0.0.1:${port}`),
);
function close() {
  instance.ai.close();
  server.close(() => {
    instance.store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
