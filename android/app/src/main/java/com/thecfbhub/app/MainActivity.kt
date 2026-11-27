package com.thecfbhub.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.thecfbhub.app.ui.CfbHubApp
import com.thecfbhub.app.ui.state.AppTab
import com.thecfbhub.app.ui.state.CfbViewModel

class MainActivity : ComponentActivity() {
  private val viewModel: CfbViewModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    handleDeepLink(intent)

    setContent {
      val state by viewModel.uiState.collectAsStateWithLifecycle()
      val isDark = state.isDarkTheme
      val isFullscreen = state.watchFullscreen

      SideEffect {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDark
        controller.isAppearanceLightNavigationBars = !isDark
        if (isFullscreen) {
          controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        } else {
          controller.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
      }

      val lifecycleOwner = LocalLifecycleOwner.current
      DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
          when (event) {
            Lifecycle.Event.ON_START -> viewModel.onAppForegroundChanged(true)
            Lifecycle.Event.ON_STOP -> viewModel.onAppForegroundChanged(false)
            else -> Unit
          }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
      }

      CfbHubApp(viewModel = viewModel)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleDeepLink(intent)
  }

  private fun handleDeepLink(intent: Intent?) {
    if (intent?.action != Intent.ACTION_VIEW) return
    val uri = intent.data ?: return
    val path = uri.path?.lowercase().orEmpty()
    val fragment = uri.fragment?.lowercase().orEmpty()
    val target = "$path#$fragment"
    when {
      target.contains("live") -> viewModel.selectTab(AppTab.LIVE)
      target.contains("watch") -> viewModel.selectTab(AppTab.WATCH)
      target.contains("standings") -> viewModel.selectTab(AppTab.STANDINGS)
      target.contains("rankings") -> viewModel.selectTab(AppTab.RANKINGS)
      target.contains("teams") -> viewModel.selectTab(AppTab.TEAMS)
      target.contains("transitive") -> viewModel.selectTab(AppTab.TRANSITIVE)
    }
  }
}
