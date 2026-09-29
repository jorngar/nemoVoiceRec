const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("voices", {
  list: () => ipcRenderer.invoke("recordings:list"),
  save: (item, audio) => ipcRenderer.invoke("recordings:save", item, audio),
  update: (id, changes) => ipcRenderer.invoke("recordings:update", id, changes),
  audio: (id) => ipcRenderer.invoke("recordings:audio", id),
  audioUrl: (id) => `voices-audio://recording/${encodeURIComponent(id)}`,
  importFile: (file, title) => {
    const filePath = webUtils.getPathForFile(file);
    return filePath
      ? ipcRenderer.invoke("recordings:import", filePath, title)
      : Promise.resolve(null);
  },
  export: (id, kind, text) =>
    ipcRenderer.invoke("recordings:export", id, kind, text),
  settings: () => ipcRenderer.invoke("settings:get"),
  pickSetting: (key) => ipcRenderer.invoke("settings:pick", key),
  setLanguage: (language) => ipcRenderer.invoke("settings:language", language),
  languages: () => ipcRenderer.invoke("settings:languages"),
  setSummaryLanguage: (language) =>
    ipcRenderer.invoke("settings:summaryLanguage", language),
  summarize: (id) => ipcRenderer.invoke("summary:create", id),
  cancelSummary: () => ipcRenderer.invoke("summary:cancel"),
  status: () => ipcRenderer.invoke("engine:status"),
  transcribe: (id) => ipcRenderer.invoke("engine:transcribe", id),
  cancel: () => ipcRenderer.invoke("engine:cancel"),
  recording: (value) => ipcRenderer.invoke("recording:state", value),
  microphone: () => ipcRenderer.invoke("microphone:request"),
  onProgress: (fn) => {
    const handler = (_event, message) => fn(message);
    ipcRenderer.on("engine:progress", handler);
    return () => ipcRenderer.removeListener("engine:progress", handler);
  },
});
