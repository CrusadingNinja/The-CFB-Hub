package com.thecfbhub.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Single-activity WebView host for The CFB Hub with native edge-to-edge theming,
 * fullscreen stream support, Chrome Custom Tabs for external links, and smart back navigation.
 */
class MainActivity : AppCompatActivity() {

  private lateinit var rootContainer: FrameLayout
  private lateinit var swipeRefresh: SwipeRefreshLayout
  private lateinit var webView: WebView
  private lateinit var loadingProgress: ProgressBar
  private lateinit var errorContainer: LinearLayout
  private lateinit var retryButton: Button
  private lateinit var fullscreenContainer: FrameLayout

  private lateinit var insetsController: WindowInsetsControllerCompat
  private lateinit var backPressedCallback: OnBackPressedCallback
  private val mainHandler = Handler(Looper.getMainLooper())

  private val appHost: String by lazy {
    Uri.parse(BuildConfig.APP_URL).host ?: AppUrlPolicy.DEFAULT_HOST
  }

  private var lastRequestedUrl: String = BuildConfig.APP_URL
  private var hasLoadError: Boolean = false

  @Volatile private var isPageAtTop: Boolean = true

  private var customView: View? = null
  private var customViewCallback: WebChromeClient.CustomViewCallback? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)

    bindViews()
    insetsController = WindowCompat.getInsetsController(window, window.decorView)
    applySystemBarTheme(isNightModeActive())
    setupEdgeToEdgeInsets()
    setupWebView()
    setupSwipeRefresh()
    setupBackNavigation()

    retryButton.setOnClickListener {
      hideErrorView()
      loadAppUrl(lastRequestedUrl)
    }

    val deepLinkUrl = extractDeepLinkUrl(intent)
    if (deepLinkUrl != null) {
      loadAppUrl(deepLinkUrl)
    } else if (savedInstanceState != null) {
      lastRequestedUrl = savedInstanceState.getString(KEY_LAST_URL, BuildConfig.APP_URL)
      if (webView.restoreState(savedInstanceState) == null) {
        loadAppUrl(lastRequestedUrl)
      }
    } else {
      loadAppUrl(BuildConfig.APP_URL)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    val deepLinkUrl = extractDeepLinkUrl(intent)
    if (deepLinkUrl != null) {
      hideErrorView()
      loadAppUrl(deepLinkUrl)
    }
  }

  override fun onResume() {
    super.onResume()
    webView.onResume()
  }

  override fun onPause() {
    webView.onPause()
    super.onPause()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    super.onSaveInstanceState(outState)
    outState.putString(KEY_LAST_URL, webView.url ?: lastRequestedUrl)
    webView.saveState(outState)
  }

  override fun onDestroy() {
    mainHandler.removeCallbacksAndMessages(null)
    customViewCallback = null
    if (::webView.isInitialized) {
      webView.removeJavascriptInterface(JS_BRIDGE_NAME)
      (webView.parent as? ViewGroup)?.removeView(webView)
      webView.stopLoading()
      webView.destroy()
    }
    super.onDestroy()
  }

  private fun bindViews() {
    rootContainer = findViewById(R.id.root_container)
    swipeRefresh = findViewById(R.id.swipe_refresh)
    webView = findViewById(R.id.web_view)
    loadingProgress = findViewById(R.id.loading_progress)
    errorContainer = findViewById(R.id.error_container)
    retryButton = findViewById(R.id.retry_button)
    fullscreenContainer = findViewById(R.id.fullscreen_container)
  }

  private fun setupEdgeToEdgeInsets() {
    ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { _, windowInsets ->
      val bars =
        windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      swipeRefresh.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      errorContainer.setPadding(
        bars.left + dpToPx(32),
        bars.top + dpToPx(32),
        bars.right + dpToPx(32),
        bars.bottom + dpToPx(32)
      )
      (loadingProgress.layoutParams as? ViewGroup.MarginLayoutParams)?.let { lp ->
        lp.leftMargin = bars.left
        lp.topMargin = bars.top
        lp.rightMargin = bars.right
        loadingProgress.layoutParams = lp
      }
      windowInsets
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun setupWebView() {
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      useWideViewPort = true
      loadWithOverviewMode = true
      builtInZoomControls = false
      displayZoomControls = false
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      setSupportMultipleWindows(true)
      javaScriptCanOpenWindowsAutomatically = false
      userAgentString = "$userAgentString TheCFBHubAndroid/${BuildConfig.VERSION_NAME}"
    }

    CookieManager.getInstance().apply {
      setAcceptCookie(true)
      setAcceptThirdPartyCookies(webView, true)
    }

    webView.addJavascriptInterface(AndroidJsBridge(), JS_BRIDGE_NAME)

    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val req = request ?: return false
        val target = req.url?.toString()
        return when (AppUrlPolicy.decideNavigation(target, req.isForMainFrame, appHost)) {
          AppUrlPolicy.NavigationAction.LOAD_IN_WEBVIEW -> false
          AppUrlPolicy.NavigationAction.OPEN_CUSTOM_TAB -> {
            if (target != null) openInCustomTab(target)
            true
          }
          AppUrlPolicy.NavigationAction.OPEN_EXTERNAL_INTENT -> {
            if (target != null) openExternalIntent(target)
            true
          }
          AppUrlPolicy.NavigationAction.IGNORE -> true
        }
      }

      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
        hasLoadError = false
        if (url != null && AppUrlPolicy.isAppUrl(url, appHost)) {
          lastRequestedUrl = url
        }
        loadingProgress.progress = 10
        loadingProgress.isVisible = true
      }

      override fun onPageFinished(view: WebView?, url: String?) {
        loadingProgress.isVisible = false
        swipeRefresh.isRefreshing = false
        if (!hasLoadError) {
          errorContainer.isVisible = false
        }
        if (url != null && AppUrlPolicy.isAppUrl(url, appHost)) {
          injectWebBridgeObservers()
        }
      }

      override fun onReceivedError(
        view: WebView?,
        request: WebResourceRequest?,
        error: WebResourceError?
      ) {
        if (request?.isForMainFrame != true) return
        if (error?.errorCode == ERROR_UNSUPPORTED_SCHEME) return
        val failedUrl = request.url?.toString()
        if (failedUrl != null && AppUrlPolicy.isAppUrl(failedUrl, appHost)) {
          lastRequestedUrl = failedUrl
        }
        hasLoadError = true
        swipeRefresh.isRefreshing = false
        loadingProgress.isVisible = false
        errorContainer.isVisible = true
      }
    }

    webView.webChromeClient = object : WebChromeClient() {
      override fun onProgressChanged(view: WebView?, newProgress: Int) {
        if (newProgress >= 100) {
          loadingProgress.isVisible = false
        } else {
          if (!loadingProgress.isVisible) {
            loadingProgress.isVisible = true
          }
          loadingProgress.progress = newProgress
        }
      }

      override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
        if (view == null) return
        if (customView != null) {
          callback?.onCustomViewHidden()
          return
        }
        customView = view
        customViewCallback = callback
        fullscreenContainer.addView(
          view,
          FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
          )
        )
        fullscreenContainer.isVisible = true
        insetsController.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
      }

      override fun onHideCustomView() {
        hideCustomView()
      }

      override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?
      ): Boolean {
        if (!isUserGesture || resultMsg == null) return false
        val transport = resultMsg.obj as? WebView.WebViewTransport ?: return false

        val tempWebView = WebView(this@MainActivity)
        var disposed = false
        fun disposeTemp() {
          if (disposed) return
          disposed = true
          tempWebView.stopLoading()
          tempWebView.destroy()
        }

        fun routePopupUrl(url: String?) {
          when (AppUrlPolicy.decideNavigation(url, isMainFrame = true, appHost = appHost)) {
            AppUrlPolicy.NavigationAction.LOAD_IN_WEBVIEW -> if (url != null) loadAppUrl(url)
            AppUrlPolicy.NavigationAction.OPEN_CUSTOM_TAB -> if (url != null) openInCustomTab(url)
            AppUrlPolicy.NavigationAction.OPEN_EXTERNAL_INTENT -> {
              if (url != null) openExternalIntent(url)
            }
            AppUrlPolicy.NavigationAction.IGNORE -> Unit
          }
        }

        tempWebView.webViewClient = object : WebViewClient() {
          override fun shouldOverrideUrlLoading(
            v: WebView?,
            request: WebResourceRequest?
          ): Boolean {
            routePopupUrl(request?.url?.toString())
            disposeTemp()
            return true
          }

          override fun onPageStarted(v: WebView?, url: String?, favicon: Bitmap?) {
            if (!disposed) {
              routePopupUrl(url)
              disposeTemp()
            }
          }
        }

        transport.webView = tempWebView
        resultMsg.sendToTarget()
        mainHandler.postDelayed({ disposeTemp() }, 5000L)
        return true
      }
    }
  }

  private fun setupSwipeRefresh() {
    swipeRefresh.setColorSchemeColors(ContextCompat.getColor(this, R.color.brand_primary))
    swipeRefresh.setOnChildScrollUpCallback { _, _ -> !isPageAtTop || webView.scrollY > 0 }
    swipeRefresh.setOnRefreshListener {
      if (hasLoadError) {
        hideErrorView()
        loadAppUrl(lastRequestedUrl)
        return@setOnRefreshListener
      }
      webView.evaluateJavascript(
        """
        (function() {
          var btn = document.getElementById('refresh-btn');
          if (btn) {
            btn.click();
            return 'clicked';
          }
          return 'missing';
        })();
        """.trimIndent()
      ) { result ->
        if (result == "\"clicked\"") {
          mainHandler.postDelayed({ swipeRefresh.isRefreshing = false }, 900L)
        } else {
          webView.reload()
        }
      }
    }
  }

  private fun setupBackNavigation() {
    backPressedCallback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (customView != null) {
          hideCustomView()
          return
        }
        if (errorContainer.isVisible) {
          exitThroughPlatformBack()
          return
        }
        webView.evaluateJavascript(
          """
          (function() {
            var sheet = document.getElementById('game-sheet');
            if (sheet && sheet.classList.contains('open')) {
              var closeBtn = document.getElementById('sheet-close-btn');
              if (closeBtn) closeBtn.click();
              return 'handled';
            }
            if (document.body.classList.contains('watch-multistream-fs')) {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              return 'handled';
            }
            var navBackBtn = document.getElementById('nav-back-btn');
            if (navBackBtn && !navBackBtn.classList.contains('hidden') && navBackBtn.getBoundingClientRect().width > 0) {
              navBackBtn.click();
              return 'handled';
            }
            var teamBackBtn = document.getElementById('back-to-teams-btn');
            if (teamBackBtn && teamBackBtn.getBoundingClientRect().width > 0) {
              teamBackBtn.click();
              return 'handled';
            }
            return 'unhandled';
          })();
          """.trimIndent()
        ) { result ->
          if (isFinishing || isDestroyed) return@evaluateJavascript
          if (result == "\"handled\"") {
            return@evaluateJavascript
          }
          if (webView.canGoBack()) {
            webView.goBack()
          } else {
            exitThroughPlatformBack()
          }
        }
      }
    }
    onBackPressedDispatcher.addCallback(this, backPressedCallback)
  }

  private fun exitThroughPlatformBack() {
    backPressedCallback.isEnabled = false
    onBackPressedDispatcher.onBackPressed()
    backPressedCallback.isEnabled = true
  }

  private fun hideCustomView() {
    val view = customView ?: return
    fullscreenContainer.removeView(view)
    fullscreenContainer.isVisible = false
    customView = null
    customViewCallback?.onCustomViewHidden()
    customViewCallback = null
    insetsController.show(WindowInsetsCompat.Type.systemBars())
  }

  private fun hideErrorView() {
    hasLoadError = false
    errorContainer.isVisible = false
  }

  private fun loadAppUrl(url: String) {
    lastRequestedUrl = url
    webView.loadUrl(url)
  }

  private fun extractDeepLinkUrl(intent: Intent?): String? {
    if (intent?.action != Intent.ACTION_VIEW) return null
    val data = intent.data?.toString() ?: return null
    return if (AppUrlPolicy.isAppUrl(data, appHost)) data else null
  }

  private fun openInCustomTab(url: String) {
    val uri = Uri.parse(url)
    try {
      CustomTabsIntent.Builder()
        .setShowTitle(true)
        .build()
        .launchUrl(this, uri)
    } catch (_: ActivityNotFoundException) {
      openExternalIntent(url)
    } catch (_: Exception) {
      openExternalIntent(url)
    }
  }

  private fun openExternalIntent(url: String) {
    try {
      startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    } catch (_: ActivityNotFoundException) {
      // No external handler installed for this URI scheme.
    }
  }

  private fun injectWebBridgeObservers() {
    webView.evaluateJavascript(
      """
      (function() {
        var bridge = window.$JS_BRIDGE_NAME;
        if (!bridge) return;
        if (!window.__cfbAndroidBridgeInstalled) {
          window.__cfbAndroidBridgeInstalled = true;
          var reportTheme = function() {
            var theme = document.documentElement.getAttribute('data-theme');
            if (theme) bridge.onThemeChanged(theme);
          };
          new MutationObserver(reportTheme).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
          });
          var computeAtTop = function(target) {
            if (window.scrollY > 2) return false;
            var sheet = document.getElementById('game-sheet');
            if (sheet && sheet.classList.contains('open')) return false;
            if (document.body.classList.contains('watch-multistream-fs')) return false;
            var el = target && target.nodeType === 1 ? target : null;
            while (el && el !== document.body && el !== document.documentElement) {
              if (el.scrollTop > 0) return false;
              el = el.parentElement;
            }
            return true;
          };
          window.addEventListener('scroll', function() {
            bridge.onScrollTopChanged(computeAtTop(null));
          }, { passive: true });
          window.addEventListener('touchstart', function(e) {
            bridge.onScrollTopChanged(computeAtTop(e.target));
          }, { passive: true });
        }
        var currentTheme = document.documentElement.getAttribute('data-theme');
        if (currentTheme) bridge.onThemeChanged(currentTheme);
        var topNow = window.scrollY <= 2 && !document.body.classList.contains('watch-multistream-fs');
        bridge.onScrollTopChanged(topNow);
      })();
      """.trimIndent(),
      null
    )
  }

  private fun applySystemBarTheme(isDark: Boolean) {
    val bgColor = if (isDark) COLOR_SURFACE_DARK else COLOR_SURFACE_LIGHT
    rootContainer.setBackgroundColor(bgColor)
    errorContainer.setBackgroundColor(bgColor)
    insetsController.isAppearanceLightStatusBars = !isDark
    insetsController.isAppearanceLightNavigationBars = !isDark
  }

  private fun isNightModeActive(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  private fun dpToPx(dp: Int): Int =
    (dp * resources.displayMetrics.density).toInt()

  private inner class AndroidJsBridge {
    @JavascriptInterface
    fun onThemeChanged(theme: String?) {
      val isDark = AppUrlPolicy.normalizeTheme(theme) ?: return
      runOnUiThread {
        if (!isFinishing && !isDestroyed) {
          applySystemBarTheme(isDark)
        }
      }
    }

    @JavascriptInterface
    fun onScrollTopChanged(atTop: Boolean) {
      isPageAtTop = atTop
    }
  }

  companion object {
    private const val JS_BRIDGE_NAME = "AndroidBridge"
    private const val KEY_LAST_URL = "last_requested_url"
    private const val COLOR_SURFACE_LIGHT = 0xFFF5FBF5.toInt()
    private const val COLOR_SURFACE_DARK = 0xFF0F1512.toInt()
  }
}
