const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const db = require('./database');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Register
app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'MISSING_FIELDS',
                message: 'Username, email, and password are required',
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
        db.run(sql, [username, email, hashedPassword], function (err) {
            if (err) {
                return res.status(400).json({ success: false, error: { code: 'DB_ERROR', message: err.message } });
            }
            res.json({ success: true, data: { id: this.lastID, username, email } });
        });
    } catch (error) {
        res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
});

// Login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: {
                code: 'MISSING_FIELDS',
                message: 'Email and password are required',
                details: {
                    email: !!email,
                    password: !!password
                }
            }
        });
    }

    const sql = `SELECT * FROM users WHERE email = ?`;
    db.get(sql, [email], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Email not registered' } });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Incorrect password' } });
        }

        res.json({ success: true, data: { id: user.id, username: user.username, email: user.email } });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
