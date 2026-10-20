const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('copilot', {
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: data => ipcRenderer.invoke('settings:save', data),
  saveRepName: name => ipcRenderer.invoke('settings:rep-name', name),
  productFocus: data => ipcRenderer.invoke('training:product-focus', data),
  retrySavedKey: () => ipcRenderer.invoke('settings:retry-key'),
  forgetKey: () => ipcRenderer.invoke('settings:forget'),
  microphonePermission: () => ipcRenderer.invoke('audio:permission'),
  connect: data => ipcRenderer.invoke('session:connect', data),
  stop: () => ipcRenderer.invoke('session:stop'),
  saveAccount: data => ipcRenderer.invoke('account:save', data),
  research: data => ipcRenderer.invoke('training:research', data),
  diarize: data => ipcRenderer.invoke('audio:diarize', data),
  lifecycle: data => ipcRenderer.invoke('training:lifecycle', data),
  handoff: data => ipcRenderer.invoke('training:handoff', data),
  openSource: url => ipcRenderer.invoke('source:open', url),
  observe: data => ipcRenderer.invoke('training:observe', data),
  review: data => ipcRenderer.invoke('training:review', data),
  coach: data => ipcRenderer.invoke('coach:start', data),
  cancelCoach: () => ipcRenderer.invoke('coach:cancel'),
  pin: value => ipcRenderer.invoke('window:pin', value),
  onCoach: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('coach:event', listener);
    return () => ipcRenderer.removeListener('coach:event', listener);
  },
});
