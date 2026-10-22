import type { Palette } from './theme'

/** The colours a theme's preview swatch shows; keep them in step with tokens.css. */
interface Preview {
  sidebar: string
  page: string
  card: string
  button: string
}

export const PALETTE_INFO: Record<Palette, { label: string; description: string; light: Preview; dark: Preview }> = {
  navy: {
    label: 'Navy & parchment',
    description: 'Deep navy on warm paper',
    light: { sidebar: '#10233f', page: '#f5f3ee', card: '#ffffff', button: '#10233f' },
    dark: { sidebar: '#0a1220', page: '#0e1622', card: '#152031', button: '#3d6b97' },
  },
  forest: {
    label: 'Forest',
    description: 'Dark green and white',
    light: { sidebar: '#163a2b', page: '#ffffff', card: '#ffffff', button: '#1d5a40' },
    dark: { sidebar: '#08120d', page: '#0d1712', card: '#13221a', button: '#2f7a57' },
  },
  lagoon: {
    label: 'Lagoon',
    description: 'Deep teal and white',
    light: { sidebar: '#0f3d44', page: '#ffffff', card: '#ffffff', button: '#126270' },
    dark: { sidebar: '#061214', page: '#0b1719', card: '#112326', button: '#1f7f8c' },
  },
  vivid: {
    label: 'Vivid',
    description: 'High contrast with bright colour',
    light: { sidebar: '#0b0b12', page: '#ffffff', card: '#ffffff', button: '#2346d8' },
    dark: { sidebar: '#000000', page: '#05050a', card: '#11121a', button: '#4f6bff' },
  },
  stone: {
    label: 'Stone',
    description: 'Soft browns and beiges, low contrast',
    light: { sidebar: '#5a4a3c', page: '#efe8dd', card: '#f7f2ea', button: '#7a6450' },
    dark: { sidebar: '#15110d', page: '#1e1914', card: '#27211b', button: '#8a735d' },
  },
}
