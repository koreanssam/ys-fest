const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'fest.db');
const db = new Database(dbPath); 

function initDB() {
    // Drop tables for fresh seed (Dev mode convenience)
    db.prepare('DROP TABLE IF EXISTS teams').run();
    db.prepare('DROP TABLE IF EXISTS judges').run();
    db.prepare('DROP TABLE IF EXISTS scores').run();
    db.prepare('DROP TABLE IF EXISTS booths').run();

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
            perf_order INTEGER
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

    seedData();
}

function seedData() {
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

function getTeams() {
    return db.prepare('SELECT * FROM teams ORDER BY perf_order ASC').all();
}

function getBooths() {
    return db.prepare('SELECT * FROM booths').all();
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

function updateVoteCount(id, increment) {
    db.prepare('UPDATE teams SET vote_count = vote_count + ? WHERE id = ?').run(increment, id);
}

function updateTeamStatus(id, status) {
    db.prepare('UPDATE teams SET status = ? WHERE id = ?').run(status, id);
}

function addTeam(name, description, imageUrl, category = 'GROUP') {
    // Get max order
    const maxOrder = db.prepare('SELECT MAX(perf_order) as m FROM teams').get().m || 0;
    return db.prepare("INSERT INTO teams (name, description, image_url, category, status, perf_order) VALUES (?, ?, ?, ?, 'WAITING', ?)").run(name, description, imageUrl, category, maxOrder + 1);
}

function updateTeam(id, name, description) {
    db.prepare('UPDATE teams SET name = ?, description = ? WHERE id = ?').run(name, description, id);
}

function updateBooth(id, data) {
    const { class_name, name, location, description } = data;
    db.prepare('UPDATE booths SET class_name = ?, name = ?, location = ?, description = ? WHERE id = ?')
      .run(class_name, name, location, description, id);
}

function updateTeamOrder(orders) {
    // orders = [{id: 1, order: 1}, {id: 2, order: 2}]
    const update = db.prepare('UPDATE teams SET perf_order = ? WHERE id = ?');
    const transaction = db.transaction((items) => {
        for (const item of items) update.run(item.order, item.id);
    });
    transaction(orders);
}

function deleteTeam(id) {
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
}

module.exports = {
    initDB,
    getTeams,
    getBooths,
    getJudges,
    loginJudge,
    submitScore,
    getScores,
    updateVoteCount,
    updateTeamStatus,
    addTeam,
    updateTeam,
    updateBooth,
    updateTeamOrder,
    deleteTeam
};
