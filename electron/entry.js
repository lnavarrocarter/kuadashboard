'use strict';

if (process.argv.includes('--kua-smoke-test')) {
  require('./packagedSmoke').run().catch(error => {
    console.error(error);
    require('electron').app.exit(1);
  });
} else {
  require('./main');
}
