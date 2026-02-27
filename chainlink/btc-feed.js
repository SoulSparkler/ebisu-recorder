/**
 * Chainlink BTC/USD price feed via Polymarket RTDS.
 * Connects using Phoenix channel protocol (vsn 2.0).
 * Outputs to stdout: "CL: {price}" on each price update.
 */

const WebSocket = require("ws");

const WS_URL = "wss://ws-live-data.polymarket.com/socket/websocket?vsn=2.0.0";
const TOPIC = "crypto_prices:btc/usd";
const HEARTBEAT_MS = 20000;
const RECONNECT_MS = 3000;

let ws = null;
let ref = 0;
let heartbeatTimer = null;

function nextRef() {
  ref++;
  return String(ref);
}

function send(topic, event, payload, joinRef = null) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Phoenix 2.0 wire format: [join_ref, ref, topic, event, payload]
  const frame = JSON.stringify([joinRef, nextRef(), topic, event, payload]);
  ws.send(frame);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    send("phoenix", "heartbeat", {});
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    const joinRef = nextRef();
    // Join the crypto prices channel
    ws.send(JSON.stringify([joinRef, nextRef(), TOPIC, "phx_join", {}]));
    startHeartbeat();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      // Phoenix 2.0: [join_ref, ref, topic, event, payload]
      const [, , topic, event, payload] = msg;

      if (topic !== TOPIC) return;

      // Price update events
      if (event === "update" || event === "price" || event === "tick") {
        const price =
          payload.price ??
          payload.value ??
          payload.last ??
          payload.close ??
          payload.mark;
        if (price != null) {
          process.stdout.write(`CL: ${price}\n`);
        }
        return;
      }

      // Some feeds emit the price directly on phx_reply for the join
      if (event === "phx_reply" && payload?.response?.price != null) {
        process.stdout.write(`CL: ${payload.response.price}\n`);
      }
    } catch (_) {
      // Non-JSON frames – try plain-text fallback
      const text = raw.toString().trim();
      const m = text.match(/([0-9]+(?:\.[0-9]+)?)/);
      if (m) {
        process.stdout.write(`CL: ${m[1]}\n`);
      }
    }
  });

  ws.on("close", () => {
    stopHeartbeat();
    setTimeout(connect, RECONNECT_MS);
  });

  ws.on("error", (err) => {
    process.stderr.write(`[btc-feed] ws error: ${err.message}\n`);
  });
}

connect();
