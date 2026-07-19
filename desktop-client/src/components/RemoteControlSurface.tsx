import { useEffect, useRef } from 'react';
import { isEditableTarget, type ControlInputEvent } from '../lib/controlState';

interface Props {
  active: boolean;
  keyboardEnabled: boolean;
  mediaAspectRatio: number | null;
  onEvent: (event: ControlInputEvent) => void;
}

interface Rect { x: number; y: number; width: number; height: number }

function contentRect(width: number, height: number, aspectRatio: number | null): Rect {
  if (!aspectRatio || width <= 0 || height <= 0) return { x: 0, y: 0, width, height };
  if (width / height > aspectRatio) {
    const contentWidth = height * aspectRatio;
    return { x: (width - contentWidth) / 2, y: 0, width: contentWidth, height };
  }
  const contentHeight = width / aspectRatio;
  return { x: 0, y: (height - contentHeight) / 2, width, height: contentHeight };
}

export function RemoteControlSurface({ active, keyboardEnabled, mediaAspectRatio, onEvent }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active || !keyboardEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) return;
      event.preventDefault();
      onEvent({ type: 'key', code: event.code, action: 'down' });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      onEvent({ type: 'key', code: event.code, action: 'up' });
    };
    const release = () => onEvent({ type: 'releaseAll' });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', release);
      release();
    };
  }, [active, keyboardEnabled, onEvent]);

  useEffect(() => () => {
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
  }, []);

  function normalizedPoint(event: { clientX: number; clientY: number }): { x: number; y: number } | null {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    const rect = contentRect(bounds.width, bounds.height, mediaAspectRatio);
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) return null;
    return { x: (x - rect.x) / rect.width, y: (y - rect.y) / rect.height };
  }

  function flushMove(): void {
    moveFrameRef.current = null;
    const point = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (point) onEvent({ type: 'mouseMove', ...point });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const point = normalizedPoint(event);
    if (!point) return;
    pendingMoveRef.current = point;
    if (moveFrameRef.current === null) moveFrameRef.current = requestAnimationFrame(flushMove);
  }

  function handlePointerButton(event: React.PointerEvent<HTMLDivElement>, action: 'down' | 'up'): void {
    const point = normalizedPoint(event);
    if (!point) return;
    const button = event.button === 0 ? 'left' : event.button === 1 ? 'middle' : event.button === 2 ? 'right' : null;
    if (!button) return;
    event.preventDefault();
    onEvent({ type: 'mouseButton', button, action, ...point });
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    const point = normalizedPoint(event);
    if (!point) return;
    event.preventDefault();
    onEvent({ type: 'mouseScroll', deltaX: event.deltaX, deltaY: event.deltaY, ...point });
  }

  if (!active) return null;
  return (
    <div
      ref={surfaceRef}
      className="remote-control-surface"
      tabIndex={0}
      onPointerMove={handlePointerMove}
      onPointerDown={(event) => handlePointerButton(event, 'down')}
      onPointerUp={(event) => handlePointerButton(event, 'up')}
      onPointerCancel={() => onEvent({ type: 'releaseAll' })}
      onWheel={handleWheel}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="Remote control surface"
    />
  );
}
