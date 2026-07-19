import { useCallback, useEffect, useRef, useState } from 'react';
import type { DrawingMessage, DrawingStroke, NormalizedPoint } from '../lib/drawingState';

interface CursorState extends NormalizedPoint {
  nickname: string;
  visible: boolean;
}

interface Props {
  enabled: boolean;
  canClearAll: boolean;
  mediaAspectRatio: number | null;
  strokes: DrawingStroke[];
  cursors: Record<string, CursorState>;
  onEnabledChange: (enabled: boolean) => void;
  onMessage: (message: DrawingMessage) => void;
  onClear: (scope: 'mine' | 'all') => void;
}

interface ContentRect { x: number; y: number; width: number; height: number }

function fitRect(width: number, height: number, aspectRatio: number | null): ContentRect {
  if (!aspectRatio || width <= 0 || height <= 0) return { x: 0, y: 0, width, height };
  const containerRatio = width / height;
  if (containerRatio > aspectRatio) {
    const contentWidth = height * aspectRatio;
    return { x: (width - contentWidth) / 2, y: 0, width: contentWidth, height };
  }
  const contentHeight = width / aspectRatio;
  return { x: 0, y: (height - contentHeight) / 2, width, height: contentHeight };
}

export function DrawingCanvas({ enabled, canClearAll, mediaAspectRatio, strokes, cursors, onEnabledChange, onMessage, onClear }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectRef = useRef<ContentRect>({ x: 0, y: 0, width: 0, height: 0 });
  const activeStrokeRef = useRef<{ id: string; points: NormalizedPoint[] } | null>(null);
  const flushFrameRef = useRef<number | null>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<NormalizedPoint | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#ffb454');
  const [width, setWidth] = useState(4);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * dpr));
    canvas.height = Math.max(1, Math.round(bounds.height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const rect = fitRect(bounds.width, bounds.height, mediaAspectRatio);
    rectRef.current = rect;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      context.save();
      context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = stroke.color;
      context.fillStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.beginPath();
      const first = stroke.points[0];
      context.moveTo(rect.x + first.x * rect.width, rect.y + first.y * rect.height);
      for (const point of stroke.points.slice(1)) context.lineTo(rect.x + point.x * rect.width, rect.y + point.y * rect.height);
      if (stroke.points.length === 1) {
        context.arc(rect.x + first.x * rect.width, rect.y + first.y * rect.height, stroke.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.stroke();
      }
      context.restore();
    }
    context.globalCompositeOperation = 'source-over';
    context.font = '12px Segoe UI';
    for (const cursor of Object.values(cursors)) {
      if (!cursor.visible) continue;
      const x = rect.x + cursor.x * rect.width;
      const y = rect.y + cursor.y * rect.height;
      context.fillStyle = '#5ee6a8';
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
      context.fillText(cursor.nickname, x + 8, y - 8);
    }
  }, [cursors, mediaAspectRatio, strokes]);

  useEffect(() => {
    redraw();
    const observer = new ResizeObserver(redraw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [redraw]);

  useEffect(() => () => {
    if (flushFrameRef.current !== null) cancelAnimationFrame(flushFrameRef.current);
    if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current);
  }, []);

  function eventPoint(event: React.PointerEvent<HTMLCanvasElement>): NormalizedPoint | null {
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    const rect = rectRef.current;
    if (rect.width <= 0 || rect.height <= 0) return null;
    const localX = event.clientX - canvasBounds.left;
    const localY = event.clientY - canvasBounds.top;
    if (localX < rect.x || localX > rect.x + rect.width || localY < rect.y || localY > rect.y + rect.height) return null;
    return { x: (localX - rect.x) / rect.width, y: (localY - rect.y) / rect.height };
  }

  function flushPoints(): void {
    flushFrameRef.current = null;
    const active = activeStrokeRef.current;
    if (!active || active.points.length === 0) return;
    const points = active.points.splice(0, 64);
    onMessage({ kind: 'drawing-segment', strokeId: active.id, tool, color, width, points });
    if (active.points.length > 0) flushFrameRef.current = requestAnimationFrame(flushPoints);
  }

  function scheduleFlush(): void {
    if (flushFrameRef.current === null) flushFrameRef.current = requestAnimationFrame(flushPoints);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (!enabled) return;
    const point = eventPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStrokeRef.current = { id: crypto.randomUUID(), points: [point] };
    scheduleFlush();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>): void {
    const point = eventPoint(event);
    if (!point) return;
    pendingCursorRef.current = point;
    if (cursorFrameRef.current === null) {
      cursorFrameRef.current = requestAnimationFrame(() => {
        cursorFrameRef.current = null;
        const cursor = pendingCursorRef.current;
        pendingCursorRef.current = null;
        if (cursor) onMessage({ kind: 'drawing-cursor', ...cursor, visible: true });
      });
    }
    const active = activeStrokeRef.current;
    if (!enabled || !active) return;
    active.points.push(point);
    scheduleFlush();
  }

  function stopStroke(event: React.PointerEvent<HTMLCanvasElement>): void {
    if (activeStrokeRef.current) {
      const point = eventPoint(event);
      if (point) activeStrokeRef.current.points.push(point);
      flushPoints();
      activeStrokeRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`drawing-canvas ${enabled ? 'drawing-enabled' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopStroke}
        onPointerCancel={stopStroke}
        onPointerLeave={() => onMessage({ kind: 'drawing-cursor', x: 0, y: 0, visible: false })}
      />
      <div className="drawing-toolbar">
        <button className={enabled ? 'primary' : ''} onClick={() => onEnabledChange(!enabled)}>{enabled ? 'Drawing on' : 'Draw'}</button>
        {enabled && (
          <>
            <button className={tool === 'pen' ? 'selected-tool' : ''} onClick={() => setTool('pen')}>Pen</button>
            <button className={tool === 'eraser' ? 'selected-tool' : ''} onClick={() => setTool('eraser')}>Eraser</button>
            <input aria-label="Drawing color" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            <select aria-label="Line width" value={width} onChange={(event) => setWidth(Number(event.target.value))}>
              <option value={2}>2 px</option><option value={4}>4 px</option><option value={8}>8 px</option><option value={16}>16 px</option>
            </select>
            <button onClick={() => onClear('mine')}>Clear mine</button>
            {canClearAll && <button onClick={() => onClear('all')}>Clear all</button>}
          </>
        )}
      </div>
    </>
  );
}
