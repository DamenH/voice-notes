# Voice Notes

Think aloud with your voice. Record, and when you press stop (or later, when you
ask) the session's pipeline runs: by default it transcribes the speech and cleans up
the transcript, keeping your meaning, uncertainty and self-corrections. Ask a Little
or Big model for help with what you said; it can search your other sessions in the
same group. Responses can be read aloud with ElevenLabs voices.

**App:** https://damenh.github.io/voice-notes/

- Installable PWA for Android and desktop; recording, playback and browsing work offline.
- Everything is stored on your device (IndexedDB). Export/import a zip backup in Settings.
- Model calls go directly from your browser to [OpenRouter](https://openrouter.ai)
  using your own account (OAuth PKCE, or paste an API key).

## How it works

Recording is 16 kHz mono PCM, saved every 5 s. A session's **pipeline** is an
ordered list of up to five steps:

| Step | What it does | Default model |
| --- | --- | --- |
| Transcribe | Speech to text with timestamps; silence is skipped on the device first, so you pay for speech, not recording time | Whisper large v3 turbo |
| Assist | A Little or Big preset (clean up, summarise, think it through, custom) working on the previous step or all earlier steps | Haiku 5.5 / Sonnet 5.5 |

Each step is set to **Show** (in the session) or **Collapse** (behind the summary
line). The pipeline runs **when recording stops** or **when you ask**: with the
latter you record as many takes as you like, then "Process now" handles them
together, optionally followed by one Assist step across all of them.

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
