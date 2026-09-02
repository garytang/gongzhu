'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

const { runParallelBatch, partitionRange } = require('../../src/selfplay/parallel');
const { buildMeta, SCHEMA_VERSION } = require('../../src/selfplay/meta');

const TEAMS = { team1: ['p0', 'p2'], team2: ['p1', 'p3'] };

describe('self-play: dataset provenance', () => {
  it('stamps the rules configuration, schema version and git sha', () => {
    const meta = buildMeta({ options: { variant: 'pips', teams: TEAMS }, seedPrefix: 'x' });
    expect(meta.schemaVersion).to.equal(SCHEMA_VERSION);
    expect(meta.gitSha).to.be.a('string').with.length.of.at.least(3);
    expect(meta.engineOptions).to.have.keys([
      'variant', 'teams', 'targetScore', 'firstLead', 'exposuresEnabled',
    ]);
    expect(meta.engineOptions.variant).to.equal('pips');
    expect(meta.engineOptions.targetScore).to.equal(1000);
    expect(meta.generatedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('gives different rule configurations different dataset ids', () => {
    const a = buildMeta({ options: { variant: 'standard' } });
    const b = buildMeta({ options: { variant: 'pips' } });
    const c = buildMeta({ options: { variant: 'standard' } });
    expect(a.datasetId).to.not.equal(b.datasetId);
    expect(a.datasetId).to.equal(c.datasetId, 'the timestamp must not enter the id');
  });
});

describe('self-play: partitioning', () => {
  it('covers exactly the whole batch, in ascending order, for any worker count', () => {
    for (const workers of [1, 2, 3, 4, 8, 16]) {
      const ranges = partitionRange(10, workers);
      expect(ranges[0].from).to.equal(0);
      expect(ranges[ranges.length - 1].to).to.equal(10);
      for (let i = 1; i < ranges.length; i++) {
        expect(ranges[i].from).to.equal(ranges[i - 1].to, `workers=${workers}`);
      }
    }
  });
});

describe('self-play: parallel batch', function parallelSuite() {
  this.timeout(30000);

  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gongzhu-selfplay-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  async function run(workers) {
    const out = path.join(dir, `w${workers}.jsonl`);
    const meta = buildMeta({ options: {}, seedPrefix: 'par' });
    const stats = await runParallelBatch({ games: 12, workers, seedPrefix: 'par', out, meta });
    return { stats, lines: fs.readFileSync(out, 'utf8').trim().split('\n') };
  }

  it('produces the same records and the same totals for any worker count', async () => {
    const one = await run(1);
    const four = await run(4);
    const seven = await run(7);

    expect(four.stats.scoreTotals).to.deep.equal(one.stats.scoreTotals);
    expect(seven.stats.scoreTotals).to.deep.equal(one.stats.scoreTotals);
    expect(four.stats.decisions).to.equal(one.stats.decisions);
    expect(four.stats.games).to.equal(12);

    // Line 1 is the header, whose generatedAt differs per run; the records must not.
    expect(four.lines.slice(1)).to.deep.equal(one.lines.slice(1));
    expect(seven.lines.slice(1)).to.deep.equal(one.lines.slice(1));
  });

  it('writes a header record and orders the file by seed', async () => {
    const { lines } = await run(4);
    const header = JSON.parse(lines[0]);
    expect(header.type).to.equal('header');
    expect(header.meta.schemaVersion).to.equal(SCHEMA_VERSION);

    const order = [];
    for (const line of lines.slice(1)) {
      const record = JSON.parse(line);
      expect(record.datasetId).to.equal(header.meta.datasetId);
      const index = Number(record.matchId.split('-').pop());
      if (order[order.length - 1] !== index) order.push(index);
    }
    expect(order).to.deep.equal([...order].sort((a, b) => a - b));
    expect(order).to.deep.equal(Array.from({ length: 12 }, (_, i) => i));
  });

  it('leaves no shard files behind', async () => {
    await run(4);
    expect(fs.readdirSync(dir).filter(f => f.includes('.part-'))).to.deep.equal([]);
  });
});
