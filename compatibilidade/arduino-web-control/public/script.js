const $ = (selector) => document.querySelector(selector);

const rfidCounterElement = $("#rfidCounter");
const rfidCounterElement1 = $("#rfidCounter1");
let totalLeituras = 0;
let totalLeituras1 = 0;

function incrementarContadorRFID() {
  totalLeituras++;
  if (rfidCounterElement) {
    rfidCounterElement.textContent = totalLeituras;
  }
}
function incrementarContadorRFID1() {
  totalLeituras1++;
  if (rfidCounterElement1) {
    rfidCounterElement1.textContent = totalLeituras1;
  }
}

const elements = {
  usbMode: $("#usbMode"), wifiMode: $("#wifiMode"),
  usbPane: $("#usbPane"), wifiPane: $("#wifiPane"),
  connectUsb: $("#connectUsb"), disconnectUsb: $("#disconnectUsb"),
  connectServer: $("#connectServer"), disconnectServer: $("#disconnectServer"),
  refreshPorts: $("#refreshPorts"), portSelect: $("#portSelect"),
  connectionBadge: $("#connectionBadge"), connectionText: $("#connectionText"),
  connectionMessage: $("#connectionMessage"), modeLabel: $("#modeLabel"),
  allOn: $("#allOn"), allOff: $("#allOff"), readStatus: $("#readStatus"),
  eventLog: $("#eventLog"), cardUid: $("#cardUid"), cardName: $("#cardName"),
  saveCard: $("#saveCard"), registrationStatus: $("#registrationStatus"),
  registrationMessage: $("#registrationMessage"), savedCards: $("#savedCards"),
  refreshCards: $("#refreshCards"),
  accessResult: $("#accessResult"), accessAvatar: $("#accessAvatar"),
  accessStatus: $("#accessStatus"), accessName: $("#accessName"),
  accessUid: $("#accessUid"), accessTime: $("#accessTime"),
  accessDecision: $("#accessDecision")
};

let mode = "usb";
let usbPort = null;
let usbReader = null;
let usbConnected = false;
let serverConnected = false;
let currentStates = { red: false, green: false, blue: false };
let pendingCardUid = "";
let usbReadTask = null;
let serverEvents = null;
let statusParts = {};

function log(message) {
  const entry = document.createElement("p");
  entry.className = "log-entry";
  const time = document.createElement("span");
  time.textContent = new Date().toLocaleTimeString("pt-BR");
  entry.append(time, document.createTextNode(message));
  elements.eventLog.prepend(entry);
  while (elements.eventLog.children.length > 80) elements.eventLog.lastElementChild.remove();
}

function showAccessResult({ granted, uid, name }) {
  const time = new Date().toLocaleTimeString("pt-BR");
  const cleanName = (name || "").trim();
  elements.accessResult.classList.remove("waiting", "granted", "denied");
  elements.accessResult.classList.add(granted ? "granted" : "denied");
  elements.accessAvatar.textContent = granted
    ? (cleanName ? cleanName.charAt(0).toLocaleUpperCase("pt-BR") : "✓")
    : "×";
  elements.accessStatus.textContent = granted ? "ACESSO AUTORIZADO" : "ACESSO NEGADO";
  elements.accessName.textContent = granted ? (cleanName || "Cartão autorizado") : "Pessoa não cadastrada";
  elements.accessUid.textContent = `UID: ${uid || "não informado"}`;
  elements.accessTime.textContent = time;
  elements.accessDecision.textContent = granted ? "Liberado" : "Bloqueado";
}

function setMessage(message) { elements.connectionMessage.textContent = message; }
function isConnected() { return mode === "usb" ? usbConnected : serverConnected; }

function updateConnectionUI() {
  const connected = isConnected();
  elements.connectionBadge.classList.toggle("connected", connected);
  elements.connectionText.textContent = connected ? "Conectado" : "Desconectado";
  document.querySelectorAll("[data-command], #allOn, #allOff, #readStatus")
    .forEach((button) => { button.disabled = !connected; });
  elements.saveCard.disabled = !connected || !pendingCardUid;
  elements.refreshCards.disabled = !connected;
  elements.modeLabel.textContent = mode === "usb" ? "Modo USB" : "Modo Wi-Fi / servidor";
  elements.disconnectUsb.classList.toggle("hidden", !(mode === "usb" && usbConnected));
  elements.disconnectServer.classList.toggle("hidden", !(mode === "wifi" && serverConnected));
}

function updateStates(states) {
  ["red", "green", "blue"].forEach((key) => {
    if (typeof states[key] === "boolean") currentStates[key] = states[key];
    const on = currentStates[key];
    const card = document.querySelector(`[data-led="${key}"]`);
    card.querySelector(".led-symbol").classList.toggle("on", on);
    const state = $(`#${key}State`);
    state.textContent = on ? "Ligado" : "Desligado";
    state.classList.toggle("on", on);
  });
}

function addSavedCard(uid, name) {
  const existing = [...elements.savedCards.querySelectorAll(".saved-card")]
    .find((node) => node.dataset.uid === uid);
  if (existing) return;
  const item = document.createElement("div");
  item.className = "saved-card";
  item.dataset.uid = uid;
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = name || "Cartão cadastrado";
  const code = document.createElement("code");
  code.textContent = uid;
  text.append(title, code);
  item.append(text);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-card-button";
  deleteButton.textContent = "Excluir";
  deleteButton.title = `Excluir cartão ${uid}`;
  deleteButton.addEventListener("click", async () => {
    if (!isConnected()) {
      setMessage("Conecte o Arduino antes de excluir um cartão.");
      return;
    }
    if (!window.confirm(`Deseja excluir o cartão ${name || uid}?\\nUID: ${uid}`)) return;

    deleteButton.disabled = true;
    deleteButton.textContent = "Excluindo...";
    try {
      await sendCommand(`DELETE:${uid}`);
      setMessage(`Solicitada exclusão do cartão ${uid}.`);
    } catch (error) {
      deleteButton.disabled = false;
      deleteButton.textContent = "Excluir";
      setMessage(`Não foi possível excluir o cartão: ${error.message}`);
      log(`Erro ao excluir ${uid}: ${error.message}`);
    }
  });
  item.append(deleteButton);

  if (elements.savedCards.querySelector(".muted")) elements.savedCards.replaceChildren();
  elements.savedCards.append(item);
}

function parseSerialLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed) return;
  log(`Arduino: ${trimmed}`);

  if (trimmed.startsWith("ENROLL_UID:")) {
    pendingCardUid = trimmed.substring("ENROLL_UID:".length).trim();
    elements.cardUid.value = pendingCardUid;
    elements.cardName.value = "";
    elements.registrationStatus.textContent = "Cartão lido";
    elements.registrationMessage.textContent = "Digite o nome e clique em Salvar cartão.";
    updateConnectionUI();
    elements.cardName.focus();
  } else if (trimmed.startsWith("REGISTERED:")) {
    const content = trimmed.substring("REGISTERED:".length);
    const split = content.indexOf("|");
    const uid = split >= 0 ? content.substring(0, split) : pendingCardUid;
    const name = split >= 0 ? content.substring(split + 1) : elements.cardName.value;
    addSavedCard(uid, name);
    pendingCardUid = "";
    elements.cardUid.value = "";
    elements.cardName.value = "";
    elements.registrationStatus.textContent = "Cadastrado";
    elements.registrationMessage.textContent = "Cartão salvo na memória do Arduino com sucesso.";
    updateConnectionUI();
    sendCommand("LIST").catch(() => { });
  } else if (trimmed.startsWith("SAVED_CARD:")) {
    const content = trimmed.substring("SAVED_CARD:".length);
    const split = content.indexOf("|");
    if (split >= 0) addSavedCard(content.substring(0, split), content.substring(split + 1));
  } else if (trimmed.startsWith("DELETE_OK:")) {
    const uid = trimmed.substring("DELETE_OK:".length).trim();
    setMessage(`Cartão ${uid} excluído da memória do Arduino.`);
    elements.registrationStatus.textContent = "Cartão excluído";
    elements.registrationMessage.textContent = `O cartão ${uid} foi removido com sucesso.`;
    log(`Cartão excluído: ${uid}`);
  } else if (trimmed.startsWith("DELETE_ERROR:")) {
    setMessage(trimmed === "DELETE_ERROR:NOT_FOUND"
      ? "O cartão não foi encontrado na memória do Arduino."
      : `Erro ao excluir cartão: ${trimmed}`);
  } else if (trimmed === "LIST_BEGIN") {
    elements.savedCards.replaceChildren();
  } else if (trimmed === "LIST_END") {
    if (!elements.savedCards.children.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Nenhum cartão cadastrado.";
      elements.savedCards.append(p);
    }
  } else if (trimmed.startsWith("ALREADY_REGISTERED:")) {
    const content = trimmed.substring("ALREADY_REGISTERED:".length);
    const split = content.indexOf("|");
    elements.registrationStatus.textContent = "Já cadastrado";
    elements.registrationMessage.textContent = split >= 0
      ? `Este cartão já pertence a ${content.substring(split + 1)}.`
      : "Este cartão já está cadastrado.";
    pendingCardUid = "";
    updateConnectionUI();
  } else if (trimmed.startsWith("SAVE_ERROR:")) {
    elements.registrationStatus.textContent = "Erro no cadastro";
    const errors = {
      "SAVE_ERROR:INVALID": "Dados inválidos. Confira o nome e tente novamente.",
      "SAVE_ERROR:EXISTS": "Este cartão já está cadastrado.",
      "SAVE_ERROR:FULL": "A memória está cheia. O limite é 20 cartões."
    };
    elements.registrationMessage.textContent = errors[trimmed] || trimmed;
    updateConnectionUI();
  } else if (trimmed.startsWith("ACCESS_GRANTED:")) {
    incrementarContadorRFID();
        
    const content = trimmed.substring("ACCESS_GRANTED:".length);
    const split = content.indexOf("|");
    const uid = split >= 0 ? content.substring(0, split).trim() : content.trim();
    const name = split >= 0 ? content.substring(split + 1).trim() : "";
    showAccessResult({ granted: true, uid, name });
    setMessage(name ? `Acesso autorizado: ${name}.` : "Acesso autorizado.");
    // ----------------------------------------------------------------
  } else if (trimmed.startsWith("ACCESS_DENIED:")) {
    incrementarContadorRFID1();

    const uid = trimmed.substring("ACCESS_DENIED:".length).trim();
    showAccessResult({ granted: false, uid, name: "" });
    setMessage("Acesso negado: cartão não cadastrado.");
  } else if (trimmed.startsWith("RED:")) {
    currentStates.red = trimmed.endsWith("1");
    updateStates({ red: currentStates.red });
  } else if (trimmed.startsWith("GREEN:")) {
    currentStates.green = trimmed.endsWith("1");
    updateStates({ green: currentStates.green });
  } else if (trimmed.startsWith("BLUE:")) {
    currentStates.blue = trimmed.endsWith("1");
    updateStates({ blue: currentStates.blue });
  } else if (trimmed.startsWith("STATE:")) {
    const values = trimmed.substring(6).split(",");
    if (values.length === 3) {
      updateStates({ red: values[0] === "1", green: values[1] === "1", blue: values[2] === "1" });
    }
  } else if (trimmed === "RFID_READY") {
    setMessage("Arduino pronto. Sistema RFID iniciado.");
  } else if (trimmed.startsWith("ERROR:")) {
    setMessage(trimmed.substring(6));
  }
}

async function startUsbReader() {
  const decoder = new TextDecoderStream();
  usbPort.readable.pipeTo(decoder.writable).catch(() => { });
  const reader = decoder.readable.getReader();
  usbReader = reader;
  let buffer = "";
  usbReadTask = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(parseSerialLine);
      }
    } catch (error) {
      if (usbConnected) log(`Leitura USB interrompida: ${error.message}`);
    } finally {
      try { reader.releaseLock(); } catch { }
      usbReader = null;
    }
  })();
}

async function connectUsb() {
  if (!("serial" in navigator)) {
    setMessage("Web Serial não está disponível. Use Chrome ou Edge atualizado em localhost ou HTTPS.");
    return;
  }
  try {
    usbPort = await navigator.serial.requestPort();
    await usbPort.open({ baudRate: 9600 });
    usbConnected = true;
    await startUsbReader();
    updateConnectionUI();
    setMessage("USB conectado. Aguarde o Arduino reiniciar e carregar os cartões.");
    log("Conexão USB estabelecida.");
    setTimeout(() => sendCommand("READ_STATUS").catch(() => { }), 1200);
    setTimeout(() => sendCommand("LIST").catch(() => { }), 1500);
  } catch (error) {
    usbConnected = false;
    updateConnectionUI();
    setMessage(`Falha na conexão USB: ${error.message}`);
    log(`Falha USB: ${error.message}`);
  }
}

async function disconnectUsb() {
  usbConnected = false;
  try {
    if (usbReader) await usbReader.cancel();
    if (usbPort) await usbPort.close();
  } catch (error) {
    log(`Aviso ao fechar USB: ${error.message}`);
  }
  usbPort = null;
  usbReader = null;
  updateConnectionUI();
  setMessage("USB desconectado.");
}

async function sendUsbCommand(command) {
  if (!usbPort?.writable) throw new Error("Porta USB não está disponível.");
  const writer = usbPort.writable.getWriter();
  try {
    await writer.write(new TextEncoder().encode(`${command}\n`));
  } finally {
    writer.releaseLock();
  }
}

async function loadPorts() {
  try {
    const response = await fetch("/api/ports");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível listar as portas.");
    elements.portSelect.replaceChildren();
    if (!data.ports?.length) {
      elements.portSelect.add(new Option("Nenhuma porta encontrada", ""));
      setMessage("Nenhuma porta serial encontrada. Conecte o Arduino e tente novamente.");
      return;
    }
    data.ports.forEach((port) => {
      const label = [port.path, port.manufacturer].filter(Boolean).join(" — ");
      elements.portSelect.add(new Option(label, port.path));
    });
    setMessage(`${data.ports.length} porta(s) serial encontrada(s).`);
  } catch (error) {
    setMessage(`Servidor não disponível: ${error.message}. Inicie o servidor Node.js.`);
  }
}

function startServerEvents() {
  if (serverEvents) serverEvents.close();
  serverEvents = new EventSource("/api/events");
  serverEvents.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "serial") parseSerialLine(data.line);
      if (data.type === "connection") {
        serverConnected = !!data.connected;
        updateConnectionUI();
      }
    } catch (error) {
      log(`Evento do servidor inválido: ${error.message}`);
    }
  };
  serverEvents.onerror = () => {
    if (mode === "wifi") log("Tentando manter a conexão de eventos com o servidor...");
  };
}

async function connectServer() {
  const path = elements.portSelect.value;
  if (!path) {
    setMessage("Selecione uma porta serial válida.");
    return;
  }
  try {
    const response = await fetch("/api/connect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha ao conectar.");
    serverConnected = true;
    startServerEvents();
    updateConnectionUI();
    setMessage(`Servidor conectado à porta ${path}.`);
    log(`Conexão pelo servidor estabelecida em ${path}.`);
    setTimeout(() => sendCommand("READ_STATUS").catch(() => { }), 500);
    setTimeout(() => sendCommand("LIST").catch(() => { }), 800);
  } catch (error) {
    serverConnected = false;
    updateConnectionUI();
    setMessage(`Falha na conexão via servidor: ${error.message}`);
    log(`Falha no servidor: ${error.message}`);
  }
}

async function disconnectServer() {
  try {
    await fetch("/api/disconnect", { method: "POST" });
  } catch { }
  serverConnected = false;
  if (serverEvents) serverEvents.close();
  updateConnectionUI();
  setMessage("Conexão do servidor encerrada.");
}

async function sendCommand(command) {
  if (mode === "usb") {
    if (!usbConnected) throw new Error("Conecte o Arduino por USB primeiro.");
    await sendUsbCommand(command);
    log(`Enviado via USB: ${command}`);
  } else {
    if (!serverConnected) throw new Error("Conecte o Arduino pelo servidor primeiro.");
    const response = await fetch("/api/command", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Erro ao enviar comando.");
    log(`Enviado pela rede: ${command}`);
    if (data.state) updateStates(data.state);
  }
}

function safeSend(command) {
  sendCommand(command).catch((error) => {
    setMessage(error.message);
    log(`Erro: ${error.message}`);
  });
}

function setMode(nextMode) {
  mode = nextMode;
  elements.usbMode.classList.toggle("active", mode === "usb");
  elements.wifiMode.classList.toggle("active", mode === "wifi");
  elements.usbPane.classList.toggle("hidden", mode !== "usb");
  elements.wifiPane.classList.toggle("hidden", mode !== "wifi");
  updateConnectionUI();
  setMessage(mode === "usb"
    ? "Modo USB selecionado. Conecte diretamente pelo navegador."
    : "Modo Wi-Fi selecionado. Inicie o servidor Node.js no computador.");
  if (mode === "wifi") loadPorts();
}

elements.usbMode.addEventListener("click", () => setMode("usb"));
elements.wifiMode.addEventListener("click", () => setMode("wifi"));
elements.connectUsb.addEventListener("click", connectUsb);
elements.disconnectUsb.addEventListener("click", disconnectUsb);
elements.refreshPorts.addEventListener("click", loadPorts);
elements.connectServer.addEventListener("click", connectServer);
elements.disconnectServer.addEventListener("click", disconnectServer);

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => safeSend(button.dataset.command));
});
elements.allOn.addEventListener("click", () => safeSend("ALL_ON"));
elements.allOff.addEventListener("click", () => safeSend("ALL_OFF"));
elements.readStatus.addEventListener("click", () => safeSend("READ_STATUS"));
elements.refreshCards.addEventListener("click", () => {
  elements.savedCards.replaceChildren();
  safeSend("LIST");
});
elements.saveCard.addEventListener("click", async () => {
  const uid = pendingCardUid.trim();
  const name = elements.cardName.value.trim();

  if (!isConnected()) {
    elements.registrationMessage.textContent = "Conecte o Arduino antes de salvar.";
    return;
  }
  if (!uid) {
    elements.registrationMessage.textContent = "Pressione o botão físico e aproxime um cartão.";
    return;
  }
  if (!name || name.length > 20 || name.includes("|") || /[\r\n]/.test(name)) {
    elements.registrationMessage.textContent = "Digite um nome de 1 a 20 caracteres, sem |.";
    return;
  }

  elements.saveCard.disabled = true;
  elements.registrationMessage.textContent = "Enviando cadastro ao Arduino...";
  try {
    await sendCommand(`SAVE:${uid}|${name}`);
    log(`Solicitado cadastro: ${uid} | ${name}`);
    setTimeout(() => {
      if (pendingCardUid === uid) {
        elements.saveCard.disabled = !isConnected();
        elements.registrationMessage.textContent =
          "Ainda sem confirmação. Verifique se o Arduino recebeu o comando pela serial.";
      }
    }, 3000);
  } catch (error) {
    elements.saveCard.disabled = false;
    elements.registrationMessage.textContent = error.message;
  }
});
$("#clearLog").addEventListener("click", () => {
  elements.eventLog.replaceChildren();
  log("Registro limpo.");
});

if ("serial" in navigator) {
  navigator.serial.addEventListener("disconnect", () => {
    usbConnected = false;
    updateConnectionUI();
    setMessage("A conexão USB foi encerrada.");
    log("Dispositivo USB desconectado.");
  });
}

updateConnectionUI();
log("Painel KBIT iniciado. Escolha USB direto ou Wi-Fi / rede.");
