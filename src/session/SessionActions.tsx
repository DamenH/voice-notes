import { useState } from 'react';
import { deleteSession, renameSession } from '../lib/library';
import { download, exportSession, type SessionExportKind } from '../lib/sessionExport';
import type { Session } from '../lib/types';
import { navigate, useRoute } from '../app/router';
import { useRecorder } from '../app/hooks';
import { Icon, type IconName } from '../ui/Icon';
import { Dialog, confirmAction, toast, type MenuItem } from '../ui/primitives';

/** Rename / Export / Delete for one session, plus the export dialog it may open. */
export function useSessionActions(session: Session | undefined) {
  const [exporting, setExporting] = useState(false);
  const route = useRoute();
  const rec = useRecorder();
  if (!session) return { items: [] as MenuItem[], dialog: null };

  const items: MenuItem[] = [
    {
      label: 'Rename',
      icon: 'pencil',
      onSelect: () => {
        const t = prompt('Session name', session.title);
        if (t?.trim()) void renameSession(session.id, t.trim());
      },
    },
    { label: 'Export…', icon: 'download', onSelect: () => setExporting(true) },
    {
      label: 'Delete session',
      icon: 'trash',
      danger: true,
      disabled: rec.state !== 'idle' && rec.sessionId === session.id,
      onSelect: () => {
        if (!confirmAction(`Delete “${session.title}” and all its recordings? This cannot be undone.`)) return;
        const here = route.name === 'session' && route.sessionId === session.id;
        void deleteSession(session.id).then(() => {
          toast('Session deleted');
          if (here) navigate({ name: 'group', groupId: session.groupId });
        });
      },
    },
  ];
  const dialog = exporting ? <ExportDialog session={session} onClose={() => setExporting(false)} /> : null;
  return { items, dialog };
}

const OPTIONS: { kind: SessionExportKind; icon: IconName; title: string; detail: string }[] = [
  { kind: 'text', icon: 'text', title: 'Text', detail: 'Messages, transcripts, notes and responses as a Markdown file.' },
  { kind: 'audio', icon: 'wave', title: 'Audio', detail: 'The recordings as WAV files (zipped when there are several).' },
  { kind: 'dump', icon: 'folder', title: 'Everything', detail: 'All entries, runs and audio in a zip you can import again in Settings → Storage.' },
];

function ExportDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [busy, setBusy] = useState<SessionExportKind | null>(null);
  const run = async (kind: SessionExportKind) => {
    setBusy(kind);
    try {
      const { blob, filename } = await exportSession(session.id, kind);
      download(blob, filename);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog title={`Export “${session.title}”`} onClose={onClose}>
      <div className="flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            disabled={!!busy}
            onClick={() => void run(o.kind)}
            className="flex items-start gap-3 rounded-xl border border-hairline px-4 py-3 text-left transition hover:border-accent hover:bg-accent-soft disabled:opacity-50"
          >
            <Icon name={o.icon} className="mt-0.5 text-accent" />
            <span className="flex-1">
              <span className="block text-[15px] font-semibold">{busy === o.kind ? 'Preparing…' : o.title}</span>
              <span className="block text-[13px] text-muted">{o.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
