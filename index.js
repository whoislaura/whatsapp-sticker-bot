const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  BufferJSON,
} = require('@whiskeysockets/baileys');
const { Sticker } = require('wa-sticker-formatter');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// Palabra que debe aparecer en el pie de foto (caption) para convertirla en sticker.
// Déjala vacía ('') si quieres que el bot convierta TODAS las fotos del grupo automáticamente.
const TRIGGER_WORD = '#s';
const QUEUE_FILE = path.join(__dirname, 'data', 'message-queue.json');
const MAX_PROCESSED_IDS = 2000;
const RETRY_DELAY_MS = 5000;

const logger = pino({ level: 'silent' });
let activeSocket;
let connectionOpen = false;
let queueProcessing = false;
let retryTimer;
let queue = loadQueue();

if (!queue.initialized) {
  queue.initialized = true;
  queue.lastMessageTimestamp = Math.floor(Date.now() / 1000);
  saveQueue();
}

function loadQueue() {
  try {
    const contents = fs.readFileSync(QUEUE_FILE, 'utf8');
    const savedQueue = JSON.parse(contents);

    return {
      initialized: Boolean(savedQueue.initialized),
      lastMessageTimestamp: Number(savedQueue.lastMessageTimestamp) || 0,
      pending: savedQueue.pending && typeof savedQueue.pending === 'object'
        ? savedQueue.pending
        : {},
      processed: Array.isArray(savedQueue.processed)
        ? savedQueue.processed
        : [],
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('❌ No se pudo cargar la cola de mensajes:', err.message);
    }

    return {
      initialized: false,
      lastMessageTimestamp: 0,
      pending: {},
      processed: [],
    };
  }
}

function saveQueue() {
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

function getMessageTimestamp(msg) {
  const timestamp = msg.messageTimestamp;

  if (timestamp && typeof timestamp.toNumber === 'function') {
    return timestamp.toNumber();
  }

  return Number(timestamp) || 0;
}

function getImageMessage(msg) {
  const jid = msg.key?.remoteJid;
  if (!isSupportedConversation(jid)) return null;

  const imageMessage = msg.message?.imageMessage;
  if (!imageMessage) return null;

  const caption = (imageMessage.caption || '').toLowerCase();
  if (TRIGGER_WORD && !caption.includes(TRIGGER_WORD)) return null;

  return { jid, imageMessage };
}

function isSupportedConversation(jid) {
  const isGroup = jid?.endsWith('@g.us');
  const isPrivate =
    jid?.endsWith('@s.whatsapp.net') || jid?.endsWith('@lid');

  return Boolean(jid && (isGroup || isPrivate));
}

function serializeMessage(msg) {
  return JSON.stringify(msg, BufferJSON.replacer);
}

function deserializeMessage(serializedMessage) {
  return JSON.parse(serializedMessage, BufferJSON.reviver);
}

function addProcessedId(messageId) {
  queue.processed.push(messageId);

  if (queue.processed.length > MAX_PROCESSED_IDS) {
    queue.processed.splice(0, queue.processed.length - MAX_PROCESSED_IDS);
  }
}

function enqueueMessage(msg) {
  const messageId = msg.key?.id;
  const timestamp = getMessageTimestamp(msg);
  const jid = msg.key?.remoteJid;

  if (!messageId || !timestamp || !isSupportedConversation(jid)) return false;

  const isNewMessage = timestamp >= queue.lastMessageTimestamp;
  let queueChanged = false;

  if (timestamp > queue.lastMessageTimestamp) {
    queue.lastMessageTimestamp = timestamp;
    queueChanged = true;
  }

  if (!isNewMessage) return queueChanged;

  const image = getImageMessage(msg);
  if (!image || queue.processed.includes(messageId) || queue.pending[messageId]) {
    return queueChanged;
  }

  queue.pending[messageId] = {
    id: messageId,
    jid: image.jid,
    timestamp,
    attempts: 0,
    nextAttemptAt: 0,
    serializedMessage: serializeMessage(msg),
  };

  return true;
}

function getNextPendingMessage() {
  const now = Date.now();

  return Object.values(queue.pending)
    .filter((item) => !item.nextAttemptAt || item.nextAttemptAt <= now)
    .sort((a, b) => a.timestamp - b.timestamp)[0];
}

function resumeQueue(sock) {
  if (sock !== activeSocket || !connectionOpen) return;

  const pendingMessages = Object.values(queue.pending);
  if (!pendingMessages.length) return;

  const nextPendingMessage = getNextPendingMessage();
  if (nextPendingMessage) {
    processQueue(sock);
    return;
  }

  const nextAttemptAt = Math.min(
    ...pendingMessages.map((item) => item.nextAttemptAt || Date.now())
  );
  scheduleRetry(sock, Math.max(nextAttemptAt - Date.now(), 0));
}

function scheduleRetry(sock, delay) {
  if (retryTimer) clearTimeout(retryTimer);

  retryTimer = setTimeout(() => {
    retryTimer = undefined;

    if (sock === activeSocket && connectionOpen) {
      processQueue(sock);
    }
  }, delay);
}

async function processQueue(sock) {
  if (queueProcessing || sock !== activeSocket || !connectionOpen) return;

  queueProcessing = true;

  try {
    let pendingMessage;

    while ((pendingMessage = getNextPendingMessage())) {
      pendingMessage.attempts += 1;
      saveQueue();

      try {
        const msg = deserializeMessage(pendingMessage.serializedMessage);

        console.log(
          `📷 Procesando imagen pendiente (intento ${pendingMessage.attempts})...`
        );

        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger }
        );

        const sticker = new Sticker(buffer, {
          pack: 'Sticker generado',
          author: 'Sticker Bot',
          // Valores válidos: 'default', 'crop', 'full', 'circle', 'rounded'
          type: 'full',
          quality: 70,
        });

        const stickerBuffer = await sticker.toBuffer();

        await sock.sendMessage(
          pendingMessage.jid,
          { sticker: stickerBuffer },
          { quoted: msg }
        );

        delete queue.pending[pendingMessage.id];
        addProcessedId(pendingMessage.id);
        saveQueue();
        console.log('✅ Sticker enviado.');
      } catch (err) {
        const retryDelay = Math.min(
          RETRY_DELAY_MS * 2 ** Math.min(pendingMessage.attempts - 1, 5),
          300000
        );

        pendingMessage.nextAttemptAt = Date.now() + retryDelay;
        pendingMessage.lastError = err.message;
        saveQueue();

        console.error('❌ Error procesando sticker:', err);
        scheduleRetry(sock, retryDelay);
      }
    }
  } finally {
    queueProcessing = false;
    resumeQueue(activeSocket);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger,
  });
  activeSocket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscanea este código QR desde WhatsApp > Dispositivos vinculados:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      if (sock === activeSocket) connectionOpen = false;

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
      connectionOpen = true;
      console.log('✅ Bot conectado a WhatsApp.');
      resumeQueue(sock);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;

    let queueChanged = false;

    for (const msg of messages) {
      if (enqueueMessage(msg)) queueChanged = true;
    }

    if (queueChanged) {
      saveQueue();
      processQueue(sock);
    }
  });
}

startBot();
