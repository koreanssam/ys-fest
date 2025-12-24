const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_MODULE_ID = require.resolve('../db');
const TMP_DIR = path.join(__dirname, 'tmp');
const MAX_USAGE = 3;

/**
 * Helper to spin up a fresh seeded DB for each test without touching the real fest.db.
 */
function withTestDb(fn) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const dbFile = path.join(TMP_DIR, `fest-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);

  process.env.DB_PATH = dbFile;
  process.env.SEED_MODE = 'fresh';
  delete require.cache[DB_MODULE_ID];
  const dbModule = require(DB_MODULE_ID);
  dbModule.initDB();

  const cleanup = () => {
    delete require.cache[DB_MODULE_ID];
    delete process.env.DB_PATH;
    delete process.env.SEED_MODE;
    try { fs.unlinkSync(dbFile); } catch (e) { /* ignore */ }
  };

  let maybePromise;
  try {
    maybePromise = fn(dbModule, dbFile);
  } catch (err) {
    cleanup();
    throw err;
  }

  return Promise.resolve(maybePromise).finally(cleanup);
}

test('seeds 143 students and booth admins with default pins', async () => {
  await withTestDb((dbModule) => {
    const students = dbModule.getStudents();
    assert.strictEqual(students.length, 143);

    const booth = dbModule.getBooths()[0];
    const admin = dbModule.loginBoothAdmin(booth.class_name, '0000');
    assert.ok(admin, 'booth admin should be seeded with default PIN');
  });
});

test('enforces per-student per-booth usage limit of three', async () => {
  await withTestDb((dbModule) => {
    const booth = dbModule.getBooths()[0];
    const student = dbModule.getStudents()[0];
    const admin = dbModule.loginBoothAdmin(booth.class_name, '0000');
    assert.ok(admin, 'admin login should succeed');

    for (let i = 1; i <= MAX_USAGE; i += 1) {
      const res = dbModule.useBooth(booth.id, student.id, admin.id);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.totalUsed, i);
      assert.strictEqual(res.remaining, Math.max(0, MAX_USAGE - i));
    }

    const over = dbModule.useBooth(booth.id, student.id, admin.id);
    assert.strictEqual(over.success, false);
    assert.strictEqual(over.error, 'OVER_LIMIT');
    assert.strictEqual(over.remaining, 0);
  });
});

test('usage summary reflects counts and remaining buckets', async () => {
  await withTestDb((dbModule) => {
    const booth = dbModule.getBooths()[1];
    const [studentA, studentB] = dbModule.getStudents();
    const admin = dbModule.loginBoothAdmin(booth.class_name, '0000');

    let summary = dbModule.getBoothUsageSummary(booth.id);
    assert.strictEqual(summary.totalUsage, 0);
    assert.strictEqual(summary.remainingBuckets[3], summary.totalStudents);

    dbModule.useBooth(booth.id, studentA.id, admin.id);
    dbModule.useBooth(booth.id, studentB.id, admin.id);

    summary = dbModule.getBoothUsageSummary(booth.id);
    assert.strictEqual(summary.totalUsage, 2);
    assert.strictEqual(summary.uniqueStudents, 2);
    assert.strictEqual(summary.perStudentCounts[studentA.id], 1);
    assert.strictEqual(summary.remainingBuckets[2], 2);
    assert.strictEqual(summary.remainingBuckets[3], summary.totalStudents - 2);
  });
});

test('voiding a usage removes it from counts and records audit trail', async () => {
  await withTestDb((dbModule, dbFile) => {
    const booth = dbModule.getBooths()[2];
    const student = dbModule.getStudents()[0];
    const admin = dbModule.loginBoothAdmin(booth.class_name, '0000');

    const { recentEntry } = dbModule.useBooth(booth.id, student.id, admin.id);
    assert.ok(recentEntry?.id, 'usage should be recorded');

    dbModule.voidBoothUsage(recentEntry.id, admin.id, 'undo');

    const summary = dbModule.getBoothUsageSummary(booth.id);
    assert.strictEqual(summary.totalUsage, 0);
    assert.strictEqual(summary.perStudentCounts[student.id], undefined);

    const auditDb = new Database(dbFile);
    const voided = auditDb.prepare('SELECT booth_usage_id, void_by_admin_id, void_reason FROM booth_usages_void').get();
    auditDb.close();

    assert.deepStrictEqual(voided, {
      booth_usage_id: recentEntry.id,
      void_by_admin_id: admin.id,
      void_reason: 'undo'
    });
  });
});
