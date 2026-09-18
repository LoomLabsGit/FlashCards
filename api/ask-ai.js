// Server-side proxy for the app's AI features:
//   mode "card"    (default) — fact-check / reword / improve ONE flashcard
//   mode "context"           — write the short subject-matter note saved with
//                              a pack, given back to the AI on every card ask
//
// The client never sees the Gemini API key — it lives only in this
// function's environment (Vercel Project Settings -> Environment Variables
// -> GEMINI_API_KEY). Requests are required to carry a live Supabase
// session token so a random visitor to the deployed URL can't call this
// endpoint and spend the account owner's API credits; only someone signed
// into the app itself can.
const SUPABASE_URL = "https://wfjadtemyzwzwpaehfib.supabase.co";
const SUPABASE_KEY = "sb_publishable_nCGbYoxQyY3Jg5lGkDV9NQ_R8ORvBBP";
const MODEL = "gemini-3.5-flash";

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

function clip(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// What each flashcard field is for. Shared by the prompt and the response
// schema so the model can't mistake the optional "Explanation" (context for
// the QUESTION, shown on the front) for the "Why" (reasoning behind the
// ANSWER, shown on the back) — swapping those two was the recurring mistake.
const FIELD_GUIDE =
  "Every flashcard has exactly four fields, and each has one job:\n" +
  "- q (Question) — FRONT of the card. A clear, specific prompt the learner answers from memory.\n" +
  "- e (Explanation, optional) — FRONT of the card, shown directly under the question. Extra context or a hint about the QUESTION itself: a scenario, a definition of a term used in the question, or what kind of answer is expected. It is NOT the reasoning for the answer. Usually empty; only fill it when the question genuinely can't stand alone.\n" +
  "- a (Answer) — BACK of the card. The concise, correct answer the learner should recall.\n" +
  "- w (Why, optional) — BACK of the card, shown under the answer after it's revealed. The reasoning, rationale or context that explains WHY the answer is correct and helps it stick. Any explanation of the answer belongs here, never in e.";

const FIELD_DESCRIPTIONS = {
  q: "Question. Front of the card: a clear, specific prompt answered from memory.",
  e: "Explanation. Front of the card, under the question: context or a hint about the QUESTION (scenario, term definition, expected answer type). NOT the reasoning for the answer. Empty string if the question needs none.",
  a: "Answer. Back of the card: the concise, correct answer.",
  w: "Why. Back of the card, under the answer: the reasoning/rationale for why the answer is correct. Empty string if none.",
  summary: "1-3 friendly sentences addressed to the user saying what you changed and why, or plainly that nothing needed changing."
};

function buildCardPrompt(body) {
  const q = clip(body.q, 4000);
  const e = clip(body.e, 4000);
  const a = clip(body.a, 4000);
  const w = clip(body.w, 4000);
  const instruction = clip(body.instruction, 2000);
  const context = clip(body.context, 1500);
  const packName = clip(body.packName, 200);
  const section = clip(body.section, 200);

  return (
    "You are helping a learner edit ONE spaced-repetition flashcard in their personal flashcard app.\n\n" +
    FIELD_GUIDE + "\n\n" +
    (context
      ? "About this flashcard pack (written by its owner — use it to interpret terminology and judge accuracy):\n" + context + "\n\n"
      : "") +
    (packName ? "Pack: " + packName + "\n" : "") +
    (section ? "Section: " + section + "\n" : "") +
    (packName || section ? "\n" : "") +
    "The card as it currently stands:\n" +
    "q (Question): " + q + "\n" +
    "e (Explanation): " + (e || "(empty)") + "\n" +
    "a (Answer): " + a + "\n" +
    "w (Why): " + (w || "(empty)") + "\n\n" +
    "The learner's instruction: " + instruction + "\n\n" +
    "Apply the instruction to this single card and return all four fields. Leave any field the instruction doesn't touch exactly as it is now. The one exception: if a field clearly holds content that belongs in a different field per the field guide (for example, reasoning for the answer sitting in e), move it to the right field and say so in the summary.\n\n" +
    "Also write the short summary described in the schema. If a fact-check found nothing wrong, or the card didn't need the requested change, say so plainly instead of inventing a change."
  );
}

function buildContextPrompt(body) {
  const name = clip(body.name, 200);
  const tagline = clip(body.tagline, 500);
  const hint = clip(body.hint, 500);
  const sections = (Array.isArray(body.sections) ? body.sections : [])
    .slice(0, 30).map(s => clip(s, 100)).filter(Boolean);
  const samples = (Array.isArray(body.samples) ? body.samples : [])
    .slice(0, 20)
    .map(s => ({ q: clip(s && s.q, 300), a: clip(s && s.a, 300) }))
    .filter(s => s.q && s.a);

  return (
    "Write a short context note for a flashcard pack. The note is saved with the pack and handed to an AI assistant every time the pack's owner asks it to fact-check, reword or improve a single card, so the assistant already knows what the pack is about and the owner never has to explain it again.\n\n" +
    "Pack name: " + (name || "(untitled)") + "\n" +
    (tagline ? "Tagline: " + tagline + "\n" : "") +
    (hint ? "The owner's own description of the topic: " + hint + "\n" : "") +
    (sections.length ? "Sections: " + sections.join("; ") + "\n" : "") +
    (samples.length
      ? "\nSample cards:\n" + samples.map(s => "- Q: " + s.q + " | A: " + s.a).join("\n") + "\n"
      : "") +
    "\nRules:\n" +
    "- 1 to 3 sentences, at most about 60 words. Plain text: no markdown, lists, quotes or headings.\n" +
    "- State the subject and domain. Include the audience/level, the source framework or language pair, and any convention that affects how cards should be worded or judged (for example \"English to Polish vocabulary\", \"UK spelling\", \"answers kept to one line\") — but only where the name, sections or cards actually show it.\n" +
    "- Only say what the material supports. Do not invent specifics, and do not describe the app or the flashcard format."
  );
}

async function callGemini(apiKey, promptText, schema) {
  const aiResp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL + ":generateContent",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      })
    }
  );

  if (!aiResp.ok) {
    const errBody = await aiResp.text().catch(() => "");
    console.error("Gemini API error", aiResp.status, errBody);
    let detail = "";
    try {
      const errJson = JSON.parse(errBody);
      detail = (errJson && errJson.error && errJson.error.message) || "";
    } catch (parseErr) {
      detail = errBody.slice(0, 300);
    }
    const err = new Error("AI request failed (" + aiResp.status + ")" + (detail ? ": " + detail : ""));
    err.status = 502;
    throw err;
  }

  const aiData = await aiResp.json();
  const candidate = aiData && Array.isArray(aiData.candidates) ? aiData.candidates[0] : null;
  const textOut =
    candidate && candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts[0]
      ? candidate.content.parts[0].text || ""
      : "";

  try {
    const match = textOut.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : textOut);
  } catch (parseErr) {
    console.error("Gemini returned non-JSON text", textOut);
    const err = new Error("AI didn't return valid JSON.");
    err.status = 502;
    throw err;
  }
}

const CARD_SCHEMA = {
  type: "OBJECT",
  properties: {
    q: { type: "STRING", description: FIELD_DESCRIPTIONS.q },
    e: { type: "STRING", description: FIELD_DESCRIPTIONS.e },
    a: { type: "STRING", description: FIELD_DESCRIPTIONS.a },
    w: { type: "STRING", description: FIELD_DESCRIPTIONS.w },
    summary: { type: "STRING", description: FIELD_DESCRIPTIONS.summary }
  },
  required: ["q", "e", "a", "w", "summary"]
};

const CONTEXT_SCHEMA = {
  type: "OBJECT",
  properties: {
    context: {
      type: "STRING",
      description: "The 1-3 sentence plain-text context note for the pack (about 60 words at most)."
    }
  },
  required: ["context"]
};

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

  const mode = body.mode === "context" ? "context" : "card";

  if (mode === "card") {
    const q = String(body.q || "").trim();
    const a = String(body.a || "").trim();
    const instruction = String(body.instruction || "").trim();
    if (!q || !a || !instruction) {
      res.status(400).json({ ok: false, error: "Missing card content or instruction." });
      return;
    }
    if (instruction.length > 2000) {
      res.status(400).json({ ok: false, error: "Instruction is too long." });
      return;
    }
  } else if (!String(body.name || "").trim() && !(Array.isArray(body.samples) && body.samples.length)) {
    res.status(400).json({ ok: false, error: "Missing pack name or sample cards." });
    return;
  }

  // Accept a couple of common env var names so a naming mismatch in Vercel
  // doesn't produce a confusing "not configured" error.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "AI isn't configured on the server yet (missing GEMINI_API_KEY)." });
    return;
  }

  try {
    if (mode === "context") {
      const parsed = await callGemini(apiKey, buildContextPrompt(body), CONTEXT_SCHEMA);
      const context = clip(parsed && parsed.context, 1000);
      if (!context) {
        res.status(502).json({ ok: false, error: "AI response was missing the context note." });
        return;
      }
      res.status(200).json({ ok: true, context });
      return;
    }

    const parsed = await callGemini(apiKey, buildCardPrompt(body), CARD_SCHEMA);
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
        w: parsed.w ? String(parsed.w).trim() : "",
        summary: parsed.summary ? String(parsed.summary).trim() : ""
      }
    });
  } catch (err) {
    if (err && err.status) {
      res.status(err.status).json({ ok: false, error: err.message });
      return;
    }
    console.error("Unexpected error calling Gemini", err);
    res.status(500).json({ ok: false, error: "Something went wrong calling AI." });
  }
};
