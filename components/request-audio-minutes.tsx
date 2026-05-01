'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { PlusCircle } from 'lucide-react';

const OPTIONS = [30, 60, 120] as const;

export function RequestAudioMinutes() {
  const [loadingOption, setLoadingOption] = useState<number | null>(null);

  async function requestMinutes(requestedMinutes: number) {
    try {
      setLoadingOption(requestedMinutes);
      const res = await fetch('/api/audio-minutes/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedMinutes }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Anfrage fehlgeschlagen');
      }

      toast.success(`${requestedMinutes} Minuten wurden angefragt`);
    } catch (error: any) {
      toast.error(error?.message || 'Anfrage fehlgeschlagen');
    } finally {
      setLoadingOption(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {OPTIONS.map((minutes) => (
        <Button
          key={minutes}
          size="sm"
          variant="outline"
          onClick={() => requestMinutes(minutes)}
          disabled={loadingOption !== null}
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          {loadingOption === minutes ? 'Sende…' : `${minutes} Min anfragen`}
        </Button>
      ))}
    </div>
  );
}
