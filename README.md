# WhatsApp Sticker Bot

Bot para grupos y chats privados de WhatsApp que convierte automáticamente en sticker cualquier foto enviada con una palabra clave en el pie de foto.

## Características

- Se conecta a WhatsApp sin necesidad de la API oficial de negocio, usando [Baileys](https://github.com/WhiskeySockets/Baileys).
- Detecta fotos enviadas en grupos y chats privados y las convierte a formato sticker (WebP) al vuelo.
- Metadata de sticker personalizable (nombre del pack y autor) con [wa-sticker-formatter](https://github.com/CENTSITE/WA-Sticker-Formatter).
- Palabra disparadora configurable, o modo automático para todas las fotos.

## Requisitos

- Node.js 18 o superior
- Un número de WhatsApp para el bot (se recomienda uno secundario, no el personal)

## Instalación

```bash
git clone <url-de-este-repo>
cd whatsapp-sticker-bot
npm install
```

## Uso

```bash
npm start
```

Escanea el código QR que aparece en la terminal desde **WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo**.

Una vez conectado, envía una foto en un grupo o chat privado con `#s` en el pie de foto y el bot responde con el sticker generado.

## Configuración

Todo el comportamiento se ajusta en `index.js`:

| Variable | Descripción |
|---|---|
| `TRIGGER_WORD` | Palabra que debe llevar el pie de foto para generar el sticker. Déjala como `''` para que **todas** las fotos de grupos y chats privados se conviertan automáticamente. |
| `pack` / `author` (dentro del objeto `Sticker`) | Nombre del pack y autor que se muestra al mantener presionado el sticker en WhatsApp. |

## Despliegue 24/7

Para que el bot corra de forma continua, hospédalo en un servidor, VPS, Raspberry Pi, un teléfono con Termux, o un servicio en la nube con proceso persistente (no sirven plataformas *serverless*), usando un gestor de procesos como [pm2](https://pm2.keymetrics.io/):

```bash
npm i -g pm2
pm2 start index.js --name sticker-bot
```

Conserva las carpetas `auth_info/` y `data/` entre despliegues y reinicios. `auth_info/` contiene la sesión, y `data/` conserva la cola de imágenes pendientes y los mensajes ya procesados. Borrar `auth_info/` obliga a volver a escanear el QR.

## Aviso

Este proyecto usa [Baileys](https://github.com/WhiskeySockets/Baileys), una librería no oficial que simula una sesión de WhatsApp Web. No forma parte de la API oficial de Meta/WhatsApp Business y técnicamente incumple sus Términos de Servicio, por lo que existe riesgo (bajo pero real) de que el número quede bloqueado. Se recomienda usar un número secundario y evitar mensajería masiva o automatizada fuera de esta funcionalidad.

**Nunca subas la carpeta `auth_info/` a este repositorio** — contiene las credenciales de sesión de WhatsApp del bot. Ya está excluida en `.gitignore`.

## Licencia

ISC
