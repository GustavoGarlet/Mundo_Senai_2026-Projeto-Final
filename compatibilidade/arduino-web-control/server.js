const express = require("express");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let serial = null;
let parser = null;
let connectedPath = "";
const clients = new Set();

function sendEvent(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of clients) response.write(data);
}

function broadcastLine(line) {
  const clean = String(line).trim();
  if (!clean) return;
  console.log("[Arduino]", clean);
  sendEvent({ type: "serial", line: clean });
}

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connection", connected: !!serial?.isOpen })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.get("/api/ports", async (req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({ ports: ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || "",
      vendorId: p.vendorId || "",
      productId: p.productId || ""
    })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/connect", async (req, res) => {
  const portPath = String(req.body?.path || "");
  if (!portPath) return res.status(400).json({ error: "Porta serial não informada." });
  if (serial?.isOpen) return res.status(409).json({ error: `Já existe uma conexão aberta em ${connectedPath}.` });

  try {
    serial = new SerialPort({ path: portPath, baudRate: 9600, autoOpen: false });
    parser = serial.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", broadcastLine);
    serial.on("error", (error) => {
      console.error("Erro serial:", error.message);
      sendEvent({ type: "serial", line: `ERROR:${error.message}` });
    });
    serial.on("close", () => {
      connectedPath = "";
      sendEvent({ type: "connection", connected: false });
    });

    await new Promise((resolve, reject) => serial.open(err => err ? reject(err) : resolve()));
    connectedPath = portPath;
    sendEvent({ type: "connection", connected: true });
    res.json({ ok: true, path: portPath });
  } catch (error) {
    serial = null;
    parser = null;
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/disconnect", async (req, res) => {
  if (!serial || !serial.isOpen) {
    serial = null;
    parser = null;
    connectedPath = "";
    return res.json({ ok: true });
  }
  const current = serial;
  current.close(error => {
    serial = null;
    parser = null;
    connectedPath = "";
    if (error) return res.status(500).json({ error: error.message });
    sendEvent({ type: "connection", connected: false });
    res.json({ ok: true });
  });
});

app.post("/api/command", (req, res) => {
  const command = String(req.body?.command || "").trim();
  if (!command || /[\r\n]/.test(command)) {
    return res.status(400).json({ error: "Comando inválido." });
  }
  if (!serial?.isOpen) return res.status(409).json({ error: "Arduino não conectado ao servidor." });

  serial.write(`${command}\n`, error => {
    if (error) return res.status(500).json({ error: error.message });
    serial.drain(drainError => {
      if (drainError) return res.status(500).json({ error: drainError.message });
      res.json({ ok: true });
    });
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, connected: !!serial?.isOpen, port: connectedPath });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`KBIT Control Center disponível em http://localhost:${PORT}`);
  console.log("Para acessar por outro dispositivo, use o IP local deste computador e a porta 3000.");
});
