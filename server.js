const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const db = require('./database');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.status(401).json({
        success: false,
        error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required'
        }
    });
    
    db.get(`SELECT u.id, u.username FROM sessions s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.token = ? AND s.expires_at > datetime('now')`, 
        [token], (err, user) => {
            if (err || !user) {
                return res.status(403).json({
                    success: false,
                    error: {
                        code: 'INVALID_TOKEN',
                        message: 'Invalid or expired session'
                    }
                });
            }
            
            req.user = user;
            next();
        }
    );
}
app.post('/check-email', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'MISSING_FIELDS',
                message: 'Email is required'
            }
        });
    }

    const sql = `SELECT COUNT(*) as count FROM users WHERE email = ?`;
    db.get(sql, [email], (err, row) => {
        if (err) {
            return res.status(500).json({ 
                success: false, 
                error: { 
                    code: 'DB_ERROR', 
                    message: err.message 
                } 
            });
        }
                res.json(row.count === 0);
    });
});

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'MISSING_FIELDS',
                message: 'All fields are required',
                details: {
                    username: !!username,
                    email: !!email,
                    password: !!password
                }
            }
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `INSERT INTO users (username, email, password) VALUES (?, ?, ?)`;
        db.run(sql, [username, email, hashedPassword], function(err) {
            if (err) {
                // Check for unique constraint violation
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'DUPLICATE_EMAIL',
                            message: 'Email already registered',
                            details: { email: true }
                        }
                    });
                }
                return res.status(500).json({
                    success: false,
                    error: {
                        code: 'DB_ERROR',
                        message: 'Failed to register user'
                    }
                });
            }
            res.json({
                success: true,
                data: {
                    id: this.lastID,
                    username,
                    email
                }
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: {
                code: 'SERVER_ERROR',
                message: 'Failed to process registration'
            }
        });
    }
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Email not registered' } });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Incorrect password' } });
        }
        const sessionToken = require('crypto').randomBytes(64).toString('hex');
                db.run(`INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)`, 
            [user.id, sessionToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()], // 30 days expiry
            (err) => {
                if (err) {
                    return res.status(500).json({
                        success: false,
                        error: {
                            code: 'SESSION_ERROR',
                            message: 'Failed to create session'
                        }
                    });
                }
                
                res.json({
                    success: true,
                    data: {
                        id: user.id,
                        username: user.username,
                        email: user.email
                    },
                    token: sessionToken
                });
            }
        );
    });
});
app.post('/update-score', (req, res) => {
    const { userId, score } = req.body;

    if (!userId || !score) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'MISSING_FIELDS',
                message: 'User ID and score are required'
            }
        });
    }

    const sql = `INSERT INTO scores (user_id, score) VALUES (?, ?)`;
    db.run(sql, [userId, score], function(err) {
        if (err) {
            return res.status(500).json({
                success: false,
                error: {
                    code: 'DB_ERROR',
                    message: 'Failed to update score'
                }
            });
        }

        res.json({
            success: true,
            data: {
                id: this.lastID,
                userId,
                score
            }
        });
    });
});


app.get('/leaderboard', (req, res) => {
    const limit = req.query.limit || 10;
    
    const sql = `
        SELECT 
            u.username, 
            MAX(s.score) as score,
            ROW_NUMBER() OVER (ORDER BY MAX(s.score) DESC) as rank
        FROM users u
        JOIN scores s ON u.id = s.user_id
        GROUP BY u.id
        ORDER BY score DESC
        LIMIT ?
    `;
    
    db.all(sql, [limit], (err, rows) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: {
                    code: 'DB_ERROR',
                    message: 'Failed to fetch leaderboard'
                }
            });
        }
        if (rows.length > 0 && rows[0].rank === undefined) {
            rows.forEach((row, index) => {
                row.rank = index + 1;
            });
        }

        res.json(rows);
    });
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

app.post('/scores', authenticateToken, (req, res) => {
    const score = req.body.score;
    
    if (score === undefined) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'MISSING_FIELDS',
                message: 'Score is required'
            }
        });
    }
    
    const userId = req.user.id;
    
    const insertScoreSql = `INSERT INTO scores (user_id, score) VALUES (?, ?)`;
    db.run(insertScoreSql, [userId, score], function(err) {
        if (err) {
            return res.status(500).json({
                success: false,
                error: {
                    code: 'DB_ERROR',
                    message: 'Failed to save score'
                }
            });
        }
        
        res.json({ success: true });
    });
});
app.post('/logout', authenticateToken, (req, res) => {
    const token = req.headers['authorization'].split(' ')[1];
    
    db.run(`DELETE FROM sessions WHERE token = ?`, [token], (err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                error: {
                    code: 'DB_ERROR',
                    message: 'Failed to logout'
                }
            });
        }
        
        res.json({ success: true });
    });
});
app.get('/validate-session', authenticateToken, (req, res) => {
    res.json({
        success: true,
        data: {
            username: req.user.username,
            id: req.user.id
        }
    });
});