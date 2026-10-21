export type PreviewDoc = {
  file: string
  htmlPath: string
}

declare module 'claude-code' {
  interface PluginState {
    'md-preview': { doc: PreviewDoc | null }
  }
}
