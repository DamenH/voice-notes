# Findings

Running log of what the prototype and implementation established. Dates are
when each finding was checked.

## Provider (OpenRouter), 2026-10-25

### Browser access
- CORS preflight succeeds (`access-control-allow-origin: *`) for
  `chat/completions`, `audio/transcriptions`, `audio/speech`, `key`, `models`.
  All model calls can be made directly from the static app.
- `X-Generation-Id` is exposed to browsers via `access-control-expose-headers`.

### Transcription — `POST /api/v1/audio/transcriptions`
- JSON body: `{ model, input_audio: { data: <base64>, format }, language?,
  response_format: "json" | "verbose_json", timestamp_granularities? }`.
  Formats: wav, mp3, flac, m4a, ogg, webm, aac. Multipart is capped at 25 MB.
- About 60 s of upstream processing per request is the practical limit, so
  long audio must be segmented.
- `openai/whisper-large-v3-turbo` with `verbose_json` returns segment
  timestamps. 18.2 s of speech took 1.9 s and cost $0.00006 (about
  $0.012/hour). Chosen as the default transcription model.
- `openai/gpt-4o-mini-transcribe` rejects `verbose_json`, so it gives no
  timestamps. The app must fall back to `json` and mark such transcripts
  as untimed.
- Response includes `usage.seconds` and `usage.cost`.
- Catalog: transcription models appear only with `?output_modalities=all`
  (output modality `transcription`). Their `pricing.prompt` is per second of
  audio for Whisper-class models; token-priced models report cost in usage.

### Audio-aware chat (Inkling)
- `thinkingmachines/inkling` ($1.00/$4.05 per M tokens) and
  `thinkingmachines/inkling-small` ($0.45/$1.20), both also `:free`.
- Content part: `{ type: "input_audio", input_audio: { data, format: "wav" } }`.
  Chat audio formats don't include webm, so audio is sent as WAV.
- `inkling-small` on an 8 s Spanish learner clip took 3.7 s. It produced an
  accurate verbatim transcript including the filler "eh", and separated
  observation / interpretation / uncertainty as instructed. It also returns a
  `reasoning` field.

### Speech — `POST /api/v1/audio/speech`
- Body `{ model, input, voice, response_format: "mp3" | "pcm" }`. A voice is
  required. Default output is `audio/pcm;rate=24000;channels=1` (16-bit LE).
  `wav` is rejected.
- Voices are listed per model in the catalog as `supported_voices`
  (ElevenLabs: george, sarah, adam, alice, … 21 voices).
- Speech models are listed with `?output_modalities=speech`. ElevenLabs
  `pricing.prompt` is per character ($0.00004 flash/turbo, $0.00008 v3/v4/
  multilingual v2).
- No cost is returned in the response body. Cost is estimated from the character
  count and catalog price.

### Inference model choice
Cleanup of the English thinking-aloud transcript ("…bike lanes. Actually, no,
wait. It's more that…"):
- `anthropic/claude-haiku-5.5` ($0.10/$0.50): preserved the self-correction
  verbatim, removed filler. $0.00007. **Default Little.**
- `deepseek/deepseek-v4-flash`: preserved it as a `[Revised: …]` note. $0.00003.
  Good cheap alternative preset.
- `openai/gpt-5.6-luna`: dropped the original claim and the self-correction
  entirely, which violates the thinking-aloud requirement. Not offered as a cleanup
  default.
- Default Big: `anthropic/claude-sonnet-5.5` ($2/$10, tools, 1M context).
  Alternatives in presets: `anthropic/claude-opus-5.5`, `openai/gpt-5.6-terra`,
  `google/gemini-3.8-flash`.

## Audio capture and storage decisions

- **Capture format: 16 kHz mono 16-bit PCM via AudioWorklet**, stored in
  IndexedDB as ~5 s chunks.
  - Every chunk is independently usable, so segmentation is exact sample
    slicing, with no container decoding or whole-file `decodeAudioData`. A
    60-minute recording never needs to be in memory at once.
  - WAV is accepted by both transcription and chat audio input.
  - Cost: about 115 MB per hour, versus about 15–30 MB for Opus. That's acceptable
    for a local-first app with storage status and export. Revisit with
    WebCodecs Opus if storage pressure becomes a real problem.
  - MediaRecorder/webm was rejected because chat audio input doesn't accept webm,
    and its fragments aren't independently decodable.
- **Segmentation:** target 5-minute segments, with each cut moved to the
  quietest 200 ms window within ±15 s of the target. Cutting in silence avoids
  splitting words, so no overlap or text de-duplication is needed. Timestamps
  are offset by the segment start.
- **Binary storage:** IndexedDB blobs via Dexie. OPFS isn't needed at these
  chunk sizes.

## Live end-to-end results (2026-10-25)

`npm run test:live` drives the built app in Chromium with the speech fixtures
as a fake microphone and the real OpenRouter API:

- Default pipeline on the 18 s English clip: Whisper turbo → Haiku 5.5 cleanup,
  self-correction preserved, $0.00015 total.
- Big chat (Sonnet 5.5) asked about "safety evidence": it called `search_group`,
  found the line in the session and cited the entry id and time. $0.011.
- Read aloud via `elevenlabs/eleven-flash-v2.5`: speech requested once, then
  replayed from the local cache with no further request.
- Language practice on the 8 s Spanish clip (Whisper + Inkling + Sonnet tutor):
  Inkling's notes included the "eh" hesitation; tutor feedback was accurate.
  $0.021 total (Inkling $0.006, which includes its reasoning tokens).
- Estimates under-predict very short clips, because fixed per-request overhead
  (instructions, reasoning) dominates. They are reasonable per minute of longer audio.

Bugs found and fixed while building:
- The capture worklet transferred its sample buffer, which detached it, and then
  sized the next buffer from the detached (zero-length) array. Only the first
  0.25 s batch was ever sent. Found by the fake-microphone e2e test.
- Picking a pipeline preset and then quickly editing a field overwrote the preset
  with a stale copy. Pipeline edits now read-modify-write against IndexedDB.
  Found by the live test.

## Inkling verbosity (2026-10-25)

The first default instructions asked for observations, interpretations and
uncertainty on every recording. Inkling followed them literally and wrote a
paragraph of each even for "Test 123". The new defaults ask for only notable
points, a few bullets at most, and one line when nothing stands out, and they forbid
describing the voice or guessing the purpose of the recording. When Inkling is given
a transcript it is told not to repeat it. On the English fixture this gave three
bullets (249 output tokens, $0.0016), and Inkling caught an "of… of" stumble that
Whisper's transcript had smoothed over. Saved copies of the old defaults are
migrated (database v2); customised text is left alone.

Cleanup now uses only transcripts as input. Before, it also received Inkling's
notes and merged them into the "cleaned transcript".

## Inkling writes its own transcript (2026-10-25)

Listen steps no longer receive Whisper's transcript by default (database v4 turns
it off for saved pipelines; the toggle remains). The default instructions ask for
a verbatim transcript, including fillers, repetitions and self-corrections, plus
bullets only when something stands out. On the English fixture, Inkling's own
transcript was more faithful than Whisper's: it kept "of, of sharing", which
Whisper dropped, and added no notes. Language practice asks for IPA of what was
heard versus the standard pronunciation for mispronounced words. Inkling produced
it (e.g. "Sevilla: heard /seˈvila/, expected /seˈβiʎa/"), but some claims are
marginal (e.g. "queso: heard /ˈke.so/, expected /ˈkeso/" differs only by a
syllable dot). Treat IPA from audio as a hint, not a measurement.

## Android recording behaviour (expected; verify on a device)

- A screen wake lock is held while recording, so the screen doesn't sleep while
  the app is in front. It is re-acquired when the page becomes visible again.
- When the user locks the screen or switches apps, Chrome on Android generally
  keeps an active `getUserMedia` capture running, but this varies by device and
  power settings. If the AudioContext is suspended the app shows a warning and
  tries to resume. Audio is saved every 5 s, and on reopen an unfinished
  recording is marked "Interrupted — saved up to here" and stays playable.
- See `docs/MANUAL-CHECKS.md` for the device checks.

## Spend log

| When | What | Spend |
| --- | --- | --- |
| 2026-10-25 | Fixtures (TTS), transcription, Inkling, cleanup probes | < $0.01 |
| 2026-10-25 | Live smoke runs (3, including one failed and re-run) | ≈ $0.05 |
| 2026-10-25 | Live smoke run after the step-list pipeline change | ≈ $0.023 |
| 2026-10-25 | Inkling own-transcript/IPA probes and a language-practice live run | ≈ $0.03 |
| | **Total on the dev key** | **≈ $0.12 of the $5 cap** |
