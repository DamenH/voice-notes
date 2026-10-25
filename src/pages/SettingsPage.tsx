import { useEffect, useState } from 'react';
import { updateSettings } from '../lib/db';
import { disconnect, getKeySource, setApiKey, startOAuth } from '../lib/openrouter/auth';
import { getKeyInfo, friendlyError, type KeyInfo } from '../lib/openrouter/client';
import { exportLibrary, formatBytes, importLibrary, requestPersistence, storageStatus, type StorageStatus } from '../lib/backup';
import { clearSpeechCache, speechCacheSize } from '../lib/tts';
import { newId } from '../lib/ids';
import type { InferencePreset, Settings } from '../lib/types';
import { refreshCatalog, useApiKey, useDesktop } from '../app/hooks';
import { navigate } from '../app/router';
import { installState, promptInstall, useInstall } from '../app/pwa';
import { Button, Field, IconButton, Toggle, confirmAction, inputClass, toast } from '../ui/primitives';
import { ModelSelect } from '../panels/ModelSelect';
import { PipelineEditor } from '../panels/PipelineEditor';
import { InstructionsEditor, VoiceEditor } from '../panels/Panels';

const SECTIONS = [
  ['connection', 'Connection'],
  ['models', 'Models'],
  ['pipeline', 'Pipeline'],
  ['instructions', 'Instructions'],
  ['voice', 'Voice'],
  ['presets', 'Assistance presets'],
  ['display', 'Display & limits'],
  ['storage', 'Storage & backup'],
  ['app', 'App'],
] as const;

export function SettingsPage({ section, settings }: { section?: string; settings: Settings }) {
  const desktop = useDesktop();
  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: 'start' });
  }, [section]);
  return (
    <div className={desktop ? 'mx-auto flex max-w-5xl gap-8 px-6' : 'pb-16'}>
      {desktop ? (
        <nav aria-label="Settings sections" className="sticky top-0 hidden h-fit w-48 shrink-0 pt-8 wide:block">
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#/settings/${id}`} className="block rounded-lg px-3 py-1.5 text-[14px] text-muted hover:bg-surface-2 hover:text-text">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b border-hairline bg-bg/90 px-2 backdrop-blur-md" style={{ paddingTop: 'var(--safe-top)' }}>
          <IconButton icon="back" label="Back" onClick={() => navigate({ name: 'home' })} />
          <h1 className="px-2 text-[17px] font-bold">Settings</h1>
        </header>
      )}
      <div className={`min-w-0 flex-1 ${desktop ? 'pt-6 pb-16' : 'px-4 pt-4'}`}>
        {desktop && <h1 className="mb-6 text-2xl font-bold">Settings</h1>}
        <div className="flex flex-col gap-8">
          <Section id="connection" title="OpenRouter connection">
            <Connection />
          </Section>
          <Section id="models" title="Models" description="Little handles cleanup, formatting and quick help. Big handles demanding reasoning, synthesis and tutoring. Prices are shown with their units.">
            <div className="grid gap-4 wide:grid-cols-2">
              <ModelSelect label="Little" kind="chat" value={settings.models.little} options={settings.littleOptions} onChange={(little) => void updateSettings({ models: { ...settings.models, little } })} />
              <ModelSelect label="Big" kind="chat" value={settings.models.big} options={settings.bigOptions} onChange={(big) => void updateSettings({ models: { ...settings.models, big } })} />
            </div>
            <Button small variant="plain" icon="retry" onClick={() => void refreshCatalog(true).then(() => toast('Prices updated'))}>
              Refresh prices
            </Button>
          </Section>
          <Section id="pipeline" title="Default pipeline" description="What happens when a recording stops. Groups and sessions can override this.">
            <PipelineEditor settings={settings} initialScope="global" />
          </Section>
          <Section id="instructions" title="Default instructions">
            <InstructionsEditor settings={settings} scopeOverride="global" />
          </Section>
          <Section id="voice" title="Read-aloud voice">
            <VoiceEditor settings={settings} scopeOverride="global" />
          </Section>
          <Section id="presets" title="Assistance presets" description="Presets appear in the pipeline and in each entry's menu.">
            <Presets settings={settings} />
          </Section>
          <Section id="display" title="Display & limits">
            <Toggle
              label="Show processing details"
              description="Keep transcripts, runs and tool calls expanded instead of collapsed into one line. Sessions can override this."
              checked={settings.showDetails}
              onChange={(showDetails) => void updateSettings({ showDetails })}
            />
            <Field label="Automatic run limit (USD)" hint="Automatic pipeline runs estimated above this wait for your approval.">
              <input
                className={inputClass}
                type="number"
                min={0}
                step={0.05}
                value={settings.costCeiling}
                onChange={(e) => void updateSettings({ costCeiling: Math.max(0, Number(e.target.value) || 0) })}
              />
            </Field>
            <Field label="Audio segment length (seconds)" hint="Long recordings are processed in parts of about this length, cut at pauses.">
              <input
                className={inputClass}
                type="number"
                min={30}
                max={900}
                step={30}
                value={settings.segmentSeconds}
                onChange={(e) => void updateSettings({ segmentSeconds: Math.min(900, Math.max(30, Number(e.target.value) || 300)) })}
              />
            </Field>
            <Field label="Tool rounds per response" hint="How many times a model may search or read before it must answer.">
              <input
                className={inputClass}
                type="number"
                min={1}
                max={12}
                value={settings.maxToolRounds}
                onChange={(e) => void updateSettings({ maxToolRounds: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })}
              />
            </Field>
            <Theme />
          </Section>
          <Section id="storage" title="Storage & backup">
            <Storage />
          </Section>
          <Section id="app" title="App">
            <AppSection />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={`settings-${id}`} className="scroll-mt-20 rounded-2xl border border-hairline bg-surface p-5">
      <h2 className="text-[17px] font-bold">{title}</h2>
      {description && <p className="mt-1 text-[14px] text-muted">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Connection() {
  const key = useApiKey();
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  useEffect(() => {
    setInfo(null);
    setError(null);
    if (key) getKeyInfo().then(setInfo, (e) => setError(friendlyError(e)));
  }, [key]);
  if (key) {
    return (
      <>
        <p className="text-[15px]">
          <span className="mr-2 inline-block size-2.5 rounded-full bg-ok" />
          Connected {getKeySource() === 'oauth' ? 'with your OpenRouter account' : 'with an API key'}.
        </p>
        {info && (
          <p className="text-[14px] text-muted">
            Used ${info.usage.toFixed(2)}
            {info.limit !== null ? ` of $${info.limit.toFixed(2)} limit · $${(info.limitRemaining ?? 0).toFixed(2)} left` : ''}
          </p>
        )}
        {error && <p className="text-[14px] text-rec">{error}</p>}
        <p className="text-[13px] text-muted">
          Your key is stored only in this browser, separately from your library, and is never included in exports. Model requests go directly from this device to OpenRouter.
        </p>
        <div>
          <Button
            variant="danger"
            small
            onClick={() => {
              if (confirmAction('Disconnect from OpenRouter on this device?')) disconnect();
            }}
          >
            Disconnect
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="text-[15px]">Connect your OpenRouter account to transcribe, listen with Inkling, get help and read aloud. You pay OpenRouter directly for what you use.</p>
      <div>
        <Button variant="primary" icon="link" onClick={() => void startOAuth()}>
          Connect OpenRouter
        </Button>
      </div>
      <details className="text-[14px]">
        <summary className="cursor-pointer font-semibold text-muted">Use an API key instead</summary>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim().startsWith('sk-')) {
              setApiKey(manual.trim(), 'manual');
              setManual('');
            } else toast('That does not look like an OpenRouter key.', 'error');
          }}
        >
          <input className={inputClass} type="password" autoComplete="off" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="sk-or-…" aria-label="OpenRouter API key" />
          <Button type="submit">Save</Button>
        </form>
      </details>
    </>
  );
}

function Presets({ settings }: { settings: Settings }) {
  const update = (id: string, patch: Partial<InferencePreset>) =>
    void updateSettings({ inferencePresets: settings.inferencePresets.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  return (
    <>
      {settings.inferencePresets.map((p) => (
        <details key={p.id} className="rounded-xl border border-hairline">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-[15px] font-semibold">
            <span className="flex-1">{p.name}</span>
            <span className="text-[13px] font-normal text-muted">{p.tier === 'big' ? 'Big' : 'Little'}</span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-hairline p-3">
            <Field label="Name">
              <input className={inputClass} value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
            </Field>
            <Field label="Model size">
              <select className={inputClass} value={p.tier} onChange={(e) => update(p.id, { tier: e.target.value as 'little' | 'big' })}>
                <option value="little">Little</option>
                <option value="big">Big</option>
              </select>
            </Field>
            <Field label="Prompt">
              <textarea className={`${inputClass} min-h-32`} value={p.prompt} onChange={(e) => update(p.id, { prompt: e.target.value })} />
            </Field>
            <Toggle label="Can search and read other sessions" checked={p.tools} onChange={(tools) => update(p.id, { tools })} />
            {!p.builtin && (
              <div>
                <Button small variant="plain" icon="trash" onClick={() => void updateSettings({ inferencePresets: settings.inferencePresets.filter((x) => x.id !== p.id) })}>
                  Delete preset
                </Button>
              </div>
            )}
          </div>
        </details>
      ))}
      <div>
        <Button
          small
          icon="plus"
          onClick={() =>
            void updateSettings({
              inferencePresets: [...settings.inferencePresets, { id: newId('ip'), name: 'New preset', tier: 'little', prompt: 'Describe the task.', tools: false }],
            })
          }
        >
          Add preset
        </Button>
      </div>
    </>
  );
}

function Theme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('vn.theme') ?? 'system');
  return (
    <Field label="Appearance">
      <select
        className={inputClass}
        value={theme}
        onChange={(e) => {
          const v = e.target.value;
          setTheme(v);
          try {
            localStorage.setItem('vn.theme', v);
          } catch {
            /* ignore */
          }
          applyTheme();
        }}
      >
        <option value="system">Match system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </Field>
  );
}

export function applyTheme() {
  let t = 'system';
  try {
    t = localStorage.getItem('vn.theme') ?? 'system';
  } catch {
    /* ignore */
  }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function Storage() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [tts, setTts] = useState<{ items: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void storageStatus().then(setStatus);
    void speechCacheSize().then(setTts);
  };
  useEffect(refresh, []);
  const doExport = async () => {
    setBusy(true);
    try {
      const blob = await exportLibrary();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `voice-notes-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const s = await importLibrary(file);
      toast(`Imported ${s.added.sessions ?? 0} sessions and ${s.added.entries ?? 0} entries${s.skipped ? ` (${s.skipped} already here)` : ''}.`);
      refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {status?.supported ? (
        <>
          <div>
            <div className="mb-1 flex justify-between text-[14px]">
              <span>{formatBytes(status.usage)} used</span>
              <span className="text-muted">{formatBytes(status.quota)} available to this app</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, (status.usage / Math.max(1, status.quota)) * 100)}%` }} />
            </div>
            <p className="mt-1 text-[13px] text-muted">Recordings use about 115 MB per hour.</p>
          </div>
          {status.persisted ? (
            <p className="text-[14px] text-muted">Storage is persistent: the browser won't clear it to free space.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1 text-[14px] text-muted">The browser may clear this app's data when space runs low. Ask it to keep your recordings safe.</p>
              <Button small onClick={() => void requestPersistence().then((ok) => (toast(ok ? 'Storage is now persistent.' : 'The browser declined. Installing the app usually helps.'), refresh()))}>
                Keep my data
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-[14px] text-muted">This browser doesn't report storage use.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button icon="download" onClick={() => void doExport()} disabled={busy}>
          Export library
        </Button>
        <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-hairline bg-surface-2 px-4 text-sm font-semibold hover:bg-surface-3 pointer-fine:min-h-9 ${busy ? 'opacity-50' : ''}`}>
          <input type="file" accept=".zip,application/zip" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
          Import library
        </label>
      </div>
      <p className="text-[13px] text-muted">Exports include recordings, transcripts, responses and settings — never your OpenRouter key. Importing merges: items already on this device are kept.</p>
      {tts && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-[14px] text-muted">
            Read-aloud cache: {tts.items} item{tts.items === 1 ? '' : 's'}, {formatBytes(tts.bytes)}
          </p>
          <Button small variant="plain" icon="trash" disabled={!tts.items} onClick={() => void clearSpeechCache().then(refresh)}>
            Clear
          </Button>
        </div>
      )}
    </>
  );
}

function AppSection() {
  const install = useInstall();
  return (
    <>
      {install.canInstall && (
        <div>
          <Button variant="primary" icon="download" onClick={() => void promptInstall()}>
            Install Voice Notes
          </Button>
        </div>
      )}
      {install.installed && <p className="text-[14px] text-muted">Installed as an app.</p>}
      {!install.canInstall && !install.installed && (
        <p className="text-[14px] text-muted">To install, use your browser's “Install app” or “Add to Home screen” option.</p>
      )}
      <p className="text-[13px] text-muted">
        Recording, playback, browsing and editing work offline. Transcription, Inkling, assistance and read-aloud need a connection; they wait and run when you're back online.
      </p>
      <p className="text-[13px] text-faint">Version {installState.version}</p>
    </>
  );
}
