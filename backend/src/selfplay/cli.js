#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { runBatch } = require('./runner');

function parseArgs(argv) {
  const args = { games: 100, out: null, policies: null, variant: 'standard', teams: false, seed: 'batch' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--games') args.games = Number(next());
    else if (arg === '--out') args.out = next();
    else if (arg === '--policies') args.policies = next().split(',');
    else if (arg === '--variant') args.variant = next();
    else if (arg === '--seed') args.seed = next();
    else if (arg === '--teams') args.teams = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const USAGE = `
Gongzhu self-play harness

  node src/selfplay/cli.js [options]

  --games N          number of matches to play (default 100)
  --out FILE         write per-decision training records as JSONL
  --policies a,b,c,d one policy per seat (random | lowest | avoidPoints)
  --variant NAME     heart scoring table: standard | pips
  --teams            play 2v2 partnerships (seats 0+2 vs 1+3) instead of individual
  --seed PREFIX      seed prefix, for reproducible batches (default "batch")
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const options = { variant: args.variant };
  if (args.teams) {
    options.teams = { team1: ['p0', 'p2'], team2: ['p1', 'p3'] };
  }

  let stream = null;
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    stream = fs.createWriteStream(args.out, { flags: 'w' });
  }

  const started = Date.now();
  const stats = runBatch({
    games: args.games,
    seedPrefix: args.seed,
    policyNames: args.policies || undefined,
    options,
    onRecord: stream ? (record) => stream.write(`${JSON.stringify(record)}\n`) : undefined,
  });
  if (stream) stream.end();

  const seconds = (Date.now() - started) / 1000;
  process.stdout.write([
    `games:     ${stats.games}`,
    `hands:     ${stats.handsPlayed}`,
    `decisions: ${stats.decisions}`,
    `elapsed:   ${seconds.toFixed(2)}s (${Math.round(stats.games / seconds)} matches/s)`,
    `wins:      ${JSON.stringify(stats.wins)}`,
    `net score: ${JSON.stringify(stats.scoreTotals)}`,
    args.out ? `written:   ${args.out}` : '',
    '',
  ].filter(Boolean).join('\n'));
}

if (require.main === module) main();

module.exports = { parseArgs };
