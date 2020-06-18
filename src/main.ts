import { app, BrowserWindow } from "electron";
import { ipcMain } from "electron";
import WINDOW_CONFIG from "./constants/window";

function createWindow() {
  // 创建浏览器窗口
  let win = new BrowserWindow(WINDOW_CONFIG);

  // 加载index.html文件
  win.loadURL("http://localhost:8080");

  win.on("close", function () {
    app.exit();
  });

  ipcMain.on("close", function () {
    app.exit();
  });
}

app.whenReady().then(createWindow);
