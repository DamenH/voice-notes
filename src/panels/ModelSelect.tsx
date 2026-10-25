import { useState } from 'react';
import { describePrice, catalogModel, type ModelKind } from '../lib/openrouter/catalog';
import type { ModelPreset } from '../lib/types';
import { useCatalog } from '../app/hooks';
import { Field, inputClass } from '../ui/primitives';

/** Model picker: curated presets first, any catalog model by id, with the current price and its unit. */
export function ModelSelect({
  label,
  value,
  options,
  onChange,
  kind,
  requireAudio,
}: {
  label: string;
  value: string;
  options: ModelPreset[];
  onChange: (id: string) => void;
  kind: ModelKind;
  requireAudio?: boolean;
}) {
  const catalog = useCatalog();
  const inOptions = options.some((o) => o.id === value);
  const [custom, setCustom] = useState(!inOptions);
  const listId = `models-${label.replace(/\W/g, '')}`;
  const candidates = catalog.filter((m) => m.kind === kind && (!requireAudio || m.inputModalities.includes('audio')));
  const model = catalogModel(value);
  const note = options.find((o) => o.id === value)?.note;
  return (
    <Field
      label={label}
      hint={
        <>
          {note && <span className="block">{note}</span>}
          <span className={model ? '' : 'text-warn'}>{catalog.length ? describePrice(model) : 'Prices load when online.'}</span>
        </>
      }
    >
      {custom ? (
        <div className="flex gap-2">
          <input
            className={inputClass}
            list={listId}
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder="provider/model-id"
            aria-label={`${label} model id`}
          />
          <datalist id={listId}>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          <button type="button" className="shrink-0 text-[13px] font-semibold text-accent" onClick={() => setCustom(false)}>
            Presets
          </button>
        </div>
      ) : (
        <select
          className={inputClass}
          value={value}
          onChange={(e) => (e.target.value === '__custom' ? setCustom(true) : onChange(e.target.value))}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          <option value="__custom">Other model…</option>
        </select>
      )}
    </Field>
  );
}
