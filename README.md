# SquadUp — Random Gamer Chat (MVP)

A guest-only random video/voice/text chat, so gamers can find teammates without needing an account.

## What's included
- Guest username entry (no login/signup)
- Random matching between two waiting users
- Video chat (WebRTC, peer-to-peer)
- Camera toggle (turns it into voice-only chat)
- Mic toggle
- Text chat alongside the call
- "Next" button to skip and find a new match

## How to run it locally

1. Install Node.js (v18+) if you don't have it: https://nodejs.org

2. Open a terminal in this folder and install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open your browser to:
   ```
   http://localhost:3000
   ```

5. To actually test the "random matching" with 2 people, open a second browser tab (or a private/incognito window) to the same address — that second tab acts as your "partner."

## Putting it online for others to use

Right now it only runs on your computer. To let other people actually use it from the internet, you'll want to deploy it somewhere. Good free/cheap options to start:
- **Render.com** or **Railway.app** — free tiers, just connect your project and it's live
- **Fly.io** — free tier, a bit more setup

One important note: WebRTC video sometimes fails to connect directly between two people if they're on strict networks (some routers/firewalls block it). For a small MVP this is fine — most home connections work fine with just the STUN servers already in the code. If you notice a lot of failed connections once you have real users, that's when you'd add a "TURN" server (a relay) — let me know when you get there and I'll help you add one.

## What's next (once this MVP is working)
- Guest names are temporary (reset each visit) — add real accounts/login later
- Add a "looking for: GTA Online / Minecraft / etc." tag so people match by game
- Add profile pages
- Add reporting/blocking for safety

## Files
- `server.js` — the backend: matches random users and relays video/chat signals
- `public/index.html` — the page structure
- `public/style.css` — the look and feel
- `public/client.js` — the browser-side logic (camera, mic, chat, WebRTC)
