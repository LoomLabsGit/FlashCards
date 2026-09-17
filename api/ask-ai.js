// Server-side proxy for the "Ask AI about this card" feature.
//
// The client never sees the Anthropic API key — it lives only in this
// function's environment (Vercel Project Settings -> Environment Variables
// -> ANTHROPIC_API_KEY). Requests are required to carry a live Supabase
// session token so a random visitor to the deployed URL can't call this
// endpoint and spend the account owner's API credits; only someone signed
// into the app itself can.
const SUPABASE_URL = "https://wfjadtemyzwzwpaehfib.supabase.co";
const SUPABASE_KEY = "sb_publishable_nCGbYoxQyY3Jg5lGkDV9NQ_R8ORvBBP";
const MODEL = "claude-sonnet-5";

async function isAuthed(req) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    const resp = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { Authorization: "Bearer " + token, apikey: SUPABASE_KEY }
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

function buildPrompt(q, e, a, w, instruction) {
  return (
    "Here is a spaced-repetition flashcard:\n\n" +
    "Question: " + q + "\n" +
    (e ? "Explanation: " + e + "\n" : "") +
    "Answer: " + a + "\n" +
    (w ? "Why: " + w + "\n" : "") +
    "\nInstruction: " + instruction + "\n\n" +
    "Apply the instruction to this single card. Keep it a good flashcard: a clear question, a concise answer, and (optionally) a short explanation for the question and/or a short why for the answer. If the instruction doesn't call for changing a field, leave that field as close to the original as makes sense.\n\n" +
    "Return ONLY a JSON object in exactly this shape, with no other text before or after it:\n\n" +
    '{\n  "q": "<question>",\n  "e": "<optional short explanation for the question, empty string if not needed>",\n  "a": "<answer>",\n  "w": "<optional why explanation, empty string if not needed>"\n}'
  );
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const authed = await isAuthed(req);
  if (!authed) {
    res.status(401).json({ ok: false, error: "Not signed in." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const q = String(body.q || "").trim();
  const a = String(body.a || "").trim();
  const e = String(body.e || "").trim();
  const w = String(body.w || "").trim();
  const instruction = String(body.instruction || "").trim();

  if (!q || !a || !instruction) {
    res.status(400).json({ ok: false, error: "Missing card content or instruction." });
    return;
  }
  if (instruction.length > 2000) {
    res.status(400).json({ ok: false, error: "Instruction is too long." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "AI isn't configured on the server yet (missing ANTHROPIC_API_KEY)." });
    return;
  }

  try {
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: buildPrompt(q, e, a, w, instruction) }]
      })
    });

    if (!aiResp.ok) {
      const errBody = await aiResp.text().catch(() => "");
      console.error("Anthropic API error", aiResp.status, errBody);
      let detail = "";
      try {
        const errJson = JSON.parse(errBody);
        detail = (errJson && errJson.error && errJson.error.message) || "";
      } catch (parseErr) {
        detail = errBody.slice(0, 300);
      }
      res.status(502).json({ ok: false, error: "AI request failed (" + aiResp.status + ")" + (detail ? ": " + detail : "") });
      return;
    }

    const aiData = await aiResp.json();
    const textOut =
      aiData && Array.isArray(aiData.content) && aiData.content[0] && aiData.content[0].text
        ? aiData.content[0].text
        : "";

    let parsed;
    try {
      const match = textOut.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : textOut);
    } catch (parseErr) {
      res.status(502).json({ ok: false, error: "AI didn't return valid JSON." });
      return;
    }

    if (!parsed || !parsed.q || !parsed.a) {
      res.status(502).json({ ok: false, error: "AI response was missing a question or answer." });
      return;
    }

    res.status(200).json({
      ok: true,
      card: {
        q: String(parsed.q).trim(),
        e: parsed.e ? String(parsed.e).trim() : "",
        a: String(parsed.a).trim(),
        w: parsed.w ? String(parsed.w).trim() : ""
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Something went wrong calling AI." });
  }
};
