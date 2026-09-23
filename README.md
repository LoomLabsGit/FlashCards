# Lean UX Flashcards

A spaced-repetition (SM-2) flashcard app for studying Lean UX concepts, built as a single self-contained HTML file.

- **Source:** [`index.html`](./index.html)
- **Hosting:** Vercel (deploys automatically from this repo's `main` branch)
- **Data:** Supabase (Postgres + email magic-link auth) — progress is synced per signed-in user across every device, not stored per-browser

This repo is the single source of truth for the app's code. Every change is committed and pushed here.

## Ready-made packs and picture cards

- `packs/*.json` are complete decks that the app's **Add a new Flashcard Pack → Ready-made packs** screen can add in one tap (currently `world-flags.json`: all 195 countries, grouped by continent).
- A card can carry a picture: `"i": "fr"` is an image code, resolved against the pack's `"imageBase"` template (e.g. `https://flagcdn.com/w640/{code}.webp`), or a full `https://` address. Only the reference is stored, never image data. Flag images come from [flagcdn.com](https://flagcdn.com) (built from Wikimedia Commons; the site asks for a link back to [flagpedia.net](https://flagpedia.net)).
- `"hideSections": true` in a pack's JSON hides the section name on the front of cards while studying (togglable with the eye button on the Study tab), for packs where it would give the answer away.

