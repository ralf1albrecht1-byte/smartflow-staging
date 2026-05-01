'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CreditCard } from 'lucide-react';

export function SubscribeButton() {
  const [loading, setLoading] = useState(false);

  async function handleSubscribe() {
    try {
      setLoading(true);
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Checkout konnte nicht gestartet werden');
      }

      window.location.href = data.url;
    } catch (error: any) {
      toast.error(error?.message || 'Fehler beim Starten des Abos');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleSubscribe} disabled={loading} size="sm">
      <CreditCard className="w-4 h-4 mr-1.5" />
      {loading ? 'Weiterleitung…' : 'Abo starten'}
    </Button>
  );
}
