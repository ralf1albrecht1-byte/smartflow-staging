'use client';
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface MwStControlProps {
  vatRate: number;
  onChange: (rate: number) => void;
}

export function MwStControl({ vatRate, onChange }: MwStControlProps) {
  const isEnabled = vatRate > 0;
  const handleToggle = (checked: boolean) => {
    if (checked) {
      onChange(8.1); // default when turning on
    } else {
      onChange(0);
    }
  };

  const handleStep = (direction: 'up' | 'down') => {
    const current = vatRate;
    const step = 0.1;
    const next = direction === 'up'
      ? Math.round((current + step) * 10) / 10
      : Math.round((current - step) * 10) / 10;
    if (next < 0) return;
    if (next > 20) return;
    onChange(next);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || val === '0') {
      onChange(0);
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0 && num <= 20) {
      onChange(Math.round(num * 10) / 10);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">MwSt.</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{isEnabled ? 'An' : 'Aus'}</span>
          <Switch checked={isEnabled} onCheckedChange={handleToggle} />
        </div>
      </div>

      {isEnabled && (
        <div className="space-y-2">
          {/* Number input with arrows */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center">
              <input
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={vatRate}
                onChange={handleInputChange}
                className="w-20 h-8 rounded-md border border-input bg-background px-2 py-1 text-sm text-center font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="ml-1 text-sm text-muted-foreground">%</span>
            </div>
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => handleStep('up')}
                className="h-4 w-5 flex items-center justify-center rounded-t border border-input bg-background hover:bg-muted text-muted-foreground"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => handleStep('down')}
                className="h-4 w-5 flex items-center justify-center rounded-b border border-t-0 border-input bg-background hover:bg-muted text-muted-foreground"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
