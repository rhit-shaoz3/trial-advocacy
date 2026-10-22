import type { Palette } from './theme'

/** The colours a theme's preview swatch shows; keep them in step with tokens.css. */
interface Preview {
  sidebar: string
  page: string
  card: string
  button: string
}

export const PALETTE_INFO: Record<
  Palette,
  { label: string; description: string; light: Preview; dark: Preview; /** Its two accent colours. */ accents: [string, string] }
> = {
  navy: {
    label: 'Navy & parchment',
    description: 'Deep navy on warm paper',
    light: { sidebar: '#10233f', page: '#f5f3ee', card: '#ffffff', button: '#10233f' },
    dark: { sidebar: '#0a1220', page: '#0e1622', card: '#dcd6c9', button: '#10233f' },
    accents: ['#b98b42', '#a84b43'],
  },
  slate: {
    label: 'Slate & peach',
    description: 'Blue slate and pale sky, with burnt peach',
    light: { sidebar: '#4f6d7a', page: '#eaeaea', card: '#ffffff', button: '#4f6d7a' },
    dark: { sidebar: '#10191d', page: '#172126', card: '#cfdbe0', button: '#4f6d7a' },
    accents: ['#dd6e42', '#e8dab2'],
  },
  earth: {
    label: 'Earth',
    description: 'Taupe and silver, with dusty rose and hunter green',
    light: { sidebar: '#51443d', page: '#edeae8', card: '#fbfaf9', button: '#51443d' },
    dark: { sidebar: '#161210', page: '#1f1a17', card: '#d8d0cb', button: '#51443d' },
    accents: ['#bf7d73', '#325d45'],
  },
  vibrant: {
    label: 'Vibrant',
    description: 'Dark teal and pacific blue, with banana cream and rosewood',
    light: { sidebar: '#0b5563', page: '#eef1f4', card: '#ffffff', button: '#0b5563' },
    dark: { sidebar: '#05151a', page: '#081d22', card: '#d0dfe5', button: '#0b5563' },
    accents: ['#fee440', '#b7245c'],
  },
  forest: {
    label: 'Forest',
    description: 'Deep forest and spruce, with dust grey and smoky rose',
    light: { sidebar: '#143d22', page: '#f6f3f3', card: '#ffffff', button: '#1b512d' },
    dark: { sidebar: '#07120b', page: '#0b1a10', card: '#d7cfce', button: '#1b512d' },
    accents: ['#d7cdcc', '#9b6a6c'],
  },
  lagoon: {
    label: 'Lagoon',
    description: 'Deep ocean and turquoise on sand, with coral and saffron',
    light: { sidebar: '#12355b', page: '#f4efe6', card: '#fffdf9', button: '#1e7d72' },
    dark: { sidebar: '#071221', page: '#0b1a2b', card: '#ddd5c6', button: '#1e7d72' },
    accents: ['#e76f51', '#e9c46a'],
  },
  contrast: {
    label: 'High contrast',
    description: 'Black and electric blue on white, for the clearest reading',
    light: { sidebar: '#0b0b0f', page: '#ffffff', card: '#ffffff', button: '#1f44d6' },
    dark: { sidebar: '#000000', page: '#000000', card: '#f0f0f0', button: '#1f44d6' },
    accents: ['#c4321a', '#f2b705'],
  },
}
