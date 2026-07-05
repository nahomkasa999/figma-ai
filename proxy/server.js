import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const env = readFileSync(join(__dirname, ".env"), "utf8");
  for (const line of env.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {}

const PROVIDERS = ["gemini", "nvidia"];

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*", methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "5mb" }));

app.options("/api/llm", (_, res) => res.sendStatus(204));

async function callGemini(system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const body = {
    contents: [{ role: "user", parts: [{ text: user }] }],
  };
  if (system) body.system_instruction = { parts: [{ text: system }] };

  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error(`Gemini returned empty. Raw: ${JSON.stringify(data).slice(0, 300)}`);
  return content;
}

async function callNvidia(system, user) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY not set");

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  const resp = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "z-ai/glm-5.2",
      messages,
      temperature: 1,
      top_p: 1,
      max_tokens: 16384,
      seed: 42,
      stream: false,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`NVIDIA API error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`NVIDIA returned empty. Raw: ${JSON.stringify(data).slice(0, 300)}`);
  return content;
}

const providerFns = {
  gemini: callGemini,
  nvidia: callNvidia,
};

const providerNames = {
  gemini: "gemini-flash-latest",
  nvidia: "z-ai/glm-5.2",
};

app.post("/api/llm", async (req, res) => {
  const { system, user, provider: rawProvider } = req.body || {};
  if (!system || !user) {
    return res.status(400).json({ error: "Missing 'system' or 'user' in request body." });
  }

  const provider = rawProvider === "auto" ? "auto"
    : PROVIDERS.includes(rawProvider) ? rawProvider
    : "gemini";

  try {
    let content;
    let used;

    if (provider === "auto") {
      const order = ["gemini", "nvidia"];
      let lastErr = null;
      for (const p of order) {
        if (!process.env[`${p.toUpperCase()}_API_KEY`]) continue;
        try {
          content = await providerFns[p](system, user);
          used = p;
          return res.json({ content, provider: used, model: providerNames[used] });
        } catch (e) {
          lastErr = e;
          console.error(`Auto-fallback: ${p} failed, trying next:`, e.message);
        }
      }
      return res.status(502).json({ error: `All providers failed. Last: ${lastErr?.message}` });
    }

    content = await providerFns[provider](system, user);
    used = provider;
    res.json({ content, provider: used, model: providerNames[used] });
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    providers: PROVIDERS.map(p => ({
      name: p,
      model: providerNames[p],
      configured: !!process.env[`${p.toUpperCase()}_API_KEY`],
    })),
  });
});

app.listen(PORT, () => {
  console.log(`Cursor for Design proxy running on http://localhost:${PORT}`);
  for (const p of PROVIDERS) {
    const key = process.env[`${p.toUpperCase()}_API_KEY`];
    console.log(`  ${p} (${providerNames[p]}): ${key ? "configured" : "NOT CONFIGURED"}`);
  }
});
