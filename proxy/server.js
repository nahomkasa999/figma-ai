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

const PROVIDERS = ["gemini", "openrouter", "nvidia"];

const app = express();
const PORT = process.env.PORT || 3000;

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
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const textPart = parts.find((p) => p.text && !p.thought) || parts.find((p) => p.text) || parts[0];
  const content = textPart?.text;
  if (!content) throw new Error(`Gemini returned empty. Raw: ${JSON.stringify(data).slice(0, 300)}`);
  return content;
}

async function callOpenRouter(system, user, requestedModel) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const fallbackFreeModels = [
    requestedModel || process.env.OPENROUTER_MODEL || "openrouter/free",
    "openrouter/free",
    "z-ai/glm-5.2:free",
    "qwen/qwen3.8-27b:free",
    "google/gemma-4-31b-it:free",
  ];
  // Deduplicate
  const modelsToTry = Array.from(new Set(fallbackFreeModels.filter(Boolean)));

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });

  let lastErr = null;
  for (const model of modelsToTry) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "BeMe Figma Plugin",
        },
        body: JSON.stringify({
          model,
          messages,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`OpenRouter (${model}) status ${resp.status}: ${errText}`);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`OpenRouter (${model}) returned empty output.`);
      return { content, model };
    } catch (err) {
      lastErr = err;
      console.warn(`OpenRouter model ${model} failed, checking next free fallback...`, err.message);
    }
  }

  throw new Error(`All OpenRouter free models failed: ${lastErr?.message}`);
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
  gemini: async (system, user) => {
    const content = await callGemini(system, user);
    return { content, model: "gemini-flash-latest" };
  },
  openrouter: async (system, user) => {
    return await callOpenRouter(system, user);
  },
  nvidia: async (system, user) => {
    const content = await callNvidia(system, user);
    return { content, model: "z-ai/glm-5.2" };
  },
};

const providerNames = {
  gemini: "gemini-flash-latest",
  openrouter: process.env.OPENROUTER_MODEL || "openrouter/free",
  nvidia: "z-ai/glm-5.2",
};

app.post("/api/llm", async (req, res) => {
  const { system, user, provider: rawProvider } = req.body || {};
  if (!system || !user) {
    return res.status(400).json({ error: "Missing 'system' or 'user' in request body." });
  }

  const provider = rawProvider === "auto" ? "auto"
    : PROVIDERS.includes(rawProvider) ? rawProvider
    : "auto";

  try {
    // Both-way Auto fallback: Gemini <-> OpenRouter (and NVIDIA if configured)
    if (provider === "auto") {
      const order = ["gemini", "openrouter", "nvidia"];
      let lastErr = null;
      for (const p of order) {
        if (!process.env[`${p.toUpperCase()}_API_KEY`]) continue;
        try {
          const result = await providerFns[p](system, user);
          return res.json({
            content: result.content,
            provider: p,
            model: result.model || providerNames[p],
          });
        } catch (e) {
          lastErr = e;
          console.error(`Auto-fallback: ${p} failed, attempting next provider:`, e.message);
        }
      }
      return res.status(502).json({ error: `All providers failed. Last error: ${lastErr?.message}` });
    }

    // Direct provider selected: call it, with two-way fallback to the other major provider on error
    try {
      const result = await providerFns[provider](system, user);
      res.json({
        content: result.content,
        provider,
        model: result.model || providerNames[provider],
      });
    } catch (directErr) {
      console.warn(`Provider ${provider} failed (${directErr.message}). Initiating two-way fallback...`);
      const fallbackProvider = provider === "gemini" ? "openrouter" : "gemini";
      if (process.env[`${fallbackProvider.toUpperCase()}_API_KEY`]) {
        try {
          const fallbackResult = await providerFns[fallbackProvider](system, user);
          return res.json({
            content: fallbackResult.content,
            provider: fallbackProvider,
            model: fallbackResult.model || providerNames[fallbackProvider],
            fallbackFrom: provider,
          });
        } catch (fallbackErr) {
          console.error(`Two-way fallback to ${fallbackProvider} also failed:`, fallbackErr.message);
        }
      }
      throw directErr;
    }
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    providers: PROVIDERS.map((p) => ({
      name: p,
      model: providerNames[p],
      configured: !!process.env[`${p.toUpperCase()}_API_KEY`],
    })),
  });
});

app.listen(PORT, () => {
  console.log(`BeMe LLM Proxy running on http://localhost:${PORT}`);
  for (const p of PROVIDERS) {
    const key = process.env[`${p.toUpperCase()}_API_KEY`];
    console.log(`  ${p} (${providerNames[p]}): ${key ? "configured" : "NOT CONFIGURED"}`);
  }
});
