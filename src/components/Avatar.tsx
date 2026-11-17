// Soft colours with dark text that passes contrast (same palette as the mockups).
const COLORS = [
  { bg: '#FDE2C8', fg: '#7C2D12' },
  { bg: '#D6E8F5', fg: '#1E3A5F' },
  { bg: '#E3DDF5', fg: '#3B2A6B' },
  { bg: '#D9EFDF', fg: '#14532D' },
  { bg: '#F8D7DA', fg: '#7F1D1D' },
  { bg: '#FCEFC7', fg: '#713F12' },
];

function pick(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function Avatar({ name, seed, size = 46, online }: { name: string; seed: string; size?: number; online?: boolean }) {
  const { bg, fg } = pick(seed);
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || '?'}
      {online && <span className="avatar__online" />}
    </span>
  );
}
