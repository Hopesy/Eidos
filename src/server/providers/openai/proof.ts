import { createHash, randomUUID } from "node:crypto";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "America/New_York",
});

const cores = [8, 16, 24, 32];
const navigatorKeys = [
  "webdriver−false",
  "vendor−Google Inc.",
  "cookieEnabled−true",
  "pdfViewerEnabled−true",
  "hardwareConcurrency−32",
  "language−zh-CN",
  "mimeTypes−[object MimeTypeArray]",
  "userAgentData−[object NavigatorUAData]",
];
const documentKeys = ["location", "_reactListeningo743lnnpvdg"];
const windowKeys = [
  "innerWidth",
  "innerHeight",
  "devicePixelRatio",
  "screen",
  "chrome",
  "location",
  "history",
  "navigator",
];

type CachedBuild = {
  scripts: string[];
  dataBuild: string;
  timestamp: number;
};

const cachedBuild: CachedBuild = {
  scripts: [],
  dataBuild: "",
  timestamp: 0,
};

function formatEasternTime() {
  const parts = Object.fromEntries(timeFormat.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.weekday} ${parts.month} ${parts.day} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} GMT-0500 (Eastern Standard Time)`;
}

export function captureBuildInfoFromHtml(html: string) {
  cachedBuild.scripts = Array.from(html.matchAll(/<script[^>]*src="([^"]+)"/g), (match) => match[1]);
  const buildMatch = html.match(/<html[^>]*data-build="([^"]*)"/i);
  cachedBuild.dataBuild = buildMatch?.[1] || cachedBuild.dataBuild;
  cachedBuild.timestamp = Date.now();
}

function choose<T>(items: T[], fallback: T) {
  return items[Math.floor(Math.random() * items.length)] ?? fallback;
}

export function getPowConfig(userAgent: string) {
  return [
    choose([3000, 4000, 4480], 3000),
    formatEasternTime(),
    4294705152,
    0,
    userAgent,
    choose(cachedBuild.scripts, ""),
    cachedBuild.dataBuild,
    "en-US",
    "en-US,zh-CN;q=0.9",
    0,
    choose(navigatorKeys, navigatorKeys[0]),
    choose(documentKeys, documentKeys[0]),
    choose(windowKeys, windowKeys[0]),
    performance.now(),
    randomUUID(),
    "",
    choose(cores, 16),
    Date.now() - performance.now(),
  ];
}

function generateAnswer(seed: string, difficulty: string, config: unknown[]) {
  const diffLen = difficulty.length;
  const seedBytes = Buffer.from(seed, "utf8");
  const part1 = Buffer.from(`${JSON.stringify(config.slice(0, 3)).slice(0, -1)},`, "utf8");
  const part2 = Buffer.from(`,${JSON.stringify(config.slice(4, 9)).slice(1, -1)},`, "utf8");
  const part3 = Buffer.from(`,${JSON.stringify(config.slice(10)).slice(1)}`, "utf8");
  const target = Buffer.from(difficulty, "hex");

  for (let attempt = 0; attempt < 500000; attempt += 1) {
    const left = Buffer.from(String(attempt), "utf8");
    const right = Buffer.from(String(attempt >> 1), "utf8");
    const payload = Buffer.concat([part1, left, part2, right, part3]).toString("base64");
    const digest = createHash("sha3-512").update(seedBytes).update(payload, "utf8").digest();
    if (Buffer.compare(digest.subarray(0, diffLen), target) <= 0) {
      return { answer: payload, solved: true };
    }
  }

  const fallback = `wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D${Buffer.from(`"${seed}"`, "utf8").toString("base64")}`;
  return { answer: fallback, solved: false };
}

export function getRequirementsToken(config: unknown[]) {
  const { answer } = generateAnswer(String(Math.random()), "0fffff", config);
  return `gAAAAAC${answer}`;
}

export function getProofToken(seed: string, difficulty: string, userAgent: string, config?: unknown[]) {
  const { answer } = generateAnswer(seed, difficulty, config ?? getPowConfig(userAgent));
  return `gAAAAAB${answer}`;
}
