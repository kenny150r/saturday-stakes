import { initials } from '../lib/format'

export function PlayerAvatar({
  name,
  color,
  size = 28,
}: {
  name: string
  color: string
  size?: number
}) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.max(10, size * 0.4),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function ChartAvatarDot({
  cx,
  cy,
  letter,
  color,
}: {
  cx?: number
  cy?: number
  letter: string
  color: string
}) {
  if (cx == null || cy == null) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill={color} stroke="#0a0a0a" strokeWidth={2} />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#fff"
        fontSize={10}
        fontWeight={700}
        fontFamily="Inter, system-ui, sans-serif"
      >
        {letter}
      </text>
    </g>
  )
}
