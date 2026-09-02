'use strict';

const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const { runBatchRange, mergeStats } = require('./runner');
const { headerRecord } = require('./meta');
const { openJsonl, appendFile } = require('./jsonl');

const WORKER_ENTRY = path.join(__dirname, 'worker.js');

/**
 * Split `games` matches into `workers` contiguous ranges.
 *
 * Contiguous, in ascending order, and always covering exactly `[0, games)`: the union
 * of the output is therefore identical for any worker count, and concatenating the
 * shards in range order reproduces the single-threaded ordering.
 */
function partitionRange(games, workers) {
  const count = Math.max(1, Math.min(workers, games));
  const base = Math.floor(games / count);
  const remainder = games % count;
  const ranges = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const size = base + (i < remainder ? 1 : 0);
    ranges.push({ from: cursor, to: cursor + size });
    cursor += size;
  }
  return ranges.filter(r => r.to > r.from);
}

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_ENTRY, { workerData });
    let settled = false;
    worker.on('message', (msg) => {
      settled = true;
      if (msg.ok) resolve(msg.stats);
      else reject(new Error(msg.error));
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (!settled) reject(new Error(`self-play worker exited with code ${code}`));
    });
  });
}

async function concatShards(outPath, meta, shardPaths) {
  const sink = openJsonl(outPath, headerRecord(meta));
  for (const shard of shardPaths) {
    // eslint-disable-next-line no-await-in-loop -- shards must land in range order
    await appendFile(sink, shard);
  }
  await sink.close();
  for (const shard of shardPaths) fs.rmSync(shard, { force: true });
}

/**
 * Run a batch across worker threads. Output is identical for any `workers` value:
 * the seed of match `i` does not depend on which worker played it, and the shards are
 * concatenated in ascending match order.
 *
 * Externally registered policies (`registerPolicy`) do not exist in a fresh worker;
 * `preload` names the modules that register them, and is required in-process too so
 * the flag means the same thing at every worker count.
 */
async function runParallelBatch({
  games = 100,
  workers = 1,
  seedPrefix = 'batch',
  policyNames,
  options = {},
  out = null,
  meta,
  preload = [],
} = {}) {
  const datasetId = meta && meta.datasetId;
  const ranges = partitionRange(games, workers);

  // One worker is not worth the thread: run the whole range here.
  if (ranges.length <= 1) {
    for (const modulePath of preload) require(modulePath);
    const sink = out ? openJsonl(out, headerRecord(meta)) : null;
    const stats = await runBatchRange({
      from: 0,
      to: games,
      seedPrefix,
      policyNames,
      options,
      datasetId,
      onRecord: sink ? sink.write : undefined,
    });
    if (sink) await sink.close();
    return { ...stats, workers: 1 };
  }

  const shardPaths = out ? ranges.map((_, i) => `${out}.part-${i}`) : [];
  try {
    const parts = await Promise.all(ranges.map((range, i) => runWorker({
      ...range,
      seedPrefix,
      policyNames,
      options,
      datasetId,
      preload,
      shardPath: out ? shardPaths[i] : null,
    })));
    if (out) await concatShards(out, meta, shardPaths);
    return { ...mergeStats(parts), workers: ranges.length };
  } catch (err) {
    for (const shard of shardPaths) fs.rmSync(shard, { force: true });
    throw err;
  }
}

module.exports = { runParallelBatch, partitionRange };
