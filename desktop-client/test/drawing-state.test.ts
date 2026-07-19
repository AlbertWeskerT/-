import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDrawingSegment, clearDrawingStrokes, parseDrawingMessage } from '../src/lib/drawingState.ts';

test('validates normalized batched drawing segments', () => {
  const segment = parseDrawingMessage({ kind: 'drawing-segment', strokeId: 'stroke-1', tool: 'pen', color: '#ffb454', width: 4, points: [{ x: 0, y: 1 }, { x: 0.5, y: 0.25 }] });
  assert.ok(segment && segment.kind === 'drawing-segment');
  assert.equal(parseDrawingMessage({ kind: 'drawing-segment', strokeId: 'bad', tool: 'pen', color: 'red', width: 4, points: [{ x: 2, y: 0 }] }), null);
});

test('combines stroke batches and applies scoped clearing', () => {
  const first = { kind: 'drawing-segment' as const, strokeId: 's', tool: 'pen' as const, color: '#ffffff', width: 2, points: [{ x: 0.1, y: 0.1 }] };
  const second = { ...first, points: [{ x: 0.2, y: 0.2 }] };
  let strokes = applyDrawingSegment([], 'participant-a', first);
  strokes = applyDrawingSegment(strokes, 'participant-a', second);
  strokes = applyDrawingSegment(strokes, 'participant-b', { ...first, strokeId: 'other' });
  assert.equal(strokes[0].points.length, 2);
  assert.equal(clearDrawingStrokes(strokes, 'participant-a', 'mine').length, 1);
  assert.deepEqual(clearDrawingStrokes(strokes, 'participant-a', 'all'), []);
});
