import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { JobValidationSummary } from '@/lib/types/jobs';

export function VerificationBadge({ validation }: { validation: JobValidationSummary }) {
  if (validation.status === 'VALID') {
    return (
      <Badge variant="outline" className="text-green-600 border-green-600 gap-1 cursor-pointer">
        <ShieldCheck className="h-3 w-3" />
        Verified
      </Badge>
    );
  }

  if (validation.status === 'SUSPICIOUS') {
    return (
      <Badge variant="destructive" className="gap-1 cursor-pointer">
        <ShieldAlert className="h-3 w-3" />
        Suspicious
      </Badge>
    );
  }

  if (validation.status === 'NEEDS_REVIEW') {
    return (
      <Badge variant="secondary" className="gap-1 cursor-pointer">
        <ShieldQuestion className="h-3 w-3" />
        Unverified
      </Badge>
    );
  }

  return null;
}
