package com.thecfbhub.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUrlPolicyTest {

  @Test
  fun decideNavigation_internalHostMainFrame_loadsInWebView() {
    assertEquals(
      AppUrlPolicy.NavigationAction.LOAD_IN_WEBVIEW,
      AppUrlPolicy.decideNavigation("https://thecfbhub.netlify.app/", isMainFrame = true)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.LOAD_IN_WEBVIEW,
      AppUrlPolicy.decideNavigation("https://THECFBHUB.NETLIFY.APP/teams/333", isMainFrame = true)
    )
  }

  @Test
  fun decideNavigation_subFrame_loadsInWebView() {
    assertEquals(
      AppUrlPolicy.NavigationAction.LOAD_IN_WEBVIEW,
      AppUrlPolicy.decideNavigation("https://ppv.st/embed/cfb-123", isMainFrame = false)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.LOAD_IN_WEBVIEW,
      AppUrlPolicy.decideNavigation("about:blank", isMainFrame = false)
    )
  }

  @Test
  fun decideNavigation_externalHttpMainFrame_opensCustomTab() {
    assertEquals(
      AppUrlPolicy.NavigationAction.OPEN_CUSTOM_TAB,
      AppUrlPolicy.decideNavigation("https://www.espn.com/college-football/game/_/gameId/401", isMainFrame = true)
    )
  }

  @Test
  fun decideNavigation_nonHttpSchemes_openExternalIntent() {
    assertEquals(
      AppUrlPolicy.NavigationAction.OPEN_EXTERNAL_INTENT,
      AppUrlPolicy.decideNavigation("mailto:support@example.com", isMainFrame = true)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.OPEN_EXTERNAL_INTENT,
      AppUrlPolicy.decideNavigation("tel:+15551234567", isMainFrame = true)
    )
  }

  @Test
  fun decideNavigation_blankOrJavascript_isIgnored() {
    assertEquals(
      AppUrlPolicy.NavigationAction.IGNORE,
      AppUrlPolicy.decideNavigation("", isMainFrame = true)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.IGNORE,
      AppUrlPolicy.decideNavigation(null, isMainFrame = true)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.IGNORE,
      AppUrlPolicy.decideNavigation("about:blank", isMainFrame = true)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.IGNORE,
      AppUrlPolicy.decideNavigation("javascript:void(0)", isMainFrame = true)
    )
    assertEquals(
      AppUrlPolicy.NavigationAction.IGNORE,
      AppUrlPolicy.decideNavigation("javascript:alert(1)", isMainFrame = false)
    )
  }

  @Test
  fun isAppUrl_matchesOnlyConfiguredHost() {
    assertTrue(AppUrlPolicy.isAppUrl("https://thecfbhub.netlify.app/"))
    assertTrue(AppUrlPolicy.isAppUrl("https://thecfbhub.netlify.app/#standings"))
    assertFalse(AppUrlPolicy.isAppUrl("https://www.espn.com/"))
    assertFalse(AppUrlPolicy.isAppUrl("mailto:test@example.com"))
    assertFalse(AppUrlPolicy.isAppUrl(null))
  }

  @Test
  fun normalizeTheme_mapsLightDarkAndUnknown() {
    assertEquals(true, AppUrlPolicy.normalizeTheme("dark"))
    assertEquals(true, AppUrlPolicy.normalizeTheme(" DARK "))
    assertEquals(false, AppUrlPolicy.normalizeTheme("light"))
    assertNull(AppUrlPolicy.normalizeTheme(""))
    assertNull(AppUrlPolicy.normalizeTheme(null))
  }
}
