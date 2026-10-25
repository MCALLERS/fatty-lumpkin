#!/usr/bin/env node
'use strict';
// flpt-server.js · the name PLAN §2.13 gives the web container's entry (`node engine/tools/server/flpt-server.js
// --mode web`): the same program as server.js.
const { main } = require('./server');

main().catch((e) => { process.stderr.write(`flpt-server: ${e.message}\n`); process.exit(2); });
