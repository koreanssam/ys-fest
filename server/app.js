const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
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
    getStudentsCsvTemplate,
    importStudentsFromCsvText,
    useBooth,
    voidBoothUsage,
    getBoothUsageSummary,
    getBoothUsageById,
    getBoothOpsDashboard
} = require('./db');

const DIST_PATH = path.join(__dirname, '..', 'client', 'dist');
const BOOTH_SUPERADMIN_NAME = process.env.BOOTH_SUPERADMIN_NAME || '통합관리자';
const VOID_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

// In-memory vote buffer for batching
let voteBuffer = {}; // { teamId: count }
const VOTE_FLUSH_INTERVAL = 5000; // 5 seconds

// SSE Clients
let sseClients = [];

// Booth admin auth (simple token kept in memory)
const boothAdminTokens = new Map();
const ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000; // 12 hours

function issueBoothAdminToken(admin, boothId) {
    const token = crypto.randomBytes(24).toString('hex');
    const session = {
        token,
        adminId: admin.id,
        className: admin.class_name,
        isSuperAdmin: admin.class_name === BOOTH_SUPERADMIN_NAME,
        defaultBoothId: boothId || null,
        createdAt: Date.now(),
        expiresAt: Date.now() + ADMIN_TOKEN_TTL
    };
    boothAdminTokens.set(token, session);
    return session;
}

function requireBoothAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!token || !boothAdminTokens.has(token)) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
    const session = boothAdminTokens.get(token);
    if (session.expiresAt && session.expiresAt < Date.now()) {
        boothAdminTokens.delete(token);
        return res.status(401).json({ error: 'EXPIRED' });
    }
    req.boothAdmin = session;
    return next();
}

function requireBoothSuperAdmin(req, res, next) {
    if (!req.boothAdmin?.isSuperAdmin) return res.status(403).json({ error: 'FORBIDDEN' });
    return next();
}

function canAccessBooth(session, boothId) {
    if (!session) return false;
    if (session.isSuperAdmin) return true;
    if (!session.defaultBoothId) return false;
    return session.defaultBoothId === boothId;
}

function parseDbTimestamp(value) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
        return new Date(value.replace(' ', 'T') + 'Z'); // SQLite CURRENT_TIMESTAMP is UTC
    }
    return new Date(value);
}

function notifyAdmins() {
    const teams = getTeams();
    const data = JSON.stringify(teams);
    sseClients.forEach(client => {
        client.res.write(`data: ${data}\n\n`);
    });
}

function createApp(options = {}) {
    const { disableIntervals = false } = options;
    const app = express();

    app.use(cors());
    app.use(bodyParser.json({ limit: '10mb' }));

    app.use(express.static('public'));
    app.use(express.static(DIST_PATH));
    app.use('/ys-fest', express.static(DIST_PATH));

    // Flush votes to DB periodically
    if (!disableIntervals) {
        setInterval(() => {
            const changes = Object.entries(voteBuffer);
            if (changes.length > 0) {
                console.log(`Flushing votes: ${JSON.stringify(voteBuffer)}`);
                changes.forEach(([teamId, count]) => updateVoteCount(parseInt(teamId), count));
                voteBuffer = {};
                notifyAdmins();
            }
        }, VOTE_FLUSH_INTERVAL);
    }

    // Shared API router, mounted on both /api and /ys-fest/api
    const api = express.Router();

    api.post('/admin/booth-login', (req, res) => {
        const { className, password } = req.body || {};
        if (!className || !password) return res.status(400).json({ error: 'MISSING_CREDENTIALS' });
        const admin = loginBoothAdmin(className, password);
        if (!admin) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

        const booth = getBoothByClassName(className);
        const session = issueBoothAdminToken(admin, booth ? booth.id : null);
        res.json({
            token: session.token,
            adminId: session.adminId,
            className: session.className,
            isSuperAdmin: session.isSuperAdmin,
            boothId: session.defaultBoothId
        });
    });

    api.get('/admin/booth-ops/dashboard', requireBoothAdmin, requireBoothSuperAdmin, (req, res) => {
        res.json(getBoothOpsDashboard());
    });

    api.post('/admin/booth-ops/reset', requireBoothAdmin, requireBoothSuperAdmin, (req, res) => {
        resetBoothOpsUsage();
        res.json({ success: true });
    });

    api.put('/admin/booth-ops/booth-admins/:className/password', requireBoothAdmin, requireBoothSuperAdmin, (req, res) => {
        const className = req.params.className;
        const { password } = req.body || {};
        if (!className) return res.status(400).json({ error: 'INVALID_CLASS' });
        if (!password) return res.status(400).json({ error: 'MISSING_PASSWORD' });
        if (className === BOOTH_SUPERADMIN_NAME) return res.status(400).json({ error: 'CANNOT_CHANGE_SUPERADMIN' });

        const booth = getBoothByClassName(className);
        if (!booth) return res.status(404).json({ error: 'NOT_FOUND' });

        setBoothAdminPassword(className, password);

        // Invalidate existing sessions for that class admin
        for (const [token, session] of boothAdminTokens.entries()) {
            if (session?.className === className) boothAdminTokens.delete(token);
        }

        res.json({ success: true });
    });

    // Admin: Booth Ops student CSV management
    api.get('/admin/students/template', (req, res) => {
        res.json({
            filename: 'students_template.csv',
            csv: getStudentsCsvTemplate()
        });
    });

    api.get('/admin/students/stats', (req, res) => {
        res.json({ totalStudents: getStudentCount() });
    });

    api.post('/admin/students/import', (req, res) => {
        const { csvText, mode, resetBoothUsage } = req.body || {};
        if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: 'MISSING_CSV' });

        const result = importStudentsFromCsvText(csvText, { mode, resetBoothUsage });
        if (!result.success) {
            if (result.error === 'HAS_USAGE_DATA') return res.status(409).json(result);
            return res.status(400).json(result);
        }
        res.json(result);
    });

    api.get('/teams', (req, res) => res.json(getTeams()));

    api.post('/vote', (req, res) => {
        const { teamId, count } = req.body;
        if (!teamId || !count) return res.status(400).send('Invalid request');
        if (!voteBuffer[teamId]) voteBuffer[teamId] = 0;
        voteBuffer[teamId] += count;
        res.json({ success: true });
    });

    // Admin: SSE Dashboard
    api.get('/stream/dashboard', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        const clientId = Date.now();
        const newClient = { id: clientId, res };
        sseClients.push(newClient);
        res.write(`data: ${JSON.stringify(getTeams())}\n\n`);
        req.on('close', () => { sseClients = sseClients.filter(c => c.id !== clientId); });
    });

    // Admin: Status Management
    api.post('/admin/status', (req, res) => {
        const { teamId, status } = req.body;
        updateTeamStatus(teamId, status);
        notifyAdmins();
        res.json({ success: true });
    });

    // Admin: Team Management
    api.post('/admin/team', (req, res) => {
        console.log('Received Add Team Request:', req.body);
        const { name, description, category } = req.body;
        try {
            addTeam(name, description, '/images/teams/img_1.jpg', category || 'GROUP');
            notifyAdmins();
            res.json({ success: true });
        } catch (e) {
            console.error("Add Team Error:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    api.put('/admin/team/:id/image', (req, res) => {
        const teamId = parseInt(req.params.id, 10);
        if (Number.isNaN(teamId)) return res.status(400).json({ error: 'INVALID_TEAM' });

        const { dataUrl } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string') return res.status(400).json({ error: 'MISSING_IMAGE' });

        const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!match) return res.status(400).json({ error: 'INVALID_IMAGE_FORMAT' });

        const mime = match[1];
        const base64 = match[2];
        let buf;
        try {
            buf = Buffer.from(base64, 'base64');
        } catch (e) {
            return res.status(400).json({ error: 'INVALID_BASE64' });
        }
        if (!buf?.length) return res.status(400).json({ error: 'INVALID_IMAGE' });

        const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
        if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: 'IMAGE_TOO_LARGE' });

        const ext = mime === 'image/png' ? 'png' : (mime === 'image/webp' ? 'webp' : 'jpg');

        const uploadDir = process.env.TEAM_IMAGE_UPLOAD_DIR
            ? path.resolve(process.env.TEAM_IMAGE_UPLOAD_DIR)
            : path.join(__dirname, '..', 'public', 'images', 'teams', 'uploads');

        fs.mkdirSync(uploadDir, { recursive: true });

        // Keep only one file per team (avoid disk fill); remove other ext variants.
        ['png', 'jpg', 'webp'].forEach(candidateExt => {
            const candidatePath = path.join(uploadDir, `team-${teamId}.${candidateExt}`);
            try { fs.unlinkSync(candidatePath); } catch (e) { /* ignore */ }
        });

        const filename = `team-${teamId}.${ext}`;
        const filePath = path.join(uploadDir, filename);
        try {
            fs.writeFileSync(filePath, buf);
        } catch (e) {
            console.error('Failed to write team image:', e);
            return res.status(500).json({ error: 'UPLOAD_FAILED' });
        }

        const imageUrl = `/images/teams/uploads/${filename}?v=${Date.now()}`;
        const result = updateTeamImage(teamId, imageUrl);
        if (!result?.changes) {
            try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
            return res.status(404).json({ error: 'NOT_FOUND' });
        }

        notifyAdmins();
        res.json({ success: true, imageUrl });
    });

    api.put('/admin/team/reorder', (req, res) => {
        const { orders } = req.body;
        updateTeamOrder(orders);
        notifyAdmins();
        res.json({ success: true });
    });

    api.put('/admin/team/:id', (req, res) => {
        const { id } = req.params;
        const { name, description } = req.body;
        updateTeam(id, name, description);
        notifyAdmins();
        res.json({ success: true });
    });

    api.post('/admin/team/:id/judge-exempt', (req, res) => {
        const { id } = req.params;
        const { exempt } = req.body;
        setTeamJudgeExempt(id, !!exempt);
        notifyAdmins();
        res.json({ success: true, judge_exempt: !!exempt });
    });

    // System Phase
    let CURRENT_PHASE = 'BOOTHS';

    api.delete('/admin/team/:id', (req, res) => {
        const { id } = req.params;
        deleteTeam(id);
        notifyAdmins();
        res.json({ success: true });
    });

    // API: Booths
    api.get('/booths', (req, res) => res.json(getBooths()));

    api.get('/students', requireBoothAdmin, (req, res) => {
        const { search = '', grade, class_no } = req.query;
        const list = getStudents({ search, grade, class_no });
        res.json(list);
    });

    api.get('/booths/:id/usages/summary', requireBoothAdmin, (req, res) => {
        const boothId = parseInt(req.params.id, 10);
        if (Number.isNaN(boothId)) return res.status(400).json({ error: 'INVALID_BOOTH' });
        if (!canAccessBooth(req.boothAdmin, boothId)) return res.status(403).json({ error: 'FORBIDDEN' });
        const booth = getBoothById(boothId);
        if (!booth) return res.status(404).json({ error: 'NOT_FOUND' });
        const summary = getBoothUsageSummary(boothId);
        res.json(summary);
    });

    api.post('/booths/:id/use', requireBoothAdmin, (req, res) => {
        const boothId = parseInt(req.params.id, 10);
        if (Number.isNaN(boothId)) return res.status(400).json({ error: 'INVALID_BOOTH' });
        if (!canAccessBooth(req.boothAdmin, boothId)) return res.status(403).json({ error: 'FORBIDDEN' });
        const booth = getBoothById(boothId);
        if (!booth) return res.status(404).json({ error: 'NOT_FOUND' });
        const { studentId } = req.body || {};
        if (!studentId) return res.status(400).json({ error: 'MISSING_STUDENT' });
        const student = getStudentById(studentId);
        if (!student) return res.status(404).json({ error: 'NOT_FOUND' });
        const result = useBooth(boothId, studentId, req.boothAdmin.adminId);
        if (!result.success) {
            return res.status(400).json({
                error: result.error || 'OVER_LIMIT',
                totalUsed: result.totalUsed,
                remaining: result.remaining
            });
        }
        res.json({
            success: true,
            totalUsed: result.totalUsed,
            remaining: result.remaining,
            recentEntry: result.recentEntry
        });
    });

    api.post('/booths/:id/use/:usageId/void', requireBoothAdmin, (req, res) => {
        const boothId = parseInt(req.params.id, 10);
        const usageId = parseInt(req.params.usageId, 10);
        if (Number.isNaN(boothId) || Number.isNaN(usageId)) return res.status(400).json({ error: 'INVALID_REQUEST' });
        if (!canAccessBooth(req.boothAdmin, boothId)) return res.status(403).json({ error: 'FORBIDDEN' });
        const booth = getBoothById(boothId);
        if (!booth) return res.status(404).json({ error: 'NOT_FOUND' });
        const usage = getBoothUsageById(usageId);
        if (!usage || usage.booth_id !== boothId) return res.status(404).json({ error: 'NOT_FOUND' });
        const usedAt = parseDbTimestamp(usage.used_at);
        if (!usedAt || Number.isNaN(usedAt.getTime())) return res.status(400).json({ error: 'INVALID_USAGE' });
        const now = Date.now();
        if (now - usedAt.getTime() > VOID_WINDOW_MS) return res.status(400).json({ error: 'VOID_WINDOW_EXPIRED' });
        const result = voidBoothUsage(usageId, req.boothAdmin.adminId, req.body?.reason || '');
        if (!result.success) return res.status(400).json({ error: 'VOID_FAILED' });
        res.json({ success: true });
    });

    api.put('/admin/booth/:id', (req, res) => {
        const { id } = req.params;
        const data = req.body;
        updateBooth(id, data);
        res.json({ success: true });
    });

    // API: Phase
    api.get('/phase', (req, res) => res.json({ phase: CURRENT_PHASE }));

    api.post('/admin/phase', (req, res) => {
        const { phase } = req.body;
        if (phase) CURRENT_PHASE = phase;
        notifyAdmins();
        res.json({ success: true, phase: CURRENT_PHASE });
    });

    // Cleanup Configuration (Default: 12/30 11:00 KST)
    let CLEANUP_TARGET = '2025-12-30T11:00:00+09:00';

    api.get('/cleanup', (req, res) => res.json({ target: CLEANUP_TARGET }));

    api.post('/admin/cleanup', (req, res) => {
        const { target } = req.body;
        CLEANUP_TARGET = target;
        res.json({ success: true, target: CLEANUP_TARGET });
    });

    // API: Judge
    api.post('/judge/login', (req, res) => {
        const { name, password } = req.body;
        const judge = loginJudge(name, password);
        if (judge) {
            res.json({ success: true, judge });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    });

    api.get('/judge/:id/scores', (req, res) => {
        const { id } = req.params;
        const judgeId = parseInt(id, 10);
        if (Number.isNaN(judgeId)) return res.status(400).json({ success: false, message: 'Invalid judge id' });
        const judge = getJudges().find(j => j.id === judgeId);
        if (!judge) return res.status(404).json({ success: false, message: 'Judge not found' });
        const rows = getScoresByJudge(judgeId);
        res.json({ success: true, teamIds: rows.map(r => r.team_id), scores: rows });
    });

    api.post('/judge/score', (req, res) => {
        const { judgeId, teamId, scores } = req.body;
        const judge = getJudges().find(j => j.id === judgeId);
        const team = getTeams().find(t => t.id === teamId);
        if (judge && team) {
            if (team.judge_exempt) return res.status(403).json({ success: false, error: 'This team is excluded from judging.' });
            if (judge.name.includes('문운주') && team.category === 'INDIVIDUAL') {
                console.warn(`Blocked score submission: Judge ${judge.name} tried to score Indiv team ${team.name}`);
                return res.status(403).json({ success: false, error: 'Permission Denied: Cannot judge Individual category.' });
            }
        }
        submitScore(judgeId, teamId, scores);
        notifyAdmins();
        res.json({ success: true });
    });

    api.get('/scores', (req, res) => res.json(getScores()));

    api.post('/admin/reset-stats', (req, res) => {
        resetStats();
        notifyAdmins();
        res.json({ success: true });
    });

    api.use((req, res) => res.status(404).json({ error: 'NOT_FOUND' }));

    app.use('/api', api);
    app.use('/ys-fest/api', api);

    // SPA fallback to serve the built client
    app.use((req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        if (!['GET', 'HEAD'].includes(req.method)) return next();
        res.sendFile(path.join(DIST_PATH, 'index.html'));
    });

    return app;
}

module.exports = { createApp, initDB };
