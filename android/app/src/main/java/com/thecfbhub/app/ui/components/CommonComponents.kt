package com.thecfbhub.app.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SportsFootball
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.thecfbhub.app.data.model.GameEvent
import com.thecfbhub.app.data.model.TeamCompetitor
import com.thecfbhub.app.ui.theme.CfbTheme
import com.thecfbhub.app.util.KickoffFormatter

fun parseHexColor(hex: String?, fallback: Color): Color {
  val clean = hex?.trim().orEmpty()
  if (clean.isEmpty()) return fallback
  return try {
    Color(android.graphics.Color.parseColor(if (clean.startsWith("#")) clean else "#$clean"))
  } catch (_: Exception) {
    fallback
  }
}

fun openUrlInCustomTab(context: Context, url: String) {
  val uri = Uri.parse(url)
  try {
    CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
  } catch (_: ActivityNotFoundException) {
    try {
      context.startActivity(Intent(Intent.ACTION_VIEW, uri))
    } catch (_: Exception) {
      // No external browser available
    }
  }
}

@Composable
fun TeamLogo(
  logoUrl: String,
  abbreviation: String,
  colorHex: String? = null,
  size: Dp = 32.dp,
  modifier: Modifier = Modifier
) {
  var failed by remember(logoUrl) { mutableStateOf(false) }
  val bg = parseHexColor(colorHex, MaterialTheme.colorScheme.primary)
  val corner = if (size >= 44.dp) 12.dp else 8.dp

  Box(
    modifier = modifier
      .size(size)
      .clip(RoundedCornerShape(corner))
      .background(MaterialTheme.colorScheme.surfaceContainerHigh),
    contentAlignment = Alignment.Center
  ) {
    if (logoUrl.isNotBlank() && !failed) {
      AsyncImage(
        model = logoUrl,
        contentDescription = abbreviation,
        modifier = Modifier
          .fillMaxSize()
          .padding(2.dp),
        contentScale = ContentScale.Fit,
        onError = { failed = true }
      )
    } else {
      Box(
        modifier = Modifier
          .fillMaxSize()
          .background(bg),
        contentAlignment = Alignment.Center
      ) {
        Text(
          text = abbreviation.ifBlank { "CFB" }.take(4),
          color = Color.White,
          style = MaterialTheme.typography.labelSmall,
          fontWeight = FontWeight.Bold,
          maxLines = 1
        )
      }
    }
  }
}

@Composable
fun RankBadge(rank: Int?, modifier: Modifier = Modifier) {
  if (rank == null || rank !in 1..25) return
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(6.dp),
    color = MaterialTheme.colorScheme.tertiaryContainer,
    contentColor = MaterialTheme.colorScheme.onTertiaryContainer
  ) {
    Text(
      text = "#$rank",
      style = MaterialTheme.typography.labelSmall,
      fontWeight = FontWeight.Bold,
      modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
    )
  }
}

@Composable
fun StatusPill(
  text: String,
  state: String,
  modifier: Modifier = Modifier
) {
  val ext = CfbTheme.extended
  val bg = when (state) {
    "in" -> ext.liveContainer
    "pre" -> MaterialTheme.colorScheme.secondaryContainer
    else -> MaterialTheme.colorScheme.surfaceContainerHighest
  }
  val fg = when (state) {
    "in" -> ext.onLiveContainer
    "pre" -> MaterialTheme.colorScheme.onSecondaryContainer
    else -> MaterialTheme.colorScheme.onSurfaceVariant
  }

  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(999.dp),
    color = bg,
    contentColor = fg
  ) {
    Row(
      modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
      if (state == "in") {
        Box(
          modifier = Modifier
            .size(7.dp)
            .clip(CircleShape)
            .background(ext.live)
        )
      }
      Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis
      )
    }
  }
}

@Composable
fun BroadcastTag(text: String, modifier: Modifier = Modifier) {
  if (text.isBlank()) return
  Surface(
    modifier = modifier.widthIn(max = 150.dp),
    shape = RoundedCornerShape(6.dp),
    color = MaterialTheme.colorScheme.surfaceContainer,
    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
  ) {
    Text(
      text = text,
      style = MaterialTheme.typography.labelSmall,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp)
    )
  }
}

@Composable
fun SegmentedOptionRow(
  options: List<Pair<String, String>>,
  selectedKey: String,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier
) {
  Row(
    modifier = modifier
      .clip(RoundedCornerShape(999.dp))
      .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(999.dp))
      .background(MaterialTheme.colorScheme.surfaceContainerLowest),
    verticalAlignment = Alignment.CenterVertically
  ) {
    options.forEach { (key, label) ->
      val selected = key == selectedKey
      Row(
        modifier = Modifier
          .clip(RoundedCornerShape(999.dp))
          .background(
            if (selected) MaterialTheme.colorScheme.secondaryContainer
            else Color.Transparent
          )
          .clickable { onSelect(key) }
          .padding(horizontal = 12.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
      ) {
        if (selected) {
          Icon(
            imageVector = Icons.Rounded.Check,
            contentDescription = null,
            modifier = Modifier.size(14.dp),
            tint = MaterialTheme.colorScheme.onSecondaryContainer
          )
        }
        Text(
          text = label,
          style = MaterialTheme.typography.labelMedium,
          fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
          color = if (selected) {
            MaterialTheme.colorScheme.onSecondaryContainer
          } else {
            MaterialTheme.colorScheme.onSurfaceVariant
          },
          maxLines = 1
        )
      }
    }
  }
}

@Composable
fun SectionHeader(
  title: String,
  trailing: String? = null,
  isLiveAccent: Boolean = false,
  modifier: Modifier = Modifier
) {
  val ext = CfbTheme.extended
  Row(
    modifier = modifier
      .fillMaxWidth()
      .padding(vertical = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
  ) {
    Row(
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
      if (isLiveAccent) {
        Box(
          modifier = Modifier
            .size(9.dp)
            .clip(CircleShape)
            .background(ext.live)
        )
      }
      Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        color = if (isLiveAccent) ext.live else MaterialTheme.colorScheme.onSurface
      )
    }
    if (!trailing.isNullOrBlank()) {
      Text(
        text = trailing,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant
      )
    }
  }
}

@Composable
fun GameCard(
  event: GameEvent,
  hasMatchedStream: Boolean,
  onOpenGame: () -> Unit,
  onOpenTeam: (String) -> Unit,
  onOpenWatch: () -> Unit,
  modifier: Modifier = Modifier
) {
  val ext = CfbTheme.extended
  val isLive = event.state == "in"
  val isPre = event.state == "pre"
  val isPost = event.state == "post"

  val statusLabel = if (isPre) {
    KickoffFormatter.formatEventKickoff(
      isoDate = event.date,
      timeValid = event.timeValid,
      statusDetail = event.statusDetail,
      flexTimeSlot = event.flexTimeSlot
    )
  } else {
    event.statusDetail.ifEmpty { if (isLive) "LIVE" else "Final" }
  }

  val borderStroke = if (isLive) {
    BorderStroke(1.5.dp, ext.live.copy(alpha = 0.65f))
  } else {
    BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
  }

  Card(
    modifier = modifier
      .fillMaxWidth()
      .clickable(onClick = onOpenGame),
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(
      containerColor = MaterialTheme.colorScheme.surfaceContainerLowest
    ),
    border = borderStroke,
    elevation = CardDefaults.cardElevation(defaultElevation = if (isLive) 2.dp else 0.dp)
  ) {
    Column(
      modifier = Modifier.padding(14.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      // Top row: status pill + optional headline & broadcast
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        StatusPill(
          text = statusLabel,
          state = event.state,
          modifier = Modifier.weight(1f, fill = false)
        )
        Spacer(Modifier.width(8.dp))
        Row(
          horizontalArrangement = Arrangement.spacedBy(6.dp),
          verticalAlignment = Alignment.CenterVertically
        ) {
          if (event.headline.isNotBlank()) BroadcastTag(event.headline)
          if (event.broadcast.isNotBlank()) BroadcastTag(event.broadcast)
        }
      }

      // Teams
      GameTeamRow(
        competitor = event.away,
        isPre = isPre,
        isPost = isPost,
        hasPossession = isLive && event.situation?.possession == event.away.id,
        onClickTeam = { onOpenTeam(event.away.id) }
      )
      GameTeamRow(
        competitor = event.home,
        isPre = isPre,
        isPost = isPost,
        hasPossession = isLive && event.situation?.possession == event.home.id,
        onClickTeam = { onOpenTeam(event.home.id) }
      )

      // Live situation banner
      val sit = if (isLive) event.situation else null
      val sitText = sit?.downDistanceText?.ifBlank { sit.shortDownDistanceText.ifBlank { sit.possessionText } }.orEmpty()
      if (sit != null && sitText.isNotBlank()) {
        Surface(
          shape = RoundedCornerShape(10.dp),
          color = if (sit.isRedZone) ext.liveContainer else MaterialTheme.colorScheme.surfaceContainerLow,
          contentColor = if (sit.isRedZone) ext.onLiveContainer else MaterialTheme.colorScheme.onSurfaceVariant
        ) {
          Row(
            modifier = Modifier
              .fillMaxWidth()
              .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            Text(
              text = sitText,
              style = MaterialTheme.typography.labelMedium,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.weight(1f)
            )
            if (sit.isRedZone) {
              Text(
                text = "RED ZONE",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.ExtraBold
              )
            }
          }
        }
      }

      // Footer: venue + Watch / Game Center prompt
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
      ) {
        val venueText = listOf(event.venue.name, event.venue.city)
          .filter { it.isNotBlank() }
          .joinToString(" · ")
          .ifBlank { "College Football" }
        Text(
          text = venueText,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f)
        )
        Spacer(Modifier.width(8.dp))
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
          if (isLive) {
            Surface(
              modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .clickable(onClick = onOpenWatch),
              shape = RoundedCornerShape(999.dp),
              color = if (hasMatchedStream) ext.winContainer else MaterialTheme.colorScheme.secondaryContainer,
              contentColor = if (hasMatchedStream) ext.onWinContainer else MaterialTheme.colorScheme.onSecondaryContainer
            ) {
              Row(
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
              ) {
                Icon(
                  imageVector = Icons.Rounded.LiveTv,
                  contentDescription = null,
                  modifier = Modifier.size(13.dp)
                )
                Text(
                  text = "Watch",
                  style = MaterialTheme.typography.labelSmall,
                  fontWeight = FontWeight.Bold
                )
              }
            }
          }
          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp)
          ) {
            Text(
              text = if (isLive || isPost) "Play-by-Play" else "Preview",
              style = MaterialTheme.typography.labelMedium,
              color = MaterialTheme.colorScheme.primary,
              fontWeight = FontWeight.Bold
            )
            Icon(
              imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
              contentDescription = null,
              modifier = Modifier.size(14.dp),
              tint = MaterialTheme.colorScheme.primary
            )
          }
        }
      }
    }
  }
}

@Composable
private fun GameTeamRow(
  competitor: TeamCompetitor,
  isPre: Boolean,
  isPost: Boolean,
  hasPossession: Boolean,
  onClickTeam: () -> Unit
) {
  val isWinner = isPost && competitor.winner
  val isLoser = isPost && !competitor.winner
  val ext = CfbTheme.extended
  val textAlpha = if (isLoser) 0.65f else 1f
  val canOpenTeam = competitor.id.isNotBlank() && competitor.id != "-1" && competitor.id != "-2"

  Row(
    modifier = Modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.SpaceBetween
  ) {
    Row(
      modifier = Modifier
        .weight(1f)
        .clip(RoundedCornerShape(8.dp))
        .then(if (canOpenTeam) Modifier.clickable(onClick = onClickTeam) else Modifier)
        .padding(vertical = 2.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      TeamLogo(
        logoUrl = competitor.logo,
        abbreviation = competitor.abbreviation,
        colorHex = competitor.color,
        size = 34.dp
      )
      Column(modifier = Modifier.weight(1f)) {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
          RankBadge(competitor.rank)
          Text(
            text = competitor.shortName,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = if (isWinner) FontWeight.ExtraBold else FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = textAlpha),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
          )
          if (hasPossession) {
            Box(
              modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(ext.win)
            )
          }
        }
        val recParts = buildList {
          add(competitor.overallRecord.ifBlank { "0-0" })
          if (competitor.confRecord.isNotBlank()) add("${competitor.confRecord} Conf")
        }
        Text(
          text = recParts.joinToString(" · "),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = textAlpha),
          maxLines = 1
        )
      }
    }

    if (!isPre) {
      Spacer(Modifier.width(8.dp))
      Text(
        text = competitor.score.ifBlank { "0" },
        style = MaterialTheme.typography.titleLarge,
        fontWeight = if (isWinner) FontWeight.ExtraBold else FontWeight.Bold,
        color = if (isWinner) ext.win else MaterialTheme.colorScheme.onSurface.copy(alpha = textAlpha)
      )
    }
  }
}

@Composable
fun LoadingStateBox(
  message: String = "Loading ESPN data...",
  modifier: Modifier = Modifier
) {
  Box(
    modifier = modifier
      .fillMaxWidth()
      .padding(32.dp),
    contentAlignment = Alignment.Center
  ) {
    Column(
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
      CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
      Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center
      )
    }
  }
}

@Composable
fun ErrorStateCard(
  message: String,
  onRetry: () -> Unit,
  modifier: Modifier = Modifier
) {
  Card(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(20.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
      Text(
        text = message,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onErrorContainer,
        textAlign = TextAlign.Center
      )
      Button(
        onClick = onRetry,
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp)
      ) {
        Icon(
          imageVector = Icons.Rounded.Refresh,
          contentDescription = null,
          modifier = Modifier.size(16.dp)
        )
        Spacer(Modifier.width(6.dp))
        Text("Retry")
      }
    }
  }
}

@Composable
fun EmptyStateCard(
  title: String,
  subtitle: String,
  modifier: Modifier = Modifier
) {
  Card(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(24.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
      Icon(
        imageVector = Icons.Rounded.SportsFootball,
        contentDescription = null,
        tint = MaterialTheme.colorScheme.primary,
        modifier = Modifier.size(32.dp)
      )
      Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center
      )
      Text(
        text = subtitle,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center
      )
    }
  }
}
