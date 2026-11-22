package com.thecfbhub.app

import java.net.URI

/**
 * Pure URL routing and theme-normalization policy for the Android WebView shell.
 */
object AppUrlPolicy {
  const val DEFAULT_HOST = "thecfbhub.netlify.app"

  enum class NavigationAction {
    LOAD_IN_WEBVIEW,
    OPEN_CUSTOM_TAB,
    OPEN_EXTERNAL_INTENT,
    IGNORE
  }

  /**
   * Decides how a requested URL should be handled based on frame context and destination host.
   */
  fun decideNavigation(
    url: String?,
    isMainFrame: Boolean,
    appHost: String = DEFAULT_HOST
  ): NavigationAction {
    val trimmed = url?.trim().orEmpty()
    if (trimmed.isEmpty()) return NavigationAction.IGNORE
    if (trimmed.startsWith("javascript:", ignoreCase = true)) return NavigationAction.IGNORE

    if (trimmed.equals("about:blank", ignoreCase = true)) {
      return if (isMainFrame) NavigationAction.IGNORE else NavigationAction.LOAD_IN_WEBVIEW
    }

    if (!isMainFrame) {
      return NavigationAction.LOAD_IN_WEBVIEW
    }

    val scheme = extractScheme(trimmed) ?: return NavigationAction.IGNORE
    if (scheme == "http" || scheme == "https") {
      val host = extractHost(trimmed)
      return if (host != null && host.equals(appHost, ignoreCase = true)) {
        NavigationAction.LOAD_IN_WEBVIEW
      } else {
        NavigationAction.OPEN_CUSTOM_TAB
      }
    }

    return NavigationAction.OPEN_EXTERNAL_INTENT
  }

  /**
   * Returns true when [url] belongs to the configured CFB Hub host.
   */
  fun isAppUrl(url: String?, appHost: String = DEFAULT_HOST): Boolean {
    val trimmed = url?.trim().orEmpty()
    if (trimmed.isEmpty()) return false
    val scheme = extractScheme(trimmed) ?: return false
    if (scheme != "http" && scheme != "https") return false
    val host = extractHost(trimmed) ?: return false
    return host.equals(appHost, ignoreCase = true)
  }

  /**
   * Converts the web app's `data-theme` attribute into a dark-mode boolean, or null if unknown.
   */
  fun normalizeTheme(raw: String?): Boolean? =
    when (raw?.trim()?.lowercase()) {
      "dark" -> true
      "light" -> false
      else -> null
    }

  private fun extractScheme(url: String): String? {
    val colonIdx = url.indexOf(':')
    if (colonIdx <= 0) return null
    val candidate = url.substring(0, colonIdx).lowercase()
    val valid = candidate.all { it.isLetterOrDigit() || it == '+' || it == '-' || it == '.' }
    return if (valid) candidate else null
  }

  private fun extractHost(url: String): String? {
    try {
      val uri = URI(url)
      if (!uri.host.isNullOrBlank()) {
        return uri.host
      }
    } catch (_: Exception) {
      // Fallback for unescaped query characters or malformed segments.
    }
    val schemeSep = url.indexOf("://")
    if (schemeSep < 0) return null
    val afterScheme = url.substring(schemeSep + 3)
    val authority = afterScheme.substringBefore('/').substringBefore('?').substringBefore('#')
    val hostPort = authority.substringAfterLast('@')
    if (hostPort.isEmpty()) return null
    return hostPort.substringBefore(':')
  }
}
