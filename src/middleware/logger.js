const { randomUUID } = require('node:crypto');

function logger(req, res, next) {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  let responseLogged = false;

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  console.info(JSON.stringify({
    type: 'request',
    requestId,
    method: req.method,
    path: req.path,
  }));

  function logResponse(type) {
    if (responseLogged) {
      return;
    }
    responseLogged = true;

    console.info(JSON.stringify({
      type,
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    }));
  }

  res.once('finish', () => logResponse('response'));
  res.once('close', () => {
    if (!res.writableFinished) {
      logResponse('response_aborted');
    }
  });

  next();
}

module.exports = logger;
