const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');

const APP_MODULE_ID = require.resolve('../app');
const DB_MODULE_ID = require.resolve('../db');

function withServer(fn) {
  const tmpDb = path.join(__dirname, 'tmp', `fest-route-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  fs.mkdirSync(path.dirname(tmpDb), { recursive: true });
  process.env.DB_PATH = tmpDb;
  process.env.SEED_MODE = 'fresh';

  // Clear cached modules to re-init with fresh env
  delete require.cache[APP_MODULE_ID];
  delete require.cache[DB_MODULE_ID];

  const { createApp, initDB } = require('../app');
  initDB();
  const app = createApp({ disableIntervals: true });
  const request = supertest(app);

  const cleanup = () => {
    delete require.cache[APP_MODULE_ID];
    delete require.cache[DB_MODULE_ID];
    delete process.env.DB_PATH;
    delete process.env.SEED_MODE;
    try { fs.unlinkSync(tmpDb); } catch (e) { /* ignore */ }
  };

  let maybePromise;
  try {
    maybePromise = fn({ request });
  } catch (err) {
    cleanup();
    throw err;
  }
  return Promise.resolve(maybePromise).finally(cleanup);
}

test('booth admin login works on /api and /ys-fest/api prefixes', async () => {
  await withServer(async ({ request }) => {
    const payload = { className: '1-1', password: '0000' };

    const direct = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    assert.ok(direct.body.token);
    assert.strictEqual(direct.body.className, '1-1');
    assert.strictEqual(direct.body.boothId, 1);

    const prefixed = await request
      .post('/ys-fest/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    assert.ok(prefixed.body.token);
    assert.strictEqual(prefixed.body.className, '1-1');
    assert.strictEqual(prefixed.body.boothId, 1);
  });
});
