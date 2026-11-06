#include <SPI.h>
#include <MFRC522.h>
#include <EEPROM.h>

#define RFID_SS 7
#define RFID_RST 6
#define BUTTON_PIN 5
#define LED_RED 8
#define LED_GREEN 9
#define LED_BLUE 10
#define ACCESS_PIN 4
#define BUZZER 3

const byte MAX_CARDS = 20;
const byte MAX_UID = 10;
const byte NAME_SIZE = 21;
const byte VALID_MARK = 0xA5;

struct SavedCard {
  byte marker;
  byte uidSize;
  byte uid[MAX_UID];
  char name[NAME_SIZE];
};

MFRC522 rfid(RFID_SS, RFID_RST);
String serialLine;
byte pendingUID[MAX_UID];
byte pendingUIDSize = 0;
bool registerMode = false;
bool waitingForName = false;

bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
unsigned long lastButtonChange = 0;
unsigned long accessUntil = 0;
const unsigned long DEBOUNCE_MS = 40;
const unsigned long ACCESS_MS = 1000;

int cardAddress(byte index) {
  return index * sizeof(SavedCard);
}

String uidText(const byte *uid, byte size) {
  String result;
  for (byte i = 0; i < size; i++) {
    if (uid[i] < 16) result += "0";
    result += String(uid[i], HEX);
  }
  result.toUpperCase();
  return result;
}

bool validCard(byte index, SavedCard &card) {
  EEPROM.get(cardAddress(index), card);
  return card.marker == VALID_MARK &&
         card.uidSize > 0 &&
         card.uidSize <= MAX_UID &&
         card.name[NAME_SIZE - 1] == '\0';
}

int findCard(const byte *uid, byte size, SavedCard &found) {
  for (byte i = 0; i < MAX_CARDS; i++) {
    SavedCard card;
    if (!validCard(i, card) || card.uidSize != size) continue;
    bool same = true;
    for (byte j = 0; j < size; j++) {
      if (card.uid[j] != uid[j]) { same = false; break; }
    }
    if (same) { found = card; return i; }
  }
  return -1;
}

int freeSlot() {
  for (byte i = 0; i < MAX_CARDS; i++) {
    SavedCard card;
    EEPROM.get(cardAddress(i), card);
    if (card.marker != VALID_MARK) return i;
  }
  return -1;
}

void listCards() {
  Serial.println("LIST_BEGIN");
  for (byte i = 0; i < MAX_CARDS; i++) {
    SavedCard card;
    if (validCard(i, card)) {
      Serial.print("SAVED_CARD:");
      Serial.print(uidText(card.uid, card.uidSize));
      Serial.print("|");
      Serial.println(card.name);
    }
  }
  Serial.println("LIST_END");
}

void readStatus() {
  Serial.print("RED:"); Serial.println(digitalRead(LED_RED));
  Serial.print("GREEN:"); Serial.println(digitalRead(LED_GREEN));
  Serial.print("BLUE:"); Serial.println(digitalRead(LED_BLUE));
}

void handleCommand(String cmd) {
  cmd.trim();

  if (cmd == "LIST") { listCards(); return; }
  if (cmd == "READ_STATUS" || cmd == "STATUS") { readStatus(); return; }

  if (cmd == "RED_ON") digitalWrite(LED_RED, HIGH);
  else if (cmd == "RED_OFF") digitalWrite(LED_RED, LOW);
  else if (cmd == "GREEN_ON") digitalWrite(LED_GREEN, HIGH);
  else if (cmd == "GREEN_OFF") digitalWrite(LED_GREEN, LOW);
  else if (cmd == "BLUE_ON") digitalWrite(LED_BLUE, HIGH);
  else if (cmd == "BLUE_OFF") digitalWrite(LED_BLUE, LOW);
  else if (cmd == "ALL_ON") {
    digitalWrite(LED_RED, HIGH);
    digitalWrite(LED_GREEN, HIGH);
    digitalWrite(LED_BLUE, HIGH);
  } else if (cmd == "ALL_OFF") {
    digitalWrite(LED_RED, LOW);
    digitalWrite(LED_GREEN, LOW);
    digitalWrite(LED_BLUE, LOW);
  } else if (cmd.startsWith("DELETE:")) {
    String targetUID = cmd.substring(7);
    targetUID.trim();
    bool deleted = false;

    for (byte i = 0; i < MAX_CARDS; i++) {
      SavedCard card;
      if (!validCard(i, card)) continue;
      if (uidText(card.uid, card.uidSize) == targetUID) {
        // Invalida apenas o cartão selecionado na EEPROM.
        EEPROM.update(cardAddress(i), 0);
        deleted = true;
        break;
      }
    }

    if (deleted) {
      Serial.print("DELETE_OK:");
      Serial.println(targetUID);
      listCards();
    } else {
      Serial.println("DELETE_ERROR:NOT_FOUND");
    }
  } else if (cmd.startsWith("SAVE:")) {
    int separator = cmd.indexOf('|', 5);
    if (separator < 0 || !waitingForName) {
      Serial.println("SAVE_ERROR:INVALID");
      return;
    }

    String uid = cmd.substring(5, separator);
    String name = cmd.substring(separator + 1);
    uid.trim();
    name.trim();

    if (uid != uidText(pendingUID, pendingUIDSize) ||
        name.length() == 0 || name.length() >= NAME_SIZE ||
        name.indexOf('|') >= 0) {
      Serial.println("SAVE_ERROR:INVALID");
      return;
    }

    SavedCard existing;
    if (findCard(pendingUID, pendingUIDSize, existing) >= 0) {
      Serial.println("SAVE_ERROR:EXISTS");
      waitingForName = false;
      return;
    }

    int slot = freeSlot();
    if (slot < 0) {
      Serial.println("SAVE_ERROR:FULL");
      waitingForName = false;
      return;
    }

    SavedCard card = {};
    card.marker = 0;
    card.uidSize = pendingUIDSize;
    for (byte i = 0; i < pendingUIDSize; i++) card.uid[i] = pendingUID[i];
    name.toCharArray(card.name, NAME_SIZE);

    EEPROM.put(cardAddress(slot), card);
    EEPROM.update(cardAddress(slot), VALID_MARK);
    waitingForName = false;

    Serial.print("REGISTERED:");
    Serial.print(uid);
    Serial.print("|");
    Serial.println(name);
    listCards();
  }
}

void handleButton() {
  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonChange = millis();
    lastButtonReading = reading;
  }

  if (millis() - lastButtonChange >= DEBOUNCE_MS &&
      reading != stableButtonState) {
    stableButtonState = reading;

    // Ação somente ao pressionar o botão
    if (stableButtonState == LOW && !registerMode && !waitingForName) {
      registerMode = true;
      Serial.println("REGISTER_MODE");
      Serial.println("PROMPT:APPROACH_CARD");
      digitalWrite(LED_BLUE, HIGH);
    }
  }
}

void setup() {
  Serial.begin(9600);
  serialLine.reserve(100);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  pinMode(ACCESS_PIN, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(LED_RED, LOW);
  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_BLUE, LOW);
  digitalWrite(ACCESS_PIN, LOW);
  digitalWrite(BUZZER, LOW);

  SPI.begin();
  rfid.PCD_Init();

  Serial.println("RFID_READY");
  listCards();
}

void loop() {
  handleButton();

  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\n') {
      handleCommand(serialLine);
      serialLine = "";
    } else if (c != '\r' && serialLine.length() < 99) {
      serialLine += c;
    }
  }

  if (accessUntil && (long)(millis() - accessUntil) >= 0) {
    digitalWrite(ACCESS_PIN, LOW);
    digitalWrite(LED_GREEN, LOW);
    accessUntil = 0;
  }

  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

  byte size = rfid.uid.size;
  if (size == 0 || size > MAX_UID) {
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  byte uid[MAX_UID];
  for (byte i = 0; i < size; i++) uid[i] = rfid.uid.uidByte[i];
  String id = uidText(uid, size);

  Serial.print("CARD:");
  Serial.println(id);

  if (registerMode) {
    registerMode = false;
    digitalWrite(LED_BLUE, LOW);
    pendingUIDSize = size;
    for (byte i = 0; i < size; i++) pendingUID[i] = uid[i];

    SavedCard existing;
    if (findCard(uid, size, existing) >= 0) {
      waitingForName = false;
      Serial.print("ALREADY_REGISTERED:");
      Serial.print(id);
      Serial.print("|");
      Serial.println(existing.name);
    } else {
      waitingForName = true;
      Serial.print("ENROLL_UID:");
      Serial.println(id);
    }
  } else {
    SavedCard card;
    if (findCard(uid, size, card) >= 0) {
      Serial.print("ACCESS_GRANTED:");
      Serial.print(id);
      Serial.print("|");
      Serial.println(card.name);

      digitalWrite(LED_RED, LOW);
      digitalWrite(LED_GREEN, HIGH);
      digitalWrite(BUZZER, HIGH);
      delay(150);
      digitalWrite(BUZZER, LOW);

      digitalWrite(ACCESS_PIN, HIGH);
      accessUntil = millis() + ACCESS_MS;
    } else {
      Serial.print("ACCESS_DENIED:");
      Serial.println(id);

      digitalWrite(LED_GREEN, LOW);
      digitalWrite(ACCESS_PIN, LOW);
      accessUntil = 0;
      digitalWrite(LED_RED, HIGH);
      digitalWrite(BUZZER, HIGH);
      delay(1000);
      digitalWrite(BUZZER, LOW);
      digitalWrite(LED_RED, LOW);
    }
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
