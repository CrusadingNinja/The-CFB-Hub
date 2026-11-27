package com.thecfbhub.app.ui.screens

import android.annotation.SuppressLint
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.FullscreenExit
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.thecfbhub.app.data.model.WatchStream
import com.thecfbhub.app.ui.components.EmptyStateCard
import com.thecfbhub.app.ui.components.ErrorStateCard
import com.thecfbhub.app.ui.components.LoadingStateBox
import com.thecfbhub.app.ui.components.SegmentedOptionRow
import com.thecfbhub.app.ui.components.StatusPill
import com.thecfbhub.app.ui.components.openUrlInCustomTab
import com.thecfbhub.app.ui.state.AppUiState
import com.thecfbhub.app.ui.theme.CfbTheme
import com.thecfbhub.app.util.KickoffFormatter

@Composable
fun WatchScreen(
  state: AppUiState,
  onChangeSource: (String) -> Unit,
  onSetFilter: (String) -> Unit,
  onSelectStream: (WatchStream) -> Unit,
  onSelectFeed: (Int) -> Unit,
  onToggleFullscreen: (Boolean) -> Unit,
  onRetry: () -> Unit
) {
  val context = LocalContext.current
  val ext = CfbTheme.extended

  val (activeStreams, activeLoading, activeError) = when (state.watchSource) {
    "thetvapp" -> Triple(state.tvAppCatalog.streams, state.tvAppLoading, state.tvAppError)
    "strmfree" -> Triple(state.strmFreeCatalog.streams, state.strmFreeLoading, state.strmFreeError)
    else -> Triple(state.ppvCatalog.streams, state.ppvLoading, state.ppvError)
  }

  val q = state.searchQuery.trim().lowercase()
  val displayedStreams = remember(activeStreams, state.watchFilter, state.searchQuery) {
    activeStreams.filter { s ->
      if (state.watchFilter == "cfb" && !s.isCfb && !s.isFootball) return@filter false
      if (q.isNotEmpty()) {
        val hay = "${s.name} ${s.tag} ${s.category} ${s.broadcast} ${s.sourceLabel}".lowercase()
        if (!hay.contains(q)) return@filter false
      }
      true
    }
  }

  val activeStream = state.selectedStream
  val activeFeed = activeStream?.feeds?.getOrNull(state.selectedFeedIndex)
    ?: activeStream?.feeds?.firstOrNull()
  var reloadNonce by remember { mutableIntStateOf(0) }

  if (state.watchFullscreen && activeStream != null && activeFeed != null) {
    Box(
      modifier = Modifier
        .fillMaxSize()
        .background(Color.Black)
    ) {
      StreamWebViewPlayer(
        embedUrl = activeFeed.iframe,
        reloadNonce = reloadNonce,
        modifier = Modifier.fillMaxSize()
      )
      IconButton(
        onClick = { onToggleFullscreen(false) },
        modifier = Modifier
          .align(Alignment.TopEnd)
          .padding(12.dp)
          .clip(RoundedCornerShape(999.dp))
          .background(Color.Black.copy(alpha = 0.65f))
      ) {
        Icon(
          imageVector = Icons.Rounded.FullscreenExit,
          contentDescription = "Exit fullscreen",
          tint = Color.White
        )
      }
    }
    return
  }

  LazyColumn(
    modifier = Modifier.fillMaxSize(),
    contentPadding = PaddingValues(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp)
  ) {
    // Player card
    if (activeStream != null && activeFeed != null) {
      item(key = "player") {
        Card(
          shape = RoundedCornerShape(16.dp),
          colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
          Column(modifier = Modifier.fillMaxWidth()) {
            Box(
              modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(Color.Black)
            ) {
              StreamWebViewPlayer(
                embedUrl = activeFeed.iframe,
                reloadNonce = reloadNonce,
                modifier = Modifier.fillMaxSize()
              )
            }

            Column(
              modifier = Modifier.padding(12.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
              Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
              ) {
                Column(modifier = Modifier.weight(1f)) {
                  Text(
                    text = activeStream.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                  )
                  Text(
                    text = "${activeStream.sourceLabel} · ${activeFeed.label}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                  )
                }
                Row {
                  IconButton(onClick = { reloadNonce += 1 }) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Reload player")
                  }
                  IconButton(onClick = { onToggleFullscreen(true) }) {
                    Icon(Icons.Rounded.Fullscreen, contentDescription = "Fullscreen")
                  }
                  if (activeStream.externalUrl.isNotBlank()) {
                    IconButton(onClick = { openUrlInCustomTab(context, activeStream.externalUrl) }) {
                      Icon(Icons.Rounded.OpenInBrowser, contentDescription = "Open source page")
                    }
                  }
                }
              }

              if (activeStream.feeds.size > 1) {
                Row(
                  modifier = Modifier.horizontalScroll(rememberScrollState()),
                  horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                  activeStream.feeds.forEachIndexed { idx, feed ->
                    FilterChip(
                      selected = idx == state.selectedFeedIndex,
                      onClick = { onSelectFeed(idx) },
                      label = { Text(feed.label, style = MaterialTheme.typography.labelSmall) }
                    )
                  }
                }
              }
            }
          }
        }
      }
    }

    // Source & category controls
    item(key = "watch-controls") {
      Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
      ) {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
          ) {
            SegmentedOptionRow(
              options = listOf(
                "ppv" to "ppv.st",
                "thetvapp" to "thetvapp.plus",
                "strmfree" to "strmfree.pk"
              ),
              selectedKey = state.watchSource,
              onSelect = onChangeSource
            )
          }
          SegmentedOptionRow(
            options = listOf("cfb" to "Football / CFB", "all" to "All Channels (${activeStreams.size})"),
            selectedKey = state.watchFilter,
            onSelect = onSetFilter
          )
        }
      }
    }

    if (activeError != null && activeStreams.isEmpty()) {
      item {
        ErrorStateCard(message = activeError, onRetry = onRetry)
      }
    } else if (activeLoading && activeStreams.isEmpty()) {
      item {
        LoadingStateBox("Loading live stream directory...")
      }
    } else if (displayedStreams.isEmpty()) {
      item {
        EmptyStateCard(
          title = "No live streams found",
          subtitle = "Switch stream sources or select \"All Channels\"."
        )
      }
    } else {
      items(displayedStreams, key = { "${it.source}:${it.id}" }) { stream ->
        val isSelected = activeStream?.id == stream.id && activeStream.source == stream.source
        Card(
          modifier = Modifier
            .fillMaxWidth()
            .clickable { onSelectStream(stream) },
          shape = RoundedCornerShape(14.dp),
          colors = CardDefaults.cardColors(
            containerColor = if (isSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
            else MaterialTheme.colorScheme.surfaceContainerLowest
          ),
          border = BorderStroke(
            if (isSelected) 1.5.dp else 1.dp,
            if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
          )
        ) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            Column(
              modifier = Modifier.weight(1f),
              verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
              Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                StatusPill(
                  text = if (stream.isLiveNow) "LIVE" else if (stream.startsAt > 0) {
                    KickoffFormatter.formatKickoffTime(
                      java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
                        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                        .format(java.util.Date(stream.startsAt * 1000L))
                    )
                  } else "Channel",
                  state = if (stream.isLiveNow) "in" else "pre"
                )
                if (stream.feeds.size > 1) {
                  Text(
                    text = "${stream.feeds.size} feeds",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                  )
                }
                if (stream.viewers > 0) {
                  Text(
                    text = "${stream.viewersDisplay} watching",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                  )
                }
              }
              Text(
                text = stream.name,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
              )
              Text(
                text = listOf(stream.sourceLabel, stream.broadcast.ifBlank { stream.category })
                  .filter { it.isNotBlank() }
                  .joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
              )
            }
            Spacer(Modifier.width(8.dp))
            Surface(
              shape = RoundedCornerShape(999.dp),
              color = if (isSelected) ext.win else MaterialTheme.colorScheme.secondaryContainer,
              contentColor = if (isSelected) Color.White else MaterialTheme.colorScheme.onSecondaryContainer
            ) {
              Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                Text(
                  text = if (isSelected) "Playing" else "Watch",
                  style = MaterialTheme.typography.labelMedium,
                  fontWeight = FontWeight.Bold
                )
              }
            }
          }
        }
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun StreamWebViewPlayer(
  embedUrl: String,
  reloadNonce: Int,
  modifier: Modifier = Modifier
) {
  val context = LocalContext.current
  var customVideoView by remember { mutableStateOf<View?>(null) }
  var customCallback by remember { mutableStateOf<WebChromeClient.CustomViewCallback?>(null) }
  var loadedUrlKey by remember { mutableStateOf("") }

  Box(modifier = modifier) {
    AndroidView(
      factory = { ctx ->
        WebView(ctx).apply {
          layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
          )
          settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
          }
          val wv = this
          CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true)
          }
          webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
              val req = request ?: return false
              if (!req.isForMainFrame) return false
              val target = req.url?.toString().orEmpty()
              return if (target.startsWith("https://thecfbhub.netlify.app/") ||
                target == embedUrl
              ) {
                false
              } else {
                openUrlInCustomTab(context, target)
                true
              }
            }
          }
          webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
              if (view == null) return
              customVideoView = view
              customCallback = callback
            }

            override fun onHideCustomView() {
              customCallback?.onCustomViewHidden()
              customVideoView = null
              customCallback = null
            }

            override fun onCreateWindow(
              view: WebView?,
              isDialog: Boolean,
              isUserGesture: Boolean,
              resultMsg: Message?
            ): Boolean {
              // Suppress unrequested ad popups from third-party stream embeds
              return false
            }
          }
        }
      },
      update = { webView ->
        val nextKey = "$embedUrl#$reloadNonce"
        if (loadedUrlKey != nextKey && embedUrl.isNotBlank()) {
          loadedUrlKey = nextKey
          webView.loadUrl(embedUrl)
        }
      },
      onRelease = { webView ->
        webView.stopLoading()
        webView.destroy()
      },
      modifier = Modifier.fillMaxSize()
    )

    customVideoView?.let { videoView ->
      AndroidView(
        factory = { ctx ->
          FrameLayout(ctx).apply {
            (videoView.parent as? ViewGroup)?.removeView(videoView)
            addView(
              videoView,
              FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
              )
            )
          }
        },
        modifier = Modifier
          .fillMaxSize()
          .background(Color.Black)
      )
    }
  }

  DisposableEffect(Unit) {
    onDispose {
      customCallback?.onCustomViewHidden()
      customVideoView = null
      customCallback = null
    }
  }
}
