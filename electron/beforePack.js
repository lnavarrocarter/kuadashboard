'use strict';
const { assertNoPackagedVercelSecret } = require('../scripts/check-packaged-secrets');
exports.default = async context => assertNoPackagedVercelSecret(context.packager.projectDir);
