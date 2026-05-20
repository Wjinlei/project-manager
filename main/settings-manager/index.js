const fs = require('fs');
const os = require('os');
const path = require('path');

function getSettingsDirectory() {
  return path.join(os.homedir(), '.project-manager');
}

function getSettingsPath() {
  return path.join(getSettingsDirectory(), 'settings.json');
}

function readSettings() {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) || {};
  } catch (_err) {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(getSettingsDirectory(), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
  return settings;
}

function setSettings(payload) {
  const current = readSettings();
  return writeSettings({ ...current, ...payload });
}

function registerSettingsManagerIpc(ipcMain) {
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_event, payload) => setSettings(payload));
}

module.exports = {
  getSettingsPath,
  readSettings,
  setSettings,
  registerSettingsManagerIpc
};
