'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { trackRunCost, addRunCost, takeRunCost } = require('./runCost');
const { createUsageLedger } = require('./ledger');
const { priceMonitoringRead } = require('./gcpPricing');

test('priced calls add to the run they happen in, per provider, without mixing overlapping runs (#353)', async () => {
  const ledger = createUsageLedger({ dataDir: ':memory:' });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await Promise.all([
    trackRunCost('apm.collection', async () => {
      ledger.record({ provider: 'aws', service: 'CloudWatch', operation: 'GetMetricData', kind: 'metrics', quantity: 100, unit: 'metric', unitPrice: 0.00001, usd: 0.001 });
      await tick();
      ledger.record({ ...priceMonitoringRead(2), provider: 'gcp' });
    }),
    trackRunCost('logs.scan.7', async () => {
      await tick();
      ledger.record({ provider: 'aws', service: 'CloudWatch Logs', operation: 'FilterLogEvents (download)', kind: 'download', quantity: 0.001, unit: 'GB', unitPrice: 0.09, usd: 0, potentialUsd: 0.00009 });
    }),
  ]);
  addRunCost({ provider: 'aws', usd: 5 }); // outside any run: ignored

  assert.deepEqual(takeRunCost('apm.collection'), {
    aws: { calls: 1, usd: 0.001, potentialUsd: 0 },
    gcp: { calls: 1, usd: 0, potentialUsd: 0.000001 },
  });
  assert.deepEqual(takeRunCost('logs.scan.7'), { aws: { calls: 1, usd: 0, potentialUsd: 0.00009 } });
  assert.equal(takeRunCost('apm.collection'), null, 'taken once');
  ledger.close();
});

test('a Cloud Monitoring read is priced per time series, at least one, as free-tier potential cost', () => {
  const none = priceMonitoringRead(0);
  assert.equal(none.quantity, 1);
  assert.equal(none.usd, 0);
  assert.equal(none.potentialUsd, 0.0000005);
  assert.equal(priceMonitoringRead(4).potentialUsd, 0.000002);
  assert.match(none.freeTier, /1,000,000/);
});
