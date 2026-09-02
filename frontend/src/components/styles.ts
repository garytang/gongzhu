import type { CSSProperties } from 'react';

/** Page container: fluid below its maximum width so phones never scroll sideways. */
export const page: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  margin: '0 auto',
  padding: 16,
  boxSizing: 'border-box',
};

export const overlay: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
  boxSizing: 'border-box',
  zIndex: 1000,
};

export const modalCard: CSSProperties = {
  background: '#fff',
  color: '#222',
  padding: 20,
  borderRadius: 12,
  width: 'min(500px, 100%)',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxSizing: 'border-box',
};

export const button: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid #bbb',
  background: '#fff',
  fontSize: 15,
  cursor: 'pointer',
};

export const primaryButton: CSSProperties = {
  ...button,
  border: 'none',
  background: '#1976D2',
  color: '#fff',
  fontWeight: 'bold',
};

/** Team 1 reads blue, team 2 reads sand; 0 means "team unknown". */
export function teamBackground(team: 0 | 1 | 2): string {
  if (team === 1) return '#e3eafc';
  if (team === 2) return '#f5e9da';
  return '#f5f5f5';
}
