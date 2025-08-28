import started from 'electron-squirrel-startup';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { exec, spawn } from 'child_process';
import util from 'util';
import fs from 'fs';

// Promisify exec for commands that don't need streaming output
const execPromise = util.promisify(exec);

// --- Define paths to our bundled tools ---
// This logic correctly finds the binaries whether in development or a packaged app
const resourcesPath = app.isPackaged
  ? path.join(process.resourcesPath, 'resources')
  : path.join(app.getAppPath(), 'resources');

const ffmpegPath = path.join(resourcesPath, 'bin', 'ffmpeg');
const dvdauthorPath = path.join(resourcesPath, 'bin', 'dvdauthor');
const mkisofsPath = path.join(resourcesPath, 'bin', 'mkisofs');

// Main function that handles the entire DVD burning process
ipcMain.handle('burn-dvd', async (_event, { isoOnly = false } = {}) => {
  // 1. Select Video File
  const fileResult = await dialog.showOpenDialog({
    title: 'Select a Video File',
    properties: ['openFile'],
    filters: [{ name: 'Movies', extensions: ['mp4', 'mov', 'mkv', 'avi'] }],
  });

  if (fileResult.canceled || fileResult.filePaths.length === 0) {
    return { success: false, error: 'File selection was canceled.' };
  }
  const videoFile = fileResult.filePaths[0];

  // 2. Try to select DVD Drive (unless isoOnly)
  let chosenDrive: string | undefined;
  let noDrive = false;
  if (!isoOnly) {
    try {
      const { stdout } = await execPromise("drutil list | grep -o '/dev/disk[0-9]*'");
      const drives = stdout.trim().split('\n');
      if (drives.length === 0 || drives[0] === '') {
        throw new Error('No DVD drive found.');
      }
      const driveChoice = await dialog.showMessageBox({
        type: 'question',
        title: 'Choose Drive',
        message: 'Please select your DVD burner:',
        buttons: [...drives, 'Cancel'],
        defaultId: 0,
        cancelId: drives.length,
      });
      if (driveChoice.response === drives.length) {
        return { success: false, error: 'Drive selection was canceled.' };
      }
      chosenDrive = drives[driveChoice.response];
    } catch (e) {
      noDrive = true;
    }
  }

  // 3. Run the process
  try {
    // Create a temporary directory
    const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'dvd-'));
    const dvdMpegFile = path.join(tmpDir, 'video.mpg');
    const dvdFolder = path.join(tmpDir, 'dvd_content');
    const isoFile = path.join(tmpDir, 'output.iso');

    // Helper to run a command and return a promise, logging both stdout and stderr
    const runCommand = (command: string, args: string[]): Promise<boolean> => new Promise((resolve, reject) => {
      console.log(`Running command: ${command} ${args.join(' ')}`);
      const process = spawn(command, args);
      process.stdout.on('data', (data) => console.log(data.toString()));
      process.stderr.on('data', (data) => console.error(data.toString()));
      process.on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`Process exited with code ${code}`)));
    });

    // Remove trailing slash from dvdFolder if present
    let sanitizedDvdFolder = dvdFolder;
    if (sanitizedDvdFolder.endsWith('/')) {
      sanitizedDvdFolder = sanitizedDvdFolder.slice(0, -1);
    }

    await runCommand(ffmpegPath, ['-i', videoFile, '-target', 'ntsc-dvd', '-aspect', '16:9', '-y', dvdMpegFile]);
    await runCommand(dvdauthorPath, ['-o', dvdFolder, '-t', dvdMpegFile]);
    // Finalize DVD structure to create VIDEO_TS.IFO
    await runCommand(dvdauthorPath, ['-o', dvdFolder]);

    // Check for VIDEO_TS/VIDEO_TS.IFO before running mkisofs
    const videoTsIfo = path.join(dvdFolder, 'VIDEO_TS', 'VIDEO_TS.IFO');
    if (!fs.existsSync(videoTsIfo)) {
      throw new Error(`DVD structure incomplete: ${videoTsIfo} not found. dvdauthor may have failed. Check the logs above for errors.`);
    }

    await runCommand(mkisofsPath, ['-dvd-video', '-o', isoFile, sanitizedDvdFolder]);

    if (isoOnly || noDrive) {
      // Only generate ISO, do not burn
      const saveResult = await dialog.showSaveDialog({
        title: 'Save ISO File',
        defaultPath: path.join(app.getPath('documents'), 'output.iso'),
        filters: [{ name: 'ISO Image', extensions: ['iso'] }],
      });
      if (saveResult.canceled || !saveResult.filePath) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return { success: false, error: 'ISO save was canceled.' };
      }
      fs.copyFileSync(isoFile, saveResult.filePath);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { success: true, log: `ISO file saved to ${saveResult.filePath}` };
    } else {
      await runCommand('hdiutil', ['burn', '-device', chosenDrive, isoFile]);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { success: true, log: `Successfully burned ${path.basename(videoFile)} to ${chosenDrive}.` };
    }
  } catch (e) {
    return { success: false, error: `An error occurred during the process: ${e.message}` };
  }
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
