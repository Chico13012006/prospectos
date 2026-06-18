type SdrName = 'Francisco' | 'Silmara';

const CONFIG: Record<SdrName, { bg: string; border: string; color: string; dot: string; initials: string }> = {
  Francisco: { bg: '#EEEDFE', border: '#AFA9EC', color: '#3C3489', dot: '#7F77DD', initials: 'FR' },
  Silmara:   { bg: '#E1F5EE', border: '#5DCAA5', color: '#085041', dot: '#1D9E75', initials: 'SI' },
};

function getConfig(name: string) {
  const c = CONFIG[name as SdrName];
  return c ?? { bg: '#f3f4f6', border: '#d1d5db', color: '#374151', dot: '#9ca3af', initials: name.slice(0, 2).toUpperCase() };
}

export function SdrPill({ name }: { name: string }) {
  const c = getConfig(name);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      borderRadius: 20, padding: '3px 9px 3px 6px',
      fontSize: 11, fontWeight: 500, lineHeight: 1.4,
      backgroundColor: c.bg, border: `0.5px solid ${c.border}`, color: c.color,
    }}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: c.dot, flexShrink: 0 }} />
      {name}
    </span>
  );
}

export function SdrCircle({ name }: { name: string }) {
  const c = getConfig(name);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 44, height: 44, borderRadius: '50%',
      backgroundColor: c.bg, border: `2px solid ${c.dot}`, color: c.color,
      fontSize: 14, fontWeight: 500, flexShrink: 0, letterSpacing: '0.03em',
    }}>
      {c.initials}
    </span>
  );
}
