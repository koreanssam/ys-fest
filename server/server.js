const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDB, getTeams, getBooths, getJudges, loginJudge, submitScore, getScores, updateVoteCount, updateTeamStatus, addTeam, updateTeam, updateBooth, updateTeamOrder, deleteTeam } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // For serving static files if needed, though frontend is separate

// In-memory vote buffer for batching
let voteBuffer = {}; // { teamId: count }
const VOTE_FLUSH_INTERVAL = 5000; // 5 seconds

// SSE Clients
let sseClients = [];

// Flush votes to DB periodically
setInterval(() => {
    const changes = Object.entries(voteBuffer);
    if (changes.length > 0) {
        console.log(`Flushing votes: ${JSON.stringify(voteBuffer)}`);
        
        // Process each update
        changes.forEach(([teamId, count]) => {
            updateVoteCount(parseInt(teamId), count);
        });

        // Clear buffer
        voteBuffer = {};

        // Notify admins via SSE
        notifyAdmins();
    }
}, VOTE_FLUSH_INTERVAL);

function notifyAdmins() {
    const teams = getTeams();
    const data = JSON.stringify(teams);
    sseClients.forEach(client => {
        client.res.write(`data: ${data}\n\n`);
    });
}

// Routes
app.get('/api/teams', (req, res) => {
    res.json(getTeams());
});

app.post('/api/vote', (req, res) => {
    const { teamId, count } = req.body;
    
    // Validations: check if team exists, is Live, etc. (Basic check for now)
    // For extreme performance, skip DB check on every vote if not strict.
    // However, we should at least check if system is LIVE? 
    // Optimization: Assume client checks status. Server just accumulates.
    
    if (!teamId || !count) return res.status(400).send('Invalid request');

    if (!voteBuffer[teamId]) {
        voteBuffer[teamId] = 0;
    }
    voteBuffer[teamId] += count;

    // Optimistic response
    res.json({ success: true });
});

// Admin: SSE Dashboard
app.get('/api/stream/dashboard', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };
    sseClients.push(newClient);

    // Send initial data
    res.write(`data: ${JSON.stringify(getTeams())}\n\n`);

    req.on('close', () => {
        sseClients = sseClients.filter(c => c.id !== clientId);
    });
});

// Admin: Status Management
app.post('/api/admin/status', (req, res) => {
    const { teamId, status } = req.body;
    updateTeamStatus(teamId, status);
    notifyAdmins();
    res.json({ success: true });
});

// Admin: Team Management
app.post('/api/admin/team', (req, res) => {
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

app.put('/api/admin/team/reorder', (req, res) => {
    const { orders } = req.body; // [{id, order}, ...]
    updateTeamOrder(orders);
    notifyAdmins();
    res.json({ success: true });
});

app.put('/api/admin/team/:id', (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    updateTeam(id, name, description);
    notifyAdmins();
    res.json({ success: true });
});

// System Phase
let CURRENT_PHASE = 'BOOTHS'; // 'BOOTHS' or 'PERFORMANCE'

// ... existing code ...

app.delete('/api/admin/team/:id', (req, res) => {
    const { id } = req.params;
    deleteTeam(id);
    notifyAdmins();
    res.json({ success: true });
});

// API: Booths
app.get('/api/booths', (req, res) => {
    res.json(getBooths());
});

app.put('/api/admin/booth/:id', (req, res) => {
    const { id } = req.params;
    const data = req.body; // { class_name, name, location, description }
    updateBooth(id, data);
    res.json({ success: true });
});

// API: Phase
app.get('/api/phase', (req, res) => {
    res.json({ phase: CURRENT_PHASE });
});

app.post('/api/admin/phase', (req, res) => {
    const { phase } = req.body; // BOOTHS, PERFORMANCE
    if (phase) CURRENT_PHASE = phase;
    notifyAdmins(); // Notify dashboard
    res.json({ success: true, phase: CURRENT_PHASE });
});

// Cleanup Configuration (Default: 12/30 11:00 KST)
let CLEANUP_TARGET = '2025-12-30T11:00:00+09:00'; 

app.get('/api/cleanup', (req, res) => {
    res.json({ target: CLEANUP_TARGET });
});

app.post('/api/admin/cleanup', (req, res) => {
    const { target } = req.body; // Expect ISO string or "YYYY-MM-DDTHH:mm:ss"
    // Validate?
    CLEANUP_TARGET = target;
    // We might want to notify clients (Booths) via SSE or polling
    // Since BoothList polls /api/booths or checks internally, we might need a push.
    // For now, BoothList uses local time check. We need to update BoothList to fetch this.
    res.json({ success: true, target: CLEANUP_TARGET });
});

// API: Judge
app.post('/api/judge/login', (req, res) => {
    const { name, password } = req.body;
    const judge = loginJudge(name, password);
    if (judge) {
        res.json({ success: true, judge });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/judge/score', (req, res) => {
    const { judgeId, teamId, scores } = req.body;
    
    // Server-side Permission Check
    const judge = getJudges().find(j => j.id === judgeId);
    const team = getTeams().find(t => t.id === teamId);
    
    if (judge && team) {
        if (judge.name.includes('문운주') && team.category === 'INDIVIDUAL') {
            console.warn(`Blocked score submission: Judge ${judge.name} tried to score Indiv team ${team.name}`);
            return res.status(403).json({ success: false, error: 'Permission Denied: Cannot judge Individual category.' });
        }
    }

    // scores: { prep, resp, exp, inc, total }
    submitScore(judgeId, teamId, scores);
    notifyAdmins();
    res.json({ success: true });
});

app.get('/api/scores', (req, res) => {
    res.json(getScores());
});

// ... existing delete route ...
app.delete('/api/admin/team/:id', (req, res) => {
    const { id } = req.params;
    deleteTeam(id);
    notifyAdmins();
    res.json({ success: true });
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Initialize DB with seed data if empty
    initDB();
});
