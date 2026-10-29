package com.whumpo.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Whumpo palette, docs/brand/whumpo-identity.md (v1.1).
val DeepSky = Color(0xFF0F2D5B)
val SkyBlue = Color(0xFF60B5FF)
val CloudCoral = Color(0xFFFF7B7B)
val Sunshine = Color(0xFFFFD56B)
val Mint = Color(0xFFA7E3C1)
val CloudWhite = Color(0xFFF8FAFC)

// Text-safe darker action blue for light surfaces (Sky Blue on white is below 4.5:1).
private val ActionBlue = Color(0xFF1F5FA8)

private val LightColors = lightColorScheme(
    primary = ActionBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD7ECFF),
    onPrimaryContainer = DeepSky,
    secondary = DeepSky,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDDE6F3),
    onSecondaryContainer = DeepSky,
    tertiary = Color(0xFF9C3A3A),
    background = CloudWhite,
    onBackground = DeepSky,
    surface = CloudWhite,
    onSurface = DeepSky,
    surfaceVariant = Color(0xFFE6EDF6),
    onSurfaceVariant = Color(0xFF34475F),
    error = Color(0xFFB3261E),
)

private val DarkColors = darkColorScheme(
    primary = SkyBlue,
    onPrimary = DeepSky,
    primaryContainer = Color(0xFF1C467F),
    onPrimaryContainer = Color(0xFFD7ECFF),
    secondary = Mint,
    onSecondary = DeepSky,
    tertiary = CloudCoral,
    background = Color(0xFF0A1F40),
    onBackground = CloudWhite,
    surface = Color(0xFF0A1F40),
    onSurface = CloudWhite,
    surfaceVariant = Color(0xFF1A3359),
    onSurfaceVariant = Color(0xFFC8D5E6),
)

@Composable
fun WhumpoTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (darkTheme) DarkColors else LightColors, content = content)
}
