# Voice Notes

Think aloud, study, and practise languages with your voice. Record, and when you
press stop the session's pipeline runs automatically: by default it transcribes
the recording and cleans up the transcript. Switch a session to **Inkling** to have
an audio-aware model actually *hear* pronunciation, pauses and hesitation, ask for
help from a Little or Big model that can search your other sessions, and have
responses read aloud with ElevenLabs voices.

**App:** https://damenh.github.io/voice-notes/

- Installable PWA for Android and desktop; recording, playback and browsing work offline.
- Everything is stored on your device (IndexedDB). Export/import a zip backup in Settings.
- Model calls go directly from your browser to [OpenRouter](https://openrouter.ai)
  using your own account (OAuth PKCE, or paste an API key).

## How it works

| Step | Default | Options |
| --- | --- | --- |
| Record | 16 kHz mono PCM, saved every 5 s | pause/resume, wake lock |
| Process | Whisper large v3 turbo (timestamps) | Inkling (audio-aware), both combined, other STT models |
| Infer | Clean up with Little (Claude Haiku 5.5) | Summarise, Language feedback, Think it through, custom presets, Big (Claude Sonnet 5.5) |
| Speak | — | ElevenLabs via OpenRouter, cached locally |

Pipelines inherit default → group → session and are edited inline from the control
next to the record button. Instructions inherit the same way, plus per-run
instructions; each run stores the exact instructions it used. Processing details
and tool calls are collapsed into one summary line per turn unless you expand them.

## Development

```sh
npm install
npm run dev          # http://localhost:5173
npm run verify       # typecheck, lint, unit tests, build, secret scan
npm run test:e2e     # Playwright (fake microphone, mocked OpenRouter)
npm run test:live    # real OpenRouter calls; key from ~/dev-key.txt or OPENROUTER_API_KEY (costs a few cents)
```

- `PLAN.md` — the product and implementation plan.
- `docs/FINDINGS.md` — provider behaviour, measurements and design decisions.
- `docs/MANUAL-CHECKS.md` — checks that need a real phone or a human sign-in.

Pushing to `main` deploys to GitHub Pages.
