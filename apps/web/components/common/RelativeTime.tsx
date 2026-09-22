'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

export function RelativeTime({ date }: { date: string | Date }) {
  const [timeStr, setTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      try {
        const d = new Date(date);
        setTimeStr(formatDistanceToNow(d, { addSuffix: true }));
      } catch {
        setTimeStr('Unknown time');
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [date]);

  if (!timeStr) {
    return <span className="opacity-0">Loading...</span>; // Prevent layout shift before hydration
  }

  return <span>{timeStr}</span>;
}
