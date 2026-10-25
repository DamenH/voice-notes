# Voice Notes

## Product

Voice Notes is an installable web app for thinking aloud, studying, and learning
languages. Users record their thoughts, choose how models interpret the audio,
and request assistance with the resulting material. Original recordings and the
steps that follow them remain part of a searchable session history.

The app runs in the browser, stores its library on the user's device, and makes
model requests directly through the user's OpenRouter account. A public static
host such as GitHub Pages distributes the app. The app should be native to both 
mobile and desktop. The desktop app should not just be a single column 
web page.

## User experience

### Groups and sessions

- Groups form a flat collection. Each session belongs to one group.
- A session is an ongoing, chat-like workspace containing recordings, processing
  runs, user messages, inference responses, and tool activity.
- Users can add recordings and continue the conversation throughout a session.
- Entries show their type, creation time, state, and source relationships.
- Users can play original audio and navigate from derived material to its source.
- Users can explicitly delete entries, recordings, sessions, and groups. Deletion
  updates associated search records and handles dependent entries consistently.

### Three stages

1. **Recording:** capture audio for tens of minutes or longer, with elapsed time,
   recording state, and incremental local saving. Stopping produces a playable
   recording entry in the session.
2. **Processing:** recordings are turned into text using an input mode, models,
   and instructions. Outputs appear as new session entries for review.
3. **Inference:** assistance is produced from processing results and other
   session context. A separate Big/Little model selection controls downstream
   reasoning. The most common inference step is cleanup.

Users can return to an earlier stage, record more material, or request another
run with different settings at any point.

### Session pipeline

The default flow is **record → process → infer (cleanup)**, and it should take a
single action: pressing stop. Each session has a pipeline setting that decides
what happens automatically when a recording stops.

- The pipeline is shown as a compact control beside the record button, e.g.
  `Stop → Transcribe → Clean up`. Tapping it opens the session's pipeline editor
  inline rather than in a separate settings page.
- A pipeline is an ordered list of steps (up to five), edited with
  "+ Add step", remove and reorder. Each step has its own model and instructions.
  There are three step types:
  - **Transcribe:** a speech-to-text model on the audio.
  - **Listen:** an audio-aware model (Inkling by default) on the audio,
    optionally given the transcript from an earlier Transcribe step.
  - **Assist:** a Little or Big inference preset (cleanup, summarise, tutor
    feedback, custom). It reads the previous step's output by default; a toggle
    switches it to all earlier outputs. Assist steps can therefore chain, e.g.
    Clean up → Summarise.
- Each step has one output setting: **Show** (appears in the session) or
  **Collapse** (behind the turn's summary line). By default the last step is shown
  and earlier steps are collapsed. Shown outputs appear in step order.
- Named presets are saved step lists; for example "Transcribe (Show) → Listen with
  Inkling (Show)" shows the Whisper transcript and Inkling's notes side by side.
  Pipelines saved in the earlier mode-based form are converted automatically
  (e.g. "combined" becomes a Transcribe step followed by a Listen step).
- Pipelines inherit like instructions: global default → group → session. A new
  session starts from its group's pipeline. Users can save named pipeline presets
  (e.g. "Thinking aloud", "Language practice") and switch per session.
- The out-of-the-box default is speech to text followed by Little cleanup.
- The control shows an estimated cost per minute of audio for the chosen
  pipeline, so enabling it is an informed approval of those paid steps. An
  automatic run that would exceed a user-set cost ceiling pauses for approval.
- Automatic runs are ordinary runs: they record their settings and instruction
  snapshots, can be cancelled while in progress, and can be rerun manually with
  different settings.
- When the pipeline is off, or for any extra run, the same steps are available
  as manual actions on a recording or entry.

### Audio processing modes

| Mode | Inputs and outputs |
| --- | --- |
| Speech to text (default) | A transcription model such as Whisper turns recordings into timestamped transcripts. |
| Audio-aware text | Thinking Machines' Inkling receives the audio itself and follows instructions for producing text. |
| Combined | Both approaches process the recording, preserving each output and its provenance. |

**Inkling** is the primary audio-aware model and gets first-class treatment:
its own presets, starting instructions, and pricing display. It hears the audio
rather than a transcript, so it can capture information useful for an activity,
including pronunciation, stress, intonation, pauses, emphasis, hesitation, and
self-correction. That makes it especially valuable for language learning and for
reviewing how something was said, not only what was said.

Inkling is opt-in rather than the default, because plain transcription is
cheaper and sufficient for most thinking-aloud sessions. The interface makes it
easy to reach for: selectable as the pipeline's process step (e.g. a "Language
practice" preset), and available as a one-off "Listen with Inkling" action on any
recording or time range. Other audio-capable models remain configurable.

Prompts should ask audio-aware models to distinguish observations,
interpretations, and uncertainty. The implementation will evaluate the
reliability of these capabilities on real recordings, including language-learning
examples.

Combined mode keeps the transcript and audio-aware output separately identifiable.
An audio-aware run may optionally receive an existing transcript as additional
context; that dependency is recorded with the run.

Processing can target a whole recording or a selected time range. Each run retains
its model, settings, instructions, source references, status, usage, and outputs.
Reprocessing adds a new run while retaining earlier results.

For thinking aloud, assistance preserves the user's meaning, uncertainty, and
self-corrections. Any cleaned transcript is a separate derivative of the original
transcription. Activity-specific instructions govern more interpretive feedback.

### Big/Little inference

Audio interpretation and downstream inference are separate model choices.

- **Little** handles routine cleanup, formatting, retrieval, and straightforward
  assistance.
- **Big** handles demanding reasoning, synthesis, and detailed tutoring.
- Users choose editable model presets informed by price and capability.
- Initial routing is explicit and task-based. The interface makes the selected
  model and expected work visible.
- Relevant original processing outputs remain available alongside summaries.
- Users can stop after reviewing processing results or continue into inference;
  the session pipeline decides which of these happens automatically.

### Text to speech

Users can have entries read aloud using ElevenLabs voices through OpenRouter's
speech endpoint, with the same OpenRouter account and no separate ElevenLabs plan.

- Any text entry (cleaned transcript, inference response, tutor feedback) has a
  play-aloud action. A session can optionally auto-speak inference responses for
  a hands-free conversational loop.
- Useful for language learning: hear a corrected sentence or model answer in the
  target language, then record an attempt and compare.
- Users choose a voice and model per session with global/group defaults, e.g. a
  low-latency model for conversational replies and a more expressive model for
  longer read-alouds. Show per-character pricing alongside other model costs.
- Long text is split within the model's per-request character limit and played
  back seamlessly.
- Generated audio is cached locally against its source entry and settings so
  replays are free and offline. It is attached to that entry, not added as a new
  timeline item, and can be cleared to reclaim storage.
- OpenRouter's speech API differs from ElevenLabs' native API; build against
  OpenRouter's request and response format.

Select initial models using a small set of representative tasks. Display current
catalog prices with their units and distinguish text pricing from audio pricing.
Capture actual usage and cost when provided by OpenRouter.

### Instructions

Maintain separate instruction chains for audio processing and inference:

1. Global defaults.
2. Group instructions.
3. Session instructions.
4. Instructions for the individual run.

More specific instructions take precedence when instructions conflict. Resolve the
effective instructions before each request and save that snapshot with the run.
Provide useful starting instructions for thinking aloud and language learning.
Keep instruction editing accessible near the action it affects.

### Agent tools

A small tool-calling harness supports inference within the current group. Initial
tools allow a model to:

- Search session content across the group.
- List relevant sessions and entries.
- Read entries and bounded excerpts with source references and timestamps.
- Request fresh audio processing for a recording or selected time range.

Searchable material includes transcripts, audio-model outputs, conversation
messages, and tool results. Recording entries are discoverable through metadata
and linked text outputs. The original audio can be revisited through processing
tools.

The harness enforces group access when executing each tool. Retrieved material is
treated as source content. Tool results use bounded payloads so the model can
retrieve further detail as needed.

Reading existing local material proceeds during a user-requested inference run.
A request for additional paid audio processing presents the model, audio range,
instructions, and estimated cost for explicit approval. Resuming an approved tool
call and its outcome are recorded in the session.

Use bounded tool-call rounds, visible progress, cancellation, and clear failure
states. Persist the tool calls and results needed to understand each response.

### Keeping the session view uncluttered

The session should read like a conversation: recordings, the user's messages, and
the results they care about. Machinery stays out of the way.

- Processing runs, segments, intermediate outputs, and tool calls are collapsed
  by default and coalesced into one summary line per step or response, e.g.
  `Transcribed 12:40 · cleaned up · 3 tool calls · $0.04`.
- The final output of a pipeline (usually the cleaned transcript) is shown in
  full; the raw transcript and other intermediates sit behind the summary line.
- Expanding a summary reveals the individual runs, tool calls, settings,
  instruction snapshots, and costs. A per-session or global "show details"
  toggle keeps them expanded for users who want them.
- In-progress work shows a single live status line (step, progress, cancel)
  rather than one entry per segment or tool call.
- Failures and approval requests are never collapsed: they stay visible until
  resolved.
- Secondary actions (reprocess, Listen with Inkling, read aloud, delete) live in
  entry menus rather than as always-visible buttons.

## Application architecture

### Static PWA

- Publish a static application with a web app manifest, icons, and a service worker.
- Support installation and an offline application shell.
- Keep local session browsing, audio playback, and instruction editing available
  offline. Model actions clearly communicate their connectivity requirements.
- Use responsive layouts for Android phones and desktop browsers.

### OpenRouter connection

- Implement OAuth with PKCE using an HTTPS callback compatible with static hosting.
- Validate authorization state and handle redirects without losing local work.
- Keep credentials separate from session data and expose connection and disconnect
  controls. Choose and document an appropriate browser credential persistence policy.
- Call transcription and chat APIs directly from the browser.
- Verify browser support, model modalities, timestamps, formats, limits, and pricing
  against current provider documentation during implementation.

### Local persistence

Use structured browser storage for groups, sessions, entries, runs, settings, and
search records. Select suitable binary storage for recordings after testing
IndexedDB and the Origin Private File System on target browsers.

Use stable identifiers and explicit relationships between recordings, processing
runs, outputs, and messages. Store audio in durable local chunks during capture.
Persist completed work before updating the interface to show success.

Measure storage use, request persistent storage where supported, and explain
capacity or quota failures while preserving already saved material. Schema changes
must preserve existing libraries. Include a portable library export/import path
so users can back up their local work.

### Long audio and processing jobs

Treat capture chunks and upload chunks as separate concerns. Browser-produced
capture fragments may depend on container headers and require assembly or
conversion before they are independently decodable.

Build processing jobs with bounded, valid audio segments sized for the selected
endpoint. Preserve global timestamps, handle boundary overlap, and avoid duplicate
transcript text when assembling results. Keep segment outputs and source ranges
available for inspection.

Persist job and segment state to support retries and recovery after interruption.
Show completed, pending, failed, and cancelled work. Handle each paid request
explicitly when retrying an ambiguous network failure.

### Pipeline edge cases

- **Offline at stop:** the recording is saved and the pipeline is queued with a
  visible "waiting for connection" status. It runs on reconnect, or the user can
  cancel it.
- **Partial failure:** a failed step stops later steps. The failure stays visible,
  and retry resumes from the failed step (or failed segment), not from the start.
- **Long transcripts:** cleanup and other inference steps chunk input that would
  exceed the model's context, preserving order and timestamps, and assemble one
  output.
- **Cost estimates:** derived from current catalog prices plus measured ratios
  (e.g. audio tokens per second, transcript tokens per minute) recorded during
  the prototype and refined from actual usage.

## Technical decisions

### Stack

- Vite, TypeScript (strict), React, Tailwind CSS. Dexie over IndexedDB for
  structured data.
- Vitest for unit tests; Playwright (Chromium, plus a mobile viewport project) for
  end-to-end tests, with fake media devices and synthetic audio.
- Hash-based routing so deep links work on GitHub Pages. The OAuth callback
  returns to the app root with `?code=`, handled before routing.
- Search: MiniSearch over the persisted search-records table, with an in-memory
  index built per group on demand. Search records are the source of truth and
  are updated in the same transaction as the content they index.
- Audio storage sits behind a small interface. IndexedDB blobs are the default;
  the prototype decides whether OPFS is worth adding.
- Audio capture format is decided by the prototype. Candidates are MediaRecorder
  (Opus, small) rotated every few minutes so each part decodes independently,
  or AudioWorklet PCM at 16 kHz mono (simple exact segmentation, larger). The
  choice must keep a 60-minute recording processable on an Android phone without
  decoding the whole recording into memory at once.

### Data model (first version)

Every record has a stable string id plus `createdAt`/`updatedAt`. Dexie versioned
schema with migrations from the start.

- `groups`: name, instructions (processing/inference), pipeline override,
  TTS override.
- `sessions`: groupId, title, the same overrides as groups.
- `entries`: sessionId, groupId, kind (`recording`, `user_message`,
  `transcript`, `audio_notes`, `cleanup`, `assistant_message`, `tool_call`,
  `tool_result`, `approval_request`, `error`), runId, sourceRefs
  (entry id + optional time range), text, status, visibility (`primary` or
  `detail`, which drives collapsing).
- `recordings`: entryId, duration, mime, chunk count, capture state.
- `audioChunks`: recordingId, index, blob, start/end time.
- `runs`: sessionId, kind (`process`, `infer`, `tts`, `pipeline`), parentRunId,
  model, settings, instruction snapshot, status, usage, cost, error.
- `segments`: runId, index, source range, status, attempt count, output.
- `searchRecords`: groupId, sessionId, entryId, text, timestamps.
- `ttsCache`: entryId, settings hash, audio blob.
- `settings`: global defaults, model presets, pipeline presets, cost ceiling.
- Credentials are stored separately (own localStorage key), never in the library
  export.

### Layout

Follows the approach of the pitch-training app (`~/Projects/pitch-training`,
`src/App.svelte`) without copying it: design tokens with light/dark, safe-area
insets, container queries so panes lay themselves out by their own width, and
`pointer`/`hover` media queries for control sizing.

- **Desktop (≥ 900px):** three panes. Left sidebar with groups and their sessions
  plus search and settings. Centre is the session conversation with the record
  bar and composer pinned at the bottom. A right inspector panel, closed by
  default, shows run details, the pipeline editor, instructions, and source
  audio for whatever is selected. The centre column is width-limited for
  reading; the inspector opens beside it rather than over it.
- **Phone portrait:** stacked navigation. Groups → sessions → session, with a
  back button in a sticky title bar. The record bar is pinned above the bottom
  safe area, and the inspector and pipeline editor open as bottom sheets.
- **Phone landscape / short screens:** the sidebar collapses to an icon rail.
- Installed desktop PWA supports window-controls-overlay, as in pitch-training.

### Credentials and testing with a real key

- Users connect through OAuth PKCE. A "paste an API key" option is also offered
  in settings, which is what automated tests use.
- During development the key comes from `~/dev-key.txt`,
  read by test scripts at runtime and injected into the browser by Playwright.
  It is never written into the repository, `.env` files in the project, source,
  or build output. A verification step fails the build if `dist/` contains
  `sk-or-`.
- **Budget:** that key has a $10 limit; development spend is capped at $5.
  Real API calls are limited to a small, explicitly-invoked smoke suite (`npm run test:live`)
  using short clips and cheap or `:free` models (e.g. `inkling:free`,
  `inkling-small`, `whisper-large-v3-turbo`, `eleven-flash-v2.5`). The default
  test suites mock OpenRouter. Check spend via `GET /api/v1/key` before and
  after live runs, and stop making live calls once total development spend
  reaches $5.00.
- Speech fixtures for tests (an English thinking-aloud clip and a short
  second-language clip) are generated once with a cheap TTS model and committed.

### Catalog notes (checked 2026-10-25)

- Audio-aware: `thinkingmachines/inkling`, `thinkingmachines/inkling-small`
  (both also `:free`).
- Transcription models are listed with `output_modalities=all` and have output
  modality `transcription`. Options include `openai/whisper-large-v3-turbo`,
  `openai/whisper-large-v3`, `openai/gpt-4o-mini-transcribe`, and
  `elevenlabs/scribe-v2`.
- Speech models are listed with `output_modalities=speech`. ElevenLabs options
  include `eleven-v4`, `eleven-v4-turbo`, `eleven-v3`, `eleven-flash-v2.5`, and
  `eleven-multilingual-v2`.
- Pricing units differ between transcription, speech, and chat models. Verify
  the unit for each before displaying or estimating costs.

## Implementation

The whole plan is implemented in one autonomous run, in the milestone order
below. Each milestone ends with passing checks and a commit. Findings and
decisions made along the way go in `docs/FINDINGS.md`; anything that needs a
real device or a human (Android screen lock, installation on a phone, OAuth
login) goes in `docs/MANUAL-CHECKS.md` instead of blocking progress.

### 1. Validate the browser and provider path

- Exercise PKCE URL construction and code exchange logic, and direct browser
  calls to OpenRouter from a local origin. The full OAuth login is a manual check.
- Verify transcription and Inkling audio input, including pricing,
  length limits, accepted formats, and time-range handling.
- Verify OpenRouter's speech endpoint with ElevenLabs models from the browser:
  output formats, latency, character limits, and voice selection.
- Test a representative long recording (synthetic, mocked endpoints),
  incremental persistence, reload recovery, storage pressure, audio segment
  decoding, and provider limits. Decide the capture format and audio storage.
- Document the expected Android background and screen-lock behaviour and the UX
  that protects saved audio; add the real-device test to the manual checks.
- Evaluate sample processing prompts and choose initial Little and Big models
  within the test budget.

Deliverable: findings recorded in `docs/FINDINGS.md`. The prototype code becomes
the foundation of the app rather than being thrown away.

### 2. Build the local recording workspace

- Implement groups, sessions, a chronological entry view, and local persistence.
- Add recording, incremental saving, playback, source metadata, and deletion.
- Add PWA installation, offline loading, storage status, and export/import.

Acceptance: users can install the app, create a group and session, capture a long
recording, reopen the app, and play saved audio.

### 3. Add explicit audio processing

- Add all three processing modes, instruction inheritance, model selection, and
  per-run instruction snapshots, with Inkling presets for audio-aware mode.
- Implement segmentation, progress, cancellation, failure recovery, and usage display.
- Present separately attributed outputs with links to original audio ranges.
- Support repeated processing and additional recordings within a session.
- Build collapsed, coalesced run summaries with expandable details.

Acceptance: each mode produces inspectable session entries; repeated processing
retains earlier runs and their sources; intermediate work is collapsed by default.

### 4. Add inference, the session pipeline, and agent tools

- Implement Big/Little presets and chat-like inference messages.
- Add the session pipeline: inline editor, inheritance, named presets, cost
  estimate and ceiling, and automatic process → cleanup on stop.
- Add group-scoped search and read tools with source references.
- Add the approval and resume flow for targeted audio reprocessing.
- Record tool activity, results, costs, and model settings in the session.

Acceptance: pressing stop with the default pipeline yields a cleaned transcript
with no further action; an inference run can retrieve useful context from another
session in the same group, reference it, and request approved reprocessing of
selected audio. Tool execution enforces the group boundary and bounded execution.

### 5. Add text to speech

- Add read-aloud on text entries, voice and model selection with inheritance,
  chunked playback, local caching, and optional auto-speak of responses.

Acceptance: a cleaned transcript or response can be played aloud, replays come
from the local cache, and cached audio can be cleared.

### 6. Validate the complete experience

- Walk through thinking aloud about an assignment and a language-learning session
  (with Inkling feedback and read-aloud corrections).
- Exercise the default pipeline and per-session overrides, all three stages,
  instruction overrides, reprocessing, search, deletion,
  export/import, installation, and offline reopening.
- Test interrupted recordings and uploads, failed API calls, exhausted credits,
  duplicate retry risks, and browser storage failures where practical.
- Check Android usability, accessibility, responsive layout, and the production
  static-host callback and service-worker update behavior.

Deliverable: a usable PWA with documented browser support, tested recovery behavior,
and model presets grounded in the sample workflows. Deployment to GitHub Pages is
via a GitHub Actions workflow to the public repo `DamenH/voice-notes`, served at
https://damenh.github.io/voice-notes/.

## Reference documentation

- [OpenRouter OAuth with PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth)
- [OpenRouter transcription](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/)
- [Inkling on OpenRouter](https://openrouter.ai/thinkingmachines/inkling)
- [ElevenLabs on OpenRouter](https://openrouter.ai/blog/announcements/elevenlabs-on-openrouter/)
- [PWA foundations](https://web.dev/learn/pwa/getting-started)

Provider details and browser behavior are validated during implementation; model
presets and endpoint constraints remain configurable as they evolve.

## Decisions deferred (2026-10-25)

- **Opus audio compression:** skipped for now. The development machine has
  ~394 GB free (over 3,000 hours at 115 MB/hour). Revisit if a phone or a
  small-quota browser runs short.
- **WebMCP:** not now. Revisit when the spec stabilises and browser agents
  actually call page tools; it would start as an opt-in, read-only setting that
  exposes the existing group-scoped search and read tools.
