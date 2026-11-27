package com.thecfbhub.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

@Immutable
data class ExtendedCfbColors(
  val live: Color,
  val liveContainer: Color,
  val onLiveContainer: Color,
  val win: Color,
  val winContainer: Color,
  val onWinContainer: Color,
  val warnContainer: Color,
  val onWarnContainer: Color,
  val redzone: Color,
  val turf: Color
)

private val LightExtendedColors = ExtendedCfbColors(
  live = Color(0xFFC62828),
  liveContainer = Color(0xFFFFDAD6),
  onLiveContainer = Color(0xFF410002),
  win = Color(0xFF006C47),
  winContainer = Color(0xFFC5F7DC),
  onWinContainer = Color(0xFF002113),
  warnContainer = Color(0xFFFFEBC2),
  onWarnContainer = Color(0xFF382600),
  redzone = Color(0xFF8F2D24),
  turf = Color(0xFF1F5C3A)
)

private val DarkExtendedColors = ExtendedCfbColors(
  live = Color(0xFFFF5449),
  liveContainer = Color(0xFF7C1315),
  onLiveContainer = Color(0xFFFFDAD6),
  win = Color(0xFF6CDBAC),
  winContainer = Color(0xFF004E32),
  onWinContainer = Color(0xFF89F8C1),
  warnContainer = Color(0xFF553B00),
  onWarnContainer = Color(0xFFFFDEA6),
  redzone = Color(0xFFB33E33),
  turf = Color(0xFF1F5C3A)
)

val LocalExtendedColors = staticCompositionLocalOf { LightExtendedColors }

private val LightColorScheme = lightColorScheme(
  primary = Color(0xFF006C47),
  onPrimary = Color(0xFFFFFFFF),
  primaryContainer = Color(0xFF89F8C1),
  onPrimaryContainer = Color(0xFF002113),
  secondary = Color(0xFF4D6356),
  onSecondary = Color(0xFFFFFFFF),
  secondaryContainer = Color(0xFFCFE9D8),
  onSecondaryContainer = Color(0xFF0A1F15),
  tertiary = Color(0xFF3C6472),
  onTertiary = Color(0xFFFFFFFF),
  tertiaryContainer = Color(0xFFC0E9FA),
  onTertiaryContainer = Color(0xFF001F28),
  error = Color(0xFFBA1A1A),
  onError = Color(0xFFFFFFFF),
  errorContainer = Color(0xFFFFDAD6),
  onErrorContainer = Color(0xFF410002),
  background = Color(0xFFF5FBF5),
  onBackground = Color(0xFF171D1A),
  surface = Color(0xFFF5FBF5),
  onSurface = Color(0xFF171D1A),
  surfaceVariant = Color(0xFFDFE5DF),
  onSurfaceVariant = Color(0xFF404943),
  outline = Color(0xFF707973),
  outlineVariant = Color(0xFFBFC9C1),
  surfaceContainerLowest = Color(0xFFFFFFFF),
  surfaceContainerLow = Color(0xFFEFF5EF),
  surfaceContainer = Color(0xFFEAEFEA),
  surfaceContainerHigh = Color(0xFFE4EAE4),
  surfaceContainerHighest = Color(0xFFDEE4DE)
)

private val DarkColorScheme = darkColorScheme(
  primary = Color(0xFF6CDBAC),
  onPrimary = Color(0xFF003823),
  primaryContainer = Color(0xFF005235),
  onPrimaryContainer = Color(0xFF89F8C1),
  secondary = Color(0xFFB4CCBC),
  onSecondary = Color(0xFF1F3529),
  secondaryContainer = Color(0xFF364B3F),
  onSecondaryContainer = Color(0xFFCFE9D8),
  tertiary = Color(0xFFA4CDDC),
  onTertiary = Color(0xFF063542),
  tertiaryContainer = Color(0xFF234C5A),
  onTertiaryContainer = Color(0xFFC0E9FA),
  error = Color(0xFFFFB4AB),
  onError = Color(0xFF690005),
  errorContainer = Color(0xFF93000A),
  onErrorContainer = Color(0xFFFFDAD6),
  background = Color(0xFF0F1512),
  onBackground = Color(0xFFDEE4DE),
  surface = Color(0xFF0F1512),
  onSurface = Color(0xFFDEE4DE),
  surfaceVariant = Color(0xFF252B28),
  onSurfaceVariant = Color(0xFFBFC9C1),
  outline = Color(0xFF8A938C),
  outlineVariant = Color(0xFF404943),
  surfaceContainerLowest = Color(0xFF0A0F0D),
  surfaceContainerLow = Color(0xFF171D1A),
  surfaceContainer = Color(0xFF1B211E),
  surfaceContainerHigh = Color(0xFF252B28),
  surfaceContainerHighest = Color(0xFF303632)
)

private val CfbTypography = Typography(
  headlineSmall = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.Bold,
    fontSize = 20.sp,
    lineHeight = 26.sp
  ),
  titleLarge = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.Bold,
    fontSize = 18.sp,
    lineHeight = 24.sp
  ),
  titleMedium = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.SemiBold,
    fontSize = 15.sp,
    lineHeight = 20.sp
  ),
  titleSmall = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.SemiBold,
    fontSize = 13.sp,
    lineHeight = 18.sp
  ),
  bodyMedium = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.Normal,
    fontSize = 14.sp,
    lineHeight = 20.sp
  ),
  bodySmall = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.Normal,
    fontSize = 12.sp,
    lineHeight = 16.sp
  ),
  labelMedium = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.SemiBold,
    fontSize = 12.sp,
    lineHeight = 16.sp
  ),
  labelSmall = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontWeight = FontWeight.SemiBold,
    fontSize = 11.sp,
    lineHeight = 14.sp
  )
)

object CfbTheme {
  val extended: ExtendedCfbColors
    @Composable
    get() = LocalExtendedColors.current
}

@Composable
fun TheCfbHubTheme(
  darkTheme: Boolean,
  content: @Composable () -> Unit
) {
  val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
  val extended = if (darkTheme) DarkExtendedColors else LightExtendedColors
  CompositionLocalProvider(LocalExtendedColors provides extended) {
    MaterialTheme(
      colorScheme = colorScheme,
      typography = CfbTypography,
      content = content
    )
  }
}
