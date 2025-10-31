import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb } from './db.js';

const router = express.Router();

function createToken(user) {
	const payload = { id: user.id, email: user.email };
	return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
}

router.post('/register', async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

		const passwordHash = await bcrypt.hash(password, 10);
		const db = getDb();
		db.run(
			'INSERT INTO users (email, password_hash) VALUES (?, ?)',
			[email.toLowerCase(), passwordHash],
			function (err) {
				if (err) {
					if (String(err?.message || '').includes('UNIQUE')) {
						return res.status(409).json({ error: 'Email already registered' });
					}
					return res.status(500).json({ error: 'Database error' });
				}
				const user = { id: this.lastID, email };
				const token = createToken(user);
				res.json({ token, user });
			}
		);
	} catch (e) {
		return res.status(500).json({ error: 'Server error' });
	}
});

router.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body;
		if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });
		const db = getDb();
		db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()], async (err, row) => {
			if (err) return res.status(500).json({ error: 'Database error' });
			if (!row) return res.status(401).json({ error: 'Invalid credentials' });
			const ok = await bcrypt.compare(password, row.password_hash);
			if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
			const token = createToken(row);
			res.json({ token, user: { id: row.id, email: row.email } });
		});
	} catch (e) {
		return res.status(500).json({ error: 'Server error' });
	}
});

export function authMiddleware(req, res, next) {
	const header = req.headers.authorization || '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : null;
	if (!token) return res.status(401).json({ error: 'Unauthorized' });
	try {
		const payload = jwt.verify(token, process.env.JWT_SECRET);
		req.user = payload;
		return next();
	} catch {
		return res.status(401).json({ error: 'Invalid token' });
	}
}

router.get('/me', authMiddleware, (req, res) => {
	res.json({ user: { id: req.user.id, email: req.user.email } });
});

export default router;
