import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'app.db');

sqlite3.verbose();
const db = new sqlite3.Database(dbPath);

export function initDb() {
	return new Promise((resolve, reject) => {
		db.serialize(() => {
			db.run(
				`CREATE TABLE IF NOT EXISTS users (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					email TEXT UNIQUE NOT NULL,
					password_hash TEXT NOT NULL,
					mail_login TEXT,
					mail_domain TEXT,
					created_at DATETIME DEFAULT CURRENT_TIMESTAMP
				)`,
				(err) => {
					if (err) return reject(err);
					resolve();
				}
			);
		});
	});
}

export function getDb() {
	return db;
}
