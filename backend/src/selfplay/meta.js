'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

const { DEFAULT_OPTIONS } = require('../engine/game');

/**
 * Bump when the shape of a JSONL record changes in a way a consumer must notice.
 * Consumers should refuse a file whose schemaVersion they do not understand.
 */
const SCHEMA_VERSION = 1;

/** The engine option fields that change what a dataset means. */
const PROVENANCE_OPTIONS = ['variant', 'teams', 'targetScore', 'firstLead', 'exposuresEnabled'];

let cachedSha = null;

/** The commit the harness ran from, or "unknown" outside a git checkout. */
function gitSha() {
  if (cachedSha) return cachedSha;
  try {
    cachedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown';
  } catch {
    cachedSha = 'unknown';
  }
  return cachedSha;
}

/**
 * Provenance for one dataset. `datasetId` is a digest of everything that changes what
 * the records mean, so records from two rule configurations can never be silently
 * mixed: concatenate two datasets and the differing ids give it away.
 */
function buildMeta({ options = {}, policyNames, seedPrefix, generatedAt } = {}) {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const engineOptions = Object.fromEntries(
    PROVENANCE_OPTIONS.map(key => [key, resolved[key] === undefined ? null : resolved[key]]),
  );

  const meta = {
    schemaVersion: SCHEMA_VERSION,
    gitSha: gitSha(),
    engineOptions,
    policyNames: policyNames || null,
    seedPrefix: seedPrefix || null,
    generatedAt: generatedAt || new Date().toISOString(),
  };

  // The timestamp is deliberately excluded: two runs of the same configuration
  // produce the same id and are safe to concatenate.
  const { generatedAt: _ignored, ...identity } = meta;
  meta.datasetId = crypto.createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex')
    .slice(0, 12);

  return meta;
}

/** The first line of a JSONL dataset: provenance for every record that follows. */
function headerRecord(meta) {
  return { type: 'header', meta };
}

module.exports = { SCHEMA_VERSION, PROVENANCE_OPTIONS, gitSha, buildMeta, headerRecord };
