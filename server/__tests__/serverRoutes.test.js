const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const supertest = require('supertest');

const APP_MODULE_ID = require.resolve('../app');
const DB_MODULE_ID = require.resolve('../db');

function withServer(fn) {
  const tmpDb = path.join(__dirname, 'tmp', `fest-route-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const tmpUploadDir = path.join(__dirname, 'tmp', `fest-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(path.dirname(tmpDb), { recursive: true });
  fs.mkdirSync(tmpUploadDir, { recursive: true });
  process.env.DB_PATH = tmpDb;
  process.env.SEED_MODE = 'fresh';
  process.env.TEAM_IMAGE_UPLOAD_DIR = tmpUploadDir;

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
    delete process.env.TEAM_IMAGE_UPLOAD_DIR;
    try { fs.unlinkSync(tmpDb); } catch (e) { /* ignore */ }
    try { fs.rmSync(tmpUploadDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
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

test('class booth admin is restricted to its own booth', async () => {
  await withServer(async ({ request }) => {
    const login = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '1-1', password: '0000' })
      .expect(200);

    const token = login.body.token;

    await request
      .get('/api/booths/1/usages/summary')
      .set('x-admin-token', token)
      .expect(200);

    const forbidden = await request
      .get('/api/booths/2/usages/summary')
      .set('x-admin-token', token)
      .expect(403);

    assert.strictEqual(forbidden.body.error, 'FORBIDDEN');
  });
});

test('superadmin can access dashboard and all booths', async () => {
  await withServer(async ({ request }) => {
    const login = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '통합관리자', password: 'dudtkswnd1!' })
      .expect(200);

    assert.strictEqual(login.body.isSuperAdmin, true);
    assert.ok(login.body.token);

    const dashboard = await request
      .get('/api/admin/booth-ops/dashboard')
      .set('x-admin-token', login.body.token)
      .expect(200);

    assert.ok(Array.isArray(dashboard.body.booths));

    await request
      .get('/api/booths/2/usages/summary')
      .set('x-admin-token', login.body.token)
      .expect(200);
  });
});

test('superadmin can update booth admin passwords', async () => {
  await withServer(async ({ request }) => {
    const superLogin = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '통합관리자', password: 'dudtkswnd1!' })
      .expect(200);

    const superToken = superLogin.body.token;

    await request
      .put('/api/admin/booth-ops/booth-admins/1-1/password')
      .set('x-admin-token', superToken)
      .set('Content-Type', 'application/json')
      .send({ password: '1234' })
      .expect(200);

    await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '1-1', password: '0000' })
      .expect(401);

    const newLogin = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '1-1', password: '1234' })
      .expect(200);

    assert.strictEqual(newLogin.body.isSuperAdmin, false);
    assert.strictEqual(newLogin.body.boothId, 1);

    const classLogin = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '1-2', password: '0000' })
      .expect(200);

    await request
      .put('/api/admin/booth-ops/booth-admins/1-1/password')
      .set('x-admin-token', classLogin.body.token)
      .set('Content-Type', 'application/json')
      .send({ password: '9999' })
      .expect(403);

    await request
      .put('/api/admin/booth-ops/booth-admins/통합관리자/password')
      .set('x-admin-token', superToken)
      .set('Content-Type', 'application/json')
      .send({ password: 'nope' })
      .expect(400);
  });
});

test('admin can upload a team image (dataUrl)', async () => {
  await withServer(async ({ request }) => {
    // 1x1 transparent PNG
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7WQXwAAAAASUVORK5CYII=';

    const uploaded = await request
      .put('/api/admin/team/1/image')
      .set('Content-Type', 'application/json')
      .send({ dataUrl })
      .expect(200);

    assert.strictEqual(uploaded.body.success, true);
    assert.ok(typeof uploaded.body.imageUrl === 'string');
    assert.ok(uploaded.body.imageUrl.startsWith('/images/teams/uploads/team-1.png'));

    const filePath = path.join(process.env.TEAM_IMAGE_UPLOAD_DIR, 'team-1.png');
    assert.ok(fs.existsSync(filePath), 'uploaded file should exist on disk');

    const teams = await request.get('/api/teams').expect(200);
    const updated = teams.body.find(t => t.id === 1);
    assert.ok(updated, 'team should exist');
    assert.strictEqual(updated.image_url, uploaded.body.imageUrl);
  });
});

test('admin can download student CSV template and import students (replace/merge)', async () => {
  await withServer(async ({ request }) => {
    const template = await request.get('/api/admin/students/template').expect(200);
    assert.strictEqual(typeof template.body.csv, 'string');
    assert.ok(template.body.csv.includes('grade,class_no,student_no,name'));

    const csvText = 'grade,class_no,student_no,name\n1,1,1,홍길동\n3,3,20,김코덱스\n';

    const imported = await request
      .post('/api/admin/students/import')
      .set('Content-Type', 'application/json')
      .send({ csvText, mode: 'replace' })
      .expect(200);

    assert.strictEqual(imported.body.success, true);
    assert.strictEqual(imported.body.totalStudents, 2);
    assert.strictEqual(imported.body.mode, 'replace');

    const stats = await request.get('/api/admin/students/stats').expect(200);
    assert.strictEqual(stats.body.totalStudents, 2);

    const merged = await request
      .post('/api/admin/students/import')
      .set('Content-Type', 'application/json')
      .send({ csvText: 'grade,class_no,student_no,name\n1,2,1,새학생\n', mode: 'merge' })
      .expect(200);

    assert.strictEqual(merged.body.success, true);
    assert.strictEqual(merged.body.mode, 'merge');
    assert.strictEqual(merged.body.inserted, 1);
    assert.strictEqual(merged.body.totalStudents, 3);
  });
});

test('student import blocks replace when usage exists unless resetBoothUsage is true', async () => {
  await withServer(async ({ request }) => {
    const login = await request
      .post('/api/admin/booth-login')
      .set('Content-Type', 'application/json')
      .send({ className: '1-1', password: '0000' })
      .expect(200);

    const token = login.body.token;

    await request
      .post('/api/booths/1/use')
      .set('x-admin-token', token)
      .set('Content-Type', 'application/json')
      .send({ studentId: 1 })
      .expect(200);

    const csvText = 'grade,class_no,student_no,name\n1,1,1,홍길동\n';

    const blocked = await request
      .post('/api/admin/students/import')
      .set('Content-Type', 'application/json')
      .send({ csvText, mode: 'replace', resetBoothUsage: false })
      .expect(409);

    assert.strictEqual(blocked.body.error, 'HAS_USAGE_DATA');

    const allowed = await request
      .post('/api/admin/students/import')
      .set('Content-Type', 'application/json')
      .send({ csvText, mode: 'replace', resetBoothUsage: true })
      .expect(200);

    assert.strictEqual(allowed.body.success, true);
    assert.strictEqual(allowed.body.totalStudents, 1);
  });
});
