'use strict';

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');

const { runBatchRange } = require('./runner');

/**
 * One shard of a parallel batch. Records go straight to this worker's own JSONL file;
 * the parent concatenates the shards in range order, which reproduces byte for byte
 * what a single-threaded run would have written.
 */
async function main() {
  const { from, to, seedPrefix, policyNames, options, datasetId, shardPath, preload } = workerData;

  // Policies registered from outside the harness (LLM bots, trained models) are not
  // loaded in a fresh worker; `--require` names the modules that register them.
  for (const modulePath of preload || []) require(modulePath);

  const stream = shardPath ? fs.createWriteStream(shardPath, { flags: 'w' }) : null;
  const stats = await runBatchRange({
    from,
    to,
    seedPrefix,
    policyNames,
    options,
    datasetId,
    onRecord: stream ? record => stream.write(`${JSON.stringify(record)}\n`) : undefined,
  });

  if (stream) await new Promise((resolve, reject) => stream.end(err => (err ? reject(err) : resolve())));
  parentPort.postMessage({ ok: true, stats });
}

main().catch((err) => {
  parentPort.postMessage({ ok: false, error: err.stack || String(err) });
});
