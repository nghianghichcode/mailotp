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

async function fetchJson(url) {
	const resp = await fetch(url, { headers: { 'accept': 'application/json' } });
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

async function generateMailboxRandom() {
	const list = await fetchJson(`${ONE_SEC_MAIL_API}?action=genRandomMailbox&count=1`);
	const address = list[0];
	const [login, domain] = address.split('@');
	return { login, domain, address };
}

function sanitizeLogin(login) {
	return String(login || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, '')
		.slice(0, 64);
}

async function listMessages(login, domain) {
	return fetchJson(`${ONE_SEC_MAIL_API}?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`);
}

async function readMessage(login, domain, id) {
	return fetchJson(`${ONE_SEC_MAIL_API}?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(id)}`);
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
			mailbox = { login, domain, address: `${login}@${domain}` };
		} else {
			mailbox = await generateMailboxRandom();
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
			const msgs = await listMessages(row.mail_login, row.mail_domain);
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
			const msg = await readMessage(row.mail_login, row.mail_domain, req.params.id);
			res.json({ message: msg });
		} catch (e) {
			console.error('read message error:', e);
			res.status(500).json({ error: String(e?.message || e) });
		}
	});
});

export default router;
