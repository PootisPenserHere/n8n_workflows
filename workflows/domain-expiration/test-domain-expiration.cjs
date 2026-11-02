const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Offline checks: execute the exported JavaScript, with no database or network calls.
const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, 'Domain expiration - Configured domains.json'), 'utf8'));
const nodes = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]));
const now = '2026-11-02T01:00:00.000Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}

function runCode(name, inputs, linked = {}) {
  const output = vm.runInNewContext(`(function () { ${nodes[name].parameters.jsCode}\n})()`, {
    Date: FixedDate,
    $input: {
      first: () => ({ json: inputs[0] }),
      all: () => inputs.map((json) => ({ json })),
    },
    $: (linkedName) => {
      assert.ok(linkedName in linked, `Missing current linked item for ${linkedName}`);
      return { item: { json: linked[linkedName] } };
    },
  }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(output));
}

function configRows(payload, chatId = '687532978') {
  return [
    { name: 'DOMAIN_EXPIRATION_CONFIG', data: JSON.stringify(payload) },
    { name: 'PERSONAL_TELEGRAM_CHAT_ID', data: chatId },
  ];
}
function lookupResponse(days, envelope = false) {
  const iso = new Date(Date.parse(now) + days * 86400000).toISOString();
  const html = `<span class="date registry-expiration">${iso}</span>`;
  return { statusCode: 200, data: envelope ? JSON.stringify({ data: html }) : html };
}
function analyze(response, domain = 'aramburo.dev') {
  return runCode('Analyze Domain', [response], { 'Loop Domains': { domain, chatId: '687532978' } })[0].json;
}
function nextNode(name, output = 0) {
  const edges = workflow.connections[name]?.main[output] || [];
  assert.equal(edges.length, 1, `Expected one continuation from ${name}, output ${output}`);
  return edges[0].node;
}

// A small graph driver checks the actual exported connections, including the loop's
// two outputs and conditional routes. n8n itself still needs an import/manual check.
function runGraph(rows, lookups, telegramReplies = {}) {
  let current = nextNode('Manual Test');
  let inputs = [{}];
  let pending;
  const completed = [];
  const linked = {};
  const events = [];
  for (let step = 0; step < 200; step++) {
    const node = nodes[current];
    assert.ok(node, `Unknown node: ${current}`);
    let output = 0;
    if (node.type.endsWith('.postgres')) {
      inputs = rows.length ? rows : [{}];
    } else if (node.type.endsWith('.splitInBatches')) {
      if (pending === undefined) pending = [...inputs];
      else completed.push(...inputs);
      const domain = pending.shift();
      output = domain ? 1 : 0;
      inputs = domain ? [domain] : completed;
      if (domain) linked[current] = domain;
    } else if (node.type.endsWith('.httpRequest')) {
      const domain = inputs[0].domain;
      events.push(`lookup:${domain}`);
      assert.ok(domain in lookups, `Unexpected lookup: ${domain}`);
      inputs = [lookups[domain]];
    } else if (node.type.endsWith('.telegram')) {
      const domain = inputs[0].domain;
      events.push(`${current}:${domain}`);
      inputs = [telegramReplies[domain] || { ok: true, result: { message_id: 42 } }];
    } else if (node.type.endsWith('.if')) {
      const condition = node.parameters.conditions.conditions[0];
      const expression = condition.leftValue.match(/^=\{\{\s*([\s\S]*?)\s*\}\}$/)[1];
      const value = vm.runInNewContext(expression, { $json: inputs[0] }, { timeout: 1000 });
      const passed = condition.operator.type === 'boolean' ? value === true : value === condition.rightValue;
      output = passed ? 0 : 1;
    } else if (node.type.endsWith('.code')) {
      inputs = runCode(current, inputs, linked).map((item) => item.json);
      if (current === 'Run Summary') return { summary: inputs[0], events };
      linked[current] = inputs[0];
      if (!inputs.length) return { summary: null, events };
    } else {
      assert.fail(`Unsupported node in test route: ${current}`);
    }
    current = nextNode(current, output);
  }
  assert.fail('Graph did not terminate');
}

test('the SQL payload seeds every existing domain as JSON serialized into TEXT', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../database/domain-expiration/config.example.sql'), 'utf8');
  const payload = JSON.parse(sql.match(/\$domain_config\$([\s\S]*?)\$domain_config\$::jsonb::text/)[1]);
  assert.deepEqual(runCode('Parse Domain Config', configRows(payload)).map((item) => item.json.domain), [
    'aramburo.dev', 'laziness.rocks', 'perfildelinversionistainverplux.com',
  ]);
});

test('configuration normalizes and deduplicates names in their first-seen order', () => {
  const items = runCode('Parse Domain Config', configRows({
    domains: [' ARAMBURO.DEV. ', 'laziness.rocks', 'aramburo.dev', 'xn--bcher-kva.de'],
    lookupUrl: 'https://lookup.example.test/v1/icann/lookup',
  }, '-1001234567890'));
  assert.deepEqual(items.map((item) => item.json.domain), ['aramburo.dev', 'laziness.rocks', 'xn--bcher-kva.de']);
  assert.equal(items[0].json.chatId, '-1001234567890');
  assert.equal(items[0].json.lookupUrl, 'https://lookup.example.test/v1/icann/lookup');
});

test('an empty domain list intentionally stops before lookup or notification', () => {
  assert.deepEqual(runGraph(configRows({ domains: [] }), {}), { summary: null, events: [] });
});

test('missing, malformed, double-serialized, and invalid configuration is rejected', () => {
  assert.throws(() => runCode('Parse Domain Config', [{}]), /DOMAIN_EXPIRATION_CONFIG/);
  for (const raw of ['{', JSON.stringify(JSON.stringify({ domains: ['aramburo.dev'] })), 'null', '[]', '{}']) {
    const rows = configRows({ domains: [] });
    rows[0].data = raw;
    assert.throws(() => runCode('Parse Domain Config', rows), /JSON|domains/);
  }
  for (const domain of ['', null, {}, 'https://aramburo.dev', 'aramburo.dev/path', '-bad.dev', 'bad..dev', 'bücher.de', '127.0.0.1', `${'x'.repeat(64)}.dev`]) {
    assert.throws(() => runCode('Parse Domain Config', configRows({ domains: ['aramburo.dev', domain] })), /domain|DNS/);
  }
  for (const lookupUrl of [null, 'file:///tmp/lookup', 'https://example.test/?domain=other.dev', 'https://user:pass@example.test/lookup', 'https://example.test/#fragment']) {
    assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [], lookupUrl })), /lookupUrl/);
  }
  assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [] }, '')), /CHAT_ID/);
  assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [] }).slice(0, 1)), /CHAT_ID/);
});

test('all reminder and critical boundaries retain the original floored-day rules', () => {
  for (const [days, level] of [
    [61, null], [60, '60_days'], [59, null], [31, null], [30, '30_days'], [29, null],
    [16, null], [15, '15_days'], [14, null], [11, null], [10, 'critical'],
    [1, 'critical'], [0.5, 'critical'], [0, 'critical'], [-1, 'critical'],
  ]) {
    const result = analyze(lookupResponse(days));
    assert.equal(result.status, 'ok');
    assert.equal(result.daysUntilExpiration, Math.max(0, Math.floor(days)));
    assert.equal(result.alertLevel, level, `${days} days`);
    assert.equal(result.shouldNotify, level !== null);
    assert.equal(result.expired, days <= 0);
  }
  assert.match(analyze(lookupResponse(-1)).message, /has expired/);
  assert.doesNotMatch(analyze(lookupResponse(0.5)).message, /has expired/);
});

test('JSON envelopes and HTML attribute/class variations retain current domain identity', () => {
  assert.equal(analyze(lookupResponse(60, true), 'laziness.rocks').domain, 'laziness.rocks');
  const result = analyze({ statusCode: 200, data: JSON.stringify({
    data: "<span data-source='registry' class='extra registry-expiration date'>\n 2026-12-02&nbsp;01:00:00 UTC\n</span>",
  }) }, 'perfildelinversionistainverplux.com');
  assert.equal(result.status, 'ok');
  assert.equal(result.expirationDateParsed, '2026-12-02T01:00:00.000Z');
  assert.equal(result.daysUntilExpiration, 30);
  assert.match(result.message, /perfildelinversionistainverplux\.com/);
});

test('UTC parsing accepts milliseconds and rejects invalid calendar dates and ambiguous zones', () => {
  for (const value of ['2028-02-29 12:34:56 UTC', '2028-02-29T12:34:56.123Z']) {
    assert.equal(analyze({ statusCode: 200, data: `<span class="date registry-expiration">${value}</span>` }).status, 'ok');
  }
  for (const value of ['2027-02-29 12:00:00 UTC', '2026-13-02 01:00:00 UTC', '2026-11-02 25:00:00 UTC', '2026-11-02T01:00:00', '2026-11-02 01:00:00 PST']) {
    const result = analyze({ statusCode: 200, data: `<span class="date registry-expiration">${value}</span>` });
    assert.equal(result.status, 'error');
    assert.equal(result.error.stage, 'parse');
    assert.equal(result.notificationType, 'error');
  }
});

test('request failures, missing HTML, malformed JSON, and missing dates yield error notifications', () => {
  for (const [response, stage] of [
    [{ error: 'ETIMEDOUT' }, 'request'],
    [{ error: { message: 'ECONNREFUSED' } }, 'request'],
    [{ statusCode: 503, data: 'Unavailable' }, 'request'],
    [{ statusCode: 404, data: '<html>Missing</html>' }, 'request'],
    [{ statusCode: 200, data: '' }, 'parse'],
    [{ statusCode: 200, data: '{broken' }, 'parse'],
    [{ statusCode: 200, data: '{}' }, 'parse'],
    [{ statusCode: 200, data: '<html>No registry date</html>' }, 'parse'],
  ]) {
    const result = analyze(response);
    assert.equal(result.status, 'error');
    assert.equal(result.error.stage, stage);
    assert.equal(result.shouldNotify, true);
  }
  const escaped = analyze({ error: '<unavailable> & failed' });
  assert.match(escaped.message, /&lt;unavailable&gt; &amp; failed/);
  assert.equal(analyze({ error: 'x'.repeat(5000) }).error.message.length, 1000);
});

test('Telegram delivery requires confirmation and preserves the linked domain result', () => {
  const result = analyze(lookupResponse(60), 'laziness.rocks');
  const linked = { 'Analyze Domain': result };
  const sent = runCode('Record Notification Result', [{ ok: true, result: { message_id: 123 } }], linked)[0].json;
  assert.equal(sent.domain, 'laziness.rocks');
  assert.equal(sent.notification.status, 'sent');
  assert.equal(sent.notification.messageId, 123);
  for (const response of [{ error: 'Forbidden' }, { error: { message: 'timeout' } }, { ok: false, description: 'Bad Request' }, {}]) {
    const failed = runCode('Record Notification Result', [response], linked)[0].json;
    assert.equal(failed.domain, 'laziness.rocks');
    assert.equal(failed.notification.status, 'failed');
    assert.equal(failed.notification.messageId, null);
    assert.ok(failed.notification.error);
  }
});

test('the graph processes later domains after lookup and Telegram failures, in order', () => {
  const { summary, events } = runGraph(configRows({
    domains: ['aramburo.dev', 'laziness.rocks', 'perfildelinversionistainverplux.com'],
  }), {
    'aramburo.dev': lookupResponse(60),
    'laziness.rocks': { error: 'ETIMEDOUT' },
    'perfildelinversionistainverplux.com': lookupResponse(365),
  }, { 'aramburo.dev': { error: 'Telegram unavailable' } });
  assert.deepEqual(events, [
    'lookup:aramburo.dev', 'Telegram - Expiration Alert:aramburo.dev',
    'lookup:laziness.rocks', 'Telegram - Lookup Error:laziness.rocks',
    'lookup:perfildelinversionistainverplux.com',
  ]);
  assert.equal(summary.status, 'partial_error');
  assert.equal(summary.checkedCount, 3);
  assert.equal(summary.lookupErrorCount, 1);
  assert.equal(summary.notificationFailureCount, 1);
  assert.equal(summary.expirationAlertsSent, 0);
  assert.equal(summary.errorNotificationsSent, 1);
  assert.equal(summary.results[2].notification.status, 'not_required');
  assert.ok(summary.results.every((result) => !('chatId' in result) && !('message' in result)));
});

test('parse-error and successful-alert branches both return to the loop and report a summary', () => {
  const { summary, events } = runGraph(configRows({ domains: ['aramburo.dev', 'laziness.rocks'] }), {
    'aramburo.dev': { statusCode: 200, data: '<html>No date</html>' },
    'laziness.rocks': lookupResponse(10),
  });
  assert.equal(summary.checkedCount, 2);
  assert.equal(summary.lookupErrorCount, 1);
  assert.equal(summary.expirationAlertsSent, 1);
  assert.equal(summary.errorNotificationsSent, 1);
  assert.equal(summary.notificationFailureCount, 0);
  assert.equal(events.at(-1), 'Telegram - Expiration Alert:laziness.rocks');
  const healthy = runGraph(configRows({ domains: ['aramburo.dev'] }), { 'aramburo.dev': lookupResponse(100) });
  assert.equal(healthy.summary.status, 'ok');
});

test('export settings preserve one daily schedule, sequential looping, and error continuation', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes.filter((node) => node.type.endsWith('.scheduleTrigger')).length, 1);
  assert.equal(nodes['Schedule - Daily 1AM'].parameters.rule.interval[0].expression, '0 1 * * *');
  assert.equal(nodes['Loop Domains'].typeVersion, 3);
  assert.equal(nodes['Loop Domains'].parameters.batchSize, 1);
  assert.equal(nodes['Loop Domains'].parameters.options.reset || false, false);
  assert.equal(nodes['Get Domain Config'].alwaysOutputData, true);
  assert.equal(nodes['Fetch ICANN Data'].parameters.options.timeout, 30000);
  assert.equal(nodes['Fetch ICANN Data'].parameters.options.response.response.responseFormat, 'text');
  for (const name of ['Fetch ICANN Data', 'Telegram - Expiration Alert', 'Telegram - Lookup Error']) {
    assert.equal(nodes[name].onError, 'continueRegularOutput');
  }
  for (const source of Object.values(workflow.connections)) {
    for (const output of source.main) {
      for (const edge of output) assert.ok(nodes[edge.node], `Unknown connection target ${edge.node}`);
    }
  }
});
