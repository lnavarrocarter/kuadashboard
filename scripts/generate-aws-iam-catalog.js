#!/usr/bin/env node
'use strict';
// Regenerates lib/awsIamCatalog.json: the IAM actions each AWS route needs,
// read from the SDK commands in routes/aws.js. Run after changing AWS routes:
//   node scripts/generate-aws-iam-catalog.js
const fs = require('fs');
const path = require('path');
const { extractRouteCatalog } = require('../lib/awsAccess');

const root = path.join(__dirname, '..');
const catalog = extractRouteCatalog(fs.readFileSync(path.join(root, 'routes/aws.js'), 'utf8'));
fs.writeFileSync(path.join(root, 'lib/awsIamCatalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`lib/awsIamCatalog.json: ${Object.keys(catalog).length} routes`);
