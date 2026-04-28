'use client';
import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TouchImageViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  urls: string[];
  initialIndex?: number;
  title?: string;
}

export function TouchImageViewer({ open, onOpenChange, urls, initialIndex = 0, title }: TouchImageViewerProps) {
  const [idx, setIdx] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset transform when image changes or dialog opens
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [idx, open]);

  useEffect(() => {
    if (open) setIdx(initialIndex);
  }, [open, initialIndex]);

  const resetTransform = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handleZoom = useCallback((direction: 'in' | 'out') => {
    setScale(prev => {
      const next = direction === 'in' ? prev * 1.4 : prev / 1.4;
      const clamped = Math.max(1, Math.min(next, 8));
      if (clamped <= 1) setTranslate({ x: 0, y: 0 });
      return clamped;
    });
  }, []);

  // Pinch-to-zoom + touch pan
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      lastTouchRef.current = null;
    } else if (e.touches.length === 1 && scale > 1) {
      // Pan start (only when zoomed in)
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setIsDragging(true);
    }
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
      // Pinch zoom
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / lastPinchDistRef.current;
      lastPinchDistRef.current = dist;
      setScale(prev => Math.max(1, Math.min(prev * ratio, 8)));
    } else if (e.touches.length === 1 && lastTouchRef.current && scale > 1) {
      // Pan
      e.preventDefault();
      const dx = e.touches[0].clientX - lastTouchRef.current.x;
      const dy = e.touches[0].clientY - lastTouchRef.current.y;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  }, [scale]);

  const handleTouchEnd = useCallback(() => {
    lastPinchDistRef.current = null;
    lastTouchRef.current = null;
    setIsDragging(false);
    // Reset pan if zoomed out
    setScale(prev => {
      if (prev <= 1) {
        setTranslate({ x: 0, y: 0 });
        return 1;
      }
      return prev;
    });
  }, []);

  // Mouse drag for desktop
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    lastTouchRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  }, [scale]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !lastTouchRef.current || scale <= 1) return;
    const dx = e.clientX - lastTouchRef.current.x;
    const dy = e.clientY - lastTouchRef.current.y;
    lastTouchRef.current = { x: e.clientX, y: e.clientY };
    setTranslate(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, [isDragging, scale]);

  const handleMouseUp = useCallback(() => {
    lastTouchRef.current = null;
    setIsDragging(false);
  }, []);

  // Double-tap to toggle zoom
  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap
      if (scale > 1) {
        resetTransform();
      } else {
        setScale(2.5);
      }
    }
    lastTapRef.current = now;
  }, [scale, resetTransform]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY < 0 ? 'in' : 'out';
    handleZoom(direction);
  }, [handleZoom]);

  if (urls.length === 0) return null;

  const currentUrl = urls[idx] || urls[0];
  const hasMultiple = urls.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl p-0 gap-0 overflow-hidden bg-black/95 border-none [&>button]:text-white [&>button]:hover:text-white [&>button]:bg-white/20 [&>button]:hover:bg-white/30">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-black/80">
          <span className="text-white text-sm font-medium">
            {title || (hasMultiple ? `Bild ${idx + 1} / ${urls.length}` : 'Bild')}
          </span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/20" onClick={() => handleZoom('out')} disabled={scale <= 1}>
              <ZoomOut className="w-4 h-4" />
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/20" onClick={() => handleZoom('in')} disabled={scale >= 8}>
              <ZoomIn className="w-4 h-4" />
            </Button>
            {scale > 1 && (
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-white hover:bg-white/20" onClick={resetTransform}>
                <RotateCcw className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Image area */}
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden select-none"
          style={{ aspectRatio: '4/3', touchAction: scale > 1 ? 'none' : 'pan-y', cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleDoubleTap}
          onWheel={handleWheel}
        >
          <img
            src={currentUrl}
            alt={`Bild ${idx + 1}`}
            className="w-full h-full object-contain transition-transform"
            style={{
              transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
              transitionDuration: isDragging ? '0ms' : '150ms',
            }}
            draggable={false}
          />

          {/* Navigation arrows */}
          {hasMultiple && idx > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resetTransform(); setIdx(i => i - 1); }}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70 z-10"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          {hasMultiple && idx < urls.length - 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); resetTransform(); setIdx(i => i + 1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70 z-10"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          {/* Zoom indicator */}
          {scale > 1 && (
            <span className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full z-10">
              {Math.round(scale * 100)}%
            </span>
          )}
        </div>

        {/* Thumbnails */}
        {hasMultiple && (
          <div className="flex gap-2 justify-center py-2 px-3 bg-black/80">
            {urls.map((url, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { resetTransform(); setIdx(i); }}
                className={`w-12 h-12 rounded border overflow-hidden bg-black shrink-0 transition-all ${
                  i === idx ? 'ring-2 ring-white border-white' : 'opacity-50 hover:opacity-80 border-gray-600'
                }`}
              >
                <img src={url} alt={`Vorschau ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
