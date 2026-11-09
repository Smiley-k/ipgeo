/**
 * MeshCentral IP Geo plugin
 * Shows ISP/provider and country next to public IP addresses in the web UI.
 *
 * @author Kirill A
 * @license MIT
 * @version 1.3.3
 */

"use strict";

module.exports.ipgeo = function (parent) {
    var obj = {};
    obj.parent = parent;

    // Functions that are copied into the browser by MeshCentral's plugin handler.
    // They must be self-contained: only browser globals (Q, currentNode, meshserver,
    // pluginHandler, isPrivateIP...) are available inside them.
    obj.exports = ["onWebUIStartupEnd", "onDeviceRefreshEnd", "onLookupResult", "onLookupBatchResult", "webDecorate", "webDecorateLink", "webLookup", "webLookupBatch", "webFlagUrl", "webShowTip", "webHideTip", "webSaveCache"];

    var fs = require("fs");
    var path = require("path");
    var http = require("http");
    var https = require("https");

    obj.settings = {
        provider: "auto",          // auto | ip-api | ipwho | ipinfo
        cacheHours: 168,           // 7 days
        requestTimeoutMs: 5000,
        minIntervalMs: 1400,       // ~43 requests/minute for ip-api.com free tier
        batchIntervalMs: 4200,     // 15 batch requests/minute for ip-api.com
        batchSize: 100,            // max IPs per ip-api batch request
        batchMax: 200,             // max IPs accepted from one browser request
        batchTimeoutMs: 15000,
        debug: false
    };

    // Optional settings.json next to this file.
    try {
        var rawSettings = fs.readFileSync(path.join(__dirname, "settings.json"), "utf8");
        var userSettings = JSON.parse(rawSettings);
        for (var sk in userSettings) {
            if (Object.prototype.hasOwnProperty.call(userSettings, sk)) { obj.settings[sk] = userSettings[sk]; }
        }
    } catch (e) { /* no settings.json, use defaults */ }

    // Sanitize settings
    if (["auto", "ip-api", "ipwho", "ipinfo"].indexOf(obj.settings.provider) < 0) { obj.settings.provider = "auto"; }
    obj.settings.cacheHours = Math.max(1, Math.min(24 * 90, Number(obj.settings.cacheHours) || 168));
    obj.settings.requestTimeoutMs = Math.max(1000, Math.min(30000, Number(obj.settings.requestTimeoutMs) || 5000));
    obj.settings.minIntervalMs = Math.max(0, Math.min(60000, Number(obj.settings.minIntervalMs)));
    var batchInterval = Number(obj.settings.batchIntervalMs);
    obj.settings.batchIntervalMs = isNaN(batchInterval) ? 4200 : Math.max(0, Math.min(60000, batchInterval));
    var batchSize = Number(obj.settings.batchSize);
    obj.settings.batchSize = isNaN(batchSize) ? 100 : Math.max(1, Math.min(100, batchSize));
    var batchMax = Number(obj.settings.batchMax);
    obj.settings.batchMax = isNaN(batchMax) ? 200 : Math.max(1, Math.min(500, batchMax));
    var batchTimeout = Number(obj.settings.batchTimeoutMs);
    obj.settings.batchTimeoutMs = isNaN(batchTimeout) ? 15000 : Math.max(5000, Math.min(60000, batchTimeout));
    if (typeof obj.settings.debug !== "boolean") { obj.settings.debug = false; }

    obj.log = function () {
        if (!obj.settings.debug) { return; }
        var args = Array.prototype.slice.call(arguments);
        args.unshift("[ipgeo]");
        console.log.apply(console, args);
    };

    // ---------------------------------------------------------------- IP helpers

    obj.normalizeIP = function (value) {
        if (value == null) { return null; }
        var ip = String(value).trim();
        if (ip === "") { return null; }
        if (ip.charAt(0) === "[") { // [IPv6]:port
            var close = ip.indexOf("]");
            if (close > 1) { return ip.substring(1, close); }
        }
        var colons = ip.split(":").length - 1;
        if (colons === 1 && ip.indexOf(".") > 0) { return ip.substring(0, ip.indexOf(":")); } // IPv4:port
        // Bare IPv6 is returned as-is. IPv6:port is cleaned by the caller, because
        // a bare IPv6 address can legitimately end with a numeric segment.
        return ip;
    };

    obj.isValidIP = function (value) {
        var ip = obj.normalizeIP(value);
        if (ip == null || ip.length > 45) { return false; }
        if (ip.indexOf(":") >= 0) {
            return /^[0-9a-fA-F:.]+$/.test(ip) && ip.split(":").length >= 3;
        }
        var p = ip.split(".");
        if (p.length !== 4) { return false; }
        for (var i = 0; i < 4; i++) { if (!/^\d{1,3}$/.test(p[i]) || Number(p[i]) > 255) { return false; } }
        return true;
    };

    obj.isPrivateIP = function (value) {
        var ip = obj.normalizeIP(value);
        if (ip == null) { return true; }
        if (ip.indexOf(":") >= 0) {
            var low = ip.toLowerCase();
            if (low === "::" || low === "::1") { return true; }
            if (/^f[cd][0-9a-f]{2}:/.test(low)) { return true; }   // fc00::/7 unique local
            if (/^fe[89ab][0-9a-f]:/.test(low)) { return true; }   // fe80::/10 link local
            if (low.indexOf("::ffff:") === 0) { return obj.isPrivateIP(low.substring(7)); }
            return false;
        }
        var p = ip.split(".");
        if (p.length !== 4) { return true; }
        for (var i = 0; i < 4; i++) { if (!/^\d{1,3}$/.test(p[i]) || Number(p[i]) > 255) { return true; } }
        var a = Number(p[0]), b = Number(p[1]);
        if (a === 0 || a === 10 || a === 127) { return true; }
        if (a === 169 && b === 254) { return true; }
        if (a === 192 && b === 168) { return true; }
        if (a === 172 && b >= 16 && b <= 31) { return true; }
        if (a === 100 && b >= 64 && b <= 127) { return true; }     // CGNAT 100.64.0.0/10
        if (a >= 224) { return true; }                              // multicast + reserved
        return false;
    };

    // ---------------------------------------------------------------- HTTP client

    function getJSON(url, timeoutMs, callback) {
        var mod = (url.indexOf("https:") === 0) ? https : http;
        var done = false;
        function finish(err, data) {
            if (done) { return; }
            done = true;
            callback(err, data);
        }
        var req;
        try {
            req = mod.get(url, {
                headers: {
                    "User-Agent": "ipgeo/1.3.3",
                    "Accept": "application/json"
                }
            }, function (res) {
                var body = "";
                if (res.statusCode !== 200) {
                    res.resume();
                    return finish(new Error("HTTP " + res.statusCode));
                }
                res.setEncoding("utf8");
                res.on("data", function (chunk) {
                    body += chunk;
                    if (body.length > 200000) { req.destroy(new Error("response too large")); }
                });
                res.on("end", function () {
                    try { finish(null, JSON.parse(body)); } catch (e) { finish(e); }
                });
                res.on("error", finish);
            });
        } catch (e) { return finish(e); }
        req.setTimeout(timeoutMs, function () { req.destroy(new Error("timeout")); });
        req.on("error", finish);
    }

    function postJSON(url, body, timeoutMs, callback) {
        var mod = (url.indexOf("https:") === 0) ? https : http;
        var done = false;
        function finish(err, data) {
            if (done) { return; }
            done = true;
            callback(err, data);
        }
        var req;
        try {
            var parsed = new URL(url);
            req = mod.request({
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || undefined,
                path: parsed.pathname + parsed.search,
                method: "POST",
                headers: {
                    "User-Agent": "ipgeo/1.3.3",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(body)
                }
            }, function (res) {
                var data = "";
                if (res.statusCode !== 200) {
                    res.resume();
                    return finish(new Error("HTTP " + res.statusCode));
                }
                res.setEncoding("utf8");
                res.on("data", function (chunk) {
                    data += chunk;
                    if (data.length > 500000) { req.destroy(new Error("response too large")); }
                });
                res.on("end", function () {
                    try { finish(null, JSON.parse(data)); } catch (e) { finish(e); }
                });
                res.on("error", finish);
            });
        } catch (e) { return finish(e); }
        req.setTimeout(timeoutMs, function () { req.destroy(new Error("timeout")); });
        req.on("error", finish);
        req.write(body);
        req.end();
    }

    // ---------------------------------------------------------------- Providers

    obj.queryProvider = function (provider, ip, callback) {
        var encoded = encodeURIComponent(ip);
        if (provider === "ip-api") {
            var u = "http://ip-api.com/json/" + encoded + "?fields=status,message,country,countryCode,isp,org,as,query";
            return getJSON(u, obj.settings.requestTimeoutMs, function (err, j) {
                if (err) { return callback(err); }
                if (!j || j.status !== "success") { return callback(new Error((j && j.message) || "ip-api lookup failed")); }
                callback(null, {
                    ip: ip,
                    country: j.country || "",
                    countryCode: j.countryCode || "",
                    isp: j.isp || j.org || "",
                    org: j.org || "",
                    asn: j.as || "",
                    source: "ip-api.com"
                });
            });
        }
        if (provider === "ipwho") {
            var u2 = "https://ipwho.is/" + encoded;
            return getJSON(u2, obj.settings.requestTimeoutMs, function (err, j) {
                if (err) { return callback(err); }
                if (!j || j.success !== true) { return callback(new Error((j && j.message) || "ipwho.is lookup failed")); }
                var conn = j.connection || {};
                callback(null, {
                    ip: ip,
                    country: j.country || "",
                    countryCode: j.country_code || "",
                    isp: conn.isp || conn.org || "",
                    org: conn.org || "",
                    asn: conn.asn ? ("AS" + conn.asn) : "",
                    source: "ipwho.is"
                });
            });
        }
        if (provider === "ipinfo") {
            var u3 = "https://ipinfo.io/" + encoded + "/json";
            return getJSON(u3, obj.settings.requestTimeoutMs, function (err, j) {
                if (err) { return callback(err); }
                if (!j || j.error || j.bogon) { return callback(new Error((j && j.error) || "ipinfo lookup failed")); }
                var org = j.org || "";
                var asn = "";
                var am = org.match(/^(AS\d+)\s+(.*)$/);
                if (am) { asn = am[1]; org = am[2]; }
                callback(null, {
                    ip: ip,
                    country: j.country || "",
                    countryCode: j.country || "",
                    isp: org,
                    org: org,
                    asn: asn,
                    source: "ipinfo.io"
                });
            });
        }
        callback(new Error("unknown provider: " + provider));
    };

    obj.queryBatch = function (ips, callback) {
        if (!ips || ips.length === 0) { return callback(null, {}); }
        var body = JSON.stringify(ips);
        var url = "http://ip-api.com/batch?fields=status,message,country,countryCode,isp,org,as,query";
        postJSON(url, body, obj.settings.batchTimeoutMs, function (err, arr) {
            if (err) { return callback(err); }
            if (!Array.isArray(arr)) { return callback(new Error("invalid batch response")); }
            var map = {};
            for (var i = 0; i < arr.length; i++) {
                var j = arr[i] || {};
                var ip = obj.normalizeIP(j.query);
                if (ip == null) { continue; }
                if (j.status === "success") {
                    map[ip] = {
                        ip: ip,
                        country: j.country || "",
                        countryCode: j.countryCode || "",
                        isp: j.isp || j.org || "",
                        org: j.org || "",
                        asn: j.as || "",
                        source: "ip-api.com"
                    };
                } else {
                    map[ip] = { error: j.message || "lookup failed" };
                }
            }
            callback(null, map);
        });
    };

    obj.lookupRemote = function (ip, callback) {
        var list;
        if (obj.settings.provider === "auto") { list = ["ip-api", "ipwho", "ipinfo"]; }
        else { list = [obj.settings.provider]; }
        var index = 0;
        var lastError = null;
        function next() {
            if (index >= list.length) { return callback(lastError || new Error("all providers failed")); }
            var provider = list[index++];
            obj.queryProvider(provider, ip, function (err, data) {
                if (!err && data) { return callback(null, data); }
                lastError = err;
                obj.log("provider " + provider + " failed for " + ip + ": " + (err && err.message));
                next();
            });
        }
        next();
    };

    // ---------------------------------------------------------------- Cache + queue

    obj.cache = {};
    obj.pending = {};
    obj.queue = [];
    obj.busy = false;
    obj.batchQueue = [];
    obj.batchBusy = false;
    obj.cacheFile = path.join(__dirname, "cache.json");
    obj.cacheDirty = false;
    obj.cacheTimer = null;
    obj.cacheWritable = true;

    try {
        if (fs.existsSync(obj.cacheFile)) {
            var cached = JSON.parse(fs.readFileSync(obj.cacheFile, "utf8"));
            if (cached && typeof cached === "object") {
                var maxAge = obj.settings.cacheHours * 3600000 * 2;
                var now = Date.now();
                for (var cip in cached) {
                    if (Object.prototype.hasOwnProperty.call(cached, cip)) {
                        var entry = cached[cip];
                        if (entry && typeof entry.t === "number" && (now - entry.t) < maxAge) { obj.cache[cip] = entry; }
                    }
                }
            }
            obj.log("loaded " + Object.keys(obj.cache).length + " cached entries");
        }
    } catch (e) { obj.log("cache load failed: " + e.message); }

    obj.saveCacheSoon = function () {
        obj.cacheDirty = true;
        if (obj.cacheTimer != null || !obj.cacheWritable) { return; }
        obj.cacheTimer = setTimeout(function () {
            obj.cacheTimer = null;
            if (!obj.cacheDirty) { return; }
            obj.cacheDirty = false;
            try {
                var tmp = obj.cacheFile + ".tmp";
                fs.writeFileSync(tmp, JSON.stringify(obj.cache));
                fs.renameSync(tmp, obj.cacheFile);
            } catch (e) {
                obj.cacheWritable = false;
                obj.log("cache save failed: " + e.message);
            }
        }, 2000);
        if (obj.cacheTimer.unref) { obj.cacheTimer.unref(); }
    };

    obj.copyData = function (data) {
        var copy = {};
        if (data) { for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) { copy[k] = data[k]; } } }
        return copy;
    };

    obj.pump = function () {
        if (obj.busy || obj.queue.length === 0) { return; }
        obj.busy = true;
        var item = obj.queue.shift();
        obj.lookupRemote(item.ip, function (err, data) {
            var waiters = obj.pending[item.ip] || [];
            delete obj.pending[item.ip];
            if (err) {
                obj.cache[item.ip] = { t: Date.now(), d: null, e: String(err.message || err) };
            } else {
                obj.cache[item.ip] = { t: Date.now(), d: data };
            }
            obj.saveCacheSoon();
            for (var i = 0; i < waiters.length; i++) {
                try { waiters[i](err, err ? null : obj.copyData(data)); } catch (e) { obj.log("callback failed: " + e.message); }
            }
            setTimeout(function () { obj.busy = false; obj.pump(); }, obj.settings.minIntervalMs);
        });
    };

    obj.lookup = function (ip, callback) {
        ip = obj.normalizeIP(ip);
        if (ip == null) { return callback(new Error("invalid IP")); }
        if (obj.isPrivateIP(ip)) { return callback(new Error("private IP")); }
        var entry = obj.cache[ip];
        if (entry) {
            // Successful results live for cacheHours, failures are retried after 10 minutes.
            var maxAge = entry.d ? (obj.settings.cacheHours * 3600000) : (10 * 60000);
            if ((Date.now() - entry.t) < maxAge) {
                if (entry.d) { var hit = obj.copyData(entry.d); hit.cached = true; return callback(null, hit); }
                return callback(new Error(entry.e || "lookup failed"));
            }
        }
        if (obj.pending[ip]) { obj.pending[ip].push(callback); return; }
        obj.pending[ip] = [callback];
        obj.queue.push({ ip: ip });
        obj.pump();
    };

    obj.pumpBatch = function () {
        if (obj.batchBusy || obj.batchQueue.length === 0) { return; }
        obj.batchBusy = true;
        var item = obj.batchQueue.shift();
        obj.processBatch(item.ips, function (err, map) {
            for (var ip in map) {
                if (Object.prototype.hasOwnProperty.call(map, ip)) { item.results[ip] = map[ip]; }
            }
            try { item.callback(err, item.results); } catch (e) { obj.log("batch callback failed: " + e.message); }
            setTimeout(function () { obj.batchBusy = false; obj.pumpBatch(); }, obj.settings.batchIntervalMs);
        });
    };

    obj.processBatch = function (ips, callback) {
        var map = {};
        var chunks = [];
        for (var i = 0; i < ips.length; i += obj.settings.batchSize) {
            chunks.push(ips.slice(i, i + obj.settings.batchSize));
        }
        var index = 0;
        function next() {
            if (index >= chunks.length) { return callback(null, map); }
            var chunk = chunks[index++];
            obj.queryBatch(chunk, function (err, res) {
                if (err) {
                    for (var i2 = 0; i2 < chunk.length; i2++) { map[chunk[i2]] = { error: String(err.message || err) }; }
                } else {
                    for (var ip in res) {
                        if (Object.prototype.hasOwnProperty.call(res, ip)) {
                            map[ip] = res[ip];
                            if (!res[ip].error) { obj.cache[ip] = { t: Date.now(), d: res[ip] }; }
                        }
                    }
                    obj.saveCacheSoon();
                }
                if (index < chunks.length) {
                    setTimeout(next, obj.settings.batchIntervalMs);
                } else {
                    next();
                }
            });
        }
        next();
    };

    obj.lookupBatch = function (ips, callback) {
        var results = {};
        var missing = [];
        var seen = {};
        if (Array.isArray(ips)) {
            for (var i = 0; i < ips.length; i++) {
                var ip = obj.normalizeIP(ips[i]);
                if (ip == null || !obj.isValidIP(ip) || obj.isPrivateIP(ip) || seen[ip]) { continue; }
                seen[ip] = true;
                var entry = obj.cache[ip];
                if (entry) {
                    var maxAge = entry.d ? (obj.settings.cacheHours * 3600000) : (10 * 60000);
                    if ((Date.now() - entry.t) < maxAge) {
                        if (entry.d) { var hit = obj.copyData(entry.d); hit.cached = true; results[ip] = hit; }
                        else { results[ip] = { error: entry.e || "lookup failed" }; }
                        continue;
                    }
                }
                missing.push(ip);
            }
        }
        if (missing.length === 0) { return callback(null, results); }
        if (obj.settings.provider !== "auto" && obj.settings.provider !== "ip-api") {
            var remaining = missing.length;
            for (var m = 0; m < missing.length; m++) {
                (function (mip) {
                    obj.lookup(mip, function (err, data) {
                        results[mip] = err ? { error: String(err.message || err) } : data;
                        remaining--;
                        if (remaining === 0) { callback(null, results); }
                    });
                })(missing[m]);
            }
            return;
        }
        obj.batchQueue.push({ ips: missing, results: results, callback: callback });
        obj.pumpBatch();
    };

    // ---------------------------------------------------------------- Server action

    // Serve the bundled SVG flags. Registered before MeshCentral's own routes so
    // /plugin/ipgeo/flags/<cc>.svg works even when MeshCentral is under a subpath.
    obj.hook_setupHttpHandlers = function (webserver, server) {
        if (!webserver || !webserver.app || !webserver.express) { return; }
        var flagsDir = path.join(__dirname, "flags");
        var roots = ["/"];
        try {
            for (var d in server.config.domains) {
                var u = server.config.domains[d].url;
                if (typeof u !== "string") { continue; }
                if (u.charAt(0) !== "/") { u = "/" + u; }
                if (u.charAt(u.length - 1) !== "/") { u += "/"; }
                if (roots.indexOf(u) < 0) { roots.push(u); }
            }
        } catch (e) { }
        for (var i = 0; i < roots.length; i++) {
            try {
                webserver.app.use(roots[i] + "plugin/ipgeo/flags",
                    webserver.express.static(flagsDir, { maxAge: "30d", fallthrough: true, index: false }));
            } catch (e) { obj.log("failed to register flag route: " + e.message); }
        }
    };

    obj.serveraction = function (command, ws) {
        if (!command || typeof command.pluginaction !== "string") { return; }

        if (command.pluginaction === "lookupBatch") {
            var ips = Array.isArray(command.ips) ? command.ips.slice(0, obj.settings.batchMax) : [];
            if (ips.length === 0) { return; }
            obj.lookupBatch(ips, function (err, results) {
                try {
                    ws.send({ action: "plugin", plugin: "ipgeo", method: "onLookupBatchResult", ok: !err, results: results || {}, error: err ? String(err.message || err) : null });
                } catch (e) { obj.log("send failed: " + e.message); }
            });
            return;
        }

        if (command.pluginaction !== "lookup") { return; }
        var ip = obj.normalizeIP(command.ip);
        function reply(ok, result, error) {
            try {
                var msg = { action: "plugin", plugin: "ipgeo", method: "onLookupResult", ok: ok, ip: ip || String(command.ip || "") };
                if (ok) { msg.result = result; } else { msg.error = error || "lookup failed"; }
                ws.send(msg);
            } catch (e) { obj.log("send failed: " + e.message); }
        }
        if (ip == null || !obj.isValidIP(ip)) { return reply(false, null, "invalid IP"); }
        if (obj.isPrivateIP(ip)) { return reply(false, null, "private IP"); }
        obj.lookup(ip, function (err, data) {
            if (err) { return reply(false, null, String(err.message || err)); }
            reply(true, data);
        });
    };

    // ---------------------------------------------------------------- Browser side
    // Everything below is serialized with Function.toString() and runs in the
    // MeshCentral web UI. Do not reference server-side variables here.

    obj.onWebUIStartupEnd = function () {
        if (window.__ipgeoInit) { return; }
        window.__ipgeoInit = true;
        window.__ipgeoData = window.__ipgeoData || {};
        window.__ipgeoAsked = window.__ipgeoAsked || {};
        window.__ipgeoBatch = window.__ipgeoBatch || {};

        // Browser cache: paints known flags immediately on page load and after
        // MeshCentral re-renders the device list while scrolling.
        try {
            var storedCache = JSON.parse(localStorage.getItem("ipgeoCacheV1") || "{}");
            var cacheNow = Date.now();
            for (var cachedIP in storedCache) {
                if (!Object.prototype.hasOwnProperty.call(storedCache, cachedIP)) { continue; }
                var cachedEntry = storedCache[cachedIP];
                if (cachedEntry && cachedEntry.d && cachedEntry.t && (cacheNow - cachedEntry.t) < (7 * 86400000)) {
                    if (!window.__ipgeoData[cachedIP]) { window.__ipgeoData[cachedIP] = cachedEntry.d; }
                }
            }
        } catch (e) { }

        if (document.getElementById("ipgeo-css") == null) {
            var style = document.createElement("style");
            style.id = "ipgeo-css";
            style.textContent = [
                ".ipgeo-b{display:inline-block;margin-left:4px;padding:0 2px;border-radius:3px;",
                "line-height:1;vertical-align:middle;cursor:help;user-select:none}",
                "#xdevices a[data-ipgeo]{position:relative}",
                "#xdevices .ipgeo-b{position:absolute;left:100%;top:50%;transform:translateY(-50%);margin-left:3px;padding:0;background:none;line-height:1;display:inline-block}",
                "#xdevices .ipgeo-b .ipgeo-flag{width:14px;height:11px;vertical-align:middle}",
                ".ipgeo-b:hover{background:rgba(127,127,127,.22)}",
                ".ipgeo-flag{width:16px;height:12px;vertical-align:-1px;border-radius:2px;",
                "box-shadow:0 0 0 1px rgba(0,0,0,.18);display:inline-block;pointer-events:none}",
                "#ipgeo-tip{position:fixed;z-index:100000;max-width:320px;white-space:pre-line;",
                "background:#1f2328;color:#fff;padding:6px 9px;border-radius:6px;font-size:12px;",
                "line-height:1.35;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;display:none}"
            ].join("");
            document.head.appendChild(style);
        }

        if (!window.__ipgeoScroll) {
            window.__ipgeoScroll = true;
            var scrollTimer = null;
            var ipgeoOnScroll = function () {
                if (scrollTimer != null) { return; }
                scrollTimer = setTimeout(function () {
                    scrollTimer = null;
                    try { pluginHandler.ipgeo.webDecorate(); } catch (e) { }
                }, 80);
            };
            document.addEventListener("scroll", ipgeoOnScroll, true);
            window.addEventListener("resize", ipgeoOnScroll);
            window.addEventListener("focus", ipgeoOnScroll);
            document.addEventListener("visibilitychange", function () { if (!document.hidden) { ipgeoOnScroll(); } });
        }

        // Custom instant tooltip. Native title is unreliable when the hover
        // target is an <img> inside the badge.
        if (!window.__ipgeoHover) {
            window.__ipgeoHover = true;
            document.addEventListener("mouseover", function (e) {
                var el = e.target;
                if (el && el.closest) {
                    var badge = el.closest(".ipgeo-b");
                    if (badge) { try { pluginHandler.ipgeo.webShowTip(badge); } catch (ex) { } }
                }
            });
            document.addEventListener("mouseout", function (e) {
                var el = e.target;
                if (el && el.closest && el.closest(".ipgeo-b")) { try { pluginHandler.ipgeo.webHideTip(); } catch (ex) { } }
            });
            window.addEventListener("scroll", function () { try { pluginHandler.ipgeo.webHideTip(); } catch (ex) { } }, true);
            document.addEventListener("click", function () { try { pluginHandler.ipgeo.webHideTip(); } catch (ex) { } }, true);
        }

        var timer = null;
        var observer = new MutationObserver(function () {
            if (timer != null) { return; }
            timer = setTimeout(function () {
                timer = null;
                try { pluginHandler.ipgeo.webDecorate(); } catch (e) { }
            }, 100);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        // MeshCentral re-creates list rows while scrolling. Decorate newly added
        // rows synchronously (before paint) instead of waiting for the debounce.
        try {
            var devicesRoot = document.getElementById("xdevices");
            if (devicesRoot && !devicesRoot.__ipgeoObserver) {
                devicesRoot.__ipgeoObserver = true;
                var deviceObserver = new MutationObserver(function (mutations) {
                    for (var mi = 0; mi < mutations.length; mi++) {
                        var added = mutations[mi].addedNodes;
                        for (var ni = 0; ni < added.length; ni++) {
                            var node = added[ni];
                            if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) { continue; }
                            if (node.matches && node.matches('a[href*="iplocation.com"]')) {
                                try { pluginHandler.ipgeo.webDecorateLink(node); } catch (e) { }
                            }
                            var nodeLinks = node.querySelectorAll ? node.querySelectorAll('a[href*="iplocation.com"]') : [];
                            for (var li = 0; li < nodeLinks.length; li++) {
                                try { pluginHandler.ipgeo.webDecorateLink(nodeLinks[li]); } catch (e) { }
                            }
                        }
                    }
                });
                deviceObserver.observe(devicesRoot, { childList: true, subtree: true });
            }
        } catch (e) { }

        try { pluginHandler.ipgeo.webDecorate(); } catch (e) { }
    };

    obj.webFlagUrl = function (cc) {
        var pathname = (window.location && window.location.pathname) ? window.location.pathname : "/";
        var base = pathname.substring(0, pathname.lastIndexOf("/") + 1);
        if (base === "") { base = "/"; }
        return base + "plugin/ipgeo/flags/" + String(cc).toLowerCase() + ".svg";
    };

    obj.webShowTip = function (el) {
        if (!el) { return; }
        var text = el.getAttribute("data-tip") || el.getAttribute("title") || "";
        if (!text) { return; }
        var tip = document.getElementById("ipgeo-tip");
        if (!tip) {
            tip = document.createElement("div");
            tip.id = "ipgeo-tip";
            document.body.appendChild(tip);
        }
        tip.textContent = text;
        tip.style.display = "block";
        var r = el.getBoundingClientRect();
        var w = tip.offsetWidth || 260;
        var h = tip.offsetHeight || 60;
        var left = r.left;
        if (left + w > window.innerWidth - 8) { left = window.innerWidth - w - 8; }
        if (left < 8) { left = 8; }
        var top = r.bottom + 6;
        if (top + h > window.innerHeight - 8) { top = r.top - h - 6; }
        if (top < 8) { top = 8; }
        tip.style.left = left + "px";
        tip.style.top = top + "px";
    };

    obj.webHideTip = function () {
        var tip = document.getElementById("ipgeo-tip");
        if (tip) { tip.style.display = "none"; }
    };

    obj.webSaveCache = function () {
        if (window.__ipgeoCacheTimer) { clearTimeout(window.__ipgeoCacheTimer); }
        window.__ipgeoCacheTimer = setTimeout(function () {
            window.__ipgeoCacheTimer = null;
            try {
                var out = {};
                var now = Date.now();
                for (var ip in window.__ipgeoData) {
                    if (!Object.prototype.hasOwnProperty.call(window.__ipgeoData, ip)) { continue; }
                    var entry = window.__ipgeoData[ip];
                    if (entry && !entry.error) { out[ip] = { t: now, d: entry }; }
                }
                localStorage.setItem("ipgeoCacheV1", JSON.stringify(out));
            } catch (e) { }
        }, 1000);
    };

    obj.webLookup = function (ip) {
        if (!ip || typeof ip !== "string") { return; }
        if (!window.__ipgeoAsked) { window.__ipgeoAsked = {}; }
        window.__ipgeoAsked[ip] = Date.now();
        try { meshserver.send({ action: "plugin", plugin: "ipgeo", pluginaction: "lookup", ip: ip }); } catch (e) { }
    };

    obj.webLookupBatch = function (ips) {
        if (!Array.isArray(ips) || ips.length === 0) { return; }
        if (!window.__ipgeoAsked) { window.__ipgeoAsked = {}; }
        for (var i = 0; i < ips.length; i++) { window.__ipgeoAsked[ips[i]] = Date.now(); }
        try {
            for (var j = 0; j < ips.length; j += 100) {
                meshserver.send({ action: "plugin", plugin: "ipgeo", pluginaction: "lookupBatch", ips: ips.slice(j, j + 100) });
            }
        } catch (e) { }
    };

    obj.webDecorateLink = function (a) {
        if (!a) { return; }
        var data = window.__ipgeoData || {};
        var asked = window.__ipgeoAsked || {};
        var now = Date.now();
        var links = [a];
        for (var i = 0; i < links.length; i++) {
            var href = a.getAttribute("href") || "";
            var match = href.match(/[?&]ip=([^&]+)/);
            if (!match) { continue; }
            var ip = decodeURIComponent(match[1]);
            var already = false;
            var scopes = [a, a.parentNode];
            for (var si = 0; si < scopes.length && !already; si++) {
                var scopeBadges = scopes[si] ? scopes[si].getElementsByClassName("ipgeo-b") : [];
                for (var s = 0; s < scopeBadges.length; s++) { if (scopeBadges[s].getAttribute("data-ip") === ip) { already = true; break; } }
            }
            if (already) { a.setAttribute("data-ipgeo", ip); continue; }
            a.removeAttribute("data-ipgeo");
            var info = data[ip];
            if (!info) {
                if (!asked[ip] || (now - asked[ip]) > 1800000) {
                    // Prefetch only what is actually visible (with a small margin).
                    // Offscreen rows are loaded lazily when they are scrolled into view.
                    var rect = a.getBoundingClientRect();
                    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
                    if (rect.width > 0 && rect.height > 0 && rect.bottom >= -200 && rect.top <= vh + 200) {
                        if (!window.__ipgeoBatch) { window.__ipgeoBatch = {}; }
                        window.__ipgeoBatch[ip] = 1;
                        if (!window.__ipgeoBatchTimer) {
                            window.__ipgeoBatchTimer = setTimeout(function () {
                                window.__ipgeoBatchTimer = null;
                                var list = Object.keys(window.__ipgeoBatch || {});
                                window.__ipgeoBatch = {};
                                if (list.length > 0) {
                                    try { pluginHandler.ipgeo.webLookupBatch(list); } catch (e) { }
                                }
                            }, 150);
                        }
                    }
                }
                continue;
            }
            if (info.error || (!info.country && !info.isp)) { continue; }

            var country = info.country || "";
            try {
                if (info.countryCode && window.Intl && Intl.DisplayNames) {
                    var dn = new Intl.DisplayNames([navigator.language || "en"], { type: "region" });
                    var localized = dn.of(info.countryCode);
                    if (localized && localized !== info.countryCode) { country = localized; }
                }
            } catch (e) { }

            var flag = "\uD83C\uDF10";
            if (info.countryCode && /^[A-Za-z]{2}$/.test(info.countryCode)) {
                var cc = info.countryCode.toUpperCase();
                flag = String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65);
            }

            var provider = info.isp || info.org || "";
            if (!provider && info.asn) { provider = String(info.asn).replace(/^AS\d+\s*/i, ""); }

            var badge = document.createElement("span");
            badge.className = "ipgeo-b";
            badge.setAttribute("data-ip", ip);
            var cc = (info.countryCode || "").toLowerCase();
            if (/^[a-z]{2}$/.test(cc)) {
                // Local SVG flag served by this plugin (no external image requests).
                var img = document.createElement("img");
                img.className = "ipgeo-flag";
                img.width = 16;
                img.height = 12;
                img.alt = provider ? (provider + (country ? " \u2014 " + country : "")) : (country || info.countryCode || "IP location");
                img.src = pluginHandler.ipgeo.webFlagUrl(cc);
                img.setAttribute("data-cc", cc);
                img.setAttribute("data-flag", flag);
                img.onerror = function () {
                    var code = this.getAttribute("data-cc") || "";
                    if (this.getAttribute("data-fallback") !== "1") {
                        this.setAttribute("data-fallback", "1");
                        this.src = "/plugin/ipgeo/flags/" + code + ".svg";
                    } else {
                        var fallback = this.getAttribute("data-flag") || "\uD83C\uDF10";
                        this.style.display = "none";
                        if (this.parentNode) { this.parentNode.textContent = fallback; }
                    }
                };
                badge.appendChild(img);
            } else {
                badge.textContent = flag;
            }

            // Hover tooltip: provider first, then country, ASN and IP.
            var tip = [provider || "Provider unknown"];
            if (country) { tip.push(flag + " " + country); }
            if (info.asn) { tip.push(info.asn); }
            tip.push("IP: " + ip);
            if (info.org && info.org !== provider) { tip.push("Org: " + info.org); }
            if (info.source) { tip.push("via " + info.source); }
            var tipText = tip.join("\n");
            badge.setAttribute("data-tip", tipText);
            // Native title on the image is only a fallback; the custom tooltip
            // above is what actually shows on hover.
            if (badge.firstChild && badge.firstChild.tagName === "IMG") { badge.firstChild.setAttribute("title", tipText); }
            badge.setAttribute("aria-label", (provider || "IP location") + (country ? ", " + country : ""));
            var inList = a.closest && a.closest("#xdevices");
            if (inList) {
                // Absolute badge inside the link: it must not change the cell
                // width or the centered IP text ("jumping" while scrolling).
                a.style.position = "relative";
                badge.className = "ipgeo-b ipgeo-b-list";
                a.appendChild(badge);
            } else {
                a.parentNode.insertBefore(badge, a.nextSibling);
            }
            a.setAttribute("data-ipgeo", ip);
        }
    };

    obj.webDecorate = function () {
        var links = document.querySelectorAll('a[href*="iplocation.com"]');
        for (var i = 0; i < links.length; i++) {
            try { pluginHandler.ipgeo.webDecorateLink(links[i]); } catch (e) { }
        }
    };

    obj.onLookupResult = function (server, message) {
        if (!message || !message.ip) { return; }
        if (!window.__ipgeoData) { window.__ipgeoData = {}; }
        if (message.ok) { window.__ipgeoData[message.ip] = message.result; }
        else { window.__ipgeoData[message.ip] = { error: message.error || "lookup failed" }; }
        try { pluginHandler.ipgeo.webSaveCache(); } catch (e) { }
        try { pluginHandler.ipgeo.webDecorate(); } catch (e) { }
    };

    obj.onLookupBatchResult = function (server, message) {
        if (!message || !message.results) { return; }
        if (!window.__ipgeoData) { window.__ipgeoData = {}; }
        for (var ip in message.results) {
            if (Object.prototype.hasOwnProperty.call(message.results, ip)) { window.__ipgeoData[ip] = message.results[ip]; }
        }
        try { pluginHandler.ipgeo.webSaveCache(); } catch (e) { }
        try { pluginHandler.ipgeo.webDecorate(); } catch (e) { }
    };

    obj.onDeviceRefreshEnd = function (nodeid, panel, refresh, event) {
        var node = (typeof currentNode !== "undefined" && currentNode != null) ? currentNode : null;
        var ips = [];
        function addIP(value, stripPort) {
            if (typeof value !== "string" || value === "") { return; }
            var ip = value;
            if (ip.charAt(0) === "[") {
                var close = ip.indexOf("]");
                if (close > 1) { ip = ip.substring(1, close); }
            } else if (stripPort) {
                var colons = ip.split(":").length - 1;
                if (colons === 1 && ip.indexOf(".") > 0) {
                    ip = ip.substring(0, ip.indexOf(":"));
                } else if (colons > 2) {
                    var parts = ip.split(":");
                    if (parts.length > 3 && /^\d{1,5}$/.test(parts[parts.length - 1])) { ip = parts.slice(0, -1).join(":"); }
                }
            }
            if (ips.indexOf(ip) < 0) { ips.push(ip); }
        }
        if (node != null) {
            addIP(node.lastaddr, true);
            addIP(node.ip, false);
        }
        for (var i = 0; i < ips.length; i++) {
            var ip = ips[i];
            if (typeof isPrivateIP === "function" && isPrivateIP(ip)) { continue; }
            if ((!window.__ipgeoAsked || !window.__ipgeoAsked[ip]) && (!window.__ipgeoData || !window.__ipgeoData[ip])) {
                try { pluginHandler.ipgeo.webLookup(ip); } catch (e) { }
            }
        }
        setTimeout(function () {
            try { pluginHandler.ipgeo.webDecorate(); } catch (e) { }
        }, 150);
    };

    obj.server_startup = function () {
        obj.log("started, provider=" + obj.settings.provider + ", cache=" + Object.keys(obj.cache).length);
    };

    return obj;
};
