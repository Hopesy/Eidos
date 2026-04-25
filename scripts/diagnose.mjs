/**
 * 诊断脚本：检测 data/accounts.json 中的 token 能否访问 chatgpt.com
 * 运行：node scripts/diagnose.mjs
 */

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const BASE_URL = "https://chatgpt.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 20000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testConnectivity() {
  console.log("\n[1] 测试基础连通性：fetch https://chatgpt.com");
  try {
    const res = await fetchWithTimeout(BASE_URL, {
      method: "GET",
      headers: { "user-agent": USER_AGENT },
      timeoutMs: 15000,
    });
    console.log(`    ✓ 连通成功，HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error(`    ✗ 连通失败：${err.message}`);
    return false;
  }
}

async function testAccountRefresh(accessToken, label) {
  const deviceId = randomUUID();
  console.log(`\n[2] 刷新账号信息：${label}`);

  // 1) /backend-api/me
  try {
    const meRes = await fetchWithTimeout(`${BASE_URL}/backend-api/me`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
        "user-agent": USER_AGENT,
        accept: "*/*",
        "content-type": "application/json",
        "oai-language": "zh-CN",
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      timeoutMs: 20000,
    });
    const meText = await meRes.text();
    if (meRes.ok) {
      const meJson = JSON.parse(meText);
      console.log(`    ✓ /backend-api/me 成功 HTTP ${meRes.status}`);
      console.log(`      email: ${meJson.email ?? "(无)"}`);
      console.log(`      name: ${meJson.name ?? "(无)"}`);
    } else {
      console.error(`    ✗ /backend-api/me 失败 HTTP ${meRes.status}: ${meText.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`    ✗ /backend-api/me 异常：${err.message}`);
  }

  // 2) /backend-api/conversation/init
  try {
    const initRes = await fetchWithTimeout(`${BASE_URL}/backend-api/conversation/init`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
        "user-agent": USER_AGENT,
        accept: "*/*",
        "content-type": "application/json",
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: JSON.stringify({
        gizmo_id: null,
        requested_default_model: null,
        conversation_id: null,
        timezone_offset_min: -480,
      }),
      timeoutMs: 20000,
    });
    const initText = await initRes.text();
    if (initRes.ok) {
      const initJson = JSON.parse(initText);
      // 查找 image 相关 limits
      const limitsStr = JSON.stringify(initJson).toLowerCase();
      const hasImageLimit = limitsStr.includes("image") || limitsStr.includes("gpt_4_i");
      console.log(`    ✓ /backend-api/conversation/init 成功 HTTP ${initRes.status}`);
      console.log(`      包含图片配额信息：${hasImageLimit ? "是" : "否"}`);
      // 尝试提取 limits
      const limits = initJson?.limits_progress ?? initJson?.features?.limits_progress ?? [];
      if (Array.isArray(limits) && limits.length > 0) {
        console.log(`      limits_progress 条目数：${limits.length}`);
        limits.forEach((item) => {
          const key = item?.limit?.limit_key ?? item?.limit_key ?? JSON.stringify(item).slice(0, 80);
          const remaining = item?.remaining_calls ?? item?.remaining ?? "(n/a)";
          const total = item?.total_calls ?? item?.total ?? "(n/a)";
          console.log(`        - ${key}: remaining=${remaining} / total=${total}`);
        });
      } else {
        console.log(`      limits_progress 为空或不存在`);
        // 打印 init 响应前 500 字符用于调试
        console.log(`      init 响应摘要: ${initText.slice(0, 500)}`);
      }
    } else {
      console.error(`    ✗ /backend-api/conversation/init 失败 HTTP ${initRes.status}: ${initText.slice(0, 200)}`);
    }
  } catch (err) {
    console.error(`    ✗ /backend-api/conversation/init 异常：${err.message}`);
  }
}

async function testImageGeneration(accessToken, label) {
  console.log(`\n[3] 测试图片生成（仅发送请求，不等待全部 SSE，10s 超时）：${label}`);
  const deviceId = randomUUID();

  // 先获取 requirements token
  let requirementsToken = "";
  try {
    const reqRes = await fetchWithTimeout(`${BASE_URL}/backend-api/sentinel/chat-requirements`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
        "user-agent": USER_AGENT,
        accept: "*/*",
        "content-type": "application/json",
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: JSON.stringify({ p: null }),
      timeoutMs: 10000,
    });
    if (reqRes.ok) {
      const reqJson = await reqRes.json();
      requirementsToken = reqJson.token ?? "";
      console.log(`    ✓ chat-requirements 成功, token 长度: ${requirementsToken.length}`);
    } else {
      const txt = await reqRes.text();
      console.error(`    ✗ chat-requirements 失败 HTTP ${reqRes.status}: ${txt.slice(0, 200)}`);
      return;
    }
  } catch (err) {
    console.error(`    ✗ chat-requirements 异常：${err.message}`);
    return;
  }

  // 发送 /backend-api/conversation，只看 HTTP 状态
  try {
    const conversationId = randomUUID();
    const body = {
      action: "next",
      messages: [
        {
          id: randomUUID(),
          author: { role: "user" },
          content: {
            content_type: "text",
            parts: ["a small red apple on white background"],
          },
        },
      ],
      model: "auto",
      parent_message_id: randomUUID(),
      timezone: "Asia/Shanghai",
      timezone_offset_min: -480,
      conversation_mode: {
        gizmo_id: null,
        kind: "primary_assistant",
      },
      enable_message_followups: false,
      enable_citations: false,
      reset_rate_limits: false,
      system_hints: ["image_gen"],
      force_paragen_v2: false,
    };

    const convRes = await fetchWithTimeout(`${BASE_URL}/backend-api/conversation`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "oai-device-id": deviceId,
        "openai-sentinel-chat-requirements-token": requirementsToken,
        "user-agent": USER_AGENT,
        accept: "text/event-stream",
        "content-type": "application/json",
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
      },
      body: JSON.stringify(body),
      timeoutMs: 10000,
    });

    if (convRes.ok) {
      console.log(`    ✓ /backend-api/conversation 已返回 HTTP ${convRes.status} (SSE 流开始)`);
      // 读前 2000 字节
      const reader = convRes.body.getReader();
      let buffer = "";
      let done = false;
      while (!done && buffer.length < 2000) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) buffer += new TextDecoder().decode(value);
      }
      reader.cancel();
      console.log(`    SSE 数据摘要（前 500 字符）：\n${buffer.slice(0, 500)}`);
    } else {
      const txt = await convRes.text();
      console.error(`    ✗ /backend-api/conversation 失败 HTTP ${convRes.status}: ${txt.slice(0, 300)}`);
    }
  } catch (err) {
    console.error(`    ✗ /backend-api/conversation 异常：${err.message}`);
  }
}

async function main() {
  console.log("=== Eidos 账号诊断脚本 ===\n");

  // 读取 accounts.json
  let accounts;
  try {
    const raw = await readFile("data/accounts.json", "utf-8");
    accounts = JSON.parse(raw);
    console.log(`账号数量：${accounts.length}`);
    accounts.forEach((a, i) => {
      const prefix = (a.access_token ?? "").slice(0, 20);
      console.log(`  [${i}] ${prefix}... | status=${a.status} type=${a.type} quota=${a.quota} email=${a.email ?? "(无)"}`);
    });
  } catch (err) {
    console.error("读取 data/accounts.json 失败：", err.message);
    process.exit(1);
  }

  // 测试连通性
  const online = await testConnectivity();
  if (!online) {
    console.log("\n⚠ 无法访问 chatgpt.com，所有后续测试会失败。请检查网络或代理。");
  }

  // 对每个 token 分别测试
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const label = `账号[${i}] ${(a.access_token ?? "").slice(0, 20)}...`;
    await testAccountRefresh(a.access_token, label);
    // 仅对第一个 token 做图片生成测试（避免消耗所有配额）
    if (i === 0) {
      await testImageGeneration(a.access_token, label);
    }
  }

  console.log("\n=== 诊断完成 ===");
}

main().catch((err) => {
  console.error("未捕获错误：", err);
  process.exit(1);
});
