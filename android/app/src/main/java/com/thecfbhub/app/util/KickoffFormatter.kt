package com.thecfbhub.app.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class ParsedGameNotes(
  val flexTimeSlot: String = "",
  val headline: String = ""
)

object KickoffFormatter {
  private val WINDOW_PREFIX_REGEX =
    Regex("^(?:flex|early|afternoon|night|late|prime|midday|window)\\s*:", RegexOption.IGNORE_CASE)
  private val WINDOW_MERIDIEM_REGEX =
    Regex(
      "\\b(?:am|pm|noon)\\b.*\\b(?:et|ct|mt|pt|est|edt|start|kickoff|window)\\b",
      RegexOption.IGNORE_CASE
    )
  private val WINDOW_RANGE_REGEX =
    Regex(
      "\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*[-–/]\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b",
      RegexOption.IGNORE_CASE
    )
  private val TRAILING_START_REGEX = Regex("\\s+start\\s*$", RegexOption.IGNORE_CASE)
  private val TBD_REGEX = Regex("\\b(?:tbd|tba)\\b", RegexOption.IGNORE_CASE)

  fun isTimeWindowNote(text: String?): Boolean {
    val t = text?.trim().orEmpty()
    if (t.isEmpty()) return false
    return WINDOW_PREFIX_REGEX.containsMatchIn(t) ||
      WINDOW_MERIDIEM_REGEX.containsMatchIn(t) ||
      WINDOW_RANGE_REGEX.containsMatchIn(t)
  }

  fun cleanFlexTimeSlot(text: String?): String =
    text?.trim().orEmpty().replace(TRAILING_START_REGEX, "").trim()

  fun parseGameNotes(notes: List<String>, fallbackGameNote: String = ""): ParsedGameNotes {
    val candidates = mutableListOf<String>()
    for (note in notes) {
      val trimmed = note.trim()
      if (trimmed.isNotEmpty() && !candidates.contains(trimmed)) {
        candidates.add(trimmed)
      }
    }
    val extra = fallbackGameNote.trim()
    if (extra.isNotEmpty() && !candidates.contains(extra)) {
      candidates.add(extra)
    }

    var flexTimeSlot = ""
    var headline = ""
    for (candidate in candidates) {
      if (isTimeWindowNote(candidate)) {
        if (flexTimeSlot.isEmpty()) {
          flexTimeSlot = cleanFlexTimeSlot(candidate)
        }
      } else if (headline.isEmpty()) {
        headline = candidate
      }
    }
    return ParsedGameNotes(flexTimeSlot = flexTimeSlot, headline = headline)
  }

  fun parseIsoTimestampMs(raw: String?): Long? {
    val input = raw?.trim().orEmpty()
    if (input.isEmpty()) return null

    if (input.matches(Regex("^\\d{4}-\\d{2}-\\d{2}$"))) {
      return try {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
          timeZone = TimeZone.getTimeZone("America/New_York")
          isLenient = false
        }
        fmt.parse(input)?.time
      } catch (_: Exception) {
        null
      }
    }

    var normalized = input
    if (normalized.endsWith("Z", ignoreCase = true)) {
      normalized = normalized.dropLast(1) + "+0000"
    }
    // Remove fractional seconds like .123 before timezone offset
    normalized = normalized.replace(Regex("\\.\\d+(?=[+-]|$)"), "")
    // Convert +HH:MM / -HH:MM -> +HHMM / -HHMM
    normalized = normalized.replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
    // Insert :00 seconds if missing (e.g., 2026-11-28T05:00+0000 -> 2026-11-28T05:00:00+0000)
    normalized = normalized.replace(Regex("(T\\d{2}:\\d{2})([+-]\\d{4}|$)"), "$1:00$2")

    val hasZone = normalized.matches(Regex(".*[+-]\\d{4}$"))
    return try {
      val pattern = if (hasZone) "yyyy-MM-dd'T'HH:mm:ssZ" else "yyyy-MM-dd'T'HH:mm:ss"
      val fmt = SimpleDateFormat(pattern, Locale.US).apply {
        if (!hasZone) timeZone = TimeZone.getTimeZone("UTC")
        isLenient = false
      }
      fmt.parse(normalized)?.time
    } catch (_: Exception) {
      null
    }
  }

  fun isKickoffTimeTbd(
    isoDate: String?,
    timeValid: Boolean,
    statusDetail: String = ""
  ): Boolean {
    if (!timeValid) return true
    if (TBD_REGEX.containsMatchIn(statusDetail)) return true
    return parseIsoTimestampMs(isoDate) == null
  }

  fun formatKickoffTime(
    isoDate: String?,
    timeZone: TimeZone = TimeZone.getDefault()
  ): String {
    val ts = parseIsoTimestampMs(isoDate) ?: return "TBD"
    val fmt = SimpleDateFormat("h:mm a", Locale.US).apply {
      this.timeZone = timeZone
    }
    return fmt.format(Date(ts))
  }

  fun formatEventKickoff(
    isoDate: String?,
    timeValid: Boolean,
    statusDetail: String = "",
    flexTimeSlot: String = "",
    timeZone: TimeZone = TimeZone.getDefault()
  ): String {
    if (isKickoffTimeTbd(isoDate, timeValid, statusDetail)) {
      return flexTimeSlot.ifBlank { "TBD" }
    }
    return formatKickoffTime(isoDate, timeZone)
  }

  fun formatDayHeading(
    isoDate: String?,
    timeValid: Boolean = true,
    localZone: TimeZone = TimeZone.getDefault()
  ): String {
    val ts = parseIsoTimestampMs(isoDate) ?: return "Scheduled"
    val targetZone = if (!timeValid) TimeZone.getTimeZone("America/New_York") else localZone
    val fmt = SimpleDateFormat("EEEE, MMM d", Locale.US).apply {
      timeZone = targetZone
    }
    return fmt.format(Date(ts))
  }

  fun getLocalDateKey(
    isoDate: String?,
    timeValid: Boolean = true,
    localZone: TimeZone = TimeZone.getDefault()
  ): String {
    val ts = parseIsoTimestampMs(isoDate) ?: return "tbd"
    val targetZone = if (!timeValid) TimeZone.getTimeZone("America/New_York") else localZone
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
      timeZone = targetZone
    }
    return fmt.format(Date(ts))
  }

  fun formatCountdown(isoDate: String?, nowMs: Long = System.currentTimeMillis()): String {
    val ts = parseIsoTimestampMs(isoDate) ?: return ""
    val diffMs = ts - nowMs
    if (diffMs <= 0L) return "Starting soon"
    val totalMins = (diffMs / 60_000L).toInt()
    val days = totalMins / (60 * 24)
    val hours = (totalMins % (60 * 24)) / 60
    val mins = totalMins % 60
    return when {
      days > 0 -> "In ${days}d ${hours}h"
      hours > 0 -> "In ${hours}h ${mins}m"
      else -> "In ${mins}m"
    }
  }

  fun quarterLabel(period: Int): String = when {
    period == 1 -> "1st Quarter"
    period == 2 -> "2nd Quarter"
    period == 3 -> "3rd Quarter"
    period == 4 -> "4th Quarter"
    period > 4 -> "OT ${period - 4}"
    else -> "Period $period"
  }
}
