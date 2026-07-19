export interface NormalizedPoint {
  x: number;
  y: number;
}

export type DrawingTool = 'pen' | 'eraser';

export interface DrawingStroke {
  participantId: string;
  strokeId: string;
  tool: DrawingTool;
  color: string;
  width: number;
  points: NormalizedPoint[];
}

export type DrawingMessage =
  | { kind: 'drawing-segment'; strokeId: string; tool: DrawingTool; color: string; width: number; points: NormalizedPoint[] }
  | { kind: 'drawing-clear'; scope: 'mine' | 'all' }
  | { kind: 'drawing-cursor'; x: number; y: number; visible: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is NormalizedPoint {
  return isRecord(value)
    && typeof value.x === 'number'
    && Number.isFinite(value.x)
    && value.x >= 0
    && value.x <= 1
    && typeof value.y === 'number'
    && Number.isFinite(value.y)
    && value.y >= 0
    && value.y <= 1;
}

export function parseDrawingMessage(value: Record<string, unknown>): DrawingMessage | null {
  if (value.kind === 'drawing-segment') {
    if (
      typeof value.strokeId !== 'string'
      || value.strokeId.length < 1
      || value.strokeId.length > 64
      || (value.tool !== 'pen' && value.tool !== 'eraser')
      || typeof value.color !== 'string'
      || !/^#[0-9a-f]{6}$/i.test(value.color)
      || typeof value.width !== 'number'
      || !Number.isFinite(value.width)
      || value.width < 1
      || value.width > 32
      || !Array.isArray(value.points)
      || value.points.length < 1
      || value.points.length > 64
      || !value.points.every(isPoint)
    ) return null;
    return {
      kind: 'drawing-segment',
      strokeId: value.strokeId,
      tool: value.tool,
      color: value.color,
      width: value.width,
      points: value.points,
    };
  }
  if (value.kind === 'drawing-clear' && (value.scope === 'mine' || value.scope === 'all')) {
    return { kind: 'drawing-clear', scope: value.scope };
  }
  if (
    value.kind === 'drawing-cursor'
    && typeof value.visible === 'boolean'
    && typeof value.x === 'number'
    && Number.isFinite(value.x)
    && value.x >= 0
    && value.x <= 1
    && typeof value.y === 'number'
    && Number.isFinite(value.y)
    && value.y >= 0
    && value.y <= 1
  ) return { kind: 'drawing-cursor', x: value.x, y: value.y, visible: value.visible };
  return null;
}

export function applyDrawingSegment(
  strokes: DrawingStroke[],
  participantId: string,
  segment: Extract<DrawingMessage, { kind: 'drawing-segment' }>,
): DrawingStroke[] {
  const index = strokes.findIndex((stroke) => stroke.participantId === participantId && stroke.strokeId === segment.strokeId);
  if (index < 0) {
    return [...strokes, { participantId, ...segment, points: [...segment.points] }];
  }
  const next = [...strokes];
  const current = next[index];
  next[index] = { ...current, points: [...current.points, ...segment.points].slice(-4096) };
  return next.slice(-500);
}

export function clearDrawingStrokes(strokes: DrawingStroke[], participantId: string, scope: 'mine' | 'all'): DrawingStroke[] {
  return scope === 'all' ? [] : strokes.filter((stroke) => stroke.participantId !== participantId);
}
