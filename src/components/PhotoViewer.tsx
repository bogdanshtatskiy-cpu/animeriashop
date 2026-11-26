import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, ImageOff, Minus, Plus, X } from 'lucide-react';
import { telegram } from '../lib/telegram';

type Point = { x: number; y: number };
type View = Point & { scale: number };

const initialView = { x: 0, y: 0, scale: 1 };
const maxScale = 5;
const clamp = (number: number, min: number, max: number) => Math.min(max, Math.max(min, number));
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

interface Props {
  src: string;
  title: string;
  index: number;
  count: number;
  onMove: (direction: number) => void;
  onClose: () => void;
}

export default function PhotoViewer({ src, title, index, count, onMove, onClose }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const liveView = useRef(initialView);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; pinched: boolean; moved: boolean } | null>(null);
  const lastTap = useRef<{ point: Point; time: number } | null>(null);
  const [view, setView] = useState(initialView);
  const [loadedSrc, setLoadedSrc] = useState('');
  const [failedSrc, setFailedSrc] = useState('');
  const failed = failedSrc === src;
  const ready = loadedSrc === src && !failed;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const trigger = document.activeElement as HTMLElement | null;
    const app = telegram();
    const suspendSwipes = app?.initData && app.isVersionAtLeast('7.7') && app.isVerticalSwipesEnabled !== false;
    node.showModal();
    if (suspendSwipes) app?.disableVerticalSwipes?.();
    return () => {
      if (suspendSwipes) app?.enableVerticalSwipes?.();
      node.close();
      trigger?.focus({ preventScroll: true });
    };
  }, []);

  const applyView = useCallback((next: View) => {
    const frame = stage.current;
    const photo = image.current;
    if (!frame || !photo) return;
    const maxX = Math.max(0, (photo.clientWidth * next.scale - frame.clientWidth) / 2);
    const maxY = Math.max(0, (photo.clientHeight * next.scale - frame.clientHeight) / 2);
    const x = clamp(next.x, -maxX, maxX);
    const y = clamp(next.y, -maxY, maxY);
    const previous = liveView.current;
    if (previous.scale === next.scale && previous.x === x && previous.y === y) return;
    liveView.current = { x, y, scale: next.scale };
    setView(liveView.current);
  }, []);

  useLayoutEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    lastTap.current = null;
    liveView.current = initialView;
    setView(initialView);
  }, [src]);

  const zoomAt = useCallback((requested: number, from?: Point, to = from) => {
    const frame = stage.current;
    if (!frame) return;
    const previous = liveView.current;
    const scale = clamp(requested, 1, maxScale);
    if (!from || !to) {
      const ratio = scale / previous.scale;
      applyView({ x: previous.x * ratio, y: previous.y * ratio, scale });
      return;
    }
    const rect = frame.getBoundingClientRect();
    const ratio = scale / previous.scale;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    applyView({
      x: to.x - x - (from.x - x - previous.x) * ratio,
      y: to.y - y - (from.y - y - previous.y) * ratio,
      scale,
    });
  }, [applyView]);

  useEffect(() => {
    const frame = stage.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => applyView(liveView.current));
    observer.observe(frame);
    const wheel = (event: WheelEvent) => {
      if (!ready || !event.deltaY) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1);
      zoomAt(liveView.current.scale * Math.exp(-clamp(delta, -160, 160) * .003), { x: event.clientX, y: event.clientY });
    };
    frame.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      frame.removeEventListener('wheel', wheel);
    };
  }, [applyView, ready, zoomAt]);

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) gesture.current = { start: point, pinched: false, moved: false };
    else if (gesture.current) {
      gesture.current.pinched = true;
      lastTap.current = null;
    }
    pointers.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    if (gesture.current && distance(point, gesture.current.start) >= 12) gesture.current.moved = true;
    if (!ready) return;
    const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1];
    const current = liveView.current;
    if (other) {
      const ratio = distance(point, other) / Math.max(1, distance(previous, other));
      zoomAt(current.scale * ratio, midpoint(previous, other), midpoint(point, other));
    } else if (current.scale > 1) {
      applyView({ x: current.x + point.x - previous.x, y: current.y + point.y - previous.y, scale: current.scale });
    }
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId) || pointers.current.size) return;
    const end = { x: event.clientX, y: event.clientY };
    const motion = gesture.current;
    gesture.current = null;
    if (!motion || motion.pinched) return;
    const dx = end.x - motion.start.x;
    const dy = end.y - motion.start.y;
    const current = liveView.current;
    if (current.scale === 1 && count > 1 && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      lastTap.current = null;
      onMove(dx < 0 ? 1 : -1);
    } else if (ready && !motion.moved && distance(end, motion.start) < 12) {
      const time = performance.now();
      const last = lastTap.current;
      if (last && time - last.time < 340 && distance(end, last.point) < 30) {
        lastTap.current = null;
        if (current.scale > 1) applyView(initialView);
        else zoomAt(2.5, end);
      } else lastTap.current = { point: end, time };
    } else lastTap.current = null;
  }

  function cancelPointer(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (!pointers.current.size) gesture.current = null;
    lastTap.current = null;
  }

  return <dialog ref={dialog} className="photo-viewer" aria-labelledby={titleId} onCancel={event => {
    event.preventDefault();
    onClose();
  }} onKeyDown={event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const { key } = event;
    const current = liveView.current;
    if (ready && (key === '+' || key === '=' || key === '-' || key === '0')) {
      event.preventDefault();
      if (key === '0') applyView(initialView);
      else zoomAt(current.scale * (key === '-' ? 1 / 1.5 : 1.5));
    } else if (current.scale > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      event.preventDefault();
      const x = key === 'ArrowLeft' ? 60 : key === 'ArrowRight' ? -60 : 0;
      const y = key === 'ArrowUp' ? 60 : key === 'ArrowDown' ? -60 : 0;
      applyView({ x: current.x + x, y: current.y + y, scale: current.scale });
    } else if (count > 1 && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      onMove(key === 'ArrowLeft' ? -1 : 1);
    }
  }}>
    <div className="photo-viewer-layout">
      <header className="photo-viewer-heading">
        <h2 id={titleId}><span className="sr-only">Перегляд фото. </span>{title}</h2>
        <button type="button" className="icon-button" aria-label="Закрити перегляд фото" autoFocus onClick={onClose}><X size={22} strokeWidth={1.7} /></button>
      </header>
      <div ref={stage} className="photo-viewer-stage" data-zoomed={view.scale > 1}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}>
        {failed ? <p className="photo-viewer-error" role="status"><ImageOff size={25} strokeWidth={1.5} />Не вдалося завантажити фото.</p>
          : <img key={src} ref={image} src={src} alt={title} draggable={false} referrerPolicy="no-referrer"
            onLoad={() => { setLoadedSrc(src); setFailedSrc(''); }} onError={() => setFailedSrc(src)}
            style={{ transform: 'translate(-50%, -50%) translate3d(' + view.x + 'px, ' + view.y + 'px, 0) scale(' + view.scale + ')' }} />}
      </div>
      <footer className="photo-viewer-footer">
        {count > 1 && <div className="photo-viewer-controls" role="group" aria-label="Галерея">
          <button type="button" className="icon-button" aria-label="Попереднє фото" onClick={() => onMove(-1)}><ArrowLeft size={20} strokeWidth={1.6} /></button>
          <span className="photo-viewer-count" aria-live="polite">{index + 1} / {count}</span>
          <button type="button" className="icon-button" aria-label="Наступне фото" onClick={() => onMove(1)}><ArrowRight size={20} strokeWidth={1.6} /></button>
        </div>}
        <div className="photo-viewer-controls" role="group" aria-label="Масштаб">
          <button type="button" className="icon-button" aria-label="Віддалити фото" disabled={!ready || view.scale <= 1}
            onClick={() => zoomAt(view.scale / 1.5)}><Minus size={20} strokeWidth={1.6} /></button>
          <button type="button" className="photo-viewer-scale" aria-label={'Скинути масштаб · ' + Math.round(view.scale * 100) + '%'} title="Скинути масштаб" disabled={!ready}
            onClick={() => applyView(initialView)}>{Math.round(view.scale * 100)}%</button>
          <button type="button" className="icon-button" aria-label="Збільшити фото" disabled={!ready || view.scale >= maxScale}
            onClick={() => zoomAt(view.scale * 1.5)}><Plus size={20} strokeWidth={1.6} /></button>
        </div>
      </footer>
    </div>
  </dialog>;
}
