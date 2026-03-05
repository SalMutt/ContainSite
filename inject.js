// ContainSite — Hardened fingerprint overrides
// Uses Firefox exportFunction/wrappedJSObject APIs (bypasses CSP)

(function() {
  "use strict";

  const CONFIG = window.__csConfig;
  if (!CONFIG) return;
  delete window.__csConfig;

  // Skip all overrides on auth domains — Google does deep browser verification
  // and rejects logins when any fingerprint inconsistency is detected
  const AUTH_BYPASS_DOMAINS = ["accounts.google.com", "accounts.youtube.com"];
  try {
    if (AUTH_BYPASS_DOMAINS.indexOf(window.location.hostname) !== -1) return;
  } catch(e) {}

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

    // Normalize key max parameters to common values to prevent GPU fingerprinting
    const PARAM_OVERRIDES = {
      0x0D33: 16384,  // MAX_TEXTURE_SIZE
      0x851C: 16384,  // MAX_CUBE_MAP_TEXTURE_SIZE
      0x84E8: 16384,  // MAX_RENDERBUFFER_SIZE
      0x8869: 16,     // MAX_VERTEX_ATTRIBS
      0x8872: 16,     // MAX_VERTEX_TEXTURE_IMAGE_UNITS
      0x8B4C: 16,     // MAX_TEXTURE_IMAGE_UNITS
      0x8DFB: 32,     // MAX_VARYING_VECTORS
      0x8DFC: 256,    // MAX_VERTEX_UNIFORM_VECTORS
      0x8DFD: 512,    // MAX_FRAGMENT_UNIFORM_VECTORS
      0x80A9: 16,     // MAX_SAMPLES
    };

    function patchWebGL(protoName) {
      const pageProto = pageWindow[protoName];
      if (!pageProto) return;
      const origProto = window[protoName];
      if (!origProto) return;

      const origGetParam = origProto.prototype.getParameter;
      exportFunction(function(pname) {
        if (pname === UNMASKED_VENDOR) return CONFIG.webgl.vendor;
        if (pname === UNMASKED_RENDERER) return CONFIG.webgl.renderer;
        if (PARAM_OVERRIDES[pname] !== undefined) {
          // Return the normalized value, but never exceed the real GPU's capability
          const real = origGetParam.call(this, pname);
          return (typeof real === "number") ? Math.min(real, PARAM_OVERRIDES[pname]) : real;
        }
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

    // Wrap the Intl.DateTimeFormat constructor to inject spoofed timezone
    // when no explicit timeZone is provided. This ensures resolvedOptions()
    // returns the spoofed timezone and all formatting uses it.
    const wrappedDTF = exportFunction(function(locales, options) {
      let opts;
      if (options) {
        try { opts = JSON.parse(JSON.stringify(options)); } catch(e) { opts = {}; }
      } else {
        opts = {};
      }
      if (!opts.timeZone) opts.timeZone = tzName;
      // Support both `new Intl.DateTimeFormat()` and `Intl.DateTimeFormat()`
      return new OrigDateTimeFormat(locales, opts);
    }, pageWindow);

    try {
      wrappedDTF.prototype = pageWindow.Intl.DateTimeFormat.prototype;
      wrappedDTF.supportedLocalesOf = pageWindow.Intl.DateTimeFormat.supportedLocalesOf;
      Object.defineProperty(pageWindow.Intl, "DateTimeFormat", {
        value: wrappedDTF, writable: true, configurable: true, enumerable: true
      });
    } catch(e) {}

    const origToString = window.Date.prototype.toString;
    const origToTimeString = window.Date.prototype.toTimeString;

    const abbrevMap = {
      "America/New_York": "EST", "America/Chicago": "CST",
      "America/Denver": "MST", "America/Los_Angeles": "PST",
      "Europe/London": "GMT", "Europe/Berlin": "CET",
      "Europe/Paris": "CET", "Asia/Tokyo": "JST",
      "Australia/Sydney": "AEST", "America/Toronto": "EST",
      "America/Phoenix": "MST"
    };
    const tzAbbrev = abbrevMap[tzName] || "UTC";

    // Pre-compute the GMT offset string: e.g. "GMT+1100" or "GMT-0500"
    const tzSign = tzOffset <= 0 ? "+" : "-";
    const tzAbsOff = Math.abs(tzOffset);
    const tzH = String(Math.floor(tzAbsOff / 60)).padStart(2, "0");
    const tzM = String(tzAbsOff % 60).padStart(2, "0");
    const gmtString = `GMT${tzSign}${tzH}${tzM}`;

    // Pre-create a formatter in the content script scope (not inside exportFunction)
    const tzDateFmt = new OrigDateTimeFormat("en-US", {
      timeZone: tzName,
      weekday: "short", year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
    const tzTimeFmt = new OrigDateTimeFormat("en-US", {
      timeZone: tzName,
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });

    exportFunction(function() {
      try {
        // Get timestamp from the page-side Date via getTime (works across compartments)
        const ts = window.Date.prototype.getTime.call(this);
        const parts = tzDateFmt.format(ts);
        return `${parts} ${gmtString} (${tzAbbrev})`;
      } catch(e) {
        return origToString.call(this);
      }
    }, pageWindow.Date.prototype, { defineAs: "toString" });

    exportFunction(function() {
      try {
        const ts = window.Date.prototype.getTime.call(this);
        const parts = tzTimeFmt.format(ts);
        return `${parts} ${gmtString} (${tzAbbrev})`;
      } catch(e) {
        return origToTimeString.call(this);
      }
    }, pageWindow.Date.prototype, { defineAs: "toTimeString" });
  }

  // =========================================================================
  //  WEBRTC LEAK PROTECTION
  // =========================================================================

  if (vectorEnabled("webrtc") && CONFIG.webrtc && CONFIG.webrtc.blockLocal) {
    // Force relay-only ICE transport to prevent local/public IP leaks via WebRTC.
    // NOTE: LibreWolf/Firefox may resist content-script-level RTCPeerConnection
    // overrides. For guaranteed protection, also set in about:config:
    //   media.peerconnection.ice.default_address_only = true
    //   media.peerconnection.ice.no_host = true
    //   media.peerconnection.ice.proxy_only_if_behind_proxy = true
    if (pageWindow.RTCPeerConnection) {
      const OrigRTC = window.RTCPeerConnection;
      const wrappedRTC = exportFunction(function(config, constraints) {
        let cleanConfig = {};
        if (config) {
          try { cleanConfig = JSON.parse(JSON.stringify(config)); } catch(e) {}
        }
        cleanConfig.iceTransportPolicy = "relay";
        const pc = new OrigRTC(cleanConfig, constraints);
        return pc;
      }, pageWindow);

      try {
        wrappedRTC.prototype = pageWindow.RTCPeerConnection.prototype;
        Object.defineProperty(pageWindow, "RTCPeerConnection", {
          value: wrappedRTC, writable: true, configurable: true, enumerable: true
        });
      } catch(e) {}

      if (pageWindow.webkitRTCPeerConnection) {
        try {
          Object.defineProperty(pageWindow, "webkitRTCPeerConnection", {
            value: wrappedRTC, writable: true, configurable: true, enumerable: true
          });
        } catch(e) {}
      }
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

    // --- document.fonts (FontFaceSet) API Protection ---
    // document.fonts.check() always returns true so font loading logic works,
    // but prevents enumeration of specific fonts by giving a uniform response.
    if (pageWindow.document.fonts) {
      try {
        Object.defineProperty(pageWindow.document.fonts, "check", {
          value: exportFunction(function() { return true; }, pageWindow),
          configurable: true, enumerable: true
        });
      } catch(e) {}
    }
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

  // =========================================================================
  //  SPEECH SYNTHESIS FINGERPRINT PROTECTION
  // =========================================================================
  //  speechSynthesis.getVoices() reveals installed TTS voices (OS/locale-specific)

  if (vectorEnabled("navigator") && pageWindow.speechSynthesis) {
    try {
      Object.defineProperty(pageWindow.speechSynthesis, "getVoices", {
        value: exportFunction(function() {
          return cloneInto([], pageWindow);
        }, pageWindow),
        configurable: true,
        enumerable: true
      });
      // Also suppress the voiceschanged event
      Object.defineProperty(pageWindow.speechSynthesis, "onvoiceschanged", {
        get: exportFunction(function() { return null; }, pageWindow),
        set: exportFunction(function() {}, pageWindow),
        configurable: true
      });
    } catch(e) {}
  }

  // =========================================================================
  //  MATCHMEDIA SCREEN OVERRIDE
  // =========================================================================
  //  CSS media queries for screen dimensions bypass JS screen overrides.
  //  Override matchMedia to return spoofed results for screen dimension queries.

  if (vectorEnabled("screen") && CONFIG.screen) {
    const origMatchMedia = window.matchMedia;
    const sw = CONFIG.screen.width;
    const sh = CONFIG.screen.height;
    const cd = CONFIG.screen.colorDepth;

    exportFunction(function(query) {
      // Replace real screen dimensions in the query with spoofed values
      // so media query evaluation uses the spoofed screen size
      let spoofedQuery = query;
      try {
        // For direct dimension checks: (min-width: 1920px), (max-width: 1920px), etc.
        // We can't truly change the CSS engine, but we can make matchMedia().matches
        // return consistent results with our spoofed screen values
        const result = origMatchMedia.call(this, query);
        const origMatches = result.matches;

        // Check if this is a screen dimension/color query we should intercept
        const isDimensionQuery = /\b(width|height|device-width|device-height|resolution|color)\b/i.test(query);
        if (!isDimensionQuery) return result;

        // Evaluate the query against our spoofed values
        let spoofedMatches = origMatches;

        // Parse simple dimension queries and evaluate against spoofed values
        const minW = query.match(/min-(?:device-)?width:\s*(\d+)px/i);
        const maxW = query.match(/max-(?:device-)?width:\s*(\d+)px/i);
        const minH = query.match(/min-(?:device-)?height:\s*(\d+)px/i);
        const maxH = query.match(/max-(?:device-)?height:\s*(\d+)px/i);
        const colorMatch = query.match(/\(color:\s*(\d+)\)/i);
        const minColor = query.match(/min-color:\s*(\d+)/i);

        if (minW || maxW || minH || maxH || colorMatch || minColor) {
          spoofedMatches = true;
          if (minW && sw < parseInt(minW[1])) spoofedMatches = false;
          if (maxW && sw > parseInt(maxW[1])) spoofedMatches = false;
          if (minH && sh < parseInt(minH[1])) spoofedMatches = false;
          if (maxH && sh > parseInt(maxH[1])) spoofedMatches = false;
          if (colorMatch && cd !== parseInt(colorMatch[1])) spoofedMatches = false;
          if (minColor && cd < parseInt(minColor[1])) spoofedMatches = false;
        }

        if (spoofedMatches !== origMatches) {
          // Return a spoofed MediaQueryList
          try {
            Object.defineProperty(result, "matches", {
              get: function() { return spoofedMatches; },
              configurable: true
            });
          } catch(e) {}
        }
        return result;
      } catch(e) {
        return origMatchMedia.call(this, query);
      }
    }, pageWindow, { defineAs: "matchMedia" });
  }

  // =========================================================================
  //  WEBGL EXTENDED FINGERPRINT PROTECTION
  // =========================================================================
  //  Normalize getSupportedExtensions to a common baseline set

  if (vectorEnabled("webgl")) {
    function patchWebGLExtensions(protoName) {
      const pageProto = pageWindow[protoName];
      if (!pageProto) return;
      const origProto = window[protoName];
      if (!origProto) return;

      const origGetExtensions = origProto.prototype.getSupportedExtensions;
      const BASELINE_EXTENSIONS = [
        "ANGLE_instanced_arrays", "EXT_blend_minmax", "EXT_color_buffer_half_float",
        "EXT_float_blend", "EXT_frag_depth", "EXT_shader_texture_lod",
        "EXT_texture_filter_anisotropic", "OES_element_index_uint",
        "OES_standard_derivatives", "OES_texture_float", "OES_texture_float_linear",
        "OES_texture_half_float", "OES_texture_half_float_linear",
        "OES_vertex_array_object", "WEBGL_color_buffer_float",
        "WEBGL_compressed_texture_s3tc", "WEBGL_debug_renderer_info",
        "WEBGL_depth_texture", "WEBGL_draw_buffers", "WEBGL_lose_context"
      ];

      exportFunction(function() {
        const real = origGetExtensions.call(this);
        if (!real) return real;
        const filtered = BASELINE_EXTENSIONS.filter(e => real.includes(e));
        return cloneInto(filtered, pageWindow);
      }, pageProto.prototype, { defineAs: "getSupportedExtensions" });
    }

    patchWebGLExtensions("WebGLRenderingContext");
    patchWebGLExtensions("WebGL2RenderingContext");

    // --- readPixels noise ---
    // Like canvas noise, adds tiny seeded perturbation to WebGL framebuffer reads
    function patchWebGLReadPixels(protoName) {
      const pageProto = pageWindow[protoName];
      if (!pageProto) return;
      const origProto = window[protoName];
      if (!origProto) return;

      const origReadPixels = origProto.prototype.readPixels;
      exportFunction(function(x, y, width, height, format, type, pixels) {
        origReadPixels.call(this, x, y, width, height, format, type, pixels);
        if (pixels && pixels.length > 0 && CONFIG.canvasSeed) {
          const rng = mulberry32(CONFIG.canvasSeed);
          for (let i = 0; i < pixels.length; i += 4) {
            if (rng() < 0.1) {
              const ch = (rng() * 3) | 0;
              const delta = rng() < 0.5 ? -1 : 1;
              pixels[i + ch] = Math.max(0, Math.min(255, pixels[i + ch] + delta));
            }
          }
        }
      }, pageProto.prototype, { defineAs: "readPixels" });
    }

    patchWebGLReadPixels("WebGLRenderingContext");
    patchWebGLReadPixels("WebGL2RenderingContext");
  }

  // =========================================================================
  //  GAMEPAD API PROTECTION
  // =========================================================================
  //  navigator.getGamepads() reveals connected game controllers (count, IDs)

  if (vectorEnabled("navigator") && pageWindow.navigator.getGamepads) {
    try {
      exportFunction(function() {
        return cloneInto([null, null, null, null], pageWindow);
      }, pageWindow.Navigator.prototype, { defineAs: "getGamepads" });
    } catch(e) {}
  }

  // =========================================================================
  //  PERFORMANCE TIMING PROTECTION
  // =========================================================================
  //  Reduce performance.now() precision to limit timing-based fingerprinting

  if (vectorEnabled("navigator")) {
    const origPerfNow = window.Performance.prototype.now;
    try {
      exportFunction(function() {
        // Round to 100μs precision (0.1ms) — enough for general use,
        // prevents sub-millisecond timing fingerprints
        const t = origPerfNow.call(this);
        return Math.round(t * 10) / 10;
      }, pageWindow.Performance.prototype, { defineAs: "now" });
    } catch(e) {}
  }

  // =========================================================================
  //  STORAGE ESTIMATE PROTECTION
  // =========================================================================
  //  navigator.storage.estimate() reveals disk usage patterns

  if (vectorEnabled("navigator") && pageWindow.navigator.storage) {
    try {
      const origEstimate = window.StorageManager.prototype.estimate;
      exportFunction(function() {
        // Return a generic estimate that doesn't reveal actual storage
        return new pageWindow.Promise(exportFunction(function(resolve) {
          resolve(cloneInto({
            quota: 2147483648,   // 2GB — common default
            usage: 0
          }, pageWindow));
        }, pageWindow));
      }, pageWindow.StorageManager.prototype, { defineAs: "estimate" });
    } catch(e) {}
  }

})();
