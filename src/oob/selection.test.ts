import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySelection, selectAll, selectUnit } from './selection.ts'
import type { Selection } from './selection.ts'

// A tree showing ten unit rows, top to bottom.
const visible = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const ids = (selection: Selection) => [...selection.ids].sort((a, b) => a - b)

/** Replays a run of clicks from an empty selection. */
const clicks = (...steps: [id: number, extend?: boolean][]): Selection =>
  steps.reduce(
    (selection, [id, extend = false]) =>
      selectUnit(selection, id, extend, visible),
    emptySelection(),
  )

test('a plain click toggles one unit', () => {
  assert.deepEqual(ids(clicks([3])), [3])
  assert.deepEqual(ids(clicks([3], [7])), [3, 7])
  assert.deepEqual(ids(clicks([3], [7], [3])), [7])
})

test('a shift-click selects the range from the last plain click', () => {
  assert.deepEqual(ids(clicks([3], [6, true])), [3, 4, 5, 6])
})

test('a range runs upwards just as well', () => {
  assert.deepEqual(ids(clicks([6], [3, true])), [3, 4, 5, 6])
})

test('the anchor stays put, so a second shift-click re-ranges from it', () => {
  assert.deepEqual(ids(clicks([3], [6, true], [9, true])), [3, 4, 5, 6, 7, 8, 9])
})

test('shift-clicking back towards the anchor shrinks the range', () => {
  // The rows passed over are dropped rather than left stuck on, which is what
  // re-deriving each range from the anchor's base selection buys.
  assert.deepEqual(ids(clicks([3], [9, true], [5, true])), [3, 4, 5])
})

test('a range keeps what was selected before the anchor', () => {
  assert.deepEqual(ids(clicks([1], [5], [7, true])), [1, 5, 6, 7])
})

test('a plain click re-anchors, and the next range starts there', () => {
  assert.deepEqual(ids(clicks([2], [4, true], [8], [10, true])), [2, 3, 4, 8, 9, 10])
})

test('shift-clicking the anchor itself leaves just the anchor selected', () => {
  assert.deepEqual(ids(clicks([3], [8, true], [3, true])), [3])
})

test('shift with nothing anchored yet is an ordinary click', () => {
  const selection = selectUnit(emptySelection(), 4, true, visible)
  assert.deepEqual(ids(selection), [4])
  assert.deepEqual(selection.anchor?.id, 4)
})

test('an off-screen anchor falls back to toggling', () => {
  // The anchor's formation was collapsed after it was set, so there is no
  // range to draw. Doing nothing at all would look broken.
  const anchored = clicks([3])
  const selection = selectUnit(anchored, 8, true, [6, 7, 8, 9])
  assert.deepEqual(ids(selection), [3, 8])
})

test('does not mutate the selection it was given', () => {
  const before = clicks([3])
  selectUnit(before, 6, true, visible)
  assert.deepEqual(ids(before), [3])
})

test('select-all takes everything on screen', () => {
  const selection = selectAll([2, 4, 6])
  assert.deepEqual(ids(selection), [2, 4, 6])
  assert.equal(selection.anchor, null)
})

test('select-all leaves nothing anchored, so the next shift-click toggles', () => {
  const selection = selectUnit(selectAll(visible), 4, true, visible)
  assert.deepEqual(
    ids(selection),
    visible.filter((id) => id !== 4),
  )
  assert.equal(selection.anchor?.id, 4)
})
