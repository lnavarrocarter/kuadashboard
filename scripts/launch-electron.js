#!/usr/bin/env node
/**
 * scripts/launch-electron.js
 *
 * Launches electron with ELECTRON_RUN_AS_NODE removed from the environment.
 * VS Code sets ELECTRON_RUN_AS_NODE=1 in all integrated terminals so electron.exe
 * can be used as a Node.js runtime for extensions. This causes `require('electron')`
 * to return the binary path instead of the Electron API, crashing the main process.
 *
 * Usage: node scripts/launch-electron.js [-- extra args]
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron'); // returns path string from npm package

// Build env without ELECTRON_RUN_AS_NODE
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const child = spawn(electronBin, ['.', ...args], {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', code => process.exit(code ?? 0));
child.on('error', err => {
  console.error('[launch-electron] Failed to start Electron:', err.message);
  process.exit(1);
});
