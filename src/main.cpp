#include <Arduino.h>
#include <WiFi.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Update.h>

// ======= Constants =======
#define RESET_PIN      0        // BOOT button — ค้าง 5 วิเพื่อ factory reset
#define RESET_HOLD_MS  5000
#define DNS_PORT       53
#define AP_IP          "192.168.4.1"

// ======= GPIO Definitions (ESP32 38-pin DevKit) =======
// GPIO 6–11 ต่อกับ Internal Flash — ห้ามใช้
// GPIO 34, 35, 36, 39 เป็น Input Only (ไม่รองรับ OUTPUT)
struct PinDef { const char* name; uint8_t gpio; bool analog; bool inputOnly; };
const PinDef PINS[] = {
    // Digital I/O
    {"GPIO2",  2,  false, false},  // LED_BUILTIN
    {"GPIO4",  4,  false, false},
    {"GPIO5",  5,  false, false},
    {"GPIO12", 12, false, false},
    {"GPIO13", 13, false, false},
    {"GPIO14", 14, false, false},
    {"GPIO15", 15, false, false},
    {"GPIO16", 16, false, false},
    {"GPIO17", 17, false, false},
    {"GPIO18", 18, false, false},
    {"GPIO19", 19, false, false},
    {"GPIO21", 21, false, false},
    {"GPIO22", 22, false, false},
    {"GPIO23", 23, false, false},
    // Digital only (ADC2 — ใช้ analogRead ไม่ได้ขณะ WiFi ทำงาน)
    {"GPIO25", 25, false, false},
    {"GPIO26", 26, false, false},
    {"GPIO27", 27, false, false},
    {"GPIO32", 32, true,  false},
    {"GPIO33", 33, true,  false},
    // Input Only (ADC)
    {"GPIO34", 34, true,  true},
    {"GPIO35", 35, true,  true},
    {"GPIO36", 36, true,  true},  // VP
    {"GPIO39", 39, true,  true},  // VN
};
const int PIN_COUNT = sizeof(PINS) / sizeof(PINS[0]);
uint8_t pinModes[PIN_COUNT];

// ======= App State =======
enum AppState { STATE_AP, STATE_CONNECTING, STATE_NORMAL };
AppState appState = STATE_AP;

// ======= Globals =======
DNSServer        dns;
Preferences      prefs;
AsyncWebServer   webServer(80);
WebSocketsClient tunnel;

struct Config {
    char ssid[64];
    char password[64];
    char relayHost[128];
    char deviceName[64];
    char deviceId[13];   // MAC hex ไม่มีเครื่องหมาย : เช่น "AABBCCDDEEFF"
    char pairingCode[7]; // 6 หลัก
} cfg;

unsigned long connectStart = 0;
bool          connectFailed = false;
bool          otaReboot     = false;   // flag: restart หลัง OTA สำเร็จ
String        wifiScanJson  = "[]";

// ======= Setup Page HTML (PROGMEM) =======
const char SETUP_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f7f7f7;color:#111;min-height:100vh}
header{background:#fff;padding:18px 24px;border-bottom:1px solid #e4e4e4;text-align:center}
.brand-mark{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1.5px solid #e4e4e4;border-radius:9px;font-size:1.1rem;margin-bottom:10px;background:#f7f7f7}
h1{font-size:1rem;font-weight:600}header p{color:#888;font-size:.78rem;margin-top:2px}
main{padding:20px;display:flex;flex-direction:column;gap:14px;max-width:440px;margin:0 auto}
.card{background:#fff;border:1px solid #e4e4e4;border-radius:10px;padding:18px}
h2{font-size:.8rem;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px}
.row{display:flex;justify-content:space-between;align-items:center;padding:5px 0}
.lbl{font-size:.7rem;color:#888;text-transform:uppercase;letter-spacing:.04em}
.val{font-size:.85rem;font-weight:600;font-family:monospace;color:#111}
.pcode-box{border:1px solid #e4e4e4;border-radius:7px;padding:12px;text-align:center;margin-top:10px}
.pcode-lbl{font-size:.62rem;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.pcode{font-size:1.9rem;font-weight:700;color:#2563eb;letter-spacing:.3em;font-family:monospace}
.pcode-hint{font-size:.68rem;color:#888;margin-top:6px;line-height:1.5}
label{display:block;font-size:.72rem;font-weight:500;color:#111;margin:12px 0 4px}
input,select{width:100%;background:#f7f7f7;border:1px solid #e4e4e4;color:#111;padding:9px 11px;border-radius:7px;font-size:.875rem;outline:none}
input:focus,select:focus{border-color:#111;background:#fff}
.btn{width:100%;background:#111;color:#fff;border:none;padding:11px;border-radius:7px;font-size:.875rem;cursor:pointer;margin-top:4px;font-weight:600}
.btn:hover{opacity:.85}
.btn-sm{background:none;border:1px solid #e4e4e4;color:#888;padding:6px 12px;border-radius:6px;font-size:.75rem;cursor:pointer;margin-top:8px}
.btn-sm:hover{border-color:#aaa;color:#111}
.msg{padding:9px 12px;border-radius:7px;font-size:.78rem;text-align:center;display:none;margin-top:4px}
.err{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;display:block}
.ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;display:block}
.inf{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;display:block}
footer{text-align:center;padding:16px;color:#ccc;font-size:.7rem}
</style></head>
<body>
<header>
  <div class="brand-mark">&#x26A1;</div>
  <h1>ESP32 Setup</h1>
  <p>ตั้งค่าครั้งแรก — AP Mode</p>
</header>
<main>
  <div class="card">
    <h2>ข้อมูลอุปกรณ์</h2>
    <div class="row"><span class="lbl">Device ID</span><span class="val" id="did">-</span></div>
    <div class="pcode-box">
      <div class="pcode-lbl">Pairing Code</div>
      <div class="pcode" id="pcode">------</div>
      <div class="pcode-hint">ใช้รหัสนี้บน Relay Dashboard<br>เพื่อผูกอุปกรณ์กับบัญชี</div>
    </div>
  </div>
  <div class="card">
    <h2>WiFi</h2>
    <label>เครือข่าย WiFi</label>
    <select id="ssid-sel" onchange="onSel()"><option value="">-- กำลังสแกน... --</option></select>
    <label>SSID (พิมพ์เองถ้าไม่อยู่ในรายการ)</label>
    <input type="text" id="ssid" placeholder="ชื่อ WiFi" />
    <label>รหัสผ่าน</label>
    <input type="password" id="pass" placeholder="WiFi Password" />
    <button class="btn-sm" onclick="rescan()">&#x21BA; สแกนใหม่</button>
  </div>
  <div class="card">
    <h2>Server</h2>
    <label>Relay Host</label>
    <input type="text" id="relay" placeholder="your-relay.railway.app" style="font-family:monospace;font-size:.82rem" />
    <label>ชื่ออุปกรณ์</label>
    <input type="text" id="devname" placeholder="เช่น ESP32 ห้องนอน" maxlength="63" />
  </div>
  <div id="msg" class="msg"></div>
  <button class="btn" onclick="save()">บันทึกและเชื่อมต่อ</button>
</main>
<footer>Arduino Nano ESP32 &#8212; WiFi Provisioning</footer>
<script>
function showMsg(t,c){var e=document.getElementById('msg');e.textContent=t;e.className='msg '+(c||'');}
function onSel(){var v=document.getElementById('ssid-sel').value;if(v)document.getElementById('ssid').value=v;}
function loadScan(nets){
  var s=document.getElementById('ssid-sel');
  s.innerHTML='<option value="">-- เลือกจากรายการ --</option>';
  nets.forEach(function(n){var o=document.createElement('option');o.value=n.ssid;
    o.textContent=n.ssid+' ('+n.rssi+'dBm'+(n.secure?' [lock]':'')+')';s.appendChild(o);});
}
function rescan(){
  showMsg('กำลังสแกน WiFi...','inf');
  fetch('/scan?fresh=1').then(function(r){return r.json();}).then(function(d){loadScan(d);showMsg('');});
}
function save(){
  var ssid=(document.getElementById('ssid').value.trim()||document.getElementById('ssid-sel').value).trim();
  var pass=document.getElementById('pass').value;
  var relay=document.getElementById('relay').value.trim();
  var name=document.getElementById('devname').value.trim()||'ESP32 Device';
  if(!ssid){showMsg('กรุณาเลือกหรือใส่ชื่อ WiFi','err');return;}
  if(!relay){showMsg('กรุณาใส่ Relay Host','err');return;}
  showMsg('กำลังส่งข้อมูล...','inf');
  fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ssid:ssid,pass:pass,relay:relay,name:name})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.ok){showMsg('กำลังเชื่อมต่อ WiFi โปรดรอสักครู่...','inf');poll();}
    else showMsg(d.error||'เกิดข้อผิดพลาด','err');
  }).catch(function(){showMsg('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง','err');});
}
function poll(){
  var iv=setInterval(function(){
    fetch('/status').then(function(r){return r.json();}).then(function(d){
      if(d.connected){clearInterval(iv);showMsg('เชื่อมต่อสำเร็จ! IP: '+d.ip+' — กำลัง restart...','ok');}
      else if(d.failed){clearInterval(iv);showMsg('เชื่อมต่อไม่ได้ ตรวจสอบ SSID/Password แล้วลองใหม่','err');}
    });
  },1500);
}
fetch('/info').then(function(r){return r.json();}).then(function(d){
  document.getElementById('did').textContent=d.deviceId;
  document.getElementById('pcode').textContent=d.pairingCode;
  if(d.relayHost)document.getElementById('relay').value=d.relayHost;
  if(d.deviceName)document.getElementById('devname').value=d.deviceName;
});
fetch('/scan').then(function(r){return r.json();}).then(loadScan);
</script>
</body></html>
)rawliteral";

// ======= Device Identity =======
void initIdentity() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(cfg.deviceId, sizeof(cfg.deviceId), "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    prefs.begin("cfg", false);
    if (!prefs.isKey("pair")) {
        snprintf(cfg.pairingCode, sizeof(cfg.pairingCode), "%06lu",
                 (unsigned long)(esp_random() % 1000000UL));
        prefs.putString("pair", cfg.pairingCode);
    } else {
        prefs.getString("pair", cfg.pairingCode, sizeof(cfg.pairingCode));
    }
    prefs.end();
}

// ======= Preferences =======
bool loadConfig() {
    prefs.begin("cfg", true);
    bool ok = prefs.isKey("ssid");
    if (ok) {
        prefs.getString("ssid",  cfg.ssid,       sizeof(cfg.ssid));
        prefs.getString("pass",  cfg.password,   sizeof(cfg.password));
        prefs.getString("relay", cfg.relayHost,  sizeof(cfg.relayHost));
        prefs.getString("name",  cfg.deviceName, sizeof(cfg.deviceName));
    }
    prefs.end();
    return ok && strlen(cfg.ssid) > 0;
}

void saveConfig() {
    prefs.begin("cfg", false);
    prefs.putString("ssid",  cfg.ssid);
    prefs.putString("pass",  cfg.password);
    prefs.putString("relay", cfg.relayHost);
    prefs.putString("name",  cfg.deviceName);
    prefs.end();
}

void clearConfig() {
    prefs.begin("cfg", false);
    prefs.clear();
    prefs.end();
    Serial.println("[Reset] Factory reset! Restarting...");
    delay(300);
    ESP.restart();
}

// ตั้ง flag ให้ boot เข้า AP mode ครั้งถัดไป (ไม่ล้าง config)
void requestAPMode() {
    prefs.begin("cfg", false);
    prefs.putBool("apMode", true);
    prefs.end();
    Serial.println("[Button] Short press → เข้า AP mode (config ยังอยู่)");
    delay(200);
    ESP.restart();
}

// ตรวจและล้าง flag
bool popForceAP() {
    prefs.begin("cfg", false);
    bool force = prefs.getBool("apMode", false);
    if (force) prefs.putBool("apMode", false);
    prefs.end();
    return force;
}

// ======= WiFi Scan =======
void doWiFiScan() {
    int n = WiFi.scanNetworks();
    String j = "[";
    for (int i = 0; i < n; i++) {
        if (i) j += ",";
        j += "{\"ssid\":\"" + WiFi.SSID(i) + "\","
             "\"rssi\":"    + String(WiFi.RSSI(i)) + ","
             "\"secure\":"  + (WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? "true" : "false") + "}";
    }
    wifiScanJson = j + "]";
    WiFi.scanDelete();
}

// ======= Content Type =======
String getContentType(const String& path) {
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".css"))  return "text/css";
    if (path.endsWith(".js"))   return "application/javascript";
    if (path.endsWith(".json")) return "application/json";
    return "text/plain";
}

// ======= GPIO =======
int findPin(const String& name) {
    for (int i = 0; i < PIN_COUNT; i++) if (name == PINS[i].name) return i;
    return -1;
}

void applyGpioSet(const String& pinName, int mode, int value) {
    int idx = findPin(pinName);
    if (idx < 0) return;
    // Input Only pins ไม่รองรับ OUTPUT และ INPUT_PULLUP
    if (PINS[idx].inputOnly && mode != 0) return;
    pinModes[idx] = mode;
    uint8_t m = mode == 0 ? INPUT : mode == 1 ? OUTPUT : INPUT_PULLUP;
    pinMode(PINS[idx].gpio, m);
    if (mode == 1) digitalWrite(PINS[idx].gpio, value ? HIGH : LOW);
}

String buildGpioJson() {
    String j = "{\"pins\":[";
    for (int i = 0; i < PIN_COUNT; i++) {
        int val = (PINS[i].analog && pinModes[i] != 1)
                  ? analogRead(PINS[i].gpio) : digitalRead(PINS[i].gpio);
        if (i) j += ",";
        j += "{\"name\":\"" + String(PINS[i].name) + "\","
             "\"gpio\":"      + String(PINS[i].gpio)  + ","
             "\"analog\":"    + (PINS[i].analog     ? "true" : "false") + ","
             "\"inputOnly\":" + (PINS[i].inputOnly  ? "true" : "false") + ","
             "\"mode\":"      + String(pinModes[i])   + ","
             "\"value\":"     + String(val)            + "}";
    }
    return j + "]}";
}

// ======= Tunnel =======
void tunnelRespond(const String& id, int status, const String& ct, const String& body) {
    StaticJsonDocument<256> meta;
    meta["type"] = "response"; meta["id"] = id;
    meta["status"] = status; meta["contentType"] = ct; meta["size"] = body.length();
    String m; serializeJson(meta, m);
    tunnel.sendTXT(m + "\n" + body);
}

void handleTunnelRequest(const String& id, const String& method, String path, const String& body) {
    if (path == "/api/status") {
        String r = "{\"status\":\"ok\","
                   "\"ip\":\"" + WiFi.localIP().toString() + "\","
                   "\"rssi\":"  + String(WiFi.RSSI()) + ","
                   "\"uptime\":" + String(millis() / 1000) + ","
                   "\"name\":\"" + String(cfg.deviceName) + "\","
                   "\"deviceId\":\"" + String(cfg.deviceId) + "\"}";
        tunnelRespond(id, 200, "application/json", r);
        return;
    }
    if (path == "/api/gpio" && method == "GET") {
        tunnelRespond(id, 200, "application/json", buildGpioJson());
        return;
    }
    if (path == "/api/gpio/set" && method == "POST") {
        StaticJsonDocument<128> req;
        if (!deserializeJson(req, body))
            applyGpioSet(req["pin"].as<String>(), req["mode"].as<int>(), req["value"].as<int>());
        tunnelRespond(id, 200, "application/json", "{\"ok\":true}");
        return;
    }
    if (path == "/" || path == "") path = "/index.html";
    if (LittleFS.exists(path)) {
        File f = LittleFS.open(path, "r");
        String data = f.readString(); f.close();
        tunnelRespond(id, 200, getContentType(path), data);
    } else {
        String err = "<h1>404</h1>";
        if (LittleFS.exists("/404.html")) { File f = LittleFS.open("/404.html","r"); err = f.readString(); f.close(); }
        tunnelRespond(id, 404, "text/html; charset=utf-8", err);
    }
}

void onTunnelEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED:
            Serial.println("[Tunnel] เชื่อมต่อกับ Relay สำเร็จ!");
            // ส่ง deviceId ไปด้วยเพื่อ multi-device routing (Phase 2)
            tunnel.sendTXT("{\"type\":\"hello\","
                           "\"deviceId\":\""    + String(cfg.deviceId)    + "\","
                           "\"pairingCode\":\"" + String(cfg.pairingCode) + "\","
                           "\"name\":\""        + String(cfg.deviceName)  + "\"}");
            break;
        case WStype_DISCONNECTED:
            Serial.println("[Tunnel] หลุดการเชื่อมต่อ กำลังต่อใหม่...");
            break;
        case WStype_TEXT: {
            String raw = String((char*)payload, length);
            int nl = raw.indexOf('\n');
            String jsonPart = (nl >= 0) ? raw.substring(0, nl) : raw;
            StaticJsonDocument<512> doc;
            if (deserializeJson(doc, jsonPart)) return;
            if (doc["type"] == "request") {
                Serial.printf("[Tunnel] %s %s\n",
                    doc["method"].as<const char*>(), doc["path"].as<const char*>());
                handleTunnelRequest(doc["id"], doc["method"], doc["path"], doc["body"] | "");
            }
            break;
        }
        default: break;
    }
}

// ======= AP Mode =======
void startAPMode() {
    appState = STATE_AP;
    WiFi.mode(WIFI_AP_STA);

    // Scan ก่อน start AP
    Serial.println("[AP] Scanning WiFi networks...");
    doWiFiScan();

    // AP SSID = "ESP32-XXYY" (4 ตัวท้ายของ MAC)
    String apSSID = String("ESP32-") + String(cfg.deviceId + 8);
    WiFi.softAP(apSSID.c_str());
    delay(500);

    dns.start(DNS_PORT, "*", WiFi.softAPIP());
    Serial.printf("[AP] SSID: %s  IP: %s\n", apSSID.c_str(), WiFi.softAPIP().toString().c_str());

    // ---- Routes ----
    webServer.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send_P(200, "text/html", SETUP_HTML);
    });

    webServer.on("/info", HTTP_GET, [](AsyncWebServerRequest* req) {
        String j = "{\"deviceId\":\""    + String(cfg.deviceId)    + "\","
                   "\"pairingCode\":\"" + String(cfg.pairingCode)  + "\","
                   "\"relayHost\":\""   + String(cfg.relayHost)    + "\","
                   "\"deviceName\":\"" + String(cfg.deviceName)   + "\"}";
        req->send(200, "application/json", j);
    });

    webServer.on("/scan", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (req->hasParam("fresh")) doWiFiScan();
        req->send(200, "application/json", wifiScanJson);
    });

    webServer.on("/save", HTTP_POST,
        [](AsyncWebServerRequest* req) {},
        NULL,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t, size_t) {
            StaticJsonDocument<256> doc;
            if (deserializeJson(doc, data, len)) {
                req->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
                return;
            }
            strlcpy(cfg.ssid,       doc["ssid"]  | "",             sizeof(cfg.ssid));
            strlcpy(cfg.password,   doc["pass"]  | "",             sizeof(cfg.password));
            strlcpy(cfg.relayHost,  doc["relay"] | "",             sizeof(cfg.relayHost));
            strlcpy(cfg.deviceName, doc["name"]  | "ESP32 Device", sizeof(cfg.deviceName));

            WiFi.begin(cfg.ssid, cfg.password);
            connectStart  = millis();
            connectFailed = false;
            appState      = STATE_CONNECTING;

            req->send(200, "application/json", "{\"ok\":true}");
        }
    );

    webServer.on("/status", HTTP_GET, [](AsyncWebServerRequest* req) {
        String j;
        if (connectFailed) {
            j = "{\"connecting\":false,\"connected\":false,\"failed\":true}";
        } else if (appState == STATE_CONNECTING) {
            j = "{\"connecting\":true,\"connected\":false,\"failed\":false}";
        } else if (WiFi.status() == WL_CONNECTED) {
            j = "{\"connecting\":false,\"connected\":true,\"failed\":false,"
                "\"ip\":\"" + WiFi.localIP().toString() + "\"}";
        } else {
            j = "{\"connecting\":false,\"connected\":false,\"failed\":false}";
        }
        req->send(200, "application/json", j);
    });

    // Captive portal: redirect ทุก path ที่ไม่รู้จักไปหน้า setup
    webServer.onNotFound([](AsyncWebServerRequest* req) {
        req->redirect("http://" AP_IP "/");
    });

    webServer.begin();
    Serial.println("[AP] Web server ready");
}

// ======= Normal Mode =======
void connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(cfg.ssid, cfg.password);
    Serial.print("[WiFi] กำลังเชื่อมต่อ");
    unsigned long t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
        delay(500); Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] เชื่อมต่อแล้ว! IP: http://" + WiFi.localIP().toString());
    } else {
        Serial.println("\n[WiFi] เชื่อมต่อไม่ได้ ตรวจสอบ SSID/Password");
    }
}

void setupNormalServer() {
    webServer.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

    webServer.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* req) {
        String j = "{\"status\":\"ok\","
                   "\"ip\":\""      + WiFi.localIP().toString() + "\","
                   "\"rssi\":"      + String(WiFi.RSSI())       + ","
                   "\"uptime\":"    + String(millis() / 1000)   + ","
                   "\"name\":\""    + String(cfg.deviceName)    + "\","
                   "\"deviceId\":\"" + String(cfg.deviceId)     + "\"}";
        req->send(200, "application/json", j);
    });

    webServer.on("/api/gpio", HTTP_GET, [](AsyncWebServerRequest* req) {
        req->send(200, "application/json", buildGpioJson());
    });

    webServer.on("/api/gpio/set", HTTP_POST,
        [](AsyncWebServerRequest* req) {},
        NULL,
        [](AsyncWebServerRequest* req, uint8_t* data, size_t len, size_t, size_t) {
            StaticJsonDocument<128> doc;
            if (!deserializeJson(doc, data, len))
                applyGpioSet(doc["pin"].as<String>(), doc["mode"].as<int>(), doc["value"].as<int>());
            req->send(200, "application/json", "{\"ok\":true}");
        }
    );

    // ======= OTA Update (local LAN only) =======
    webServer.on("/ota", HTTP_POST,
        // onRequest: ส่ง response แล้ว reboot ถ้า success
        [](AsyncWebServerRequest* req) {
            bool ok = !Update.hasError();
            AsyncWebServerResponse* res = req->beginResponse(
                200, "text/plain", ok ? "OK" : Update.errorString());
            res->addHeader("Connection", "close");
            req->send(res);
            if (ok) otaReboot = true;
        },
        // onUpload: รับไฟล์ทีละ chunk
        [](AsyncWebServerRequest* req, const String& filename,
           size_t index, uint8_t* data, size_t len, bool final) {
            if (!index) {
                bool isFS = req->hasParam("type") &&
                            req->getParam("type")->value() == "fs";
                int cmd = isFS ? U_SPIFFS : U_FLASH;
                Serial.printf("[OTA] Start: %s (%s)\n",
                    filename.c_str(), isFS ? "filesystem" : "firmware");
                if (!Update.begin(UPDATE_SIZE_UNKNOWN, cmd))
                    Serial.println("[OTA] Begin failed: " + String(Update.errorString()));
            }
            if (Update.isRunning()) Update.write(data, len);
            if (final) {
                if (Update.end(true))
                    Serial.printf("[OTA] Done: %u bytes\n", index + len);
                else
                    Serial.println("[OTA] Failed: " + String(Update.errorString()));
            }
        }
    );

    webServer.onNotFound([](AsyncWebServerRequest* req) {
        if (LittleFS.exists("/404.html")) req->send(LittleFS, "/404.html", "text/html");
        else req->send(404, "text/plain", "Not Found");
    });

    webServer.begin();
    Serial.println("[Local] Web server started on port 80");
}

// ======= Setup =======
void setup() {
    Serial.begin(115200);
    delay(500);

    pinMode(RESET_PIN, INPUT_PULLUP);
    memset(pinModes, 0, sizeof(pinModes));
    for (int i = 0; i < PIN_COUNT; i++) pinMode(PINS[i].gpio, INPUT);

    if (!LittleFS.begin(true)) Serial.println("[FS] LittleFS mount failed!");
    else                       Serial.println("[FS] LittleFS ready");

    // Device ID และ Pairing Code ต้องมีก่อนเสมอ (ก่อน WiFi.begin)
    WiFi.mode(WIFI_STA);
    WiFi.begin(); // เพื่อให้ macAddress พร้อม
    delay(100);
    initIdentity();

    bool forceAP = popForceAP(); // short press → boot เข้า AP mode
    if (forceAP || !loadConfig()) {
        startAPMode(); // forceAP: config ยังอยู่ / ไม่มี config: setup ใหม่
    } else {
        // มี config → Normal mode (retry WiFi อัตโนมัติถ้ายังไม่ได้)
        connectWiFi();
        setupNormalServer();
        tunnel.beginSSL(cfg.relayHost, 443, "/tunnel"); // production: WSS port 443
        tunnel.onEvent(onTunnelEvent);
        tunnel.setReconnectInterval(5000);
        appState = STATE_NORMAL;
        Serial.println("[Tunnel] กำลังเชื่อมต่อ Relay...");
    }
}

// ======= Loop =======
void loop() {
    // BOOT button timing:
    //   2–4 วิ (short press) → AP mode โดยไม่ล้าง config
    //   5+ วิ (long press)   → Factory reset (ล้างทุกอย่าง)
    static unsigned long btnPress = 0;
    if (digitalRead(RESET_PIN) == LOW) {
        if (!btnPress) btnPress = millis();
        if (millis() - btnPress >= RESET_HOLD_MS) clearConfig(); // long press
    } else {
        if (btnPress) {
            unsigned long held = millis() - btnPress;
            if (held >= 2000) requestAPMode(); // short press
        }
        btnPress = 0;
    }

    switch (appState) {
        case STATE_AP:
            dns.processNextRequest();
            break;

        case STATE_CONNECTING:
            dns.processNextRequest();
            if (WiFi.status() == WL_CONNECTED) {
                Serial.println("[Connect] สำเร็จ! IP: " + WiFi.localIP().toString());
                saveConfig();
                delay(2000); // รอให้ browser เห็น /status → connected ก่อน restart
                ESP.restart();
            }
            if (millis() - connectStart > 15000) {
                Serial.println("[Connect] Timeout — กลับ AP mode");
                connectFailed = true;
                appState = STATE_AP;
                WiFi.disconnect();
            }
            break;

        case STATE_NORMAL:
            tunnel.loop();
            if (otaReboot) { delay(300); ESP.restart(); }
            static unsigned long lastWifiCheck = 0;
            static int wifiRetryCount = 0;
            if (millis() - lastWifiCheck > 10000) {
                lastWifiCheck = millis();
                if (WiFi.status() != WL_CONNECTED) {
                    wifiRetryCount++;
                    Serial.printf("[WiFi] หลุด กำลังต่อใหม่... (%d)\n", wifiRetryCount);
                    WiFi.disconnect();
                    delay(100);
                    WiFi.begin(cfg.ssid, cfg.password);
                } else {
                    wifiRetryCount = 0;
                }
            }
            break;
    }
}
