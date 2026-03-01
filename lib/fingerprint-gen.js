// Deterministic fingerprint profile generator
// Given the same seed, always produces the same device identity

// Real hardware values — spoofed values must NEVER match these
const REAL_HARDWARE = {
  hardwareConcurrency: 4,  // 2 cores / 4 threads
  screenWidth: 1920,
  screenHeight: 1080
};

function generateFingerprintProfile(masterSeed) {
  const rng = mulberry32(masterSeed);

  function pick(arr) {
    return arr[Math.floor(rng() * arr.length)];
  }

  // Pick from array, but never the excluded value. Rerolls if needed.
  function pickExcluding(arr, exclude) {
    const filtered = arr.filter(v => {
      if (typeof exclude === "object" && exclude !== null) {
        return Object.keys(exclude).some(k => v[k] !== exclude[k]);
      }
      return v !== exclude;
    });
    return filtered.length > 0 ? pick(filtered) : pick(arr);
  }

  function subSeed() {
    return (rng() * 0xFFFFFFFF) >>> 0;
  }

  const platforms = ["Win32", "Linux x86_64", "MacIntel"];

  const vendors = [
    "Google Inc. (NVIDIA)",
    "Google Inc. (AMD)",
    "Google Inc. (Intel)",
    "Google Inc."
  ];

  const renderers = [
    "ANGLE (NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (Intel HD Graphics 630 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
    "ANGLE (AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)",
    "Mesa Intel(R) UHD Graphics 620",
    "Mesa AMD Radeon RX 580",
    "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)"
  ];

  const resolutions = [
    { width: 2560, height: 1440 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 },
    { width: 2560, height: 1080 },
    { width: 3440, height: 1440 },
    { width: 1600, height: 900 }
  ];

  const languageSets = [
    ["en-US", "en"],
    ["en-GB", "en"],
    ["en-US"],
    ["de-DE", "de", "en-US", "en"],
    ["fr-FR", "fr", "en-US", "en"]
  ];

  // Exclude real hardwareConcurrency (4)
  const hardwareConcurrencies = [2, 6, 8, 12, 16];
  const deviceMemories = [4, 8, 16, 32];
  const colorDepths = [24, 30, 32];

  // Timezones for spoofing — common real-world timezones
  const timezones = [
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

  // Resolution: never match real 1920x1080
  const res = pickExcluding(resolutions, { width: REAL_HARDWARE.screenWidth, height: REAL_HARDWARE.screenHeight });

  return {
    seed: masterSeed,
    canvasSeed: subSeed(),
    audioSeed: subSeed(),
    fontSeed: subSeed(),
    rectSeed: subSeed(),
    nav: {
      hardwareConcurrency: pick(hardwareConcurrencies),
      platform: pick(platforms),
      languages: pick(languageSets),
      deviceMemory: pick(deviceMemories),
      maxTouchPoints: 0
    },
    screen: {
      width: res.width,
      height: res.height,
      colorDepth: pick(colorDepths)
    },
    webgl: {
      vendor: pick(vendors),
      renderer: pick(renderers)
    },
    timezone: pick(timezones),
    webrtc: {
      blockLocal: true
    }
  };
}
