import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo, useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthContext'
import type { User } from '../auth/types'
import { placeCard } from './placement'
import { TourButton } from './TourButton'
import { usePageTour, useTourNavigator } from './tourContext'
import { TourProvider } from './TourProvider'
import { caseTour, phaseTourKey, pickCaseTour } from './tours'
import type { Tour } from './tourTypes'

const ada: User = {
  id: 'u1',
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  role: 'student',
  theme: 'navy',
  avatarUrl: null,
  toursSeen: {},
  createdAt: '2026-09-01T00:00:00.000Z',
}

const TOUR: Tour = {
  key: 'test-page',
  title: 'Page tour',
  steps: [
    { title: 'Hello there', body: 'The first step, about the page.' },
    { target: '#one', title: 'The first thing', body: 'It does a thing.' },
    { target: '#two', title: 'The second thing', body: 'It does another.' },
  ],
}

/** The app around a page: signed in as `user`, who remembers tours like the real provider. */
function Harness({ user, children, marked }: { user: User; children: ReactNode; marked: string[] }) {
  const [current, setCurrent] = useState(user)
  const value = useMemo<AuthContextValue>(
    () => ({
      user: current,
      loading: false,
      signUp: vi.fn(),
      logIn: vi.fn(),
      logOut: vi.fn(),
      updateProfile: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      markTourSeen: async (key) => {
        marked.push(key)
        setCurrent((u) => ({ ...u, toursSeen: { ...u.toursSeen, [key]: 'now' } }))
      },
    }),
    [current, marked],
  )
  return (
    <AuthContext.Provider value={value}>
      <TourProvider>
        <TourButton />
        {children}
      </TourProvider>
    </AuthContext.Provider>
  )
}

function Page({ tour = TOUR, ready = true }: { tour?: Tour; ready?: boolean }) {
  usePageTour(tour, { ready })
  return (
    <main>
      <button id="one">One</button>
      <button id="two">Two</button>
    </main>
  )
}

function renderPage(page: ReactNode, user: User = ada) {
  const marked: string[] = []
  const events = userEvent.setup()
  render(
    <Harness user={user} marked={marked}>
      {page}
    </Harness>,
  )
  return { marked, events }
}

const card = () => screen.findByRole('dialog', undefined, { timeout: 3000 })

describe('guided tours', () => {
  it('starts on its own the first time, remembers it, and steps through', async () => {
    const { marked, events } = renderPage(<Page />)

    expect(await card()).toHaveAccessibleName('Hello there')
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
    expect(marked).toEqual(['test-page'])

    await events.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'The first thing' })).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()

    await events.keyboard('{ArrowRight}')
    expect(await screen.findByRole('dialog', { name: 'The second thing' })).toBeInTheDocument()
    await events.keyboard('{ArrowLeft}')
    expect(await screen.findByRole('dialog', { name: 'The first thing' })).toBeInTheDocument()

    await events.click(screen.getByRole('button', { name: 'Back' }))
    await events.click(await screen.findByRole('button', { name: 'Next' }))
    await events.click(await screen.findByRole('button', { name: 'Next' }))
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes with Esc, the X, or Skip tour, and goes back to the tour button', async () => {
    const { events } = renderPage(<Page />)

    await card()
    await events.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take the tour of this page' })).toHaveFocus())
    // Seen: it doesn't start again on its own.
    await act(() => new Promise((r) => setTimeout(r, 600)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // The tour button replays it.
    await events.click(screen.getByRole('button', { name: 'Take the tour of this page' }))
    await card()
    await events.click(screen.getByRole('button', { name: 'Skip tour' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await events.click(screen.getByRole('button', { name: 'Take the tour of this page' }))
    await events.click(await screen.findByRole('button', { name: 'Next' }))
    await events.click(await screen.findByRole('button', { name: 'Close tour' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('doesn’t start on its own once seen, before the page is ready, or when the server didn’t say', async () => {
    renderPage(<Page />, { ...ada, toursSeen: { 'test-page': 'earlier' } })
    renderPage(<Page tour={{ ...TOUR, key: 'other' }} ready={false} />)
    renderPage(<Page tour={{ ...TOUR, key: 'third' }} />, { ...ada, toursSeen: undefined })
    await act(() => new Promise((r) => setTimeout(r, 700)))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('skips a step whose target isn’t on the page, or shows it in the middle', async () => {
    const tour: Tour = {
      key: 'gaps',
      title: 'Gaps',
      steps: [
        { title: 'Start', body: 'Here we go.' },
        { target: '#nowhere', title: 'Not here', body: 'Skipped.' },
        { target: '#also-nowhere', title: 'Still explained', body: 'Shown anyway.', ifMissing: 'center' },
        { target: '#two', title: 'The end', body: 'Done.' },
      ],
    }
    const { events } = renderPage(<Page tour={tour} />)

    await card()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'Still explained' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument()
    await events.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'The end' }, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
  })

  it('opens the tab a step is about first', async () => {
    const selectTab = vi.fn()
    const tour: Tour = { key: 'tabs', title: 'Tabs', steps: [{ target: '#one', title: 'In a tab', body: '…', go: { tab: 'exchange' } }] }
    const navigator = { selectTab }
    function TabbedPage() {
      useTourNavigator(navigator)
      return <Page tour={tour} />
    }
    renderPage(<TabbedPage />)
    expect(await card()).toHaveAccessibleName('In a tab')
    expect(selectTab).toHaveBeenCalledWith('exchange')
  })

  it('has no tour button to press on a page without a tour', () => {
    renderPage(<main />)
    expect(screen.getByRole('button', { name: 'No tour on this page' })).toBeDisabled()
  })
})

describe('pickCaseTour', () => {
  const seenOf = (keys: string[]) => (key: string) => keys.includes(key)

  it('starts the whole case tour the first time in any case, covering its phase', () => {
    const { tour, startWith } = pickCaseTour(seenOf([]), 'k1', 'introduction', 'active')
    expect(startWith).toBe(tour)
    expect(tour.key).toBe('student-case')
    expect(tour.alsoMarks).toEqual([phaseTourKey('k1', 'introduction')])
  })

  it('starts a short tour when the case moves to a phase not yet seen in it', () => {
    const { tour, startWith } = pickCaseTour(seenOf(['student-case', 'phase:k1:introduction']), 'k1', 'information_exchange', 'active')
    expect(tour.key).toBe('student-case')
    expect(startWith?.key).toBe('phase:k1:information_exchange')
    expect(startWith?.steps[0].title).toBe('New phase! 🎉')
  })

  it('starts nothing once seen, or on a closed case, but the button still has the whole tour', () => {
    expect(pickCaseTour(seenOf(['student-case', 'phase:k1:deposition']), 'k1', 'deposition', 'active').startWith).toBeNull()
    const closed = pickCaseTour(seenOf([]), 'k1', 'deposition', 'closed')
    expect(closed.startWith).toBeNull()
    expect(closed.tour).toEqual(caseTour('k1', 'deposition'))
  })
})

describe('placeCard', () => {
  const viewport = { width: 1000, height: 800 }
  const card = { width: 300, height: 160 }

  it('goes below the target when there’s room, with the arrow at the target', () => {
    const at = placeCard({ top: 100, left: 400, width: 100, height: 40 }, card, viewport)
    expect(at).toMatchObject({ side: 'bottom', top: 154, left: 300, arrow: 150 })
  })

  it('goes above near the bottom, and beside a tall one', () => {
    expect(placeCard({ top: 700, left: 400, width: 100, height: 40 }, card, viewport).side).toBe('top')
    expect(placeCard({ top: 20, left: 20, width: 200, height: 760 }, card, viewport).side).toBe('right')
  })

  it('keeps the card on screen, and centres it with nothing to point at', () => {
    expect(placeCard({ top: 100, left: 960, width: 30, height: 30 }, card, viewport).left).toBe(688)
    expect(placeCard(null, card, viewport)).toMatchObject({ side: 'center', top: 320, left: 350 })
  })
})
