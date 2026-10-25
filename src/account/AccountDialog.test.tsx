import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthService, User } from '../auth/types'
import { AppShell } from '../components/AppShell'

// The canvas isn't available in jsdom; the crop maths has its own tests.
vi.mock('../components/avatarCrop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/avatarCrop')>()),
  cropToBlob: vi.fn().mockResolvedValue(new Blob(['cropped'], { type: 'image/jpeg' })),
}))

const ada: User = {
  id: 'u1',
  name: 'Ada Lawyer',
  email: 'ada@example.com',
  role: 'student',
  theme: 'navy',
  avatarUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
}

function fakeService(user: User = ada) {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(user),
    signUp: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn(),
    updateProfile: vi.fn(async (input) => ({ ...user, ...input })),
    uploadAvatar: vi.fn(async () => ({ ...user, avatarUrl: '/api/users/u1/avatar?v=1' })),
    removeAvatar: vi.fn(async () => ({ ...user, avatarUrl: null })),
  } satisfies AuthService
}

async function openAccount(service: AuthService) {
  render(
    <MemoryRouter>
      <AuthProvider service={service}>
        <AppShell subtitle="LAW 540" navLabel="Course" navHeading="Workspace" nav={[]}>
          <p>Page</p>
        </AppShell>
      </AuthProvider>
    </MemoryRouter>,
  )
  await userEvent.click(await screen.findByRole('button', { name: /Ada Lawyer/ }))
  return screen.getByRole('dialog', { name: 'Your account' })
}

beforeEach(() => {
  document.documentElement.dataset.palette = 'navy'
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:picture'), revokeObjectURL: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the account dialog', () => {
  it('opens from your name in the sidebar and closes again', async () => {
    const dialog = await openAccount(fakeService())

    expect(within(dialog).getByLabelText('Name')).toHaveValue('Ada Lawyer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renames you, everywhere at once', async () => {
    const service = fakeService()
    const dialog = await openAccount(service)
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    const input = within(dialog).getByLabelText('Name')
    await userEvent.clear(input)
    expect(save).toBeDisabled()
    await userEvent.type(input, '  Ada L. Lovelace ')
    await userEvent.click(save)

    expect(service.updateProfile).toHaveBeenCalledWith({ name: 'Ada L. Lovelace' })
    expect(await within(dialog).findByText('Saved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada L\. Lovelace/ })).toBeInTheDocument()
  })

  it('switches the theme straight away and saves it', async () => {
    const service = fakeService()
    const dialog = await openAccount(service)
    expect(within(dialog).getByRole('radio', { name: /Navy & parchment/ })).toBeChecked()

    await userEvent.click(within(dialog).getByRole('radio', { name: /Forest/ }))

    expect(document.documentElement.dataset.palette).toBe('forest')
    expect(service.updateProfile).toHaveBeenCalledWith({ theme: 'forest' })
    expect(await within(dialog).findByRole('radio', { name: /Forest/ })).toBeChecked()
  })

  it('goes back to the old theme if saving fails', async () => {
    const service = fakeService()
    service.updateProfile.mockRejectedValueOnce(new Error('Could not reach the server.'))
    const dialog = await openAccount(service)

    await userEvent.click(within(dialog).getByRole('radio', { name: /Earth/ }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not reach the server.')
    expect(document.documentElement.dataset.palette).toBe('navy')
  })

  it('crops and uploads a new picture, then shows it in the sidebar', async () => {
    const service = fakeService()
    const dialog = await openAccount(service)

    const photo = new File(['photo'], 'me.png', { type: 'image/png' })
    await userEvent.upload(within(dialog).getByLabelText('Upload a picture'), photo)
    const preview = within(dialog).getByRole('img', { name: 'Your new picture' })
    Object.defineProperties(preview, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 } })
    fireEvent.load(preview)

    // The picture can be moved with the keyboard as well as dragged.
    const frame = within(dialog).getByRole('group', { name: /Picture position/ })
    fireEvent.keyDown(frame, { key: 'ArrowRight' })
    expect(preview.style.transform).toContain('8px')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this picture' }))

    // Cropping is async, so wait for the upload.
    await waitFor(() => expect(service.uploadAvatar).toHaveBeenCalledWith(expect.any(Blob)))
    expect(await within(dialog).findByText('Change picture')).toBeInTheDocument()
    const sidebarButton = screen.getByRole('button', { name: /Ada Lawyer/ })
    expect(sidebarButton.querySelector('img')).toHaveAttribute('src', '/api/users/u1/avatar?v=1')
  })

  it('only accepts pictures', async () => {
    const dialog = await openAccount(fakeService())

    const notes = new File(['notes'], 'notes.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(dialog).getByLabelText('Upload a picture'), notes, { applyAccept: false })

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a picture')
    expect(within(dialog).queryByRole('group', { name: /Picture position/ })).not.toBeInTheDocument()
  })

  it('removes the picture, going back to initials', async () => {
    const service = fakeService({ ...ada, avatarUrl: '/api/users/u1/avatar?v=1' })
    const dialog = await openAccount(service)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    expect(service.removeAvatar).toHaveBeenCalled()
    expect(await within(dialog).findByText('Upload a picture')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada Lawyer/ }).querySelector('img')).toBeNull()
  })
})
