'use strict';
/**
 * lib/lazyModule.js
 * A module loaded on the first property read. The AWS SDK clients take
 * hundreds of milliseconds to load (client-ec2 alone ~200 ms), and the modules
 * that use them are required while the server boots, long before any AWS call:
 *
 *   const ec2 = lazyModule('@aws-sdk/client-ec2');
 *   await client.send(new ec2.DescribeInstancesCommand({ … }));
 */
function lazyModule(id) {
  let loaded = null;
  return new Proxy({}, {
    get: (_target, key) => (loaded ||= require(id))[key],
  });
}

module.exports = { lazyModule };
