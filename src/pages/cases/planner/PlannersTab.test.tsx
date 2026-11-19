import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CourseServiceContext } from '../../../courses/CourseServiceContext'
import type { CourseCase } from '../../../courses/types'
import { fakeCourseService } from '../../../test/fakeCourseService'
import { PlannersTab } from './PlannersTab'

const courseCase = {
  id: 'k1',
  title: 'Winston v. Thrillville',
  planner: { enabled: true, reviewLimit: { max: 3, per: 'student' }, feedbackLevel: 'balanced' },
} as CourseCase

describe('the planner settings', () => {
  it('sets how demanding the feedback is, from gentle to rigorous', async () => {
    const savePlannerSettings = vi.fn(async (_c: string, _k: string, planner) => ({ ...courseCase, planner }))
    const service = fakeCourseService({ savePlannerSettings })
    render(
      <CourseServiceContext.Provider value={service}>
        <PlannersTab courseId="c1" courseCase={courseCase} onCaseChange={vi.fn()} />
      </CourseServiceContext.Provider>,
    )
    const slider = screen.getByLabelText('How demanding the feedback is')
    expect(slider).toHaveAttribute('aria-valuetext', 'Balanced')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(slider).toHaveAttribute('aria-valuetext', 'Gentle')
    expect(screen.getByText(/The big picture only/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(savePlannerSettings).toHaveBeenCalledWith('c1', 'k1', { enabled: true, reviewLimit: { max: 3, per: 'student' }, feedbackLevel: 'gentle' }),
    )
  })
})
