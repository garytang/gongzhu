#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');

const { runParallelBatch } = require('./parallel');
const { runTournament, formatTable } = require('./tournament');
const { buildMeta } = require('./meta');
const { DEFAULT_POLICIES, TEAMS } = require('./runner');

const COMMANDS = ['batch', 'tournament'];

function parseArgs(argv) {
  const args = {
    command: 'batch',
    games: 100,
    out: null,
    policies: null,
    variant: 'standard',
    teams: false,
    seed: null,
    workers: 1,
    matches: 20,
    require: [],
  };
  let rest = argv;
  if (rest.length > 0 && COMMANDS.includes(rest[0])) {
    args.command = rest[0];
    rest = rest.slice(1);
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = () => rest[++i];
    if (arg === '--games') args.games = Number(next());
    else if (arg === '--out') args.out = next();
    else if (arg === '--policies') args.policies = next().split(',');
    else if (arg === '--variant') args.variant = next();
    else if (arg === '--seed') args.seed = next();
    else if (arg === '--teams') args.teams = true;
    else if (arg === '--workers') {
      const value = next();
      args.workers = value === 'auto' ? os.cpus().length : Number(value);
    }
    else if (arg === '--matches') args.matches = Number(next());
    else if (arg === '--require') args.require.push(path.resolve(next()));
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.seed === null) args.seed = args.command === 'tournament' ? 'tourney' : 'batch';
  return args;
}

const USAGE = `
Gongzhu self-play harness

  node src/selfplay/cli.js [batch|tournament] [options]

batch — generate matches and training records (default)

  --games N          number of matches to play (default 100)
  --out FILE         write per-decision training records as JSONL
  --workers N|auto   play the batch across N worker threads (default 1)
  --policies a,b,c,d one policy per seat (random | lowest | avoidPoints | cardCounter)

tournament — head-to-head evaluation with win rate and mean score

  --policies a,b,... the policies to compare (at least two)
  --matches N        matches per seating (default 20); every seat rotation is played

common

  --variant NAME     heart scoring table: standard | pips
  --teams            play 2v2 partnerships (seats 0+2 vs 1+3) instead of individual
  --seed PREFIX      seed prefix, for reproducible runs
  --require MODULE   load a module first, so policies it registers are usable by name
                     (repeatable; also passed to worker threads)
`;

async function runBatchCommand(args) {
  const options = args.teams ? { variant: args.variant, teams: TEAMS } : { variant: args.variant };
  const policyNames = args.policies || DEFAULT_POLICIES;
  const meta = buildMeta({ options, policyNames, seedPrefix: args.seed });

  const started = Date.now();
  const stats = await runParallelBatch({
    games: args.games,
    workers: args.workers,
    seedPrefix: args.seed,
    policyNames,
    options,
    out: args.out,
    meta,
    preload: args.require,
  });
  const seconds = (Date.now() - started) / 1000;

  process.stdout.write([
    `games:     ${stats.games}`,
    `hands:     ${stats.handsPlayed}`,
    `decisions: ${stats.decisions}`,
    `workers:   ${stats.workers}`,
    `elapsed:   ${seconds.toFixed(2)}s (${(stats.games / seconds).toFixed(1)} matches/s)`,
    `wins:      ${JSON.stringify(stats.wins)}`,
    `net score: ${JSON.stringify(stats.scoreTotals)}`,
    `dataset:   ${meta.datasetId} @ ${meta.gitSha.slice(0, 12)}`,
    args.out ? `written:   ${args.out}` : '',
    '',
  ].filter(Boolean).join('\n'));
}

async function runTournamentCommand(args) {
  if (!args.policies || args.policies.length < 2) {
    throw new Error('tournament needs --policies with at least two names');
  }
  const started = Date.now();
  const result = await runTournament({
    policyNames: args.policies,
    matches: args.matches,
    seed: args.seed,
    options: { variant: args.variant },
    mode: args.teams ? 'teams' : 'individual',
  });
  const seconds = (Date.now() - started) / 1000;
  process.stdout.write(`${formatTable(result)}\n`);
  process.stdout.write(`elapsed: ${seconds.toFixed(2)}s (${(result.matchesPlayed / seconds).toFixed(1)} matches/s)\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }
  for (const modulePath of args.require) require(modulePath);
  if (args.command === 'tournament') await runTournamentCommand(args);
  else await runBatchCommand(args);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
