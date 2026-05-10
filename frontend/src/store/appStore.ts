import { create } from 'zustand'
import { Developer } from '../types'

interface AppStore {
  currentDeveloper: Developer | null
  setCurrentDeveloper: (dev: Developer | null) => void
}

export const useAppStore = create<AppStore>((set) => ({
  currentDeveloper: null,
  setCurrentDeveloper: (dev) => set({ currentDeveloper: dev }),
}))
