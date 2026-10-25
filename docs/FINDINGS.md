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

## Spend log

| When | What | Spend |
| --- | --- | --- |
| 2026-10-25 | Fixtures (TTS), transcription, Inkling, cleanup probes | < $0.01 |
