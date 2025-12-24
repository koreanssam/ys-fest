const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const MAX_USAGE_PER_BOOTH = 3;
const BOOTH_SUPERADMIN_NAME = process.env.BOOTH_SUPERADMIN_NAME || '통합관리자';
const BOOTH_SUPERADMIN_PASSWORD = process.env.BOOTH_SUPERADMIN_PASSWORD || 'dudtkswnd1!';
const resolvedPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.resolve(__dirname, 'fest.db');
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
const db = new Database(resolvedPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 3000');

const dataDir = path.join(__dirname, 'data');
const studentCsvPath = path.join(dataDir, 'students.csv');
const sourceSheetPath = path.resolve(__dirname, '..', 'student_sheet.csv');

function ensureTeamColumns() {
    const cols = db.prepare('PRAGMA table_info(teams)').all().map(c => c.name);
    if (!cols.includes('judge_exempt')) {
        db.prepare('ALTER TABLE teams ADD COLUMN judge_exempt INTEGER DEFAULT 0').run();
    }
    db.prepare('UPDATE teams SET judge_exempt = 0 WHERE judge_exempt IS NULL').run();
}

function ensureStudentCsv() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(studentCsvPath)) return studentCsvPath;
    if (!fs.existsSync(sourceSheetPath)) return studentCsvPath;

    const raw = fs.readFileSync(sourceSheetPath, 'utf8').trim();
    if (!raw) return studentCsvPath;

    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return studentCsvPath;

    const [, ...rows] = lines; // skip header
    const normalized = ['grade,class_no,student_no,name'];
    rows.forEach(line => {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 4) return;
        const [grade, classNo, studentNo, name] = parts;
        if (!grade || !classNo || !studentNo || !name) return;
        normalized.push([grade, classNo, studentNo, name].join(','));
    });

    fs.writeFileSync(studentCsvPath, normalized.join('\n'), 'utf8');
    return studentCsvPath;
}

function parseStudentsCsv(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split(/\r?\n/);
    const rows = [];
    lines.slice(1).forEach(line => {
        const [grade, class_no, student_no, name] = line.split(',').map(s => s.trim());
        if (!grade || !class_no || !student_no || !name) return;
        rows.push({
            grade: parseInt(grade, 10),
            class_no: parseInt(class_no, 10),
            student_no: parseInt(student_no, 10),
            name
        });
    });
    return rows;
}

function dropTables() {
    const tables = ['booth_usages_void', 'booth_usages', 'booth_admins', 'students', 'scores', 'judges', 'teams', 'booths'];
    tables.forEach(tbl => {
        db.prepare(`DROP TABLE IF EXISTS ${tbl}`).run();
    });
}

function initDB() {
    if (process.env.SEED_MODE === 'fresh') {
        console.log('[DB] fresh seed mode: dropping tables');
        dropTables();
    }

    createCoreTables();
    ensureTeamColumns();
    createBoothOpsTables();
    seedCoreData();
    seedStudents();
    seedBoothAdmins();
}

function createCoreTables() {
    // TEAMS (Performers)
    db.prepare(`
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            image_url TEXT,
            category TEXT, -- 'GROUP' or 'INDIVIDUAL'
            vote_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'WAITING', -- WAITING, LIVE, DONE
            perf_order INTEGER,
            judge_exempt INTEGER DEFAULT 0 -- 1이면 심사에서 제외
        )
    `).run();

    // JUDGES
    db.prepare(`
        CREATE TABLE IF NOT EXISTS judges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            password TEXT NOT NULL
        )
    `).run();

    // SCORES
    db.prepare(`
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            judge_id INTEGER,
            team_id INTEGER,
            score_prep INTEGER, -- Preparation
            score_resp INTEGER, -- Response
            score_exp INTEGER,  -- Expression
            score_inc INTEGER,  -- Inclusiveness (Group only)
            total INTEGER,
            UNIQUE(judge_id, team_id)
        )
    `).run();

    // BOOTHS
    db.prepare(`
        CREATE TABLE IF NOT EXISTS booths (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_name TEXT,
            name TEXT,
            location TEXT,
            description TEXT
        )
    `).run();
}

function createBoothOpsTables() {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            grade INTEGER,
            class_no INTEGER,
            student_no INTEGER,
            name TEXT
        )
    `).run();
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_students_unique ON students (grade, class_no, student_no)').run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS booth_admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            class_name TEXT,
            password TEXT
        )
    `).run();
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_booth_admins_class ON booth_admins (class_name)').run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS booth_usages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booth_id INTEGER,
            student_id INTEGER,
            used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            admin_id INTEGER,
            FOREIGN KEY (booth_id) REFERENCES booths(id),
            FOREIGN KEY (student_id) REFERENCES students(id),
            FOREIGN KEY (admin_id) REFERENCES booth_admins(id)
        )
    `).run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_booth_usages_student_booth ON booth_usages (student_id, booth_id)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_booth_usages_used_at ON booth_usages (used_at DESC)').run();

    const voidFks = db.prepare("PRAGMA foreign_key_list('booth_usages_void')").all();
    const hasUsageFk = voidFks.some(row => row.table === 'booth_usages');
    if (voidFks.length && hasUsageFk) {
        db.prepare('DROP TABLE IF EXISTS booth_usages_void').run();
    }

    db.prepare(`
        CREATE TABLE IF NOT EXISTS booth_usages_void (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booth_usage_id INTEGER,
            void_by_admin_id INTEGER,
            void_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (void_by_admin_id) REFERENCES booth_admins(id)
        )
    `).run();
}

function seedCoreData() {
    // Seed If Empty
    const teamCount = db.prepare('SELECT count(*) as c FROM teams').get().c;
    if (teamCount === 0) {
        console.log('Seeding Teams...');
        const stmt = db.prepare('INSERT INTO teams (name, description, image_url, category, status, perf_order) VALUES (?, ?, ?, ?, ?, ?)');
        const teams = [
            // Group (7 teams)
            ['방경목', '노래: 이승기 - 삭제', '/images/teams/img_4-7.png', 'INDIVIDUAL', 'HIDDEN', 14],
            ['이성원', '노래: WOODZ - Drowning', '/images/teams/img_4-8.png', 'INDIVIDUAL', 'HIDDEN', 15],
            ['1학년 2반', '빅뱅 - 뱅뱅뱅 / 싸이 - 강남스타일', '/images/teams/img_1-2.png', 'GROUP', 'WAITING', 1],
            ['1학년 1반', '싸이 - New Face / 트와이스 - TT', '/images/teams/img_1-1.png', 'GROUP', 'WAITING', 2],
            ['2학년 1반', '여자친구 - 오늘부터 우리는 / 트와이스 - YES or YES / 싸이 - 젠틀맨', '/images/teams/img_2-1.png', 'GROUP', 'WAITING', 3],
            ['2학년 2반', '보이넥스트도어 - One and Only (화이트), 123-78', '/images/teams/img_2-2.png', 'GROUP', 'WAITING', 4],
            ['3학년 1반', '박진영 - 어머님이 누구니 / 세븐틴 - 예쁘다', '/images/teams/img_3-1.png', 'GROUP', 'WAITING', 5],
            ['3학년 3반', '청하 - Dream of You / 오렌지카라멜 - 까탈레나 / NCT - 내 얘길 들어봐', '/images/teams/img_3-3.png', 'GROUP', 'WAITING', 6],
            ['3학년 2반', '트와이스 - Knock Knock / 티아라 - 롤리폴리 / H.O.T - 행복', '/images/teams/img_3-2.png', 'GROUP', 'WAITING', 7],
            // Individual (6 teams)
            ['평행우주 (윤효원)', '노래: 조용필(고추잠자리) - 너라는 별', '/images/teams/img_4-1.png', 'INDIVIDUAL', 'WAITING', 8],
            ['강한비', '노래: 달담 - 졸업', '/images/teams/img_4-2.png', 'INDIVIDUAL', 'WAITING', 9],
            ['조예형', '노래: 지드래곤 - 무제', '/images/teams/img_4-3.png', 'INDIVIDUAL', 'WAITING', 10],
            ['최시은 밴드', '밴드: 윤하 - 혜성 / 한로로 - 사랑하게 될거야', '/images/teams/img_4-4.png', 'INDIVIDUAL', 'WAITING', 11],
            ['유다온', '댄스: 키스오브라이프', '/images/teams/img_4-5.png', 'INDIVIDUAL', 'WAITING', 12],
            ['박영광', '악기연주: 위플래시', '/images/teams/img_4-6.png', 'INDIVIDUAL', 'WAITING', 13]
        ];
        teams.forEach(t => stmt.run(...t));
    }

    const judgeCount = db.prepare('SELECT count(*) as c FROM judges').get().c;
    if (judgeCount === 0) {
        console.log('Seeding Judges...');
        const stmt = db.prepare('INSERT INTO judges (name, password) VALUES (?, ?)');
        const judges = [
            ['이대호', '1111'],
            ['강희경', '2222'],
            ['정순순', '3333'],
            ['문운주', '4444']
        ];
        judges.forEach(j => stmt.run(...j));
    }

    const boothCount = db.prepare('SELECT count(*) as c FROM booths').get().c;
    if (boothCount === 0) {
        console.log('Seeding Booths...');
        const stmt = db.prepare('INSERT INTO booths (class_name, name, location, description) VALUES (?, ?, ?, ?)');
        const booths = [
            ['1-1', '방탈출', '1-1 교실', '미스터리 스릴러 방탈출 게임'],
            ['1-2', '분식집', '1-2 교실', '맛있는 떡볶이와 어묵'],
            ['2-1', '찜질방', '2-1 교실', '뜨끈뜨끈한 찜질 체험'],
            ['2-2', '영광이네 5성급 포차', '2-2 교실', '논알콜 칵테일과 안주'],
            ['3-1', '카페', '3-1 교실', '향긋한 커피와 디저트'],
            ['3-2', '풍선 다트 게임', '3-2 교실', '풍선 다트 게임으로 스트레스 해소'],
            ['3-3', '귀신의 집', '3-3 교실', '공포체험 귀신의 집']
        ];
        booths.forEach(b => stmt.run(...b));
    }
}

function seedStudents() {
    const studentCount = db.prepare('SELECT count(*) as c FROM students').get().c;
    if (studentCount > 0) return;

    const csvPath = ensureStudentCsv();
    const students = parseStudentsCsv(csvPath);
    if (students.length === 0) {
        console.warn('[DB] No students parsed for seeding');
        return;
    }

    const insert = db.prepare('INSERT INTO students (grade, class_no, student_no, name) VALUES (?, ?, ?, ?)');
    const tx = db.transaction((rows) => {
        rows.forEach(r => insert.run(r.grade, r.class_no, r.student_no, r.name));
    });
    tx(students);
    console.log(`[DB] Seeded ${students.length} students`);
}

function seedBoothAdmins() {
    const booths = getBooths();
    if (!booths.length) return;

    const insert = db.prepare('INSERT OR IGNORE INTO booth_admins (class_name, password) VALUES (?, ?)');
    const tx = db.transaction((rows) => {
        rows.forEach(row => insert.run(row.class_name, row.password));
    });

    // Default password is deliberately simple for on-site ops; change in DB if needed.
    tx(booths.map(b => ({ class_name: b.class_name, password: '0000' })));

    // Ensure a single super admin exists for teachers/integrated ops.
    db.prepare(`
        INSERT INTO booth_admins (class_name, password)
        VALUES (?, ?)
        ON CONFLICT(class_name) DO UPDATE SET password = excluded.password
    `).run(BOOTH_SUPERADMIN_NAME, BOOTH_SUPERADMIN_PASSWORD);

    console.log(`[DB] Ensured booth admins for ${booths.length} booths + super admin`);
}

function getTeams() {
    return db.prepare('SELECT * FROM teams ORDER BY perf_order ASC').all();
}

function getBooths() {
    return db.prepare('SELECT * FROM booths').all();
}

function getBoothById(id) {
    return db.prepare('SELECT * FROM booths WHERE id = ?').get(id);
}

function getBoothByClassName(className) {
    return db.prepare('SELECT * FROM booths WHERE class_name = ?').get(className);
}

function getJudges() {
    return db.prepare('SELECT * FROM judges').all();
}

function loginJudge(name, password) {
    return db.prepare('SELECT * FROM judges WHERE name = ? AND password = ?').get(name, password);
}

function submitScore(judgeId, teamId, scores) {
    const { prep, resp, exp, inc, total } = scores;
    return db.prepare(`
        INSERT OR REPLACE INTO scores (judge_id, team_id, score_prep, score_resp, score_exp, score_inc, total)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(judgeId, teamId, prep, resp, exp, inc, total);
}

function getScores() {
    return db.prepare(`
        SELECT 
            t.id as team_id, 
            t.name as team_name,
            t.category,
            COALESCE(SUM(s.total), 0) as grand_total,
            COUNT(s.id) as judge_count
        FROM teams t
        LEFT JOIN scores s ON t.id = s.team_id
        GROUP BY t.id
        ORDER BY grand_total DESC
    `).all();
}

function getScoresByJudge(judgeId) {
    return db.prepare(`
        SELECT 
            team_id, 
            score_prep, 
            score_resp, 
            score_exp, 
            score_inc, 
            total 
        FROM scores 
        WHERE judge_id = ?
    `).all(judgeId);
}

function updateVoteCount(id, increment) {
    db.prepare('UPDATE teams SET vote_count = vote_count + ? WHERE id = ?').run(increment, id);
}

function updateTeamStatus(id, status) {
    db.prepare('UPDATE teams SET status = ? WHERE id = ?').run(status, id);
}

function addTeam(name, description, imageUrl, category = 'GROUP') {
    const maxOrder = db.prepare('SELECT MAX(perf_order) as m FROM teams').get().m || 0;
    return db.prepare("INSERT INTO teams (name, description, image_url, category, status, perf_order) VALUES (?, ?, ?, ?, 'WAITING', ?)").run(name, description, imageUrl, category, maxOrder + 1);
}

function updateTeam(id, name, description) {
    db.prepare('UPDATE teams SET name = ?, description = ? WHERE id = ?').run(name, description, id);
}

function updateTeamImage(id, imageUrl) {
    return db.prepare('UPDATE teams SET image_url = ? WHERE id = ?').run(imageUrl, id);
}

function setTeamJudgeExempt(id, exempt) {
    db.prepare('UPDATE teams SET judge_exempt = ? WHERE id = ?').run(exempt ? 1 : 0, id);
}

function updateBooth(id, data) {
    const { class_name, name, location, description } = data;
    db.prepare('UPDATE booths SET class_name = ?, name = ?, location = ?, description = ? WHERE id = ?')
      .run(class_name, name, location, description, id);
}

function updateTeamOrder(orders) {
    const update = db.prepare('UPDATE teams SET perf_order = ? WHERE id = ?');
    const transaction = db.transaction((items) => {
        for (const item of items) update.run(item.order, item.id);
    });
    transaction(orders);
}

function deleteTeam(id) {
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
}

function resetStats() {
    db.prepare('DELETE FROM scores').run();
    db.prepare('UPDATE teams SET vote_count = 0').run();
}

// --- Booth ops helpers ---
function getStudents(filters = {}) {
    const { search, grade, class_no } = filters;
    let query = 'SELECT id, grade, class_no, student_no, name FROM students WHERE 1=1';
    const params = [];
    if (grade) {
        query += ' AND grade = ?';
        params.push(parseInt(grade, 10));
    }
    if (class_no) {
        query += ' AND class_no = ?';
        params.push(parseInt(class_no, 10));
    }
    if (search) {
        query += ' AND (name LIKE ? OR CAST(student_no AS TEXT) LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term);
    }
    query += ' ORDER BY grade ASC, class_no ASC, student_no ASC';
    return db.prepare(query).all(...params);
}

function getStudentCount() {
    return db.prepare('SELECT COUNT(*) as c FROM students').get().c;
}

function getStudentById(id) {
    return db.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

function loginBoothAdmin(className, password) {
    return db.prepare('SELECT * FROM booth_admins WHERE class_name = ? AND password = ?').get(className, password);
}

function getBoothUsageById(id) {
    return db.prepare('SELECT * FROM booth_usages WHERE id = ?').get(id);
}

function setBoothAdminPassword(className, password) {
    db.prepare(`
        INSERT INTO booth_admins (class_name, password)
        VALUES (?, ?)
        ON CONFLICT(class_name) DO UPDATE SET password = excluded.password
    `).run(className, password);
    return { success: true };
}

function resetBoothOpsUsage() {
    db.prepare('DELETE FROM booth_usages_void').run();
    db.prepare('DELETE FROM booth_usages').run();
    return { success: true };
}

function getBoothOpsUsageCount() {
    return db.prepare('SELECT COUNT(*) as c FROM booth_usages').get().c;
}

function getStudentsCsvTemplate() {
    const header = 'grade,class_no,student_no,name';
    const example = '1,1,1,홍길동';
    return `${header}\n${example}\n`;
}

function normalizeCsvText(csvText) {
    return String(csvText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

function parseStudentsCsvText(csvText) {
    const text = normalizeCsvText(csvText).trim();
    if (!text) return { rows: [], errors: [{ line: 0, reason: 'EMPTY_FILE' }] };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return { rows: [], errors: [{ line: 0, reason: 'EMPTY_FILE' }] };

    const normalizeHeaderKey = (value) =>
        String(value || '')
            .replace(/^\uFEFF/, '')
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, '');

    const headerKeys = lines[0]
        .split(',')
        .map(normalizeHeaderKey);

    const aliases = {
        grade: ['grade', '학년'],
        class_no: ['classno', 'class', '반', '학급'],
        student_no: ['studentno', 'student', '번호', '학생번호'],
        name: ['name', '이름', '성명']
    };

    const findIndex = (keys, candidates) => {
        const normalized = candidates.map(normalizeHeaderKey);
        return keys.findIndex(k => normalized.includes(k));
    };

    const idxGrade = findIndex(headerKeys, aliases.grade);
    const idxClass = findIndex(headerKeys, aliases.class_no);
    const idxStudent = findIndex(headerKeys, aliases.student_no);
    const idxName = findIndex(headerKeys, aliases.name);

    const missing = [];
    if (idxGrade < 0) missing.push('grade');
    if (idxClass < 0) missing.push('class_no');
    if (idxStudent < 0) missing.push('student_no');
    if (idxName < 0) missing.push('name');
    if (missing.length) {
        return {
            rows: [],
            errors: [{
                line: 1,
                reason: 'INVALID_HEADER',
                missing
            }]
        };
    }

    const rows = [];
    const errors = [];
    const seen = new Set();

    for (let i = 1; i < lines.length; i++) {
        const lineNo = i + 1; // 1-based, including header
        const raw = lines[i];
        const parts = raw.split(',').map(p => p.trim());
        const readCell = (idx) => (idx >= 0 && idx < parts.length ? parts[idx] : '');

        const gradeRaw = readCell(idxGrade);
        const classRaw = readCell(idxClass);
        const studentRaw = readCell(idxStudent);
        const nameRaw = idxName === parts.length - 1
            ? parts.slice(idxName).join(',').trim()
            : readCell(idxName);

        const grade = parseInt(gradeRaw, 10);
        const class_no = parseInt(classRaw, 10);
        const student_no = parseInt(studentRaw, 10);
        const name = String(nameRaw || '').trim();

        if (!Number.isInteger(grade) || !Number.isInteger(class_no) || !Number.isInteger(student_no) || !name) {
            errors.push({
                line: lineNo,
                reason: 'INVALID_ROW',
                row: { grade: gradeRaw, class_no: classRaw, student_no: studentRaw, name: nameRaw }
            });
            continue;
        }

        const key = `${grade}-${class_no}-${student_no}`;
        if (seen.has(key)) {
            errors.push({ line: lineNo, reason: 'DUPLICATE_ROW', key });
            continue;
        }
        seen.add(key);

        rows.push({ grade, class_no, student_no, name });
    }

    return { rows, errors };
}

function importStudentsFromCsvText(csvText, options = {}) {
    const mode = options.mode === 'merge' ? 'merge' : 'replace';
    const resetBoothUsage = !!options.resetBoothUsage;

    const parsed = parseStudentsCsvText(csvText);
    if (!parsed.rows.length) {
        return {
            success: false,
            error: parsed.errors?.[0]?.reason || 'NO_ROWS',
            details: parsed.errors || []
        };
    }

    const usageCount = getBoothOpsUsageCount();
    if (mode === 'replace' && usageCount > 0 && !resetBoothUsage) {
        return { success: false, error: 'HAS_USAGE_DATA', usageCount };
    }

    const insert = db.prepare('INSERT INTO students (grade, class_no, student_no, name) VALUES (?, ?, ?, ?)');
    const update = db.prepare('UPDATE students SET name = ? WHERE id = ?');
    const find = db.prepare('SELECT id, name FROM students WHERE grade = ? AND class_no = ? AND student_no = ?');

    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    const tx = db.transaction(() => {
        if (mode === 'replace') {
            if (resetBoothUsage) resetBoothOpsUsage();
            deleted = db.prepare('DELETE FROM students').run().changes;
            parsed.rows.forEach(r => {
                insert.run(r.grade, r.class_no, r.student_no, r.name);
                inserted += 1;
            });
            return;
        }

        // merge
        parsed.rows.forEach(r => {
            const existing = find.get(r.grade, r.class_no, r.student_no);
            if (!existing) {
                insert.run(r.grade, r.class_no, r.student_no, r.name);
                inserted += 1;
                return;
            }
            const prevName = String(existing.name || '').trim();
            if (prevName !== r.name) {
                update.run(r.name, existing.id);
                updated += 1;
            }
        });
    });

    if (typeof tx.immediate === 'function') tx.immediate();
    else tx();

    return {
        success: true,
        mode,
        resetBoothUsage: mode === 'replace' ? resetBoothUsage : false,
        usageCountBefore: usageCount,
        parsed: { rows: parsed.rows.length, errors: parsed.errors.length },
        inserted,
        updated,
        deleted,
        totalStudents: getStudentCount(),
        errors: parsed.errors.slice(0, 50)
    };
}

function useBooth(boothId, studentId, adminId) {
    const countStmt = db.prepare('SELECT COUNT(*) as c FROM booth_usages WHERE booth_id = ? AND student_id = ?');
    const insertStmt = db.prepare('INSERT INTO booth_usages (booth_id, student_id, admin_id) VALUES (?, ?, ?)');
    const recentStmt = db.prepare(`
        SELECT u.id, u.booth_id, u.student_id, u.admin_id, u.used_at,
               s.name as student_name, s.grade, s.class_no, s.student_no,
               ba.class_name as admin_class
        FROM booth_usages u
        JOIN students s ON u.student_id = s.id
        LEFT JOIN booth_admins ba ON u.admin_id = ba.id
        WHERE u.id = ?
    `);

    const tx = db.transaction((bId, sId, aId) => {
        const current = countStmt.get(bId, sId).c;
        if (current >= MAX_USAGE_PER_BOOTH) {
            return { success: false, error: 'OVER_LIMIT', totalUsed: current, remaining: 0 };
        }
        const result = insertStmt.run(bId, sId, aId);
        const totalUsed = current + 1;
        const recentEntry = recentStmt.get(result.lastInsertRowid);
        return { success: true, totalUsed, remaining: Math.max(0, MAX_USAGE_PER_BOOTH - totalUsed), recentEntry };
    });

    if (typeof tx.immediate === 'function') {
        return tx.immediate(boothId, studentId, adminId);
    }
    return tx(boothId, studentId, adminId);
}

function voidBoothUsage(usageId, adminId, reason) {
    const insertVoid = db.prepare('INSERT INTO booth_usages_void (booth_usage_id, void_by_admin_id, void_reason) VALUES (?, ?, ?)');
    const deleteUsage = db.prepare('DELETE FROM booth_usages WHERE id = ?');
    const tx = db.transaction((id, admin, why) => {
        insertVoid.run(id, admin, why || '');
        deleteUsage.run(id);
        return { success: true };
    });

    if (typeof tx.immediate === 'function') {
        return tx.immediate(usageId, adminId, reason);
    }
    return tx(usageId, adminId, reason);
}

function getBoothUsageSummary(boothId) {
    const totalUsage = db.prepare('SELECT COUNT(*) as c FROM booth_usages WHERE booth_id = ?').get(boothId).c;
    const uniqueStudents = db.prepare('SELECT COUNT(DISTINCT student_id) as c FROM booth_usages WHERE booth_id = ?').get(boothId).c;

    const topClasses = db.prepare(`
        SELECT s.grade, s.class_no, COUNT(*) as count
        FROM booth_usages u
        JOIN students s ON u.student_id = s.id
        WHERE u.booth_id = ?
        GROUP BY s.grade, s.class_no
        ORDER BY count DESC
        LIMIT 3
    `).all(boothId).map(row => ({ class_name: `${row.grade}-${row.class_no}`, count: row.count }));

    const perStudentCounts = {};
    db.prepare('SELECT student_id, COUNT(*) as count FROM booth_usages WHERE booth_id = ? GROUP BY student_id')
      .all(boothId)
      .forEach(row => { perStudentCounts[row.student_id] = row.count; });

    const recent = db.prepare(`
        SELECT u.id, u.booth_id, u.student_id, u.admin_id, u.used_at,
               s.name as student_name, s.grade, s.class_no, s.student_no,
               ba.class_name as admin_class
        FROM booth_usages u
        JOIN students s ON u.student_id = s.id
        LEFT JOIN booth_admins ba ON u.admin_id = ba.id
        WHERE u.booth_id = ?
        ORDER BY u.used_at DESC, u.id DESC
        LIMIT 20
    `).all(boothId);

    const totalStudents = db.prepare('SELECT COUNT(*) as c FROM students').get().c;
    const remainingBuckets = { 3: 0, 2: 0, 1: 0, 0: 0 };
    db.prepare('SELECT id FROM students').all().forEach(row => {
        const used = perStudentCounts[row.id] || 0;
        const rem = MAX_USAGE_PER_BOOTH - used;
        const bucket = rem <= 0 ? 0 : rem;
        remainingBuckets[bucket] = (remainingBuckets[bucket] || 0) + 1;
    });

    return {
        totalUsage,
        uniqueStudents,
        topClasses,
        recent,
        perStudentCounts,
        remainingBuckets,
        totalStudents
    };
}

function getBoothOpsDashboard() {
    const totalStudents = db.prepare('SELECT COUNT(*) as c FROM students').get().c;
    const totalUsage = db.prepare('SELECT COUNT(*) as c FROM booth_usages').get().c;
    const uniqueStudents = db.prepare('SELECT COUNT(DISTINCT student_id) as c FROM booth_usages').get().c;

    const usageByBooth = Object.fromEntries(
        db.prepare('SELECT booth_id, COUNT(*) as c FROM booth_usages GROUP BY booth_id').all().map(r => [r.booth_id, r.c])
    );
    const uniqueByBooth = Object.fromEntries(
        db.prepare('SELECT booth_id, COUNT(DISTINCT student_id) as c FROM booth_usages GROUP BY booth_id').all().map(r => [r.booth_id, r.c])
    );
    const lastUsedByBooth = Object.fromEntries(
        db.prepare('SELECT booth_id, MAX(used_at) as last_used_at FROM booth_usages GROUP BY booth_id').all().map(r => [r.booth_id, r.last_used_at])
    );

    const booths = getBooths().map(b => ({
        id: b.id,
        class_name: b.class_name,
        name: b.name,
        totalUsage: usageByBooth[b.id] || 0,
        uniqueStudents: uniqueByBooth[b.id] || 0,
        lastUsedAt: lastUsedByBooth[b.id] || null
    }));

    const recent = db.prepare(`
        SELECT u.id, u.booth_id, u.student_id, u.admin_id, u.used_at,
               b.class_name as booth_class, b.name as booth_name,
               s.name as student_name, s.grade, s.class_no, s.student_no,
               ba.class_name as admin_class
        FROM booth_usages u
        JOIN booths b ON u.booth_id = b.id
        JOIN students s ON u.student_id = s.id
        LEFT JOIN booth_admins ba ON u.admin_id = ba.id
        ORDER BY u.used_at DESC, u.id DESC
        LIMIT 50
    `).all();

    const usageByStudent = db.prepare(`
        SELECT s.id as student_id, s.grade, s.class_no, s.student_no, s.name, COUNT(*) as count
        FROM booth_usages u
        JOIN students s ON u.student_id = s.id
        GROUP BY s.id
        ORDER BY count DESC, s.grade ASC, s.class_no ASC, s.student_no ASC
        LIMIT 20
    `).all();

    return {
        totalStudents,
        totalUsage,
        uniqueStudents,
        booths,
        recent,
        usageByStudent
    };
}

module.exports = {
    initDB,
    getTeams,
    getBooths,
    getBoothById,
    getBoothByClassName,
    getJudges,
    loginJudge,
    submitScore,
    getScores,
    getScoresByJudge,
    updateVoteCount,
    updateTeamStatus,
    addTeam,
    updateTeam,
    updateTeamImage,
    setTeamJudgeExempt,
    updateBooth,
    updateTeamOrder,
    deleteTeam,
    resetStats,
    // booth ops
    getStudents,
    getStudentCount,
    getStudentById,
    loginBoothAdmin,
    setBoothAdminPassword,
    resetBoothOpsUsage,
    getBoothOpsUsageCount,
    getStudentsCsvTemplate,
    importStudentsFromCsvText,
    useBooth,
    voidBoothUsage,
    getBoothUsageSummary,
    getBoothUsageById,
    getBoothOpsDashboard
};
