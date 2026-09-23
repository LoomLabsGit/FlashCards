# Retainiac

A spaced-repetition (SM-2) flashcard app for learning anything (ships with Lean UX and World Flags packs), built as a single self-contained HTML file.

- **Source:** [`index.html`](./index.html)
- **Hosting:** Vercel (deploys automatically from this repo's `main` branch)
- **Data:** Supabase (Postgres + email/password auth) — progress is synced per signed-in user across every device, not stored per-browser

This repo is the single source of truth for the app's code. Every change is committed and pushed here.

## Ready-made packs and picture cards

- **Lean UX Drills** is bundled in the app. Existing accounts keep it as before; brand-new accounts start with an empty home and add it from Ready-made packs (tracked by `state.hiddenBuiltins`, so adding it never resets progress).
- `packs/*.json` are complete decks that the app's **Add a new Flashcard Pack → Ready-made packs** screen can add in one tap (currently `world-flags.json`: all 195 countries, grouped by continent).
- A card can carry a picture: `"i": "fr"` is an image code, resolved against the pack's `"imageBase"` template (e.g. `https://flagcdn.com/w640/{code}.webp`), or a full `https://` address. Only the reference is stored, never image data. Flag images come from [flagcdn.com](https://flagcdn.com) (built from Wikimedia Commons; the site asks for a link back to [flagpedia.net](https://flagpedia.net)).
- `"hideSections": true` in a pack's JSON hides the section name on the front of cards while studying (togglable with the eye button on the Study tab), for packs where it would give the answer away.

## Sign-ups

The sign-in screen has a **Create an account** option. Whether it works is controlled in Supabase (Authentication → Sign In / Providers → *Allow new users to sign up*): when off, the app shows "Sign-ups are closed right now." If *Confirm email* is on, new users are told to confirm by email before signing in. A different account signing in on a browser resets that browser's local copy, so accounts never inherit each other's progress.
