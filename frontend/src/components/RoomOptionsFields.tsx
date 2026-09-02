import React from 'react';
import type { RoomOptions } from '../PlayerContext';

interface RoomOptionsFieldsProps {
  options: RoomOptions;
  /** Omitted for anyone but the host, who is the only one allowed to change them. */
  onChange?: (options: RoomOptions) => void;
}

const row: React.CSSProperties = { display: 'block', marginBottom: 8 };
const field: React.CSSProperties = { padding: '0.4rem', marginLeft: 8 };

/** One label per value, so the editable and read-only views always agree. */
const VARIANT_LABEL: Record<RoomOptions['variant'], string> = {
  standard: 'Standard',
  pips: 'Pip values (4♥ counts)',
};

const VISIBILITY_LABEL: Record<RoomOptions['visibility'], string> = {
  public: 'Public — listed in the lobby',
  private: 'Private — invite link only',
};

const DISCONNECT_LABEL: Record<RoomOptions['onDisconnect'], string> = {
  bot: 'A bot takes over the seat',
  lobby: 'End the hand and wait in the room',
};

/** The room's rules, editable when `onChange` is given and read-only otherwise. */
export default function RoomOptionsFields({ options, onChange }: RoomOptionsFieldsProps) {
  if (!onChange) {
    return (
      <div style={{ color: '#444' }}>
        <div>Hearts: {VARIANT_LABEL[options.variant]}</div>
        <div>Scoring: {options.teams ? 'teams' : 'individuals'}</div>
        <div>Target score: {options.targetScore}</div>
        <div>Visibility: {VISIBILITY_LABEL[options.visibility]}</div>
        <div>If someone drops: {DISCONNECT_LABEL[options.onDisconnect]}</div>
      </div>
    );
  }

  const set = <K extends keyof RoomOptions>(key: K, value: RoomOptions[K]) =>
    onChange({ ...options, [key]: value });

  return (
    <div>
      <label style={row}>
        Hearts
        <select
          value={options.variant}
          aria-label="Hearts"
          style={field}
          onChange={e => set('variant', e.target.value as RoomOptions['variant'])}
        >
          {Object.entries(VARIANT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <label style={row}>
        <input
          type="checkbox"
          checked={options.teams}
          onChange={e => set('teams', e.target.checked)}
        />{' '}
        Play in teams
      </label>

      <label style={row}>
        Target score
        <input
          type="number"
          value={options.targetScore}
          aria-label="Target score"
          min={1}
          style={{ ...field, width: 100 }}
          onChange={e => set('targetScore', Number(e.target.value))}
        />
      </label>

      <label style={row}>
        Visibility
        <select
          value={options.visibility}
          aria-label="Visibility"
          style={field}
          onChange={e => set('visibility', e.target.value as RoomOptions['visibility'])}
        >
          {Object.entries(VISIBILITY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <label style={row}>
        If someone drops
        <select
          value={options.onDisconnect}
          aria-label="If someone drops"
          style={field}
          onChange={e => set('onDisconnect', e.target.value as RoomOptions['onDisconnect'])}
        >
          {Object.entries(DISCONNECT_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
