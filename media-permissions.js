// Camera access stays denied. Display capture goes through the OS picker;
// the fallback grants nothing rather than silently capturing a whole desktop.
export function installMediaPermissions(session, getWindow, origin) {
  const trusted = (wc,url) => Boolean(wc && wc === getWindow()?.webContents && (url === origin || url?.startsWith(origin+'/')));
  session.setPermissionCheckHandler((wc,permission,url,details) =>
    trusted(wc,url) && (permission === 'display-capture' || (permission === 'media' && details.mediaType !== 'video')));
  session.setPermissionRequestHandler((wc,permission,callback,details) =>
    callback(trusted(wc,wc?.getURL()) && (permission === 'display-capture' || (permission === 'media' && !details.mediaTypes?.includes('video')))));
  session.setDisplayMediaRequestHandler((_request,callback) => callback({}), {useSystemPicker:true});
}
