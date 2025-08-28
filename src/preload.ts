import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe, limited API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // The UI can call window.api.burnDVD({ isoOnly }) to trigger the backend logic
  burnDVD: (options?: { isoOnly?: boolean }): Promise<{ success: boolean; log?: string; error?: string }> => 
    ipcRenderer.invoke('burn-dvd', options),
  // Explicit ISO creation
  createISO: (): Promise<{ success: boolean; log?: string; error?: string }> =>
    ipcRenderer.invoke('burn-dvd', { isoOnly: true }),
});