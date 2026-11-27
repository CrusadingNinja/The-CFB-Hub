package com.thecfbhub.app

import com.thecfbhub.app.util.KickoffFormatter
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KickoffFormatterTest {

  @Test
  fun parseGameNotes_separatesFlexSlotsFromBowlTitles() {
    val flex = KickoffFormatter.parseGameNotes(listOf("FLEX: 3:30 - 4:30pm OR 6 - 8pm ET start"))
    assertEquals("FLEX: 3:30 - 4:30pm OR 6 - 8pm ET", flex.flexTimeSlot)
    assertEquals("", flex.headline)

    val night = KickoffFormatter.parseGameNotes(listOf("NIGHT: 6 - 8pm ET start"))
    assertEquals("NIGHT: 6 - 8pm ET", night.flexTimeSlot)
    assertEquals("", night.headline)

    val early = KickoffFormatter.parseGameNotes(listOf("EARLY: Noon - 1pm ET start"))
    assertEquals("EARLY: Noon - 1pm ET", early.flexTimeSlot)
    assertEquals("", early.headline)

    val bowl = KickoffFormatter.parseGameNotes(listOf("TransPerfect San Juan Bowl"))
    assertEquals("", bowl.flexTimeSlot)
    assertEquals("TransPerfect San Juan Bowl", bowl.headline)
  }

  @Test
  fun formatEventKickoff_neverReturnsMidnightForTbdOrFlexGames() {
    val est = TimeZone.getTimeZone("America/New_York")

    val flexDisplay = KickoffFormatter.formatEventKickoff(
      isoDate = "2026-11-28T05:00Z",
      timeValid = false,
      statusDetail = "TBD",
      flexTimeSlot = "FLEX: 3:30 - 4:30pm OR 6 - 8pm ET",
      timeZone = est
    )
    assertEquals("FLEX: 3:30 - 4:30pm OR 6 - 8pm ET", flexDisplay)

    val unknownDisplay = KickoffFormatter.formatEventKickoff(
      isoDate = "2026-11-28T05:00Z",
      timeValid = false,
      statusDetail = "TBD",
      flexTimeSlot = "",
      timeZone = est
    )
    assertEquals("TBD", unknownDisplay)

    val confirmedDisplay = KickoffFormatter.formatEventKickoff(
      isoDate = "2026-11-28T21:15Z",
      timeValid = true,
      statusDetail = "11/28 - 4:15 PM EST",
      flexTimeSlot = "AFTERNOON: 3:30 - 4:30pm ET",
      timeZone = est
    )
    assertEquals("4:15 PM", confirmedDisplay)
    assertFalse(confirmedDisplay.contains("12:00 AM"))
  }

  @Test
  fun getLocalDateKey_anchorsTbdGamesToEasternDateAcrossWesternTimeZones() {
    val pst = TimeZone.getTimeZone("America/Los_Angeles")
    // 2026-11-28T05:00Z is Nov 27 9:00 PM PST, but ESPN means Saturday Nov 28 EST when timeValid=false
    val tbdKey = KickoffFormatter.getLocalDateKey("2026-11-28T05:00Z", timeValid = false, localZone = pst)
    assertEquals("2026-11-28", tbdKey)

    val heading = KickoffFormatter.formatDayHeading("2026-11-28T05:00Z", timeValid = false, localZone = pst)
    assertTrue(heading.contains("Nov 28"))
  }
}
