import express from 'express';
import fetch from 'node-fetch';
import { authMiddleware } from './auth.js';
import { getDb } from './db.js';

const router = express.Router();

const ONE_SEC_MAIL_API = 'https://www.1secmail.com/api/v1/';
const DEFAULT_DOMAINS = [
	'1secmail.com',
	'1secmail.org',
	'1secmail.net',
	'wwjmp.com',
	'ezfill.dev',
	'icznn.com',
	'dxcre.com'
];

// mail.tm fallback
const MAIL_TM_API = 'https://api.mail.tm';
const tokenCache = new Map(); // key: userId, value: { token, address, provider: 'mailtm' }

async function fetchJson(url, options = {}) {
	const resp = await fetch(url, { headers: { 'accept': 'application/json', ...(options.headers || {}) }, ...options });
	if (!resp.ok) {
		const text = await resp.text().catch(() => '');
		const err = new Error(`HTTP ${resp.status} ${resp.statusText} - ${text || 'request failed'}`);
		err.status = resp.status;
		throw err;
	}
	return resp.json();
}

async function fetchDomainList() {
	try {
		const list = await fetchJson(`${ONE_SEC_MAIL_API}?action=getDomainList`);
		if (Array.isArray(list) && list.length) return list;
		return DEFAULT_DOMAINS;
	} catch (e) {
		console.error('getDomainList error:', e);
		return DEFAULT_DOMAINS;
	}
}

function randomLogin(length = 10) {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let out = '';
	for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
	return out;
}

async function generateMailboxRandom() {
	try {
		const list = await fetchJson(`${ONE_SEC_MAIL_API}?action=genRandomMailbox&count=1`);
		const address = list[0];
		const [login, domain] = address.split('@');
		return { login, domain, address, provider: '1secmail' };
	} catch (e) {
		console.warn('genRandomMailbox failed; falling back to mail.tm:', e?.message || e);
		return await createMailTmAccount();
	}
}

function sanitizeLogin(login) {
	return String(login || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, '')
		.slice(0, 64);
}

async function listMessages1Sec(login, domain) {
	return fetchJson(`${ONE_SEC_MAIL_API}?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`);
}

async function readMessage1Sec(login, domain, id) {
	return fetchJson(`${ONE_SEC_MAIL_API}?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(id)}`);
}

// ---- mail.tm helpers ----
async function getMailTmDomain() {
	const data = await fetchJson(`${MAIL_TM_API}/domains`);
	if (data?.hydra:member) {
		const list = data['hydra:member'];
		if (list.length) return list[Math.floor(Math.random() * list.length)].domain;
	}
	// fallback known
	return 'mbox.re';
}

async function createMailTmAccount() {
	const domain = await getMailTmDomain().catch(() => 'mbox.re');
	const local = randomLogin(10);
	const address = `${local}@${domain}`;
	const password = randomLogin(14);
	await fetchJson(`${MAIL_TM_API}/accounts`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ address, password })
	});
	const tokenRes = await fetchJson(`${MAIL_TM_API}/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ address, password })
	});
	return { login: local, domain, address, provider: 'mailtm', token: tokenRes?.token };
}

async function listMessagesMailTm(userId) {
	const info = tokenCache.get(userId);
	if (!info?.token) throw new Error('No mail.tm token');
	const data = await fetchJson(`${MAIL_TM_API}/messages`, { headers: { Authorization: `Bearer ${info.token}` } });
	const list = data?.['hydra:member'] || [];
	// Normalize to 1secmail-like shape
	return list.map((m) => ({ id: m.id, from: m.from?.address || m.from || '', subject: m.subject || '', date: m.intro || '' }));
}

async function readMessageMailTm(userId, id) {
	const info = tokenCache.get(userId);
	if (!info?.token) throw new Error('No mail.tm token');
	const msg = await fetchJson(`${MAIL_TM_API}/messages/${id}`, { headers: { Authorization: `Bearer ${info.token}` } });
	return { from: msg.from?.address || '', to: (msg.to || []).map(t => t.address).join(', '), subject: msg.subject || '', textBody: msg.text || msg.intro || '', body: msg.html?.join('\n') || '' };
}

router.get('/domains', authMiddleware, async (_req, res) => {
	const list = await fetchDomainList();
	res.json({ domains: list });
});

router.get('/debug/pingsecmail', async (_req, res) => {
	try {
		const list = await fetchDomainList();
		res.json({ ok: true, domains: list });
	} catch (e) {
		res.status(500).json({ ok: false, error: String(e?.message || e) });
	}
});

router.post('/mailbox/new', authMiddleware, async (req, res) => {
	try {
		const { login: desiredLogin, domain: desiredDomain } = req.body || {};
		let mailbox;
		if (desiredDomain && desiredLogin) {
			const domains = await fetchDomainList();
			const domain = String(desiredDomain).toLowerCase();
			if (!domains.includes(domain)) return res.status(400).json({ error: 'Domain không hợp lệ' });
			const login = sanitizeLogin(desiredLogin);
			if (!login) return res.status(400).json({ error: 'Login không hợp lệ' });
			mailbox = { login, domain, address: `${login}@${domain}`, provider: '1secmail' };
		} else {
			mailbox = await generateMailboxRandom();
		}
		// cache token if mail.tm
		if (mailbox.provider === 'mailtm' && mailbox.token) {
			tokenCache.set(req.user.id, { token: mailbox.token, address: mailbox.address, provider: 'mailtm' });
		}
		const db = getDb();
		db.run(
			'UPDATE users SET mail_login = ?, mail_domain = ? WHERE id = ?',
			[mailbox.login, mailbox.domain, req.user.id],
			(err) => {
				if (err) {
					console.error('SQL update mailbox error:', err);
					return res.status(500).json({ error: 'Database error' });
				}
				res.json({ address: `${mailbox.login}@${mailbox.domain}`, login: mailbox.login, domain: mailbox.domain });
			}
		);
	} catch (e) {
		console.error('mailbox/new error:', e);
		res.status(500).json({ error: String(e?.message || e) });
	}
});

router.post('/mailbox/clear', authMiddleware, (req, res) => {
	const db = getDb();
	tokenCache.delete(req.user.id);
	db.run('UPDATE users SET mail_login = NULL, mail_domain = NULL WHERE id = ?', [req.user.id], (err) => {
		if (err) return res.status(500).json({ error: 'Database error' });
		res.json({ ok: true });
	});
});

router.get('/mailbox', authMiddleware, (req, res) => {
	const db = getDb();
	db.get('SELECT mail_login, mail_domain FROM users WHERE id = ?', [req.user.id], (err, row) => {
		if (err) return res.status(500).json({ error: 'Database error' });
		if (!row?.mail_login || !row?.mail_domain) return res.json({ address: null });
		return res.json({ address: `${row.mail_login}@${row.mail_domain}`, login: row.mail_login, domain: row.mail_domain });
	});
});

router.get('/messages', authMiddleware, async (req, res) => {
	const db = getDb();
	db.get('SELECT mail_login, mail_domain FROM users WHERE id = ?', [req.user.id], async (err, row) => {
		if (err) return res.status(500).json({ error: 'Database error' });
		if (!row?.mail_login || !row?.mail_domain) return res.status(400).json({ error: 'No mailbox. Create one first.' });
		try {
			if (tokenCache.has(req.user.id)) {
				const msgs = await listMessagesMailTm(req.user.id);
				return res.json({ messages: msgs });
			}
			const msgs = await listMessages1Sec(row.mail_login, row.mail_domain);
			res.json({ messages: msgs });
		} catch (e) {
			console.error('get messages error:', e);
			res.status(500).json({ error: String(e?.message || e) });
		}
	});
});

router.get('/messages/:id', authMiddleware, async (req, res) => {
	const db = getDb();
	db.get('SELECT mail_login, mail_domain FROM users WHERE id = ?', [req.user.id], async (err, row) => {
		if (err) return res.status(500).json({ error: 'Database error' });
		if (!row?.mail_login || !row?.mail_domain) return res.status(400).json({ error: 'No mailbox. Create one first.' });
		try {
			if (tokenCache.has(req.user.id)) {
				const msg = await readMessageMailTm(req.user.id, req.params.id);
				return res.json({ message: msg });
			}
			const msg = await readMessage1Sec(row.mail_login, row.mail_domain, req.params.id);
			res.json({ message: msg });
		} catch (e) {
			console.error('read message error:', e);
			res.status(500).json({ error: String(e?.message || e) });
		}
	});
});

export default router;
