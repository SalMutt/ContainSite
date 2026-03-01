// Deterministic fingerprint profile generator
// Given the same seed, always produces the same device identity
// Profiles are coherent — platform, UA, GPU, resolution all match

// Real hardware values — spoofed values must NEVER match these
const REAL_HARDWARE = {
  hardwareConcurrency: 4,  // 2 cores / 4 threads
  screenWidth: 1920,
  screenHeight: 1080
};

// --- Device Archetypes ---
// Each archetype defines a coherent set of values for a device class

const DEVICE_ARCHETYPES = [
  // Windows desktops
  {
    platform: "Win32",
    uaTemplate: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/{ffVersion}",
    appVersionTemplate: "5.0 (Windows)",
    oscpu: "Windows NT 10.0; Win64; x64",
    vendors: ["Google Inc. (NVIDIA)", "Google Inc. (AMD)", "Google Inc. (Intel)"],
    renderers: [
      "ANGLE (NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)",
      "ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
      "ANGLE (AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)",
      "ANGLE (AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)",
      "ANGLE (Intel HD Graphics 630 Direct3D11 vs_5_0 ps_5_0)"
    ],
    resolutions: [
      { width: 2560, height: 1440 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1680, height: 1050 },
      { width: 2560, height: 1080 },
      { width: 3440, height: 1440 },
      { width: 1600, height: 900 }
    ],
    cores: [4, 6, 8, 12, 16],
    memory: [8, 16, 32]
  },
  // Linux desktops
  {
    platform: "Linux x86_64",
    uaTemplate: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/{ffVersion}",
    appVersionTemplate: "5.0 (X11)",
    oscpu: "Linux x86_64",
    vendors: ["Google Inc. (AMD)", "Google Inc. (Intel)", "Google Inc."],
    renderers: [
      "Mesa Intel(R) UHD Graphics 620",
      "Mesa AMD Radeon RX 580",
      "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)",
      "Mesa Intel(R) HD Graphics 530",
      "AMD Radeon RX 6600 (radeonsi, navi23, LLVM 15.0.7, DRM 3.49)"
    ],
    resolutions: [
      { width: 2560, height: 1440 },
      { width: 1366, height: 768 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 3440, height: 1440 },
      { width: 1600, height: 900 }
    ],
    cores: [2, 6, 8, 12, 16],
    memory: [4, 8, 16, 32]
  },
  // macOS desktops
  {
    platform: "MacIntel",
    uaTemplate: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/{ffVersion}",
    appVersionTemplate: "5.0 (Macintosh)",
    oscpu: "Intel Mac OS X 10.15",
    vendors: ["Google Inc. (Apple)", "Google Inc. (Intel)", "Google Inc."],
    renderers: [
      "ANGLE (Apple, Apple M1, OpenGL 4.1)",
      "ANGLE (Apple, Apple M2, OpenGL 4.1)",
      "ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)",
      "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, OpenGL 4.1)"
    ],
    resolutions: [
      { width: 2560, height: 1440 },
      { width: 1440, height: 900 },
      { width: 1680, height: 1050 },
      { width: 2560, height: 1600 },
      { width: 3024, height: 1964 }
    ],
    cores: [4, 8, 10, 12],
    memory: [8, 16, 32]
  }
];

const FIREFOX_VERSIONS = ["126.0", "127.0", "128.0", "129.0", "130.0", "131.0", "132.0", "133.0", "134.0"];

const LANGUAGE_SETS = [
  ["en-US", "en"],
  ["en-GB", "en"],
  ["en-US"],
  ["de-DE", "de", "en-US", "en"],
  ["fr-FR", "fr", "en-US", "en"]
];

const COLOR_DEPTHS = [24, 30, 32];

const TIMEZONES = [
  { name: "America/New_York", offset: 300 },
  { name: "America/Chicago", offset: 360 },
  { name: "America/Denver", offset: 420 },
  { name: "America/Los_Angeles", offset: 480 },
  { name: "Europe/London", offset: 0 },
  { name: "Europe/Berlin", offset: -60 },
  { name: "Europe/Paris", offset: -60 },
  { name: "Asia/Tokyo", offset: -540 },
  { name: "Australia/Sydney", offset: -660 },
  { name: "America/Toronto", offset: 300 },
  { name: "America/Phoenix", offset: 420 }
];

function generateFingerprintProfile(masterSeed) {
  const rng = mulberry32(masterSeed);

  function pick(arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function pickExcluding(arr, excludeFn) {
    const filtered = arr.filter(excludeFn);
    return filtered.length > 0 ? pick(filtered) : pick(arr);
  }

  function subSeed() {
    return (rng() * 0xFFFFFFFF) >>> 0;
  }

  // Pick a device archetype
  const arch = pick(DEVICE_ARCHETYPES);

  // Pick coherent values from within the archetype
  const res = pickExcluding(arch.resolutions, r =>
    r.width !== REAL_HARDWARE.screenWidth || r.height !== REAL_HARDWARE.screenHeight
  );

  const cores = pickExcluding(arch.cores, c => c !== REAL_HARDWARE.hardwareConcurrency);

  const ffVersion = pick(FIREFOX_VERSIONS);
  const userAgent = arch.uaTemplate.replace("{ffVersion}", ffVersion);
  const appVersion = arch.appVersionTemplate;

  return {
    seed: masterSeed,
    canvasSeed: subSeed(),
    audioSeed: subSeed(),
    fontSeed: subSeed(),
    rectSeed: subSeed(),
    nav: {
      hardwareConcurrency: cores,
      platform: arch.platform,
      languages: pick(LANGUAGE_SETS),
      deviceMemory: pick(arch.memory),
      maxTouchPoints: 0,
      userAgent: userAgent,
      appVersion: appVersion,
      oscpu: arch.oscpu
    },
    screen: {
      width: res.width,
      height: res.height,
      colorDepth: pick(COLOR_DEPTHS)
    },
    webgl: {
      vendor: pick(arch.vendors),
      renderer: pick(arch.renderers)
    },
    timezone: pick(TIMEZONES),
    webrtc: {
      blockLocal: true
    }
  };
}
