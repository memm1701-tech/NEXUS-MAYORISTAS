const { contextBridge, ipcRenderer, webFrame } = require('electron');

const api = {
    minimize: () => ipcRenderer.send('minimize-login-window'),
    close: () => ipcRenderer.send('close-login-window'),
    cerrarYVolverAlLogin: () => ipcRenderer.send('cerrar-y-volver-login'),
    ejecutarMigracion: (idEmpresa) => ipcRenderer.invoke('migrar-adopcion-datos', { idEmpresa }),
    abrirVentanaPrincipal: (ruta) => ipcRenderer.send('abrir-ventana-principal', ruta),
    guardarSesion: (datos) => ipcRenderer.invoke('guardar-sesion', datos),
    obtenerSesion: () => ipcRenderer.invoke('obtener-sesion'),
    cerrarSesion: () => ipcRenderer.invoke('cerrar-sesion'),
    // CONTROL DE APARIENCIA (ZOOM)
    setZoomLevel: (level) => webFrame.setZoomLevel(level),
    getZoomLevel: () => webFrame.getZoomLevel(),
    // AUTO-UPDATES
    obtenerVersionApp: () => ipcRenderer.invoke('obtener-version-app'),
    verificarActualizacion: (versionLocal, forzarBusqueda = false) => 
        ipcRenderer.invoke('verificar-actualizacion-github', versionLocal, forzarBusqueda),
    descargarEInstalar: (url) => ipcRenderer.invoke('descargar-update', url),
    onDownloadProgress: (callback) => {
        ipcRenderer.removeAllListeners('download-progress');
        ipcRenderer.on('download-progress', (event, progress) => callback(progress));
    },
    // MÉTODOS IPC GENÉRICOS (Para migración legacy)
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, (event, ...args) => listener(event, ...args)),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
};

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('nexusAPI', api);
} else {
    window.nexusAPI = api;
}

console.log('✅ Puente NexusAPI establecido correctamente (frameless config).');
