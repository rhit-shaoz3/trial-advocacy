import type { PacketFolder, PacketItem } from '../../courses/types'

/** A folder for each kind of document, everything in: how a team's PDF starts. */
export function defaultFolders(items: PacketItem[]): PacketFolder[] {
  const folders: PacketFolder[] = []
  for (const item of items) {
    if (!item.printable) continue
    const folder = folders.find((f) => f.name === item.section)
    if (folder) folder.items.push(item.id)
    else folders.push({ name: item.section, items: [item.id] })
  }
  return folders
}
