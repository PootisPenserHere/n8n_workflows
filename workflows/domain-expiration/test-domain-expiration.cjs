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

function codeContext(inputs, linked) {
  return {
    Date: FixedDate,
    Buffer,
    $input: {
      first: () => ({ json: inputs[0] }),
      all: () => inputs.map((json) => ({ json })),
    },
    $: (linkedName) => {
      assert.ok(linkedName in linked, `Missing current linked item for ${linkedName}`);
      return { item: { json: linked[linkedName] } };
    },
  };
}

function runCode(name, inputs, linked = {}) {
  const output = vm.runInNewContext(`(function () { ${nodes[name].parameters.jsCode}\n})()`, codeContext(inputs, linked), { timeout: 1000 });
  return JSON.parse(JSON.stringify(output));
}

async function runAsyncCode(name, inputs, linked, httpRequest) {
  const output = await vm.runInNewContext(`(async function () { ${nodes[name].parameters.jsCode}\n})()`, {
    ...codeContext(inputs, linked),
    helpers: { httpRequest },
  }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(output));
}

function configRows(payload, overrides = {}) {
  return Object.entries({
    DOMAIN_EXPIRATION_CONFIG: JSON.stringify(payload),
    PLAYWRIGHT_BASE_URL: 'http://playwright-api:8080',
    NOTIFICATIONS_BASE_URL: 'https://ntfy.example.test',
    NOTIFICATIONS_INFRA_ISSUES_TOPIC: 'infra-issues',
    NOTIFICATIONS_USER: 'test-user',
    NOTIFICATIONS_PASSWORD: 'test-password',
    ...overrides,
  }).map(([name, data]) => ({ name, data }));
}
function lookupResponse(days, envelope = false) {
  const iso = new Date(Date.parse(now) + days * 86400000).toISOString();
  const html = `<span class="date registry-expiration">${iso}</span>`;
  return { statusCode: 200, data: envelope ? JSON.stringify({ data: html }) : html };
}
function analyze(response, domain = 'aramburo.dev') {
  return runCode('Analyze Domain', [response], { 'Loop Domains': { domain } })[0].json;
}
async function send(result, httpRequest, overrides = {}) {
  const item = runCode('Parse Domain Config', configRows({ domains: [result.domain] }, overrides))[0].json;
  return (await runAsyncCode('Send Domain ntfy', [result], { 'Loop Domains': item }, httpRequest))[0].json;
}
function nextNode(name, output = 0) {
  const edges = workflow.connections[name]?.main[output] || [];
  assert.equal(edges.length, 1, `Expected one continuation from ${name}, output ${output}`);
  return edges[0].node;
}

function renderRequest(item) {
  const parameters = nodes['Render ICANN Lookup'].parameters;
  const evaluate = (expression) => vm.runInNewContext(
    expression.match(/^=\{\{\s*([\s\S]*?)\s*\}\}$/)[1], { $json: item }, { timeout: 1000 },
  );
  return {
    url: new URL(evaluate(parameters.url)),
    body: JSON.parse(JSON.stringify(evaluate(parameters.jsonBody))),
  };
}

// A small graph driver checks the actual exported connections, including the loop's
// two outputs and conditional routes. n8n itself still needs an import/manual check.
async function runGraph(rows, lookups, ntfyReplies = {}) {
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
      const request = renderRequest(inputs[0]);
      assert.equal(request.url.origin, 'http://playwright-api:8080');
      assert.equal(request.url.pathname, '/render/actions');
      assert.equal(request.body.url, 'https://lookup.icann.org/en');
      assert.equal(request.body.actions[0].value, domain);
      events.push(`lookup:${domain}`);
      assert.ok(domain in lookups, `Unexpected lookup: ${domain}`);
      inputs = [lookups[domain]];
    } else if (node.type.endsWith('.if')) {
      const condition = node.parameters.conditions.conditions[0];
      const expression = condition.leftValue.match(/^=\{\{\s*([\s\S]*?)\s*\}\}$/)[1];
      const value = vm.runInNewContext(expression, { $json: inputs[0] }, { timeout: 1000 });
      const passed = condition.operator.type === 'boolean' ? value === true : value === condition.rightValue;
      output = passed ? 0 : 1;
    } else if (node.type.endsWith('.code')) {
      if (current === 'Send Domain ntfy') {
        const domain = inputs[0].domain;
        inputs = (await runAsyncCode(current, inputs, linked, async (request) => {
          events.push(`ntfy:${domain}`);
          assert.equal(JSON.parse(request.body).topic, 'infra-issues');
          const reply = ntfyReplies[domain];
          if (reply instanceof Error) throw reply;
          return reply || { statusCode: 200 };
        })).map((item) => item.json);
      } else {
        inputs = runCode(current, inputs, linked).map((item) => item.json);
      }
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

test('the SQL example stores parseable domain JSON as TEXT', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../database/domain-expiration/config.example.sql'), 'utf8');
  const payload = JSON.parse(sql.match(/\$domain_config\$([\s\S]*?)\$domain_config\$::jsonb::text/)[1]);
  assert.ok(payload.domains.length > 0);
  assert.deepEqual(runCode('Parse Domain Config', configRows(payload)).map((item) => item.json.domain), payload.domains);
});

test('configuration normalizes and deduplicates names in their first-seen order', () => {
  const items = runCode('Parse Domain Config', configRows({
    domains: [' ARAMBURO.DEV. ', 'laziness.rocks', 'aramburo.dev', 'xn--bcher-kva.de'],
  }, { NOTIFICATIONS_BASE_URL: ' https://ntfy.example.test/// ', NOTIFICATIONS_USER: ' test-user ' }));
  assert.deepEqual(items.map((item) => item.json.domain), ['aramburo.dev', 'laziness.rocks', 'xn--bcher-kva.de']);
  assert.equal(items[0].json.notifications.baseUrl, 'https://ntfy.example.test');
  assert.equal(items[0].json.notifications.user, 'test-user');
  assert.equal(items[0].json.renderInstructions.url, 'https://lookup.icann.org/en');
  assert.equal(items[0].json.renderInstructions.actions[0].value, 'aramburo.dev');
});

test('Playwright action requests preserve Docker host/port and tolerate trailing slashes', () => {
  for (const [base, expected] of [
    ['http://playwright-api:8080', 'http://playwright-api:8080/render/actions'],
    ['http://playwright-api:8080/', 'http://playwright-api:8080/render/actions'],
    [' http://srv-captain--playwright-api:8080/// ', 'http://srv-captain--playwright-api:8080/render/actions'],
    ['http://playwright:9000/api/', 'http://playwright:9000/api/render/actions'],
    ['http://[fd00::1]:8080/', 'http://[fd00::1]:8080/render/actions'],
    ['https://playwright.internal:8443', 'https://playwright.internal:8443/render/actions'],
  ]) {
    const items = runCode('Parse Domain Config', configRows({ domains: ['aramburo.dev', 'laziness.rocks'] }, { PLAYWRIGHT_BASE_URL: base }));
    for (const { json: item } of items) {
      assert.equal(item.renderUrl, expected);
      const request = renderRequest(item);
      assert.equal(request.url.origin + request.url.pathname, expected);
      assert.equal(request.url.search, '');
      assert.equal(request.body.url, 'https://lookup.icann.org/en');
      assert.equal(request.body.wait_until, 'domcontentloaded');
      assert.equal(request.body.timeout_ms, 45000);
      assert.deepEqual(request.body.actions, [
        { type: 'fill', selector: '#input-domain', value: item.domain },
        { type: 'click', selector: '#domain-form button[type="submit"]' },
        { type: 'wait_for', selector: 'span.date.registry-expiration:text-matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")', state: 'visible' },
      ]);
    }
  }
});

test('missing or malformed Playwright addresses fail before rendering', () => {
  const rows = configRows({ domains: ['laziness.rocks'] }).filter((row) => row.name !== 'PLAYWRIGHT_BASE_URL');
  assert.throws(() => runCode('Parse Domain Config', rows), /PLAYWRIGHT_BASE_URL/);
  for (const base of [null, '', ' ', 'playwright:8080', 'file:///tmp/render', 'http://playwright:0', 'http://playwright:65536',
    'http://playwright:port', 'http://user:pass@playwright:8080', 'http://playwright:8080?url=example', 'http://playwright:8080/#fragment']) {
    assert.throws(() => runCode('Parse Domain Config', configRows({ domains: ['laziness.rocks'] }, { PLAYWRIGHT_BASE_URL: base })), /PLAYWRIGHT_BASE_URL/);
  }
});

test('an empty domain list intentionally stops before lookup or notification', async () => {
  assert.deepEqual(await runGraph(configRows({ domains: [] }), {}), { summary: null, events: [] });
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
});

test('ntfy requires its base URL and infrastructure topic, with optional credentials as a pair', () => {
  for (const key of ['NOTIFICATIONS_BASE_URL', 'NOTIFICATIONS_INFRA_ISSUES_TOPIC']) {
    assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [] }).filter((row) => row.name !== key)), new RegExp(key));
    assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [] }, { [key]: ' ' })), new RegExp(key));
  }
  assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [] }, { NOTIFICATIONS_BASE_URL: 'not-a-url' })), /NOTIFICATIONS_BASE_URL/);
  for (const overrides of [{ NOTIFICATIONS_USER: '' }, { NOTIFICATIONS_PASSWORD: '' }]) {
    assert.throws(() => runCode('Parse Domain Config', configRows({ domains: [] }, overrides)), /both be configured/);
  }
  const noAuth = configRows({ domains: ['laziness.rocks'] }).filter((row) => !['NOTIFICATIONS_USER', 'NOTIFICATIONS_PASSWORD'].includes(row.name));
  assert.equal(runCode('Parse Domain Config', noAuth)[0].json.notifications.user, '');
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
  for (const field of ['html', 'data']) {
    const result = analyze({ statusCode: 200, data: JSON.stringify({ [field]: lookupResponse(60).data }) }, 'laziness.rocks');
    assert.equal(result.status, 'ok');
    assert.equal(result.domain, 'laziness.rocks');
    assert.equal(result.daysUntilExpiration, 60);
  }
  const result = analyze({ statusCode: 200, data: JSON.stringify({
    data: "<span data-source='registry' class='extra registry-expiration date'>\n 2026-12-02&nbsp;01:00:00 UTC\n</span>",
  }) }, 'perfildelinversionistainverplux.com');
  assert.equal(result.status, 'ok');
  assert.equal(result.expirationDateParsed, '2026-12-02T01:00:00.000Z');
  assert.equal(result.daysUntilExpiration, 30);
  assert.match(result.message, /perfildelinversionistainverplux\.com/);
});

test('a rendered ICANN home form is diagnosed as an incomplete search', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/icann-home.html'), 'utf8');
  const result = analyze({ statusCode: 200, data: html });
  assert.equal(result.status, 'error');
  assert.equal(result.error.stage, 'parse');
  assert.match(result.error.message, /home lookup form.*submission did not complete/);
  assert.equal(result.shouldNotify, true);
  assert.equal(result.expirationDate, null);
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
  const plain = analyze({ error: '<unavailable> & failed' });
  assert.match(plain.message, /<unavailable> & failed/);
  assert.equal(analyze({ error: 'x'.repeat(5000) }).error.message.length, 1000);
});

test('ntfy posts JSON to the base URL with the shared topic and Basic authentication', async () => {
  const result = analyze(lookupResponse(60), 'laziness.rocks');
  let request;
  const sent = await send(result, async (options) => {
    request = options;
    return { statusCode: 200 };
  }, { NOTIFICATIONS_PASSWORD: 'test-pässword' });
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://ntfy.example.test');
  assert.equal(request.timeout, 20000);
  assert.equal(request.returnFullResponse, true);
  assert.equal(request.ignoreHttpStatusErrors, true);
  assert.equal(request.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(request.headers.Authorization, `Basic ${Buffer.from('test-user:test-pässword').toString('base64')}`);
  const body = JSON.parse(request.body);
  assert.equal(body.topic, 'infra-issues');
  assert.match(body.title, /laziness\.rocks/);
  assert.equal(body.message, result.message);
  assert.equal(body.priority, 3);
  assert.deepEqual(body.tags, ['calendar']);
  assert.equal(sent.domain, 'laziness.rocks');
  assert.equal(sent.notification.status, 'sent');
  assert.equal(sent.notification.provider, 'ntfy');
  assert.equal(sent.notification.topic, 'infra-issues');
  assert.equal(sent.notification.statusCode, 200);
  assert.ok(!('notifications' in sent));
  assert.ok(!JSON.stringify(sent).includes('test-pässword'));
});

test('ntfy omits Basic authentication when both credentials are empty', async () => {
  await send(analyze(lookupResponse(30)), async (request) => {
    assert.equal('Authorization' in request.headers, false);
    return { statusCode: 202 };
  }, { NOTIFICATIONS_USER: '', NOTIFICATIONS_PASSWORD: '' });
});

test('ntfy priorities reflect reminder urgency and lookup failures', async () => {
  for (const [result, priority, tag] of [
    [analyze(lookupResponse(30)), 4, 'calendar'],
    [analyze(lookupResponse(15)), 4, 'calendar'],
    [analyze(lookupResponse(10)), 5, 'rotating_light'],
    [analyze({ error: 'ETIMEDOUT' }), 4, 'warning'],
  ]) {
    await send(result, async (request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.topic, 'infra-issues');
      assert.equal(body.priority, priority);
      assert.deepEqual(body.tags, [tag]);
      return { statusCode: 200 };
    });
  }
});

test('ntfy HTTP failures and network errors preserve the current domain result', async () => {
  const result = analyze(lookupResponse(60), 'laziness.rocks');
  for (const reply of [{ statusCode: 401 }, { statusCode: 503 }, {}, new Error('ETIMEDOUT')]) {
    const failed = await send(result, async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
    assert.equal(failed.domain, 'laziness.rocks');
    assert.equal(failed.notification.status, 'failed');
    assert.equal(failed.notification.statusCode, reply.statusCode || null);
    assert.ok(failed.notification.error);
  }
});

test('the graph processes later domains after lookup and ntfy failures, in order', async () => {
  const { summary, events } = await runGraph(configRows({
    domains: ['aramburo.dev', 'laziness.rocks', 'perfildelinversionistainverplux.com'],
  }), {
    'aramburo.dev': lookupResponse(60),
    'laziness.rocks': { error: 'ETIMEDOUT' },
    'perfildelinversionistainverplux.com': lookupResponse(365),
  }, { 'aramburo.dev': new Error('ntfy unavailable') });
  assert.deepEqual(events, [
    'lookup:aramburo.dev', 'ntfy:aramburo.dev',
    'lookup:laziness.rocks', 'ntfy:laziness.rocks',
    'lookup:perfildelinversionistainverplux.com',
  ]);
  assert.equal(summary.status, 'partial_error');
  assert.equal(summary.checkedCount, 3);
  assert.equal(summary.lookupErrorCount, 1);
  assert.equal(summary.notificationFailureCount, 1);
  assert.equal(summary.expirationAlertsSent, 0);
  assert.equal(summary.errorNotificationsSent, 1);
  assert.equal(summary.results[2].notification.status, 'not_required');
  assert.ok(summary.results.every((result) => !('notifications' in result) && !('message' in result)));
  assert.ok(!JSON.stringify(summary).includes('test-password'));
});

test('parse-error and successful-alert branches both return to the loop and report a summary', async () => {
  const { summary, events } = await runGraph(configRows({ domains: ['aramburo.dev', 'laziness.rocks'] }), {
    'aramburo.dev': { statusCode: 200, data: '<html>No date</html>' },
    'laziness.rocks': lookupResponse(10),
  });
  assert.equal(summary.checkedCount, 2);
  assert.equal(summary.lookupErrorCount, 1);
  assert.equal(summary.expirationAlertsSent, 1);
  assert.equal(summary.errorNotificationsSent, 1);
  assert.equal(summary.notificationFailureCount, 0);
  assert.equal(events.at(-1), 'ntfy:laziness.rocks');
  const healthy = await runGraph(configRows({ domains: ['aramburo.dev'] }), { 'aramburo.dev': lookupResponse(100) });
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
  assert.equal(nodes['Render ICANN Lookup'].parameters.method, 'POST');
  assert.equal(nodes['Render ICANN Lookup'].parameters.specifyBody, 'json');
  assert.equal(nodes['Render ICANN Lookup'].parameters.options.timeout, 60000);
  assert.equal(nodes['Render ICANN Lookup'].parameters.options.response.response.responseFormat, 'text');
  assert.equal(nodes['Render ICANN Lookup'].onError, 'continueRegularOutput');
  assert.ok(nodes['Get Domain Config'].parameters.query.includes("'PLAYWRIGHT_BASE_URL'"));
  assert.ok(workflow.nodes.every((node) => !node.type.endsWith('.telegram')));
  assert.doesNotMatch(JSON.stringify(workflow), /PERSONAL_TELEGRAM_CHAT_ID|telegramApi/);
  assert.doesNotMatch(JSON.stringify(workflow), /selenium-service|\/v1\/icann\/lookup|config\.lookupUrl/);
  for (const source of Object.values(workflow.connections)) {
    for (const output of source.main) {
      for (const edge of output) assert.ok(nodes[edge.node], `Unknown connection target ${edge.node}`);
    }
  }
});
