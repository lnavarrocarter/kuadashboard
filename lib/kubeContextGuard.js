// The UI confirms a write against the context it showed the user. The server
// acts on whatever context is loaded now, so a switch from another window
// between confirm and request must stop the write instead of hitting the
// wrong cluster.
function contextMismatch(expectedContext, currentContext) {
  if (expectedContext === undefined || expectedContext === null || expectedContext === '') return null;
  if (expectedContext === currentContext) return null;
  return {
    error: `Active Kubernetes context changed to "${currentContext}"; the action was confirmed for "${expectedContext}". Nothing was changed.`,
    code: 'KUBE_CONTEXT_CHANGED',
    expectedContext,
    currentContext,
  };
}

// Express guard: replies 409 and returns false when the request was confirmed
// for another context.
function requireExpectedContext(req, res, currentContext) {
  const mismatch = contextMismatch(req.body?.expectedContext, currentContext);
  if (!mismatch) return true;
  res.status(409).json(mismatch);
  return false;
}

module.exports = { contextMismatch, requireExpectedContext };
