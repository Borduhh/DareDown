'use strict';
/**
 * Application menu and keyboard shortcuts. Menu items either run in main
 * (open dialogs, window controls) or forward a named command to the renderer
 * over the `menu:command` channel.
 */
const { app, Menu, shell } = require('electron');
const config = require('./config');

const isMac = process.platform === 'darwin';

/**
 * @param {{ onCommand: (command: string, arg?: unknown) => void }} handlers
 */
function buildMenu(handlers) {
  const send = (command, arg) => ({
    click: () => handlers.onCommand(command, arg),
  });

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'Cmd+,', ...send('prefs:toggle') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: '&File',
    submenu: [
      { label: 'Open File…', accelerator: 'CmdOrCtrl+O', ...send('file:open') },
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', ...send('folder:open') },
      { type: 'separator' },
      { label: 'Reload Document', accelerator: 'CmdOrCtrl+R', ...send('doc:reload') },
      { label: 'Reveal in File Manager', accelerator: 'CmdOrCtrl+Alt+R', ...send('doc:reveal') },
      { type: 'separator' },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', ...send('tab:close') },
      { label: 'Close Folder', ...send('folder:close') },
      ...(isMac
        ? []
        : [
            { type: 'separator' },
            { label: 'Preferences…', accelerator: 'Ctrl+,', ...send('prefs:toggle') },
            { type: 'separator' },
            { role: 'quit', label: 'Exit' },
          ]),
    ],
  });

  template.push({
    label: '&Edit',
    submenu: [
      { role: 'copy' },
      { role: 'selectAll' },
      { type: 'separator' },
      { label: 'Find in Document…', accelerator: 'CmdOrCtrl+F', ...send('find:open') },
      { label: 'Find Next', accelerator: 'CmdOrCtrl+G', ...send('find:next') },
      { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', ...send('find:prev') },
    ],
  });

  template.push({
    label: '&View',
    submenu: [
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', ...send('sidebar:toggle') },
      { label: 'Switch Sidebar View', accelerator: 'CmdOrCtrl+Shift+B', ...send('sidebar:switch') },
      { label: 'Files', accelerator: 'CmdOrCtrl+Shift+E', ...send('sidebar:files') },
      { label: 'Outline', accelerator: 'CmdOrCtrl+Shift+Y', ...send('sidebar:outline') },
      { type: 'separator' },
      { label: 'Light / Dark Theme', accelerator: 'CmdOrCtrl+Shift+T', ...send('theme:cycle') },
      { type: 'separator' },
      { label: 'Larger Text', accelerator: 'CmdOrCtrl+Plus', ...send('font:bigger') },
      { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', ...send('font:smaller') },
      { label: 'Reset Text Size', accelerator: 'CmdOrCtrl+0', ...send('font:reset') },
      { type: 'separator' },
      { label: 'Full Width', accelerator: 'CmdOrCtrl+\\', ...send('width:full') },
      { label: 'Narrower Column', accelerator: 'CmdOrCtrl+[', ...send('width:narrower') },
      { label: 'Wider Column', accelerator: 'CmdOrCtrl+]', ...send('width:wider') },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(process.env.DAREDOWN_DEBUG ? [{ role: 'toggleDevTools' }] : []),
    ],
  });

  template.push({
    label: '&Go',
    submenu: [
      { label: 'Next Tab', accelerator: isMac ? 'Cmd+Alt+Right' : 'Ctrl+Tab', ...send('tab:next') },
      { label: 'Previous Tab', accelerator: isMac ? 'Cmd+Alt+Left' : 'Ctrl+Shift+Tab', ...send('tab:prev') },
      { type: 'separator' },
      { label: 'Quick Open…', accelerator: 'CmdOrCtrl+P', ...send('quickopen:toggle') },
      { type: 'separator' },
      { label: 'Top of Document', accelerator: 'CmdOrCtrl+Up', ...send('doc:top') },
      { label: 'Bottom of Document', accelerator: 'CmdOrCtrl+Down', ...send('doc:bottom') },
    ],
  });

  template.push({
    label: '&Window',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
  });

  template.push({
    role: 'help',
    submenu: [
      { label: 'Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', ...send('help:shortcuts') },
      { type: 'separator' },
      {
        label: 'Open Config File Location',
        click: () => shell.showItemInFolder(config.configPath()),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
