import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe, limited API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // The UI can call window.api.burnDVD() to trigger the backend logic
  burnDVD: (): Promise<{ success: boolean; log?: string; error?: string }> => 
    ipcRenderer.invoke('burn-dvd'),
});