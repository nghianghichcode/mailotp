const apiBase = '';
let token = localStorage.getItem('tm_token') || '';

const qs = (s) => document.querySelector(s);
const authSection = qs('#auth-section');
const mailSection = qs('#mail-section');
const nav = qs('#nav');
const currentAddressEl = qs('#current-address');
const messagesEl = qs('#messages');
const messageContentEl = qs('#message-content');

function setAuthedUI(authed) {
	authSection.classList.toggle('hidden', authed);
	mailSection.classList.toggle('hidden', !authed);
	nav.innerHTML = authed
		? '<button id="logout">Đăng xuất</button>'
		: '';
	if (authed) {
		qs('#logout').onclick = () => {
			localStorage.removeItem('tm_token');
			token = '';
			setAuthedUI(false);
		};
	}
}

async function api(path, options = {}) {
	const headers = { 'Content-Type': 'application/json' };
	if (token) headers['Authorization'] = `Bearer ${token}`;
	const resp = await fetch(apiBase + path, { ...options, headers });
	const data = await resp.json().catch(() => ({}));
	if (!resp.ok) throw Object.assign(new Error(data?.error || 'Request failed'), { status: resp.status, data });
	return data;
}

async function loadDomains() {
	try {
		const data = await api('/api/domains');
		const select = qs('#domain');
		select.innerHTML = '';
		for (const d of data.domains || []) {
			const opt = document.createElement('option');
			opt.value = d; opt.textContent = d;
			select.appendChild(opt);
		}
	} catch {
		const fallback = ['1secmail.com','1secmail.org','1secmail.net'];
		qs('#domain').innerHTML = fallback.map(d => `<option value="${d}">${d}</option>`).join('');
	}
}

async function loadMailbox() {
	try {
		const data = await api('/api/mailbox');
		if (!data.address) currentAddressEl.textContent = '(chưa có)';
		else currentAddressEl.textContent = data.address;
		await loadMessages();
	} catch (e) {
		console.error(e);
	}
}

function renderMessages(list) {
	messagesEl.innerHTML = '';
	if (!list || list.length === 0) {
		messagesEl.innerHTML = '<div class="muted">Chưa có thư nào. Gửi OTP vào email ở trên để nhận.</div>';
		return;
	}
	for (const m of list) {
		const el = document.createElement('div');
		el.className = 'message-item';
		el.innerHTML = `
			<div><strong>${m.from}</strong> — <span class="muted">${m.subject || '(Không tiêu đề)'}</span></div>
			<div class="muted">ID: ${m.id} • ${new Date(m.date).toLocaleString()}</div>
		`;
		el.onclick = () => openMessage(m.id);
		messagesEl.appendChild(el);
	}
}

async function loadMessages() {
	try {
		const data = await api('/api/messages');
		renderMessages(data.messages || []);
	} catch (e) {
		messagesEl.innerHTML = `<div class="muted">${e.message}</div>`;
	}
}

async function openMessage(id) {
	messageContentEl.textContent = 'Đang tải...';
	try {
		const data = await api(`/api/messages/${id}`);
		const msg = data.message || {};
		const parts = [];
		parts.push(`Từ: ${msg.from}`);
		parts.push(`Đến: ${msg.to}`);
		parts.push(`Chủ đề: ${msg.subject}`);
		parts.push('');
		if (msg.textBody) parts.push(msg.textBody);
		if (!msg.textBody && msg.body) parts.push(msg.body);
		messageContentEl.textContent = parts.join('\n');
	} catch (e) {
		messageContentEl.textContent = e.message || 'Không đọc được thư';
	}
}

function copyAddress() {
	const text = currentAddressEl.textContent.trim();
	if (!text || text === '(chưa có)') return;
	navigator.clipboard.writeText(text);
}

function initAuthForms() {
	qs('#login-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const email = qs('#login-email').value.trim();
		const password = qs('#login-password').value;
		try {
			const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
			token = data.token;
			localStorage.setItem('tm_token', token);
			setAuthedUI(true);
			await Promise.all([loadDomains(), loadMailbox()]);
		} catch (err) {
			alert(err?.data?.error || 'Đăng nhập thất bại');
		}
	});

	qs('#register-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const email = qs('#register-email').value.trim();
		const password = qs('#register-password').value;
		try {
			const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ email, password }) });
			token = data.token;
			localStorage.setItem('tm_token', token);
			setAuthedUI(true);
			await Promise.all([loadDomains(), loadMailbox()]);
		} catch (err) {
			alert(err?.data?.error || 'Đăng ký thất bại');
		}
	});
}

function initMailboxActions() {
	qs('#new-mail').onclick = async () => {
		qs('#new-mail').disabled = true;
		try {
			const local = (qs('#local-part').value || '').trim();
			const domain = qs('#domain').value;
			const body = local ? { login: local, domain } : {};
			const data = await api('/api/mailbox/new', { method: 'POST', body: JSON.stringify(body) });
			currentAddressEl.textContent = data.address;
			await loadMessages();
		} catch (e) {
			alert(e?.data?.error || e.message || 'Tạo email thất bại');
		} finally {
			qs('#new-mail').disabled = false;
		}
	};
	qs('#refresh').onclick = loadMessages;
	qs('#copy-address').onclick = copyAddress;
	const clearBtn = qs('#clear-mail');
	if (clearBtn) {
		clearBtn.onclick = async () => {
			try {
				await api('/api/mailbox/clear', { method: 'POST' });
				currentAddressEl.textContent = '(chưa có)';
				messagesEl.innerHTML = '<div class="muted">Đã xóa hộp thư. Tạo mới để dùng tiếp.</div>';
				messageContentEl.textContent = '';
			} catch (e) {
				alert('Không xóa được hộp thư');
			}
		};
	}
}

function init() {
	setAuthedUI(!!token);
	initAuthForms();
	initMailboxActions();
	if (token) {
		Promise.all([loadDomains(), loadMailbox()]);
	}
}

document.addEventListener('DOMContentLoaded', init);
