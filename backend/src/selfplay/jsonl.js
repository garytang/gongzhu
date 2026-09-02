'use strict';

const fs = require('fs');
const path = require('path');

/**
 * A JSONL sink: one JSON object per line. Used by the in-process batch runner, by each
 * worker thread writing its shard, and by the parent concatenating those shards, so
 * every path frames records the same way.
 */
function openJsonl(filePath, firstRecord = null) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const stream = fs.createWriteStream(filePath, { flags: 'w' });
  if (firstRecord) stream.write(`${JSON.stringify(firstRecord)}\n`);

  return {
    stream,
    write(record) { stream.write(`${JSON.stringify(record)}\n`); },
    close() {
      return new Promise((resolve, reject) => {
        stream.end(err => (err ? reject(err) : resolve()));
      });
    },
  };
}

/** Append a file's bytes to an open sink without closing it. */
function appendFile(sink, filePath) {
  return new Promise((resolve, reject) => {
    const source = fs.createReadStream(filePath);
    source.on('error', reject);
    source.on('end', resolve);
    source.pipe(sink.stream, { end: false });
  });
}

module.exports = { openJsonl, appendFile };
