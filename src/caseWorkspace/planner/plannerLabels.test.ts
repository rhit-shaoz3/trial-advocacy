import { describe, expect, it } from 'vitest'
import type { PlannerCard, PlannerChart } from '../../courses/types'
import { dropTarget } from './plannerLabels'

const card = (id: string, parentId: string | null, position: number): PlannerCard => ({
  id,
  parentId,
  title: id,
  notes: '',
  position,
  evidence: [],
  witnessIds: [],
  updatedBy: null,
  updatedAt: '2026-11-18T12:00:00Z',
})

// A and B are facts of consequence; A has sub-facts A1 and A2, and A1 has A1x.
const chart: PlannerChart = {
  cards: [card('A', null, 0), card('B', null, 1), card('A1', 'A', 0), card('A2', 'A', 1), card('A1x', 'A1', 0)],
  gaps: [],
  finalized: null,
}

describe('dropping a dragged card', () => {
  it('onto a card makes it the last sub-fact of that card', () => {
    expect(dropTarget(chart, 'A2', 'into:B')).toEqual({ cardId: 'A2', parentId: 'B', index: 0 })
    expect(dropTarget(chart, 'B', 'into:A')).toEqual({ cardId: 'B', parentId: 'A', index: 2 })
  })

  it('onto a card’s edge puts it beside that card', () => {
    expect(dropTarget(chart, 'A2', 'before:A1')).toEqual({ cardId: 'A2', parentId: 'A', index: 0 })
    expect(dropTarget(chart, 'A1x', 'after:B')).toEqual({ cardId: 'A1x', parentId: null, index: 2 })
    expect(dropTarget(chart, 'B', 'before:A')).toEqual({ cardId: 'B', parentId: null, index: 0 })
  })

  it('onto the top makes it a fact of consequence', () => {
    expect(dropTarget(chart, 'A1', 'root:')).toEqual({ cardId: 'A1', parentId: null, index: 2 })
  })

  it('never under itself or one of its own sub-facts', () => {
    expect(dropTarget(chart, 'A', 'into:A')).toBeNull()
    expect(dropTarget(chart, 'A', 'into:A1x')).toBeNull()
    expect(dropTarget(chart, 'A', 'after:A1x')).toBeNull()
    expect(dropTarget(chart, 'A1', 'before:A1')).toBeNull()
  })
})
