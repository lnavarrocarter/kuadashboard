'use strict';

const express = require('express');

/** Read-only view of the KUApps task journal (lib/kua/taskJournal.js, #325). */
function createKuappsTaskJournalRouter({ journal }) {
  if (!journal || typeof journal.list !== 'function') throw new TypeError('A task journal is required');
  const router = express.Router();
  router.get('/', (req, res) => {
    res.json(journal.list({
      applicationId: typeof req.query.applicationId === 'string' ? req.query.applicationId : null,
      since: typeof req.query.since === 'string' ? req.query.since : null,
      limit: req.query.limit,
    }));
  });
  return router;
}

module.exports = { createKuappsTaskJournalRouter };
