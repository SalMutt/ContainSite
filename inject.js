// ContainSite — Hardened fingerprint overrides
// Uses Firefox exportFunction/wrappedJSObject APIs (bypasses CSP)

(function() {
  "use strict";

  const CONFIG = window.__csConfig;
  if (!CONFIG) return;
  delete window.__csConfig;

  const pageWindow = window.wrappedJSObject;

  // --- Vector Toggle ---
  const V = CONFIG.vectors || {};
  function vectorEnabled(name) { return V[name] !== false; }

  // --- PRNG (Mulberry32) ---
  function mulberry32(seed) {
    return function() {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // =========================================================================
  //  CANVAS SPOOFING
  // =========================================================================

  if (vectorEnabled("canvas")) {
    const origGetImageData = window.CanvasRenderingContext2D.prototype.getImageData;
    const origPutImageData = window.CanvasRenderingContext2D.prototype.putImageData;

    function addCanvasNoise(ctx, canvas) {
      try {
        const w = canvas.width, h = canvas.height;
        if (w <= 0 || h <= 0) return;
        const imgData = origGetImageData.call(ctx, 0, 0, w, h);
        const data = imgData.data;
        const rng = mulberry32(CONFIG.canvasSeed);
        for (let i = 0; i < data.length; i += 4) {
          if (rng() < 0.1) {
            const ch = (rng() * 3) | 0;
            const delta = rng() < 0.5 ? -1 : 1;
            data[i + ch] = Math.max(0, Math.min(255, data[i + ch] + delta));
          }
        }
        origPutImageData.call(ctx, imgData, 0, 0);
      } catch(e) {}
    }

    const origToDataURL = window.HTMLCanvasElement.prototype.toDataURL;
    exportFunction(function(...args) {
      try {
        const ctx = this.getContext("2d");
        if (ctx) addCanvasNoise(ctx, this);
      } catch(e) {}
      return origToDataURL.apply(this, args);
    }, pageWindow.HTMLCanvasElement.prototype, { defineAs: "toDataURL" });

    const origToBlob = window.HTMLCanvasElement.prototype.toBlob;
    exportFunction(function(callback, ...args) {
      try {
        const ctx = this.getContext("2d");
        if (ctx) addCanvasNoise(ctx, this);
      } catch(e) {}
      return origToBlob.call(this, callback, ...args);
    }, pageWindow.HTMLCanvasElement.prototype, { defineAs: "toBlob" });

    exportFunction(function(...args) {
      const imgData = origGetImageData.apply(this, args);
      const data = imgData.data;
      const rng = mulberry32(CONFIG.canvasSeed);
      for (let i = 0; i < data.length; i += 4) {
        if (rng() < 0.1) {
          const ch = (rng() * 3) | 0;
          const delta = rng() < 0.5 ? -1 : 1;
          data[i + ch] = Math.max(0, Math.min(255, data[i + ch] + delta));
        }
      }
      return imgData;
    }, pageWindow.CanvasRenderingContext2D.prototype, { defineAs: "getImageData" });
  }

  // =========================================================================
  //  WEBGL SPOOFING
  // =========================================================================

  if (vectorEnabled("webgl")) {
    const UNMASKED_VENDOR = 0x9245;
    const UNMASKED_RENDERER = 0x9246;

    function patchWebGL(protoName) {
      const pageProto = pageWindow[protoName];
      if (!pageProto) return;
      const origProto = window[protoName];
      if (!origProto) return;

      const origGetParam = origProto.prototype.getParameter;
      exportFunction(function(pname) {
        if (pname === UNMASKED_VENDOR) return CONFIG.webgl.vendor;
        if (pname === UNMASKED_RENDERER) return CONFIG.webgl.renderer;
        return origGetParam.call(this, pname);
      }, pageProto.prototype, { defineAs: "getParameter" });
    }

    patchWebGL("WebGLRenderingContext");
    patchWebGL("WebGL2RenderingContext");
  }

  // =========================================================================
  //  AUDIO SPOOFING
  // =========================================================================

  if (vectorEnabled("audio")) {
    const origGetFloatFreq = window.AnalyserNode.prototype.getFloatFrequencyData;
    exportFunction(function(array) {
      origGetFloatFreq.call(this, array);
      const rng = mulberry32(CONFIG.audioSeed);
      for (let i = 0; i < array.length; i++) {
        if (array[i] !== 0) array[i] += (rng() - 0.5) * 0.0001;
      }
    }, pageWindow.AnalyserNode.prototype, { defineAs: "getFloatFrequencyData" });

    const origGetByteFreq = window.AnalyserNode.prototype.getByteFrequencyData;
    exportFunction(function(array) {
      origGetByteFreq.call(this, array);
      const rng = mulberry32(CONFIG.audioSeed);
      for (let i = 0; i < array.length; i++) {
        if (array[i] !== 0 && rng() < 0.05) {
          array[i] = Math.max(0, Math.min(255, array[i] + (rng() < 0.5 ? -1 : 1)));
        }
      }
    }, pageWindow.AnalyserNode.prototype, { defineAs: "getByteFrequencyData" });

    const origGetChannelData = window.AudioBuffer.prototype.getChannelData;
    exportFunction(function(channel) {
      const data = origGetChannelData.call(this, channel);
      const rng = mulberry32(CONFIG.audioSeed);
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) data[i] += (rng() - 0.5) * 0.0001;
      }
      return data;
    }, pageWindow.AudioBuffer.prototype, { defineAs: "getChannelData" });
  }

  // =========================================================================
  //  NAVIGATOR SPOOFING
  // =========================================================================

  if (vectorEnabled("navigator")) {
    const navOverrides = {
      hardwareConcurrency: CONFIG.nav.hardwareConcurrency,
      platform: CONFIG.nav.platform,
      deviceMemory: CONFIG.nav.deviceMemory,
      maxTouchPoints: CONFIG.nav.maxTouchPoints,
      userAgent: CONFIG.nav.userAgent,
      appVersion: CONFIG.nav.appVersion,
      oscpu: CONFIG.nav.oscpu
    };

    for (const [prop, value] of Object.entries(navOverrides)) {
      if (value !== undefined) {
        Object.defineProperty(pageWindow.Navigator.prototype, prop, {
          get: exportFunction(function() { return value; }, pageWindow),
          configurable: true,
          enumerable: true
        });
      }
    }

    const frozenLangs = CONFIG.nav.languages;
    Object.defineProperty(pageWindow.Navigator.prototype, "languages", {
      get: exportFunction(function() {
        return cloneInto(frozenLangs, pageWindow, { freeze: true });
      }, pageWindow),
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(pageWindow.Navigator.prototype, "language", {
      get: exportFunction(function() { return frozenLangs[0]; }, pageWindow),
      configurable: true,
      enumerable: true
    });
  }

  // =========================================================================
  //  PLUGINS SPOOFING
  // =========================================================================

  if (vectorEnabled("plugins")) {
    Object.defineProperty(pageWindow.Navigator.prototype, "plugins", {
      get: exportFunction(function() {
        return cloneInto([], pageWindow);
      }, pageWindow),
      configurable: true,
      enumerable: true
    });

    Object.defineProperty(pageWindow.Navigator.prototype, "mimeTypes", {
      get: exportFunction(function() {
        return cloneInto([], pageWindow);
      }, pageWindow),
      configurable: true,
      enumerable: true
    });
  }

  // =========================================================================
  //  CONNECTION SPOOFING
  // =========================================================================

  if (vectorEnabled("connection") && pageWindow.navigator.connection) {
    try {
      Object.defineProperty(pageWindow.Navigator.prototype, "connection", {
        get: exportFunction(function() {
          return cloneInto({
            effectiveType: "4g",
            downlink: 10,
            rtt: 50,
            saveData: false
          }, pageWindow);
        }, pageWindow),
        configurable: true,
        enumerable: true
      });
    } catch(e) {}
  }

  // =========================================================================
  //  BATTERY SPOOFING
  // =========================================================================

  if (vectorEnabled("battery") && pageWindow.navigator.getBattery) {
    exportFunction(function() {
      return new pageWindow.Promise(exportFunction(function(resolve) {
        resolve(cloneInto({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1.0,
          addEventListener: function() {},
          removeEventListener: function() {}
        }, pageWindow, { cloneFunctions: true }));
      }, pageWindow));
    }, pageWindow.Navigator.prototype, { defineAs: "getBattery" });
  }

  // =========================================================================
  //  SCREEN SPOOFING
  // =========================================================================

  if (vectorEnabled("screen")) {
    const screenOverrides = {
      width: CONFIG.screen.width,
      height: CONFIG.screen.height,
      availWidth: CONFIG.screen.width,
      availHeight: CONFIG.screen.height - 40,
      colorDepth: CONFIG.screen.colorDepth,
      pixelDepth: CONFIG.screen.colorDepth
    };

    for (const [prop, value] of Object.entries(screenOverrides)) {
      Object.defineProperty(pageWindow.Screen.prototype, prop, {
        get: exportFunction(function() { return value; }, pageWindow),
        configurable: true,
        enumerable: true
      });
    }

    Object.defineProperty(pageWindow, "outerWidth", {
      get: exportFunction(function() { return CONFIG.screen.width; }, pageWindow),
      configurable: true
    });
    Object.defineProperty(pageWindow, "outerHeight", {
      get: exportFunction(function() { return CONFIG.screen.height; }, pageWindow),
      configurable: true
    });
    Object.defineProperty(pageWindow, "innerWidth", {
      get: exportFunction(function() { return CONFIG.screen.width; }, pageWindow),
      configurable: true
    });
    Object.defineProperty(pageWindow, "innerHeight", {
      get: exportFunction(function() { return CONFIG.screen.height - 80; }, pageWindow),
      configurable: true
    });
  }

  // =========================================================================
  //  TIMEZONE SPOOFING
  // =========================================================================

  if (vectorEnabled("timezone") && CONFIG.timezone) {
    const tzName = CONFIG.timezone.name;
    const tzOffset = CONFIG.timezone.offset;

    const origGetTimezoneOffset = window.Date.prototype.getTimezoneOffset;
    exportFunction(function() {
      return tzOffset;
    }, pageWindow.Date.prototype, { defineAs: "getTimezoneOffset" });

    const OrigDateTimeFormat = window.Intl.DateTimeFormat;
    const origResolvedOptions = OrigDateTimeFormat.prototype.resolvedOptions;
    exportFunction(function() {
      const opts = origResolvedOptions.call(this);
      try { opts.timeZone = tzName; } catch(e) {}
      return opts;
    }, pageWindow.Intl.DateTimeFormat.prototype, { defineAs: "resolvedOptions" });

    const origToString = window.Date.prototype.toString;
    const origToTimeString = window.Date.prototype.toTimeString;

    function formatTzAbbrev(tzName) {
      const abbrevMap = {
        "America/New_York": "EST", "America/Chicago": "CST",
        "America/Denver": "MST", "America/Los_Angeles": "PST",
        "Europe/London": "GMT", "Europe/Berlin": "CET",
        "Europe/Paris": "CET", "Asia/Tokyo": "JST",
        "Australia/Sydney": "AEST", "America/Toronto": "EST",
        "America/Phoenix": "MST"
      };
      return abbrevMap[tzName] || "UTC";
    }

    function buildTzString(date) {
      try {
        const fmt = new OrigDateTimeFormat("en-US", {
          timeZone: tzName,
          weekday: "short", year: "numeric", month: "short", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        });
        const parts = fmt.format(date);
        const sign = tzOffset <= 0 ? "+" : "-";
        const absOff = Math.abs(tzOffset);
        const h = String(Math.floor(absOff / 60)).padStart(2, "0");
        const m = String(absOff % 60).padStart(2, "0");
        const abbrev = formatTzAbbrev(tzName);
        return `${parts} GMT${sign}${h}${m} (${abbrev})`;
      } catch(e) {
        return origToString.call(date);
      }
    }

    exportFunction(function() {
      return buildTzString(this);
    }, pageWindow.Date.prototype, { defineAs: "toString" });

    exportFunction(function() {
      try {
        const fmt = new OrigDateTimeFormat("en-US", {
          timeZone: tzName,
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        });
        const parts = fmt.format(this);
        const sign = tzOffset <= 0 ? "+" : "-";
        const absOff = Math.abs(tzOffset);
        const h = String(Math.floor(absOff / 60)).padStart(2, "0");
        const m = String(absOff % 60).padStart(2, "0");
        const abbrev = formatTzAbbrev(tzName);
        return `${parts} GMT${sign}${h}${m} (${abbrev})`;
      } catch(e) {
        return origToTimeString.call(this);
      }
    }, pageWindow.Date.prototype, { defineAs: "toTimeString" });
  }

  // =========================================================================
  //  WEBRTC LEAK PROTECTION
  // =========================================================================

  if (vectorEnabled("webrtc") && CONFIG.webrtc && CONFIG.webrtc.blockLocal) {
    if (pageWindow.RTCPeerConnection) {
      const OrigRTC = window.RTCPeerConnection;
      const wrappedRTC = exportFunction(function(config, constraints) {
        if (config && config.iceServers) {
          config.iceTransportPolicy = "relay";
        }
        const pc = new OrigRTC(config, constraints);
        return pc;
      }, pageWindow);

      try {
        wrappedRTC.prototype = pageWindow.RTCPeerConnection.prototype;
        pageWindow.RTCPeerConnection = wrappedRTC;
      } catch(e) {}
    }

    if (pageWindow.webkitRTCPeerConnection) {
      try {
        pageWindow.webkitRTCPeerConnection = pageWindow.RTCPeerConnection;
      } catch(e) {}
    }
  }

  // =========================================================================
  //  FONT FINGERPRINT PROTECTION
  // =========================================================================

  if (vectorEnabled("fonts") && CONFIG.fontSeed) {
    const fontRng = mulberry32(CONFIG.fontSeed);

    const origMeasureText = window.CanvasRenderingContext2D.prototype.measureText;
    exportFunction(function(text) {
      const metrics = origMeasureText.call(this, text);

      const noise = (fontRng() - 0.5) * 0.3;
      const origWidth = metrics.width;

      try {
        Object.defineProperty(metrics, "width", {
          get: function() { return origWidth + noise; },
          configurable: true
        });
      } catch(e) {}

      return metrics;
    }, pageWindow.CanvasRenderingContext2D.prototype, { defineAs: "measureText" });
  }

  // =========================================================================
  //  CLIENTRECTS FINGERPRINT PROTECTION
  // =========================================================================

  if (vectorEnabled("clientRects") && CONFIG.rectSeed) {
    const rectRng = mulberry32(CONFIG.rectSeed);

    function addRectNoise(rect) {
      const noise = (rectRng() - 0.5) * 0.1;
      try {
        const origX = rect.x, origY = rect.y;
        const origW = rect.width, origH = rect.height;
        const origT = rect.top, origL = rect.left;
        const origB = rect.bottom, origR = rect.right;

        Object.defineProperties(rect, {
          x: { get: () => origX + noise, configurable: true },
          y: { get: () => origY + noise, configurable: true },
          width: { get: () => origW + noise, configurable: true },
          height: { get: () => origH + noise, configurable: true },
          top: { get: () => origT + noise, configurable: true },
          left: { get: () => origL + noise, configurable: true },
          bottom: { get: () => origB + noise, configurable: true },
          right: { get: () => origR + noise, configurable: true }
        });
      } catch(e) {}
      return rect;
    }

    const origGetBCR = window.Element.prototype.getBoundingClientRect;
    exportFunction(function() {
      const rect = origGetBCR.call(this);
      return addRectNoise(rect);
    }, pageWindow.Element.prototype, { defineAs: "getBoundingClientRect" });

    const origGetCR = window.Element.prototype.getClientRects;
    exportFunction(function() {
      const rects = origGetCR.call(this);
      for (let i = 0; i < rects.length; i++) {
        addRectNoise(rects[i]);
      }
      return rects;
    }, pageWindow.Element.prototype, { defineAs: "getClientRects" });
  }

})();
