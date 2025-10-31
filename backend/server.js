import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import authRouter from './auth.js';
import mailRouter from './mail.js';
import { initDb } from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(
	cors({
		origin: process.env.CORS_ORIGIN || '*',
		credentials: false
	})
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', authRouter);
app.use('/api', mailRouter);

// Serve frontend if present
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('*', (req, res, next) => {
	if (req.path.startsWith('/api')) return next();
	res.sendFile(path.join(frontendDir, 'index.html'));
});

await initDb();
app.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});
