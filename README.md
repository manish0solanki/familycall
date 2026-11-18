# FamilyCall

Free video calls for families. Start a call, share the link or QR code, and talk face to face. No sign-up needed.

**Status: Phases 1–3: accounts, family contacts and tap-to-call, plus video effects.** See [Roadmap](#roadmap).

## Features

**Accounts and calling family**
- Username + password accounts. Usernames are easy to say: first 2 letters of your first name + last name (Manish Solanki → `masolanki`), with alternatives if taken
- Save family by username, by scanning their "My QR code", or by opening their `/add/<username>` link
- See who's online, tap a name to ring them: full-screen incoming call with ringtone and vibration, Accept / Decline
- Calls ring even when the app is closed (Web Push; on iPhone after "Add to Home Screen")
- Declined / no answer / missed call handling, recent calls list, call back
- Installable as an app (manifest + service worker)
- Forgotten passwords: each account gets a recovery code (`XXXX-XXXX-XXXX-XXXX`) at sign-up; "Forgot password?" sets a new password with it. Codes work once (a new one is issued), are stored only as a salted PBKDF2 hash, and 5 wrong tries lock the account for 15 minutes. Change password and make a new code under Settings
- Ringtones: Marimba, Morning chimes, Harp, Classic phone (original melodies synthesised with Web Audio; chosen in Settings)

**Calling by link (no account needed)**

- Start a call and get a room link + QR code to share
- Join by tapping the link, typing the room code, or scanning the QR code with the in-app scanner (camera, or upload a photo of the code)
- Camera preview before joining, with mic/camera toggles
- 1-to-1 video and voice calls, peer-to-peer and encrypted (WebRTC)
- In-call controls: mute, camera on/off, switch front/back camera, hang up
- Handles the other person hanging up, closing the tab or losing connection, and rejoining
- Video effects, all processed on the device (the camera picture never leaves the phone except in the call):
  - Background blur (slight or strong) and replacement with six built-in scenes or your own photo
  - Beautify with face tracking: smooths and brightens skin only, keeping eyes, eyebrows, lips and nose sharp (three levels)
  - Colour filters: Warm, Cool, Vivid, B&W, Vintage, Soft glow
- Phone and desktop layouts. Phones held upright send tall (9:16) video so it fills the other phone's screen; if shapes don't match (e.g. a computer's wide picture on a phone), the whole picture is shown instead of a zoomed-in crop. Tap the video (or the Fit/Fill button) to switch between fit and fill. "Normal view / Wide angle" switches your camera to its full 4:3 sensor picture and its widest zoom (0.6× on phones whose browser exposes an ultra-wide lens), so more of the room fits; nothing is cropped

## How it works

```
 Phone A ──"I'm here" / offer / answer / network info──► Supabase Realtime ──► Phone B
    │                                                   (tiny broadcast channel,
    │                                                    no database needed)
    └──────────── video + audio flow directly, encrypted ────────────► Phone B
                  (via a TURN relay only when a firewall blocks a direct path)
```

| Piece | What | File |
| --- | --- | --- |
| Call engine | `RTCPeerConnection` setup, offer/answer, ICE, reconnects | `src/lib/peerCall.ts` |
| Signaling | Supabase Realtime broadcast; falls back to `BroadcastChannel` (same browser only) when Supabase isn't configured | `src/lib/signaling.ts` |
| STUN / TURN | Google public STUN; optional TURN from env | `src/lib/iceServers.ts` |
| Camera + mic | `getUserMedia`, toggles, camera switching | `src/lib/useLocalMedia.ts` |
| Effects | MediaPipe selfie segmentation + canvas compositing → processed video track | `src/effects/` |
| Screens | Home, pre-join lobby, in-call | `src/pages/` |

Each room holds two people in Phase 1. See [Reliability notes](#reliability-notes) for how the call engine copes with lost or reordered messages.

## Accounts, contacts and ringing

| Piece | What | File |
| --- | --- | --- |
| Database | `profiles`, `contacts`, `calls`, `push_subscriptions` with Row Level Security | `supabase/migrations/` |
| Server API | Edge Function: sign-up, username suggestions, recovery codes, password reset / change, add contact, register device, ring / cancel / decline / answer | `supabase/functions/family/index.ts` |
| Sign-in | Supabase Auth with username → `<username>@users.familycall.app` (never mailed) | `src/lib/auth.tsx` |
| Ringing | Private Realtime channel `user:<id>` per person (only they can listen; only the server sends) + Web Push | `src/lib/calls.tsx`, `public/sw.js` |

**How a call rings:** tapping a contact opens a new room and calls the `ring` action. The server records the call and sends a "ring" to the callee's private channel (reaches any open app instantly) and as a Web Push (rings a closed app). Accepting joins the same room, and the normal WebRTC call connects. The Web Push signing keys are created by the server on first use and kept in a table only the server can read.

Deploy the function with the Supabase CLI or dashboard; it uses its own sign-in check, so deploy it with JWT verification off (`--no-verify-jwt`), since sign-up must work before sign-in.

## Video effects

`src/effects/processor.ts` draws each camera frame onto a canvas and sends `canvas.captureStream()` in the call instead of the raw camera:

1. **Finding the person:** Google MediaPipe's selfie segmenter (`public/models/selfie_segmenter.tflite`) runs on the device's GPU where available. Its runtime (~3 MB compressed) is copied from `node_modules` into `public/mediapipe/` by `scripts/copy-mediapipe.mjs` before `dev`/`build`, and only downloads when someone turns on a background effect.
2. **Background:** blurred cheaply by shrinking the frame, blurring and scaling it back up, or replaced with a scene from `public/backgrounds/` (original SVG illustrations) or the user's own photo.
3. **Beautify:** MediaPipe's face landmarker (`public/models/face_landmarker.task`, 478 points per face) gives a skin mask: face outline minus eyes, eyebrows, lips and nostrils. A blurred, brightened copy of the frame is laid over only the skin. Until face tracking loads, a light whole-picture soft focus is used.
4. **Filters:** CSS filter strings applied while drawing.

On slow devices, segmentation runs less often (at least 4 times a second) and the last outline is reused in between, so the video stays smooth. When no effect is on, the raw camera is sent untouched. Add `?debug` to the URL to log frames per second and the cost of each step.

## Run locally

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL in **two tabs of the same browser**, start a call in one, and paste the link into the other. Without Supabase settings, calls only connect between tabs of the same browser.

To call between two devices, add Supabase (below). Phones need **https** to use the camera, so test across devices with the deployed site, not `localhost`.

## Supabase setup (free)

1. Create a free project at [supabase.com](https://supabase.com).
2. In **Project Settings → API**, copy the project URL and the publishable (or anon) key.
3. Copy `.env.example` to `.env.local` and fill them in:

   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   ```

No tables are needed: Phase 1 only uses Realtime broadcast. The publishable key is designed to be public, so it's fine in the browser bundle.

## Deploy to Vercel (free)

1. Import this repository at [vercel.com/new](https://vercel.com/new). It's detected as a Vite app.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Environment Variables**.
3. Deploy. `vercel.json` sends every path to the app, so `/room/...` links work.

## Tests

The end-to-end tests drive two Chromium tabs with fake cameras through real calls. They need [Playwright](https://playwright.dev) (`npm i -D playwright && npx playwright install chromium`) and the built app running:

```bash
npm run build
```

```bash
npm run preview
```

Then in another terminal:

```bash
npm run test:e2e
```

```bash
npm run test:connect
```

- `test:e2e`: start → join → connected both ways with audio and video → mute/camera toggles → a third person is told the room is full → hang up → rejoin → closing the tab → desktop layout → bad room codes. Screenshots go to `tests/screenshots/`.
- `test:connect`: connects two people 50 times in a row to catch timing races.
- `test:qr`: joining by uploading a photo of the QR code and by scanning it with the camera (feeds a video of the code to Chrome's fake camera; needs ffmpeg).
- `test:effects`: A's camera is a portrait photo; A switches on blur, scenes, filters and beautify mid-call, and the test checks the pixels B receives. Needs ffmpeg and a Supabase build.
- `test:reset` (`tests/password-reset.cjs`): sign-up recovery code, forgot password with a wrong and a right code, old vs new password, change password, ringtone choice.
- `test:calls` (`tests/direct-calls.cjs`): creates test accounts, signs in two browsers, and checks ringing, accept, hang-up, decline, cancel → missed call, sign-up and add contact.
- `test:browsers`: calls between two completely separate browsers, so they can only meet through Supabase. Needs a build with Supabase settings.

## Reliability notes

Supabase Realtime broadcast is fast (calls connect in about 0.6 s) but doesn't guarantee delivery or ordering, so the call engine:

- holds ICE candidates that arrive before their offer/answer, and treats an early offer as the "welcome";
- repeats "hello" every 3 s while waiting alone, and resends the offer if the other side is still announcing itself;
- lets whoever joined the room first send the offer, so both sides never offer at once;
- starts over if a call hasn't connected within 15 s;
- sends hang-ups over a direct WebRTC data channel too, so closing a tab is noticed right away.

Add `?debug` to a room URL to log every signaling message in the browser console.

## Roadmap

| Phase | What |
| --- | --- |
| 0 ✅ | Setup: React + Vite + TypeScript, design from the mockups |
| 1 ✅ | 1-to-1 video calls via room link / QR code |
| 2 ✅ | Accounts and contacts: sign-in, usernames, add by username / QR, online status |
| 3 ✅ | Real calling: tap a contact to ring them, push notifications, missed calls, call history |
| 4 | Reliability: self-hosted TURN (coturn on Oracle Cloud free tier), testing on mobile data |
| 5 | Group calls: up to 4 directly, LiveKit for more |
| 6 | Extras: chat, screen sharing, elder mode, native apps |
