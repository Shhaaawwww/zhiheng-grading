const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
let instance, server, mainWindow;
function startupFailure(e) {
  const folder = app.getPath("userData");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "startup-error.log"),
    String(e.stack || e),
  );
  if (process.env.ZHIHENG_SMOKE)
    fs.writeFileSync(
      process.env.ZHIHENG_SMOKE + ".error.txt",
      String(e.stack || e),
    );
  else
    dialog.showErrorBox(
      "知衡无法启动",
      e.message + "\n详情已写入数据目录的 startup-error.log。",
    );
  app.quit();
}
async function renderPdf(html) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      javascript: false,
    },
  });
  try {
    await win.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html),
    );
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      preferCSSPageSize: true,
    });
  } finally {
    win.destroy();
  }
}
if (process.env.ZHIHENG_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.ZHIHENG_DATA_DIR));
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const { createApp } = await import(
        pathToFileURL(path.join(__dirname, "../server/app.mjs")).href
      );
      const crypto = safeStorage.isEncryptionAvailable()
        ? {
            encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
            decrypt: (s) => safeStorage.decryptString(Buffer.from(s, "base64")),
          }
        : {};
      instance = createApp({
        dataDir: path.join(app.getPath("userData"), "workspace"),
        crypto,
      });
      server = instance.app.listen(0, "127.0.0.1", async () => {
        try {
          const url = `http://127.0.0.1:${server.address().port}`;
          mainWindow = new BrowserWindow({
            width: 1480,
            height: 960,
            minWidth: 1050,
            minHeight: 740,
            show: !process.env.ZHIHENG_SMOKE,
            backgroundColor: "#f3f6f8",
            icon: path.join(__dirname, "assets/icon.png"),
            title: "知衡 · 阅卷与学情分析",
            autoHideMenuBar: true,
            webPreferences: {
              preload: path.join(__dirname, "preload.cjs"),
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          });
          mainWindow.webContents.setWindowOpenHandler(() => ({
            action: "deny",
          }));
          mainWindow.webContents.on("will-navigate", (event, target) => {
            if (new URL(target).origin !== url) event.preventDefault();
          });
          mainWindow.webContents.session.setPermissionRequestHandler(
            (_w, _p, callback) => callback(false),
          );
          ipcMain.handle("export-pdf", async (event, html) => {
            if (
              event.sender !== mainWindow.webContents ||
              typeof html !== "string" ||
              html.length > 5_000_000
            )
              throw new Error("无效报告。");
            const output = await dialog.showSaveDialog(mainWindow, {
              title: "导出报告 PDF",
              defaultPath: "知衡学情报告.pdf",
              filters: [{ name: "PDF", extensions: ["pdf"] }],
            });
            if (output.canceled) return null;
            const bytes = await renderPdf(html);
            fs.writeFileSync(output.filePath, bytes);
            return output.filePath;
          });
          ipcMain.handle("open-data-folder", (event) => {
            if (event.sender === mainWindow.webContents)
              return shell.openPath(instance.store.dir);
          });
          await mainWindow.loadURL(url);
          if (process.env.ZHIHENG_SMOKE) {
            setTimeout(async () => {
              try {
                const ready = await mainWindow.webContents.executeJavaScript(`
                  new Promise((resolve, reject) => {
                    const began = Date.now();
                    const check = () => {
                      const view = document.querySelector('.exam-hero, .welcome-start');
                      if (view) return resolve({examLoaded: !!document.querySelector('.exam-hero'), text: view.innerText});
                      if (Date.now() - began > 20000) return reject(new Error('Teacher workspace did not finish loading'));
                      setTimeout(check, 100);
                    }; check();
                  })
                `);
                const image = await mainWindow.webContents.capturePage();
                fs.writeFileSync(process.env.ZHIHENG_SMOKE, image.toPNG());
                if (process.env.ZHIHENG_SMOKE_REPORT) {
                  const html = fs.readFileSync(
                    process.env.ZHIHENG_SMOKE_REPORT,
                    "utf8",
                  );
                  fs.writeFileSync(
                    process.env.ZHIHENG_SMOKE + ".pdf",
                    await renderPdf(html),
                  );
                }
                fs.writeFileSync(
                  process.env.ZHIHENG_SMOKE + ".json",
                  JSON.stringify({
                    electron: process.versions.electron,
                    node: process.versions.node,
                    title: mainWindow.getTitle(),
                    safeStorage: safeStorage.isEncryptionAvailable(),
                    workspaceReady: ready,
                    ok: true,
                  }),
                );
              } catch (e) {
                fs.writeFileSync(
                  process.env.ZHIHENG_SMOKE + ".error.txt",
                  String(e.stack),
                );
              } finally {
                app.quit();
              }
            }, 2000);
          }
        } catch (e) {
          startupFailure(e);
        }
      });
      server.on("error", startupFailure);
    })
    .catch(startupFailure);
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    instance?.ai.close();
    server?.close();
  });
}
