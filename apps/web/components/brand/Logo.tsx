import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The JobSentinel AI mark, from the same master SVG as the favicon and app icons
 * (public/icons/jobsentinel.svg). Decorative by default, because it almost always sits next to
 * the product name; pass `label` when it stands alone.
 */
export function Logo({
  size = 32,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Image
      src="/icons/jobsentinel.svg"
      alt={label ?? ''}
      width={size}
      height={size}
      // An SVG needs no resizing, and Next refuses to optimise SVGs by default.
      unoptimized
      className={cn('shrink-0', className)}
    />
  );
}
