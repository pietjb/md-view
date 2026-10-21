export type ViewedDoc = {
  file: string
}

declare module 'claude-code' {
  interface PluginState {
    'md-view': { doc: ViewedDoc | null }
  }
}
