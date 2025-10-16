// LGS Paintboard helper - single clean implementation
import fetch from 'node-fetch';
import WebSocket from 'ws';

const WS_URL = 'wss://paintboard.luogu.me/api/paintboard/ws';
const TOKEN_URL = 'https://paintboard.luogu.me/api/auth/gettoken';

let ws = null;
let chunks = [];
let totalSize = 0;
let paintId = 1;
const pendingPaints = new Map();
// store unconfirmed packets so we can resend after reconnect
const pendingPackets = new Map(); // id -> { data, attempts, sentAt }

function appendData(paintData) {
  chunks.push(paintData);
  totalSize += paintData.length;
}

function getMergedData() {
  if (totalSize === 0) return new Uint8Array(0);
  const out = new Uint8Array(totalSize);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  chunks = [];
  totalSize = 0;
  return out;
}

function uintToBytesLE(n, bytes) {
  const a = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    a[i] = n & 0xff;
    n = n >> 8;
  }
  return a;
}

async function getToken(uid, access_key) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, access_key })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ct = (res.headers.get && res.headers.get('content-type')) || '';
      if (!ct.includes('application/json')) throw new Error('非 JSON 返回: ' + ct);
      const data = await res.json();
      if (data && data.data && data.data.token) return data.data.token;
      throw new Error('获取 token 失败: ' + JSON.stringify(data));
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      const backoff = 200 * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

function ensureWS(onOpen) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (onOpen) onOpen();
    return;
  }
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    console.log('ws open');
    // on reconnect, resend pending packets
    try {
      for (const [id, pkt] of pendingPackets) {
        if (pkt && pkt.data) ws.send(pkt.data);
      }
    } catch (e) {
      console.error('resend pending packets failed', e);
    }
    if (onOpen) onOpen();
  };
  ws.onerror = (e) => console.error('ws error', e && e.message ? e.message : e);
  ws.onclose = (e) => {
    console.log('ws closed', e && e.code, e && e.reason || '');
    // start reconnect loop
    (async function reconnectLoop() {
      let attempt = 0;
      while (!ws || ws.readyState !== WebSocket.OPEN) {
        attempt++;
        const backoff = Math.min(30000, 500 * Math.pow(2, attempt));
        await new Promise(r => setTimeout(r, backoff));
        try {
          console.log('attempting ws reconnect...');
          ensureWS();
          // wait briefly to see if open
          await new Promise(r => setTimeout(r, 1000));
          if (ws && ws.readyState === WebSocket.OPEN) break;
        } catch (e) {
          // continue
        }
      }
    })();
  };
  ws.onmessage = (ev) => {
    try {
      const buf = ev.data;
      const view = new DataView(buf);
      let off = 0;
      while (off < buf.byteLength) {
        const t = view.getUint8(off); off++;
        if (t === 0xfc) {
          // server ping -> send pong
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([0xfb]));
          continue;
        }
        if (t === 0xff) {
          // paint result: id:uint32 + code:uint8
          const id = view.getUint32(off, true);
          const code = view.getUint8(off + 4);
          off += 5;
          const p = pendingPaints.get(id);
          if (p) {
            pendingPaints.delete(id);
            // also remove pendingPackets entry
            pendingPackets.delete(id);
            p.resolve({ id, code });
          }
          continue;
        }
        // unknown op - skip rest
        break;
      }
    } catch (err) {
      console.error('ws message parse error', err);
    }
  };

  // flush merged packets regularly
  const ticker = setInterval(() => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN && chunks.length > 0) {
        const m = getMergedData();
        if (m.length > 0) {
          ws.send(m);
          // record each packet's id from m: we cannot parse multiple ids easily here,
          // so the sendPaintPacket will also store to pendingPackets when creating packets.
        }
      }
    } catch (e) {
      console.error('ws send error', e);
    }
  }, 20);
  // clear interval on close
  ws.addEventListener('close', () => clearInterval(ticker));
}

function tokenStringToBytes(tokenStr) {
  const out = new Uint8Array(16);
  if (!tokenStr) return out;
  const s = tokenStr.replace(/-/g, '');
  for (let i = 0; i < 16 && i * 2 + 1 < s.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16) || 0;
  }
  return out;
}

function sendPaintPacket(uid, token, r, g, b, x, y) {
  const id = (paintId++) >>> 0;
  const tokenBytes = tokenStringToBytes(token);
  const arr = new Uint8Array(1 + 2 + 2 + 3 + 3 + 16 + 4); // op + x(2) + y(2) + rgb(3) + uid(3) + token(16) + id(4)
  let off = 0;
  arr[off++] = 0xfe;
  arr.set(uintToBytesLE(x, 2), off); off += 2;
  arr.set(uintToBytesLE(y, 2), off); off += 2;
  arr[off++] = r; arr[off++] = g; arr[off++] = b;
  arr.set(uintToBytesLE(uid, 3), off); off += 3;
  arr.set(tokenBytes, off); off += 16;
  arr.set(uintToBytesLE(id, 4), off); off += 4;

  // save to pendingPackets so we can resend if connection drops before confirmation
  pendingPackets.set(id, { data: arr.slice(), attempts: 0, sentAt: Date.now() });
  appendData(arr);
  // return a promise resolved when server replies for this id
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => {
      pendingPaints.delete(id);
      // leave pendingPackets so reconnect can resend
      reject(new Error('paint timeout id=' + id));
    }, 10000);
    pendingPaints.set(id, {
      resolve: (v) => { clearTimeout(to); resolve(v); },
      reject: (e) => { clearTimeout(to); reject(e); }
    });
  });
}

async function paint(uid, access_key, r, g, b, x, y) {
  if (typeof uid !== 'number') throw new TypeError('uid 必须为 number');

  // result codes (assumptions based on protocol):
  const CODE_SUCCESS = 0xef; // success
  const CODE_COOLDOWN = 0xee; // need to wait and retry
  const CODE_INVALID_TOKEN = 0xed; // token invalid, refresh

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function ensureWSPromise() {
    return new Promise((resolve) => ensureWS(resolve));
  }

  const maxAttempts = 5;
  let token = await getToken(uid, access_key);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureWSPromise();
      const res = await sendPaintPacket(uid, token, r, g, b, x, y);
      const code = (res && res.code) || 0;
      if (code === CODE_SUCCESS) return res;
      if (code === CODE_INVALID_TOKEN) {
        // try refresh token once and retry
        token = await getToken(uid, access_key);
        continue;
      }
      if (code === CODE_COOLDOWN) {
        const backoff = Math.min(30000, 500 * Math.pow(2, attempt));
        await sleep(backoff);
        continue;
      }
      // unknown code: throw to let caller see it
      throw new Error('paint returned failure code=' + code.toString(16));
    } catch (e) {
      // on timeout or network error, backoff and retry
      if (attempt === maxAttempts) throw e;
      const backoff = 500 * Math.pow(2, attempt);
      await sleep(backoff);
    }
  }
  throw new Error('paint failed after retries');
}

export { paint };