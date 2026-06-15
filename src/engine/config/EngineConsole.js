export const EngineConsole = {
  installGlobalHandlers() {
    if (window.__aquaEngineConsoleHandlersInstalled) {
      return
    }

    window.__aquaEngineConsoleHandlersInstalled = true
    window.addEventListener('error', (event) => {
      EngineConsole.error('Unhandled browser error', event.error || event.message, {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      })
    })
    window.addEventListener('unhandledrejection', (event) => {
      EngineConsole.error('Unhandled promise rejection', event.reason)
    })
  },

  info(message, context = null) {
    logWithContext('info', message, context)
  },

  warn(message, context = null) {
    logWithContext('warn', message, context)
  },

  error(message, error = null, context = null) {
    if (console.groupCollapsed) {
      console.groupCollapsed(`[Aqua Engine] ${message}`)
      if (context) {
        console.info('Context:', context)
      }
      if (error) {
        console.error(error)
      }
      console.groupEnd()
      return
    }

    console.error(`[Aqua Engine] ${message}`, context || '', error || '')
  },
}

function logWithContext(level, message, context) {
  const logger = console[level] || console.log

  if (context) {
    logger.call(console, `[Aqua Engine] ${message}`, context)
  } else {
    logger.call(console, `[Aqua Engine] ${message}`)
  }
}
