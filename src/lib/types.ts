export type Id = string;

export interface Base {
  id: Id;
  createdAt: number;
  updatedAt: number;
}

/** Instructions at one level of the chain. Empty or missing means "inherit". */
export interface InstructionSet {
  processing?: string;
  inference?: string;
}

export type StepKind = 'transcribe' | 'listen' | 'assist';

/** One step of a pipeline. Runs in order; later steps can use earlier outputs. */
export interface PipelineStep {
  id: string;
  kind: StepKind;
  /** transcribe: speech-to-text model; listen: audio-aware model. Assist uses its preset's tier. */
  model?: string;
  /** assist: inference preset id. */
  preset?: string;
  /** Step-specific instructions, applied at the run level of the chain. */
  instructions: string;
  /** 'show' puts the output in the session; 'collapse' keeps it behind the turn's summary line. */
  output: 'show' | 'collapse';
  /** listen: also give the model the transcript from the nearest earlier Transcribe step. */
  useTranscript?: boolean;
  /** assist: read the previous step's output, or all earlier outputs. */
  input?: 'previous' | 'all';
  /** transcribe: send only the parts with speech (default on). */
  skipSilence?: boolean;
}

export interface PipelineConfig {
  /** ISO-639-1 code for transcription and listening, or empty for auto-detect. */
  language: string;
  steps: PipelineStep[];
  /** When the pipeline runs: as soon as a recording stops (default), or when asked. */
  trigger?: 'stop' | 'request';
  /** With trigger 'request': an optional Assist preset run once over the whole batch. */
  batchPreset?: string | null;
}

export type Tier = 'little' | 'big';

export interface InferencePreset {
  id: string;
  name: string;
  tier: Tier;
  /** The task prompt for this preset (combined with the inference instruction chain). */
  prompt: string;
  /** Whether the preset may call agent tools. */
  tools: boolean;
  /** Output is a transformation of the input (e.g. cleanup), so long input is processed in chunks. */
  chunked?: boolean;
  builtin?: boolean;
}

export interface PipelinePreset {
  id: string;
  name: string;
  config: PipelineConfig;
  builtin?: boolean;
}

export interface ModelPreset {
  id: string;
  label: string;
  note?: string;
}

export interface TtsSettings {
  model: string;
  voice: string;
  /** Speak new inference responses automatically. */
  autoSpeak: boolean;
  speed: number;
}

export interface Settings {
  id: 'global';
  instructions: Required<InstructionSet>;
  pipeline: PipelineConfig;
  pipelinePresets: PipelinePreset[];
  inferencePresets: InferencePreset[];
  models: { little: string; big: string };
  littleOptions: ModelPreset[];
  bigOptions: ModelPreset[];
  sttOptions: ModelPreset[];
  audioOptions: ModelPreset[];
  tts: TtsSettings;
  /** Automatic pipeline runs estimated above this (USD) wait for approval. */
  costCeiling: number;
  /** Keep processing details and tool calls expanded. */
  showDetails: boolean;
  segmentSeconds: number;
  maxToolRounds: number;
  schemaNote?: string;
}

export interface Group extends Base {
  name: string;
  instructions: InstructionSet;
  pipeline: PipelineConfig | null;
  tts: Partial<TtsSettings> | null;
}

export interface Session extends Base {
  groupId: Id;
  title: string;
  instructions: InstructionSet;
  pipeline: PipelineConfig | null;
  tts: Partial<TtsSettings> | null;
  showDetails: boolean | null;
  lastActivityAt: number;
}

export type EntryKind =
  | 'recording'
  | 'user_message'
  | 'transcript'
  | 'audio_notes'
  | 'inference'
  | 'tool_call'
  | 'approval_request'
  | 'error';

export interface SourceRef {
  entryId: Id;
  /** Seconds within a recording. */
  start?: number;
  end?: number;
}

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export type EntryStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'waiting';

export interface Entry extends Base {
  sessionId: Id;
  groupId: Id;
  /** Entries sharing a turn are shown together: a recording and everything derived from it, or a message and its response. */
  turnId: Id;
  kind: EntryKind;
  runId?: Id;
  sourceRefs: SourceRef[];
  text: string;
  timestamps?: TimedText[];
  status: EntryStatus;
  /** 'primary' entries are always shown; 'detail' entries sit behind the turn summary. */
  visibility: 'primary' | 'detail';
  title?: string;
  meta?: Record<string, unknown>;
}

export type CaptureState = 'recording' | 'complete' | 'interrupted';

export interface Recording {
  id: Id;
  entryId: Id;
  sessionId: Id;
  sampleRate: number;
  duration: number;
  chunkCount: number;
  state: CaptureState;
  createdAt: number;
}

export interface AudioChunk {
  id: Id;
  recordingId: Id;
  index: number;
  /** Seconds. */
  start: number;
  end: number;
  /** Raw little-endian Int16 PCM, mono. */
  data: Blob;
}

export type RunKind = 'process' | 'infer';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_network'
  | 'awaiting_approval'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface Usage {
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  seconds?: number;
  characters?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Run extends Base {
  sessionId: Id;
  groupId: Id;
  turnId: Id;
  kind: RunKind;
  /** process: 'stt' | 'audio'; infer: preset id. */
  mode: string;
  model: string;
  tier?: Tier;
  trigger: 'auto' | 'manual' | 'tool';
  settings: Record<string, unknown>;
  /** Resolved instruction snapshot sent with the request. */
  instructions: string;
  /** For infer: the user's request text, if any. */
  request?: string;
  sourceRefs: SourceRef[];
  /** Runs that must finish first (e.g. cleanup waits for its transcript). */
  dependsOn: Id[];
  status: RunStatus;
  error?: string;
  usage: Usage;
  estimatedCost?: number;
  outputEntryIds: Id[];
  /** Persisted conversation for tool-calling inference, so it can resume after approval. */
  messages?: ChatMessage[];
  toolRounds?: number;
  pendingToolCallId?: string;
  startedAt?: number;
  finishedAt?: number;
}

export type SegmentStatus = 'pending' | 'requesting' | 'done' | 'failed' | 'uncertain';

export interface Segment {
  id: Id;
  runId: Id;
  index: number;
  /** Recording time covered (first speech start to last speech end when silence is skipped). */
  start: number;
  end: number;
  /** When silence is skipped: the speech regions sent, joined with short gaps. */
  regions?: { start: number; end: number }[];
  status: SegmentStatus;
  attempts: number;
  text?: string;
  timestamps?: TimedText[];
  usage?: Usage;
  error?: string;
}

export interface SearchRecord {
  id: Id;
  groupId: Id;
  sessionId: Id;
  entryId: Id;
  kind: EntryKind;
  text: string;
  title: string;
  createdAt: number;
}

export interface TtsCacheItem {
  id: Id;
  entryId: Id;
  key: string;
  /** Sequence of mp3 parts, played in order. */
  parts: Blob[];
  characters: number;
  cost: number;
  createdAt: number;
}
