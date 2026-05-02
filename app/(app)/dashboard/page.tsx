tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, ClipboardList, FileText, FileCheck, Plus, ArrowRight, Calendar, AlertTriangle, Users, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { ORDER_STATUS_STYLES, OFFER_STATUS_STYLES, INVOICE_STATUS_STYLES, getStatusStyle } from '@/lib/status-colors';
import { AudioUsageCard, type AudioUsageData } from '@/components/audio-usage-card';

interface ReviewData {
  total: number;
  incompleteCustomers: number;
  uncertainAssignments: number;
}

interface DashboardData {
  activeOrders: number;
  activeOffers: number;
  totalInvoices: number;
  needsReview: number;
  review: ReviewData;
  recentOrders: any[];
  recentOffers: any[];
  recentInvoices: any[];
  audioUsage?: AudioUsageData;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const handleCheckout = async () => {
    const res = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert('Fehler beim Starten des Checkouts');
    }
  };

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const res = await fetch('/api/dashboard');
        const d = await res.json();
        setData(d);
      } finally {
        setLoading(false);
      }
    };
    loadDashboard();
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-primary" /> Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Übersicht aller Aktivitäten</p>
        </div>

        {/* 🔥 HIER IST DEIN BUTTON BLOCK */}
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Link href="/auftraege?new=1" className="w-full sm:w-auto">
            <Button size="sm" className="w-full sm:w-auto justify-center">
              <Plus className="w-4 h-4 mr-1.5" /> Neuer Auftrag
            </Button>
          </Link>

          <Link href="/angebote?new=1" className="w-full sm:w-auto">
            <Button size="sm" variant="outline" className="w-full sm:w-auto justify-center">
              <FileCheck className="w-4 h-4 mr-1.5" /> Neues Angebot
            </Button>
          </Link>

          <Link href="/rechnungen?new=1" className="w-full sm:w-auto">
            <Button size="sm" variant="outline" className="w-full sm:w-auto justify-center">
              <FileText className="w-4 h-4 mr-1.5" /> Neue Rechnung
            </Button>
          </Link>

          {/* ✅ DAS IST DER NEUE BUTTON */}
          <Button
            size="sm"
            onClick={handleCheckout}
            className="w-full sm:w-auto justify-center bg-green-600 hover:bg-green-700 text-white"
          >
            Abo starten
          </Button>
        </div>
      </div>
    </div>
  );
}

