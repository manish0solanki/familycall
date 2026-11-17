# FamilyCall

Free video calls for families. Start a call, share the link or QR code, and talk face to face. No sign-up needed.

**Status: Phase 1 — 1-to-1 video calls.** See [Roadmap](#roadmap).

## Features (Phase 1)

- Start a call and get a room link + QR code to share
- Join by tapping the link, typing the room code, or scanning the QR code with the in-app scanner (camera, or upload a photo of the code)
- Camera preview before joining, with mic/camera toggles
- 1-to-1 video and voice calls, peer-to-peer and encrypted (WebRTC)
- In-call controls: mute, camera on/off, switch front/back camera, hang up
- Handles the other person hanging up, closing the tab or losing connection, and rejoining
- Video effects, all processed on the device:
  - Background blur (slight or strong) and replacement with six built-in scenes or your own photo
  - Beautify (soft skin and gentle brightening) at three levels
  - Colour filters: Warm, Cool, Vivid, B&W, Vintage, Soft glow
- Phone and desktop layouts

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

## Video effects

`src/effects/processor.ts` draws each camera frame onto a canvas and sends `canvas.captureStream()` in the call instead of the raw camera:

1. **Finding the person:** Google MediaPipe's selfie segmenter (`public/models/selfie_segmenter.tflite`) runs on the device's GPU where available. Its runtime (~3 MB compressed) is copied from `node_modules` into `public/mediapipe/` by `scripts/copy-mediapipe.mjs` before `dev`/`build`, and only downloads when someone turns on a background effect.
2. **Background:** blurred cheaply by shrinking the frame, blurring and scaling it back up, or replaced with a scene from `public/backgrounds/` (original SVG illustrations) or the user's own photo.
3. **Beautify:** a blurred copy of the frame is laid over at partial opacity (a soft-focus lens effect), plus slight brightening.
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
| 2 | Accounts and family groups: sign-in, invites, online status |
| 3 | Real calling: tap a family member to ring them, push notifications, call history |
| 4 | Reliability: self-hosted TURN (coturn on Oracle Cloud free tier), testing on mobile data |
| 5 | Group calls: up to 4 directly, LiveKit for more |
| 6 | Extras: chat, screen sharing, elder mode, native apps |
