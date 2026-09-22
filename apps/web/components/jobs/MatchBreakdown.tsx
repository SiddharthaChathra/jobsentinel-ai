import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { JobMatchDetail } from '@/lib/types/jobs';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

export function MatchBreakdown({ match }: { match: JobMatchDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          Match Breakdown: {match.overallScore}%
          {match.aiPending && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              AI refinement pending
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {match.explanation && <p className="text-sm text-muted-foreground">{match.explanation}</p>}

        <div className="space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Skill Match</span>
              <span>{match.skillScore}%</span>
            </div>
            <Progress value={match.skillScore} />
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Role Match</span>
              <span>{match.roleScore}%</span>
            </div>
            <Progress value={match.roleScore} />
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Experience Level Match</span>
              <span>{match.experienceScore}%</span>
            </div>
            <Progress value={match.experienceScore} />
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Location Match</span>
              <span>{match.locationScore}%</span>
            </div>
            <Progress value={match.locationScore} />
          </div>
        </div>

        {match.matchedSkills.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Matched Skills</h4>
            <div className="flex flex-wrap gap-1">
              {match.matchedSkills.map((skill) => (
                <Badge
                  key={skill}
                  variant="secondary"
                  className="bg-green-100 text-green-800 hover:bg-green-100"
                >
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {match.missingSkills.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Missing Skills</h4>
            <div className="flex flex-wrap gap-1">
              {match.missingSkills.map((skill) => (
                <Badge key={skill} variant="outline" className="text-muted-foreground">
                  {skill}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
