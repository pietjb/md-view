// Optional PreToolUse hook for mcp__Claude_Browser__preview_start (Claude
// Desktop's browser pane), to let /md-view open the pane in one step in auto
// mode. It approves the call only when it opens a page on this machine:
// exactly http://127.0.0.1:<port>/ and nothing else in the input, as md-view
// does. Any other call gets no decision from this hook, so auto mode and the
// usual permission checks judge it as before. See the README for setup.

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => (raw += chunk))
process.stdin.on('end', () => {
  let input
  try {
    input = JSON.parse(raw)
  } catch {
    return
  }

  const toolInput = input?.tool_input ?? {}
  const isPreviewTool = /^mcp__.*Claude_Browser__preview_start$/.test(input?.tool_name ?? '')
  const isLocalPage =
    typeof toolInput.url === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(toolInput.url)

  if (isPreviewTool && isLocalPage && Object.keys(toolInput).length === 1) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: 'A local page on 127.0.0.1 (md-view) in the browser pane',
      },
    }))
  }
})
