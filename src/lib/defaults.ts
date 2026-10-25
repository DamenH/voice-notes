import type { InferencePreset, PipelineConfig, PipelinePreset, PipelineStep, Settings } from './types';

export const STT_DEFAULT = 'openai/whisper-large-v3-turbo';
export const INKLING = 'thinkingmachines/inkling';
export const INKLING_SMALL = 'thinkingmachines/inkling-small';
export const LITTLE_DEFAULT = 'anthropic/claude-haiku-5.5';
export const BIG_DEFAULT = 'anthropic/claude-sonnet-5.5';
export const TTS_DEFAULT = 'elevenlabs/eleven-flash-v2.5';

export const DEFAULT_PROCESSING_INSTRUCTIONS = `Write what you hear:
1. A verbatim transcript, including fillers, false starts, repetitions and self-corrections.
2. Then, only if something stands out (mispronounced or unclear words, notable pauses or hesitations, emphasis that changes the meaning), a few short bullet points naming the words concerned. If nothing stands out, leave this part out.
Do not describe the speaker's voice, gender or the recording quality, and do not guess at the purpose of the recording. Mark anything you are unsure about with "(unsure)".`;

export const DEFAULT_INFERENCE_INSTRUCTIONS = `You help someone who thinks, studies, and practises languages aloud.
Preserve their meaning, uncertainty, and self-corrections. Never invent content they did not say.
When you refer to material from their recordings, cite the entry and time when available.
Be concise.`;

export const CLEANUP_PROMPT = `Clean up the transcript of someone thinking aloud. Remove filler words and false starts, fix punctuation, and break it into paragraphs.
Preserve the speaker's meaning, wording where possible, uncertainty, and self-corrections: keep the corrected idea and keep the visible change of mind (e.g. "Actually, no — ...").
Do not add ideas, summarise, or answer questions. Output only the cleaned text.`;

export const INFERENCE_PRESETS: InferencePreset[] = [
  { id: 'cleanup', name: 'Clean up', tier: 'little', prompt: CLEANUP_PROMPT, tools: false, chunked: true, builtin: true },
  {
    id: 'summarize',
    name: 'Summarise',
    tier: 'little',
    prompt:
      'Summarise the material as short bullet points in the speaker\'s own terms. Keep open questions and uncertainties as their own list. Do not add ideas.',
    tools: false,
    builtin: true,
  },
  {
    id: 'tutor',
    name: 'Language feedback',
    tier: 'big',
    prompt: `Act as a supportive language tutor. Using the transcript and any audio notes:
1. Give a corrected version of what the learner said, in the target language.
2. List the most important corrections (grammar, vocabulary, pronunciation from the audio notes), each with a short explanation.
3. Suggest one or two phrases to practise next.
Keep feedback encouraging and specific. Mark anything uncertain.`,
    tools: false,
    builtin: true,
  },
  {
    id: 'reflect',
    name: 'Think it through',
    tier: 'big',
    prompt:
      'Help the speaker develop their thinking: restate their main ideas faithfully, point out tensions or gaps, and ask two or three questions that would move the work forward. Use earlier sessions in the group when relevant.',
    tools: true,
    builtin: true,
  },
];

export const LANGUAGE_PRACTICE_PROCESSING = `The speaker is practising a language they are learning. Transcribe exactly what they said, mistakes included; do not correct it.
For words that were mispronounced or unclear, give IPA for what you heard and for the standard pronunciation, e.g. word: heard /…/, expected /…/.
Then add the few points on stress, intonation and fluency that matter most for improving.`;

const transcribe = (id: string, output: 'show' | 'collapse'): PipelineStep => ({ id, kind: 'transcribe', model: STT_DEFAULT, instructions: '', output });

export const DEFAULT_PIPELINE: PipelineConfig = {
  language: '',
  steps: [
    transcribe('d-transcribe', 'collapse'),
    { id: 'd-cleanup', kind: 'assist', preset: 'cleanup', instructions: '', output: 'show', input: 'previous' },
  ],
};

export const PIPELINE_PRESETS: PipelinePreset[] = [
  { id: 'thinking-aloud', name: 'Thinking aloud', config: DEFAULT_PIPELINE, builtin: true },
  { id: 'transcribe-only', name: 'Transcribe only', config: { language: '', steps: [transcribe('to-transcribe', 'show')] }, builtin: true },
  { id: 'manual', name: 'Manual', config: { language: '', steps: [] }, builtin: true },
];

export function defaultSettings(): Settings {
  return {
    id: 'global',
    instructions: { processing: DEFAULT_PROCESSING_INSTRUCTIONS, inference: DEFAULT_INFERENCE_INSTRUCTIONS },
    pipeline: DEFAULT_PIPELINE,
    pipelinePresets: PIPELINE_PRESETS,
    inferencePresets: INFERENCE_PRESETS,
    models: { little: LITTLE_DEFAULT, big: BIG_DEFAULT },
    littleOptions: [
      { id: LITTLE_DEFAULT, label: 'Claude Haiku 5.5', note: 'Default. Keeps self-corrections faithfully.' },
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Cheapest; marks revisions explicitly.' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    ],
    bigOptions: [
      { id: BIG_DEFAULT, label: 'Claude Sonnet 5.5', note: 'Default.' },
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', note: 'Most capable, highest price.' },
      { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'moonshotai/kimi-k3.1-pro', label: 'Kimi K3.1 Pro' },
    ],
    sttOptions: [
      { id: STT_DEFAULT, label: 'Whisper large v3 turbo', note: 'Default. Timestamps, very cheap.' },
      { id: 'openai/whisper-large-v3', label: 'Whisper large v3', note: 'Timestamps.' },
      { id: 'elevenlabs/scribe-v2', label: 'ElevenLabs Scribe v2' },
      { id: 'openai/gpt-4o-mini-transcribe', label: 'GPT-4o mini transcribe', note: 'No timestamps.' },
    ],
    audioOptions: [
      { id: INKLING, label: 'Inkling', note: 'Hears pronunciation, pauses and emphasis.' },
      { id: INKLING_SMALL, label: 'Inkling Small', note: 'Cheaper and faster.' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    ],
    tts: { model: TTS_DEFAULT, voice: 'george', autoSpeak: false, speed: 1 },
    costCeiling: 0.5,
    showDetails: false,
    segmentSeconds: 300,
    maxToolRounds: 6,
  };
}
