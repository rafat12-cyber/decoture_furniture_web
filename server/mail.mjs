// A small SMTP client for order notifications, so the server needs no packages.
// Works with any provider that accepts SMTP over TLS on port 465 (Gmail, Zoho, Brevo, cPanel mail).
import net from 'node:net';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const header = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

export function createMailer(config, log = console) {
  const enabled = !!(config.host && config.from);
  async function send({ to, subject, text, replyTo }) {
    const recipients = [].concat(to).filter(Boolean);
    if (!enabled || !recipients.length) return false;
    const socket = config.secure === false
      ? net.connect(config.port, config.host)
      : tls.connect({ host: config.host, port: config.port, servername: config.host });
    socket.setEncoding('utf8');
    socket.setTimeout(20000, () => socket.destroy(new Error('SMTP timeout')));
    let buffer = '';
    const waiting = [];
    socket.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) waiting.shift()?.resolve(line);
      }
    });
    socket.on('error', (e) => waiting.splice(0).forEach((w) => w.reject(e)));
    const reply = () => new Promise((resolve, reject) => waiting.push({ resolve, reject }));
    const expect = async (codes, cmd) => {
      const p = reply();
      if (cmd != null) socket.write(`${cmd}\r\n`);
      const line = await p;
      if (!codes.includes(line.slice(0, 3))) throw new Error(`SMTP ${cmd ? cmd.split(' ')[0] : 'greeting'} failed: ${line}`);
      return line;
    };
    try {
      await expect(['220']);
      await expect(['250'], `EHLO ${config.helo || 'decoture.local'}`);
      if (config.user) {
        await expect(['334'], 'AUTH LOGIN');
        await expect(['334'], b64(config.user));
        await expect(['235'], b64(config.pass || ''));
      }
      await expect(['250'], `MAIL FROM:<${config.from}>`);
      for (const r of recipients) await expect(['250', '251'], `RCPT TO:<${r}>`);
      await expect(['354'], 'DATA');
      const domain = config.from.split('@')[1] || 'decoture.local';
      const message = [
        `From: ${header(config.fromName || 'Decoture')} <${config.from}>`,
        `To: ${recipients.join(', ')}`,
        replyTo ? `Reply-To: ${replyTo}` : null,
        `Subject: ${header(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(b64(text)),
      ].filter((l) => l !== null).join('\r\n');
      await expect(['250'], `${message.replace(/^\./gm, '..')}\r\n.`);
      await expect(['221'], 'QUIT').catch(() => {});
      return true;
    } finally {
      socket.end();
    }
  }
  return {
    enabled,
    // Notifications never block or fail an order: errors are logged and dropped.
    notify(msg) {
      if (!enabled) return Promise.resolve(false);
      return send(msg).catch((e) => { log.error(`[mail] ${e.message}`); return false; });
    },
    send,
  };
}
