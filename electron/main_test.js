'use strict';
const e = require('electron');
process.stdout.write('typeof electron: ' + typeof e + '\n');
process.stdout.write('process.type: ' + process.type + '\n');
process.stdout.write('has app: ' + (typeof e.app !== 'undefined') + '\n');
