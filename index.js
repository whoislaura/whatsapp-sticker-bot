const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const { Sticker } = require('wa-sticker-formatter');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Palabra que debe aparecer en el pie de foto (caption) para convertirla en sticker.
// Déjala vacía ('') si quieres que el bot convierta TODAS las fotos del grupo automáticamente.
const TRIGGER_WORD = '#s';

const logger = pino({ level: 'silent' });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscanea este código QR desde WhatsApp > Dispositivos vinculados:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(
        'Conexión cerrada.',
        shouldReconnect
          ? 'Reconectando...'
          : 'Sesión cerrada (logout). Borra la carpeta auth_info y vuelve a escanear el QR.'
      );

      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot conectado a WhatsApp.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid?.endsWith('@g.us');
    if (!isGroup) return; // El bot solo responde dentro de grupos

    const imageMessage = msg.message.imageMessage;
    if (!imageMessage) return;

    const caption = (imageMessage.caption || '').toLowerCase();
    if (TRIGGER_WORD && !caption.includes(TRIGGER_WORD)) return;

    try {
      console.log('📷 Imagen recibida, generando sticker...');

      const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });

      const sticker = new Sticker(buffer, {
        pack: 'Sticker generado',
        author: 'Sticker Bot',
        // Valores válidos: 'default', 'crop', 'full', 'circle', 'rounded'
        type: 'full',
        quality: 70,
      });

      const stickerBuffer = await sticker.toBuffer();

      await sock.sendMessage(jid, { sticker: stickerBuffer }, { quoted: msg });
      console.log('✅ Sticker enviado.');
    } catch (err) {
      console.error('❌ Error generando el sticker:', err);
    }
  });
}

startBot();