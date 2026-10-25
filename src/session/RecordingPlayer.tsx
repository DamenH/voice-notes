import { pausePlayback, playRecording, playback, useStore } from '../app/stores';
import { Icon } from '../ui/Icon';

export function RecordingPlayer({ entryId, recordingId, duration }: { entryId: string; recordingId: string; duration: number }) {
  const p = useStore(playback);
  const mine = p.entryId === entryId;
  const playing = mine && p.playing;
  const loading = mine && p.loading;
  return (
    <button
      type="button"
      aria-label={playing ? 'Pause recording' : 'Play recording'}
      onClick={() => (playing ? pausePlayback() : void playRecording(entryId, recordingId, duration, mine && p.time < duration - 0.5 ? undefined : 0))}
      className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-text transition hover:brightness-110 active:scale-95"
    >
      {loading ? (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <Icon name={playing ? 'pause' : 'play'} size={18} strokeWidth={playing ? 2.4 : 1.8} />
      )}
    </button>
  );
}
