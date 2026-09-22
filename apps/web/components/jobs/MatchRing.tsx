import type { PriorityBand } from '@jobsentinel/types';
import { cn } from '@/lib/utils';

const BAND_CLASS: Record<PriorityBand, string> = {
  VERY_HIGH: 'text-success',
  HIGH: 'text-primary',
  MEDIUM: 'text-warning',
  OTHER: 'text-muted-foreground',
};

/**
 * The match score as a ring. A number alone reads as a grade; the ring makes "how close to a
 * great fit" legible at a glance, and the colour carries the priority band without extra text.
 */
export function MatchRing({
  score,
  priority,
  size = 44,
  className,
}: {
  score: number;
  priority: PriorityBand;
  size?: number;
  className?: string;
}) {
  const stroke = size >= 56 ? 5 : 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));

  return (
    <div
      className={cn('relative shrink-0', BAND_CLASS[priority], className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Match ${clamped} percent, ${priority.replace('_', ' ').toLowerCase()} priority`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-current opacity-15"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="stroke-current transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span
        className="absolute inset-0 grid place-items-center font-semibold tabular-nums"
        style={{ fontSize: size >= 56 ? 15 : 12 }}
      >
        {clamped}
      </span>
    </div>
  );
}
