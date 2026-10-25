/** Default texts from earlier versions, replaced when they were never customised. */
export const OLD_PROCESSING_INSTRUCTIONS_V1 = `Describe only what is in the audio. Distinguish clearly between:
- Observations: what you can hear (words, pauses, hesitations, emphasis, self-corrections, pronunciation).
- Interpretations: what those observations might mean.
- Uncertainty: anything you could not hear clearly or are unsure about.
Keep the speaker's own words. Do not answer questions the speaker asks themselves.`;

export const OLD_LANGUAGE_PRACTICE_V1 = `The speaker is practising a language they are learning. Give:
1. A verbatim transcript, including hesitations and fillers.
2. Notes on pronunciation, stress, intonation, pauses, and fluency, tied to specific words.
Separate what you heard from your interpretation, and say when you are unsure.`;

/** v2 defaults (shorter notes, no transcript), replaced in v4 by "write your own transcript" defaults. */
export const OLD_PROCESSING_INSTRUCTIONS_V2 = `Note only what is worth knowing about how things were said: mispronounced or unclear words, notable pauses or hesitations, self-corrections, and emphasis that changes the meaning.
- Be brief: at most a few short bullet points, each naming the words concerned.
- If nothing stands out, reply with one short line saying so.
- Do not describe the speaker's voice, gender or the recording quality, and do not guess at the purpose of the recording.
- Mark anything you are unsure about with "(unsure)".`;

export const OLD_LANGUAGE_PRACTICE_V2 = `The speaker is practising a language they are learning. Focus on pronunciation, stress, intonation and fluency, tied to specific words. Keep it to the few points that matter most for improving.`;
