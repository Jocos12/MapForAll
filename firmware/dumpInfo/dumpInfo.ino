/*
 * MapForAll — ESP32 + MFRC522 RFID attendance reader
 * --------------------------------------------------
 * One physical tap = one POST. The reader is halted after each UID so the
 * same card is not read again until it leaves the field. Wi-Fi and the HTTP
 * client stay up between scans.
 *
 * Self-healing: if the RC522 stops answering (loose wire, voltage drop),
 * the sketch detects it and re-initialises the reader automatically.
 *
 * Hardware: ESP32 + RC522 (SS=5, RST=22, SCK=18, MISO=19, MOSI=23).
 * Libraries: WiFi, HTTPClient, SPI, MFRC522
 * Keep your existing config.h next to this file.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
// Slow SPI clock = much more reliable with jumper wires (default is 4 MHz).
#define MFRC522_SPICLOCK 1000000u
#include <MFRC522.h>
#include "config.h"

#define PIN_SCK  18
#define PIN_MISO 19
#define PIN_MOSI 23

MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);
HTTPClient http;

String lastUid = "";
unsigned long lastScanMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastReaderCheckMs = 0;
unsigned long lastAliveMs = 0;

// ── Feedback (no-ops when the pin is -1) ─────────────────────────────────────

void setupFeedback() {
  if (LED_OK_PIN >= 0) {
    pinMode(LED_OK_PIN, OUTPUT);
    digitalWrite(LED_OK_PIN, LOW);
  }
  if (LED_ERR_PIN >= 0) {
    pinMode(LED_ERR_PIN, OUTPUT);
    digitalWrite(LED_ERR_PIN, LOW);
  }
  if (BUZZER_PIN >= 0) {
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void pulsePin(int pin, unsigned long ms) {
  if (pin < 0) return;
  digitalWrite(pin, HIGH);
  delay(ms);
  digitalWrite(pin, LOW);
}

void feedbackOk() {
  if (LED_OK_PIN < 0 && BUZZER_PIN < 0) return;
  pulsePin(LED_OK_PIN, 80);
  pulsePin(BUZZER_PIN, 50);
}

void feedbackErr() {
  if (LED_ERR_PIN < 0 && BUZZER_PIN < 0) return;
  for (uint8_t i = 0; i < 2; i++) {
    if (LED_ERR_PIN >= 0) digitalWrite(LED_ERR_PIN, HIGH);
    if (BUZZER_PIN >= 0) digitalWrite(BUZZER_PIN, HIGH);
    delay(70);
    if (LED_ERR_PIN >= 0) digitalWrite(LED_ERR_PIN, LOW);
    if (BUZZER_PIN >= 0) digitalWrite(BUZZER_PIN, LOW);
    if (i == 0) delay(50);
  }
}

void feedbackDup() {
  if (LED_OK_PIN < 0 && BUZZER_PIN < 0) return;
  pulsePin(BUZZER_PIN, 25);
  delay(35);
  pulsePin(BUZZER_PIN, 25);
  pulsePin(LED_OK_PIN, 40);
}

// ── WiFi ─────────────────────────────────────────────────────────────────────

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.print(F("[wifi] Connecting to "));
  Serial.print(WIFI_SSID);
  Serial.print(F(" ... "));

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < WIFI_TIMEOUT_MS) {
    delay(250);
    Serial.print('.');
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(F(" OK"));
    Serial.print(F("[wifi] IP "));
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println(F(" FAILED"));
  Serial.println(F("[wifi] Check SSID/password and that the ESP32 is on the same LAN as the MapForAll PC."));
  return false;
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const unsigned long now = millis();
  if (now - lastWifiAttemptMs < 15000UL) return;
  lastWifiAttemptMs = now;
  Serial.println(F("[wifi] Disconnected — reconnecting..."));
  connectWiFi();
}

// ── RFID reader (self-healing) ───────────────────────────────────────────────

// The RC522 version register reads 0x00 or 0xFF when the chip is not answering.
bool readerAlive() {
  const byte v = mfrc522.PCD_ReadRegister(MFRC522::VersionReg);
  return v != 0x00 && v != 0xFF;
}

bool initReader() {
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, RFID_SS_PIN);
  mfrc522.PCD_Init();
  mfrc522.PCD_SetAntennaGain(mfrc522.RxGain_max);
  return readerAlive();
}

void checkReader() {
  const unsigned long now = millis();
  if (now - lastReaderCheckMs < 2000UL) return;
  lastReaderCheckMs = now;
  if (!readerAlive()) {
    Serial.println(F("[rfid] reader lost - re-init"));
    if (initReader()) Serial.println(F("[rfid] reader recovered"));
  }
}

String readUid() {
  if (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    return "";
  }

  String uid;
  uid.reserve(mfrc522.uid.size * 2);
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) uid += '0';
    uid += String(mfrc522.uid.uidByte[i], HEX);
  }
  uid.toUpperCase();

  // Halt so the same card is not re-read until it leaves the antenna.
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  return uid;
}

// ── HTTP → MapForAll ─────────────────────────────────────────────────────────

String jsonString(const String& json, const char* key) {
  String pat = String('"') + key + '"';
  int i = json.indexOf(pat);
  if (i < 0) return "";
  i = json.indexOf(':', i + pat.length());
  if (i < 0) return "";
  i++;
  while (i < (int)json.length() && (json[i] == ' ' || json[i] == '\t')) i++;
  if (i >= (int)json.length() || json[i] != '"') return "";
  i++;
  String out;
  out.reserve(48);
  while (i < (int)json.length() && json[i] != '"') {
    if (json[i] == '\\' && i + 1 < (int)json.length()) i++;
    out += json[i];
    i++;
  }
  return out;
}

// One POST. Reuses the TCP connection (setReuse + keep-alive). Returns the HTTP
// status, or a negative code on timeout / disconnect. Body lands in `resp`.
int postJson(const String& uid, String& resp) {
  resp = "";
  if (WiFi.status() != WL_CONNECTED) return -1;

  http.setReuse(true);
  http.setConnectTimeout(1500);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(SERVER_URL)) return -1;

  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("Connection"), F("keep-alive"));
  http.addHeader(F("X-RFID-API-KEY"), RFID_API_KEY);

  const String body = String(F("{\"uid\":\"")) + uid + F("\",\"device_id\":\"") + DEVICE_ID + F("\"}");
  const int code = http.POST(body);
  if (code > 0) resp = http.getString();
  http.end();
  return code;
}

void printResult(int code, const String& uid, const String& resp) {
  const String type = jsonString(resp, "type");
  const String name = jsonString(resp, "name");
  const String time = jsonString(resp, "time");

  if (type == "in") {
    Serial.print(F("IN  "));
    Serial.print(name);
    Serial.print(' ');
    Serial.println(time);
    feedbackOk();
    return;
  }
  if (type == "out") {
    Serial.print(F("OUT "));
    Serial.print(name);
    Serial.print(' ');
    Serial.println(time);
    feedbackOk();
    return;
  }
  if (type == "duplicate") {
    Serial.print(F("DUPLICATE "));
    Serial.println(name);
    feedbackDup();
    return;
  }
  if (code == 404) {
    Serial.print(F("UNKNOWN "));
    Serial.println(uid);
    feedbackErr();
    return;
  }

  const String err = jsonString(resp, "error");
  Serial.print(F("FAIL "));
  if (err.length()) Serial.println(err);
  else Serial.println(code);
  feedbackErr();
}

void handleScan(const String& uid) {
  Serial.print(F("[rfid] UID "));
  Serial.println(uid);

  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  String resp;
  int code = postJson(uid, resp);
  // Transport failure only: one immediate retry, then stop. Never loop.
  if (code <= 0) code = postJson(uid, resp);

  if (code <= 0) {
    Serial.print(F("FAIL network ("));
    Serial.print(code);
    Serial.println(F(") - check SERVER_URL / PC IP / firewall"));
    feedbackErr();
    return;
  }
  printResult(code, uid, resp);
}

// ── Arduino lifecycle ────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println(F("=== MapForAll RFID attendance reader ==="));
  Serial.print(F("Device "));
  Serial.println(DEVICE_ID);
  Serial.print(F("POST  "));
  Serial.println(SERVER_URL);

  setupFeedback();

  bool ok = false;
  for (int i = 0; i < 5 && !ok; i++) {
    ok = initReader();
    if (!ok) {
      Serial.println(F("[rfid] reader not responding, retry..."));
      delay(300);
    }
  }
  mfrc522.PCD_DumpVersionToSerial();
  if (!ok) {
    Serial.println(F("[rfid] STILL NOT RESPONDING - check wiring: SDA=5 SCK=18 MOSI=23 MISO=19 RST=22 3V3 GND"));
    Serial.println(F("[rfid] Unplug the microSD module, power the RC522 from 3V3 only."));
  }

  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  connectWiFi();
  lastWifiAttemptMs = millis();

  Serial.println(F("Ready - present a card"));
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) ensureWiFi();
  checkReader();

  // Small heartbeat so you can see the sketch is running.
  if (millis() - lastAliveMs > 10000UL) {
    lastAliveMs = millis();
    Serial.println(F("[alive]"));
  }

  const String uid = readUid();
  if (uid.length() == 0) {
    delay(30);
    return;
  }

  const unsigned long now = millis();
  if (uid == lastUid && (now - lastScanMs) < (unsigned long)DEBOUNCE_MS) {
    delay(30);
    return;
  }
  lastUid = uid;
  lastScanMs = now;

  handleScan(uid);
}
