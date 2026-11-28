package com.thecfbhub.app.data.remote

import com.thecfbhub.app.data.model.BoxscoreRow
import com.thecfbhub.app.data.model.ConferenceInfo
import com.thecfbhub.app.data.model.ConferenceStandings
import com.thecfbhub.app.data.model.DriveInfo
import com.thecfbhub.app.data.model.DriveTeamInfo
import com.thecfbhub.app.data.model.GameEvent
import com.thecfbhub.app.data.model.GameOdds
import com.thecfbhub.app.data.model.GameSituation
import com.thecfbhub.app.data.model.GameSummary
import com.thecfbhub.app.data.model.GameVenue
import com.thecfbhub.app.data.model.PlayInfo
import com.thecfbhub.app.data.model.RankedTeamRow
import com.thecfbhub.app.data.model.RankingPoll
import com.thecfbhub.app.data.model.RankingsWeekOption
import com.thecfbhub.app.data.model.ScoreboardData
import com.thecfbhub.app.data.model.ScoringPlay
import com.thecfbhub.app.data.model.SeasonCalendar
import com.thecfbhub.app.data.model.SeasonGraphTeam
import com.thecfbhub.app.data.model.SeasonResultGame
import com.thecfbhub.app.data.model.SeasonResultsGraph
import com.thecfbhub.app.data.model.StandingGroup
import com.thecfbhub.app.data.model.StandingTeamRow
import com.thecfbhub.app.data.model.StandingsBundle
import com.thecfbhub.app.data.model.TeamComparisonRow
import com.thecfbhub.app.data.model.TeamCompetitor
import com.thecfbhub.app.data.model.TeamDetailHeader
import com.thecfbhub.app.data.model.TeamDirectoryItem
import com.thecfbhub.app.data.model.TeamLeaderEntry
import com.thecfbhub.app.data.model.TeamLeaderGroup
import com.thecfbhub.app.data.model.TeamPageData
import com.thecfbhub.app.data.model.TeamScheduleEvent
import com.thecfbhub.app.data.model.TeamSeasonSummary
import com.thecfbhub.app.data.model.TeamStatCategory
import com.thecfbhub.app.data.model.TeamStatItem
import com.thecfbhub.app.data.model.TeamStatisticsData
import com.thecfbhub.app.data.model.WatchCatalog
import com.thecfbhub.app.data.model.WatchCategory
import com.thecfbhub.app.data.model.WatchFeed
import com.thecfbhub.app.data.model.WatchStream
import com.thecfbhub.app.data.model.WeekEntry
import com.thecfbhub.app.data.model.WeeklyRankingsData
import com.thecfbhub.app.util.KickoffFormatter
import java.util.Calendar
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

object EspnJsonParser {
  private val PRIORITY_CONFERENCE_ORDER =
    listOf("8", "5", "1", "4", "9", "151", "17", "37", "15", "12", "18")

  private val TBD_REGEX = Regex("\\b(?:tbd|tba)\\b", RegexOption.IGNORE_CASE)
  private val RECORD_REGEX = Regex("^\\d+-\\d+(?:-\\d+)?$")
  private val YEAR_REGEX = Regex("\\b(20\\d{2})\\b")

  fun resolveIframeUrl(rawUrl: String, backendBaseUrl: String): String {
    val trimmed = rawUrl.trim()
    if (trimmed.isEmpty()) return ""
    return if (trimmed.startsWith("/")) {
      "${backendBaseUrl.trimEnd('/')}$trimmed"
    } else {
      trimmed
    }
  }

  fun extractScore(rawScore: Any?): String {
    if (rawScore == null || rawScore === JSONObject.NULL) return ""
    if (rawScore is JSONObject) {
      val dv = rawScore.opt("displayValue")
      if (dv != null && dv !== JSONObject.NULL) return dv.toString()
      val v = rawScore.opt("value")
      if (v != null && v !== JSONObject.NULL) return v.toString()
      return ""
    }
    return rawScore.toString()
  }

  private fun extractImageUrl(value: Any?): String {
    if (value == null || value === JSONObject.NULL) return ""
    if (value is String) return value
    if (value is JSONObject) return value.optString("href", "")
    return ""
  }

  fun extractLogoUrl(team: JSONObject?): String {
    if (team == null) return ""
    val logos = team.optJSONArray("logos")
    var chosen = ""
    if (logos != null) {
      for (i in 0 until logos.length()) {
        val logoObj = logos.optJSONObject(i) ?: continue
        val rel = logoObj.optJSONArray("rel")
        var hasDefault = false
        var hasDark = false
        if (rel != null) {
          for (j in 0 until rel.length()) {
            val tag = rel.optString(j)
            if (tag == "default") hasDefault = true
            if (tag == "dark") hasDark = true
          }
        }
        if (hasDefault && !hasDark) {
          val href = extractImageUrl(logoObj)
          if (href.isNotEmpty()) {
            chosen = href
            break
          }
        }
      }
      if (chosen.isEmpty()) {
        val directLogo = extractImageUrl(team.opt("logo"))
        if (directLogo.isNotEmpty()) chosen = directLogo
      }
      if (chosen.isEmpty()) {
        for (i in 0 until logos.length()) {
          val logoObj = logos.optJSONObject(i) ?: continue
          val rel = logoObj.optJSONArray("rel")
          var hasDark = false
          if (rel != null) {
            for (j in 0 until rel.length()) {
              if (rel.optString(j) == "dark") hasDark = true
            }
          }
          if (!hasDark) {
            val href = extractImageUrl(logoObj)
            if (href.isNotEmpty()) {
              chosen = href
              break
            }
          }
        }
      }
      if (chosen.isEmpty() && logos.length() > 0) {
        chosen = extractImageUrl(logos.opt(0))
      }
    } else {
      chosen = extractImageUrl(team.opt("logo"))
    }
    return chosen.replace(Regex("/500-dark/", RegexOption.IGNORE_CASE), "/500/")
  }

  fun normalizeRank(raw: Any?): Int? {
    if (raw == null || raw === JSONObject.NULL) return null
    val num = when (raw) {
      is Number -> raw.toInt()
      else -> raw.toString().toDoubleOrNull()?.toInt()
    } ?: return null
    return if (num in 1..25) num else null
  }

  private fun normalizeHexColor(raw: String?): String? {
    val clean = raw?.trim()?.removePrefix("#").orEmpty()
    if (clean.length != 6 && clean.length != 8) return null
    return "#$clean"
  }

  private fun pickRecord(records: JSONArray?, typeName: String): String {
    if (records == null) return ""
    for (i in 0 until records.length()) {
      val rec = records.optJSONObject(i) ?: continue
      if (rec.optString("type") == typeName) {
        return rec.optString("summary").ifEmpty { rec.optString("displayValue") }
      }
    }
    return ""
  }

  private fun normalizeCompetitorLeaders(rawLeaders: JSONArray?): List<TeamLeaderGroup> {
    if (rawLeaders == null) return emptyList()
    val entries = mutableListOf<TeamLeaderEntry>()
    for (i in 0 until rawLeaders.length()) {
      val cat = rawLeaders.optJSONObject(i) ?: continue
      val top = cat.optJSONArray("leaders")?.optJSONObject(0) ?: continue
      val athlete = top.optJSONObject("athlete") ?: JSONObject()
      val position = athlete.optJSONObject("position")?.optString("abbreviation").orEmpty()
      entries.add(
        TeamLeaderEntry(
          category = cat.optString("shortDisplayName")
            .ifEmpty { cat.optString("displayName") }
            .ifEmpty { cat.optString("name") },
          displayName = cat.optString("displayName"),
          athleteName = athlete.optString("displayName").ifEmpty { athlete.optString("shortName") },
          headshot = extractImageUrl(athlete.opt("headshot")),
          jersey = athlete.optString("jersey"),
          position = position,
          displayValue = top.optString("displayValue")
        )
      )
    }
    if (entries.isEmpty()) return emptyList()
    return listOf(TeamLeaderGroup(teamId = "", teamAbbr = "", teamName = "", categories = entries))
  }

  private fun normalizeCompetitor(raw: JSONObject): TeamCompetitor {
    val team = raw.optJSONObject("team") ?: JSONObject()
    val logo = extractLogoUrl(team)
    val records = raw.optJSONArray("records") ?: raw.optJSONArray("record")
    val curatedRank = raw.optJSONObject("curatedRank")?.opt("current")
    val rank = normalizeRank(curatedRank ?: raw.opt("rank"))

    val teamConfId = team.optString("conferenceId").ifEmpty {
      team.optJSONObject("groups")?.optString("id").orEmpty()
    }.ifEmpty { null }

    val lines = mutableListOf<String>()
    val linescores = raw.optJSONArray("linescores")
    if (linescores != null) {
      for (i in 0 until linescores.length()) {
        val ls = linescores.optJSONObject(i) ?: continue
        val dv = ls.opt("displayValue")
        val v = ls.opt("value")
        lines.add(
          when {
            dv != null && dv !== JSONObject.NULL -> dv.toString()
            v != null && v !== JSONObject.NULL -> v.toString()
            else -> "0"
          }
        )
      }
    }

    val rawId = raw.optString("id").ifEmpty { team.optString("id") }
    val abbr = team.optString("abbreviation").ifEmpty { team.optString("shortDisplayName") }.ifEmpty { "TBD" }
    val displayName = team.optString("displayName").ifEmpty { team.optString("location") }.ifEmpty { "TBD" }
    val shortName = team.optString("shortDisplayName")
      .ifEmpty { team.optString("nickname") }
      .ifEmpty { team.optString("location") }
      .ifEmpty { "TBD" }

    return TeamCompetitor(
      id = rawId,
      homeAway = raw.optString("homeAway"),
      abbreviation = abbr,
      displayName = displayName,
      shortName = shortName,
      location = team.optString("location"),
      color = normalizeHexColor(team.optString("color")),
      alternateColor = normalizeHexColor(team.optString("alternateColor")),
      logo = logo,
      logoDark = logo,
      conferenceId = teamConfId,
      score = extractScore(raw.opt("score")),
      winner = raw.optBoolean("winner", false),
      rank = rank,
      overallRecord = pickRecord(records, "total").ifEmpty { pickRecord(records, "overall") },
      confRecord = pickRecord(records, "vsconf"),
      linescores = lines,
      leaders = normalizeCompetitorLeaders(raw.optJSONArray("leaders"))
    )
  }

  private fun extractBroadcast(comp: JSONObject): String {
    val broadcasts = comp.optJSONArray("broadcasts")
    if (broadcasts != null && broadcasts.length() > 0) {
      val first = broadcasts.optJSONObject(0)
      val namesArr = first?.optJSONArray("names")
      if (namesArr != null && namesArr.length() > 0) {
        val parts = mutableListOf<String>()
        for (i in 0 until namesArr.length()) {
          val n = namesArr.optString(i)
          if (n.isNotEmpty()) parts.add(n)
        }
        if (parts.isNotEmpty()) return parts.joinToString(" / ")
      }
      val mediaShort = first?.optJSONObject("media")?.optString("shortName").orEmpty()
      if (mediaShort.isNotEmpty()) return mediaShort
    }
    val direct = comp.optString("broadcast")
    if (direct.isNotEmpty()) return direct
    val geo = comp.optJSONArray("geoBroadcasts")?.optJSONObject(0)
    return geo?.optJSONObject("media")?.optString("shortName").orEmpty()
  }

  private fun collectNoteHeadlines(notes: JSONArray?): List<String> {
    if (notes == null) return emptyList()
    val list = mutableListOf<String>()
    for (i in 0 until notes.length()) {
      val headline = notes.optJSONObject(i)?.optString("headline").orEmpty().trim()
      if (headline.isNotEmpty()) list.add(headline)
    }
    return list
  }

  fun normalizeEvent(ev: JSONObject): GameEvent {
    val comp = ev.optJSONArray("competitions")?.optJSONObject(0) ?: JSONObject()
    val competitors = comp.optJSONArray("competitors") ?: JSONArray()
    var awayRaw: JSONObject? = null
    var homeRaw: JSONObject? = null
    for (i in 0 until competitors.length()) {
      val c = competitors.optJSONObject(i) ?: continue
      val ha = c.optString("homeAway")
      if (ha == "away" && awayRaw == null) awayRaw = c
      if (ha == "home" && homeRaw == null) homeRaw = c
    }
    if (awayRaw == null) awayRaw = competitors.optJSONObject(1) ?: competitors.optJSONObject(0) ?: JSONObject()
    if (homeRaw == null) homeRaw = competitors.optJSONObject(0) ?: JSONObject()

    val away = normalizeCompetitor(awayRaw)
    val home = normalizeCompetitor(homeRaw)

    val statusObj = ev.optJSONObject("status") ?: comp.optJSONObject("status") ?: JSONObject()
    val statusType = statusObj.optJSONObject("type") ?: JSONObject()
    val state = statusType.optString("state").ifEmpty { "pre" }

    val seasonTypeObj = ev.optJSONObject("seasonType")
    val seasonObj = ev.optJSONObject("season")
    val seasonTypeId = seasonTypeObj?.opt("id")?.toString()
      ?: seasonTypeObj?.opt("type")?.toString()
      ?: seasonObj?.opt("type")?.toString()
      ?: "2"

    val weekObj = ev.optJSONObject("week")
    val weekNumber = weekObj?.optInt("number", -1)?.takeIf { it > 0 }
    val weekText = weekObj?.optString("text").orEmpty()
      .ifEmpty { if (weekNumber != null) "Week $weekNumber" else "" }

    val sit = comp.optJSONObject("situation")
    val situation = if (sit != null) {
      GameSituation(
        possession = sit.optString("possession").ifEmpty { null },
        down = if (sit.has("down") && !sit.isNull("down")) sit.optInt("down") else null,
        distance = if (sit.has("distance") && !sit.isNull("distance")) sit.optInt("distance") else null,
        downDistanceText = sit.optString("downDistanceText"),
        shortDownDistanceText = sit.optString("shortDownDistanceText"),
        possessionText = sit.optString("possessionText"),
        yardLine = if (sit.has("yardLine") && !sit.isNull("yardLine")) sit.optInt("yardLine") else null,
        isRedZone = sit.optBoolean("isRedZone", false),
        homeTimeouts = if (sit.has("homeTimeouts") && !sit.isNull("homeTimeouts")) sit.optInt("homeTimeouts") else null,
        awayTimeouts = if (sit.has("awayTimeouts") && !sit.isNull("awayTimeouts")) sit.optInt("awayTimeouts") else null,
        lastPlay = sit.optJSONObject("lastPlay")?.optString("text").orEmpty()
      )
    } else null

    val shortDetail = statusType.optString("shortDetail")
    val detail = statusType.optString("detail")
    val rawStatusText = "$shortDetail $detail"
    val compHasFalseTimeValid = comp.has("timeValid") && !comp.optBoolean("timeValid", true)
    val timeValid = !compHasFalseTimeValid && !TBD_REGEX.containsMatchIn(rawStatusText)
    val parsedNotes = KickoffFormatter.parseGameNotes(collectNoteHeadlines(comp.optJSONArray("notes")))

    val venueObj = comp.optJSONObject("venue")
    val venueAddr = venueObj?.optJSONObject("address")
    val oddsObj = comp.optJSONArray("odds")?.optJSONObject(0)
    val odds = if (oddsObj != null) {
      GameOdds(
        details = oddsObj.optString("details"),
        overUnder = if (oddsObj.has("overUnder") && !oddsObj.isNull("overUnder")) {
          oddsObj.optDouble("overUnder")
        } else null
      )
    } else null

    val dateStr = ev.optString("date").ifEmpty { comp.optString("date") }
    return GameEvent(
      id = ev.optString("id"),
      name = ev.optString("name").ifEmpty { "${away.shortName} at ${home.shortName}" },
      shortName = ev.optString("shortName").ifEmpty { "${away.abbreviation} @ ${home.abbreviation}" },
      date = dateStr,
      timeValid = timeValid,
      flexTimeSlot = parsedNotes.flexTimeSlot,
      seasonTypeId = seasonTypeId,
      seasonTypeName = seasonTypeObj?.optString("name").orEmpty()
        .ifEmpty { if (seasonTypeId == "3") "Postseason" else "Regular Season" },
      weekNumber = weekNumber,
      weekText = weekText,
      state = state,
      statusDetail = shortDetail.ifEmpty { detail },
      statusDescription = statusType.optString("description"),
      completed = statusType.optBoolean("completed", false),
      period = statusObj.optInt("period", 0),
      displayClock = statusObj.optString("displayClock"),
      neutralSite = comp.optBoolean("neutralSite", false),
      conferenceCompetition = comp.optBoolean("conferenceCompetition", false),
      playByPlayAvailable = comp.optBoolean("playByPlayAvailable", false),
      broadcast = extractBroadcast(comp),
      headline = parsedNotes.headline,
      venue = GameVenue(
        name = venueObj?.optString("fullName").orEmpty(),
        city = venueAddr?.optString("city").orEmpty(),
        state = venueAddr?.optString("state").orEmpty()
      ),
      odds = odds,
      away = away,
      home = home,
      situation = situation
    )
  }

  private fun normalizeCalendar(rawCalendar: JSONArray?): SeasonCalendar {
    if (rawCalendar == null || rawCalendar.length() == 0) return SeasonCalendar()
    var regSec: JSONObject? = null
    var postSec: JSONObject? = null
    for (i in 0 until rawCalendar.length()) {
      val sec = rawCalendar.optJSONObject(i) ?: continue
      val v = sec.opt("value")?.toString()
      if (v == "2" && regSec == null) regSec = sec
      if (v == "3" && postSec == null) postSec = sec
    }
    if (regSec == null) regSec = rawCalendar.optJSONObject(0)

    fun mapEntries(sec: JSONObject?): List<WeekEntry> {
      val arr = sec?.optJSONArray("entries") ?: return emptyList()
      val list = ArrayList<WeekEntry>(arr.length())
      for (i in 0 until arr.length()) {
        val e = arr.optJSONObject(i) ?: continue
        val valueStr = e.opt("value")?.toString().orEmpty()
        if (valueStr.isEmpty()) continue
        list.add(
          WeekEntry(
            label = e.optString("label")
              .ifEmpty { e.optString("alternateLabel") }
              .ifEmpty { "Week $valueStr" },
            detail = e.optString("detail"),
            value = valueStr,
            startDate = e.optString("startDate"),
            endDate = e.optString("endDate")
          )
        )
      }
      return list
    }

    return SeasonCalendar(
      regular = mapEntries(regSec),
      postseason = mapEntries(postSec)
    )
  }

  fun parseScoreboard(
    raw: JSONObject,
    fallbackSeasonType: String = "2",
    fallbackWeek: String = "1"
  ): ScoreboardData {
    val leagues = raw.optJSONArray("leagues")
    val calendar = normalizeCalendar(leagues?.optJSONObject(0)?.optJSONArray("calendar"))
    val rawEvents = raw.optJSONArray("events") ?: JSONArray()
    val events = ArrayList<GameEvent>(rawEvents.length())
    for (i in 0 until rawEvents.length()) {
      val evObj = rawEvents.optJSONObject(i) ?: continue
      events.add(normalizeEvent(evObj))
    }

    val stateOrder = mapOf("in" to 0, "pre" to 1, "post" to 2)
    events.sortWith { a, b ->
      val ordA = stateOrder[a.state] ?: 1
      val ordB = stateOrder[b.state] ?: 1
      if (ordA != ordB) return@sortWith ordA - ordB
      if (a.state == "pre") {
        val dayA = KickoffFormatter.getLocalDateKey(a.date, a.timeValid)
        val dayB = KickoffFormatter.getLocalDateKey(b.date, b.timeValid)
        if (dayA != dayB) return@sortWith dayA.compareTo(dayB)
        val aTbd = if (!a.timeValid) 1 else 0
        val bTbd = if (!b.timeValid) 1 else 0
        if (aTbd != bTbd) return@sortWith aTbd - bTbd
        if (aTbd == 1 && bTbd == 1) {
          val aHasFlex = if (a.flexTimeSlot.isNotBlank()) 0 else 1
          val bHasFlex = if (b.flexTimeSlot.isNotBlank()) 0 else 1
          if (aHasFlex != bHasFlex) return@sortWith aHasFlex - bHasFlex
        }
      }
      val tsA = KickoffFormatter.parseIsoTimestampMs(a.date) ?: Long.MAX_VALUE
      val tsB = KickoffFormatter.parseIsoTimestampMs(b.date) ?: Long.MAX_VALUE
      tsA.compareTo(tsB)
    }

    val curYear = Calendar.getInstance().get(Calendar.YEAR)
    val seasonYear = raw.optJSONObject("season")?.optInt("year", curYear) ?: curYear
    val seasonTypeOut = raw.optJSONObject("season")?.opt("type")?.toString() ?: fallbackSeasonType
    val weekOut = raw.optJSONObject("week")?.opt("number")?.toString() ?: fallbackWeek

    return ScoreboardData(
      seasonYear = seasonYear,
      seasonType = seasonTypeOut,
      weekNumber = weekOut,
      calendar = calendar,
      events = events
    )
  }

  private fun normalizePlay(play: JSONObject): PlayInfo {
    val start = play.optJSONObject("start")
    val end = play.optJSONObject("end")
    val periodNum = play.optJSONObject("period")?.optInt("number", 1) ?: 1
    val clockDisplay = play.optJSONObject("clock")?.optString("displayValue").orEmpty()
    val seqNum = play.optString("sequenceNumber").toLongOrNull() ?: play.optLong("sequenceNumber", 0L)

    return PlayInfo(
      id = play.optString("id").ifEmpty { "play-$seqNum-${play.hashCode()}" },
      sequenceNumber = seqNum,
      period = periodNum,
      clock = clockDisplay,
      text = play.optString("text"),
      awayScore = play.optInt("awayScore", 0),
      homeScore = play.optInt("homeScore", 0),
      scoringPlay = play.optBoolean("scoringPlay", false),
      isTurnover = play.optBoolean("isTurnover", false),
      isPenalty = play.optBoolean("isPenalty", false),
      statYardage = if (play.has("statYardage") && !play.isNull("statYardage")) play.optInt("statYardage") else null,
      typeText = play.optJSONObject("type")?.optString("text").orEmpty(),
      downDistanceText = start?.optString("downDistanceText").orEmpty()
        .ifEmpty { end?.optString("downDistanceText").orEmpty() },
      shortDownDistance = start?.optString("shortDownDistanceText").orEmpty(),
      possessionText = start?.optString("possessionText").orEmpty()
        .ifEmpty { end?.optString("possessionText").orEmpty() },
      yardLine = if (start != null && start.has("yardLine") && !start.isNull("yardLine")) start.optInt("yardLine") else null,
      yardsToEndzone = if (start != null && start.has("yardsToEndzone") && !start.isNull("yardsToEndzone")) {
        start.optInt("yardsToEndzone")
      } else null,
      endDownDistanceText = end?.optString("downDistanceText").orEmpty(),
      endShortDownDistanceText = end?.optString("shortDownDistanceText").orEmpty(),
      endPossessionText = end?.optString("possessionText").orEmpty(),
      endYardsToEndzone = if (end != null && end.has("yardsToEndzone") && !end.isNull("yardsToEndzone")) {
        end.optInt("yardsToEndzone")
      } else null,
      endTeamId = end?.optJSONObject("team")?.optString("id")?.ifEmpty { null }
    )
  }

  private fun normalizeDrive(drive: JSONObject, isCurrent: Boolean): DriveInfo {
    val teamObj = drive.optJSONObject("team") ?: JSONObject()
    val logo = extractLogoUrl(teamObj)
    val playsArr = drive.optJSONArray("plays") ?: JSONArray()
    val plays = ArrayList<PlayInfo>(playsArr.length())
    for (i in 0 until playsArr.length()) {
      val p = playsArr.optJSONObject(i) ?: continue
      plays.add(normalizePlay(p))
    }
    val lastPlay = plays.lastOrNull()
    val result = drive.optString("result")
    val displayResult = drive.optString("displayResult")
      .ifEmpty { drive.optString("shortDisplayResult") }
      .ifEmpty { if (isCurrent) "In Progress" else "Drive" }

    return DriveInfo(
      id = drive.optString("id").ifEmpty { "drive-${drive.hashCode()}" },
      isCurrent = isCurrent,
      description = drive.optString("description"),
      team = DriveTeamInfo(
        id = teamObj.optString("id"),
        abbreviation = teamObj.optString("abbreviation"),
        displayName = teamObj.optString("displayName").ifEmpty { teamObj.optString("name") },
        logo = logo,
        logoDark = logo
      ),
      result = result,
      displayResult = displayResult,
      isScore = drive.optBoolean("isScore", false),
      yards = drive.optInt("yards", 0),
      offensivePlays = if (drive.has("offensivePlays") && !drive.isNull("offensivePlays")) {
        drive.optInt("offensivePlays")
      } else plays.size,
      timeElapsed = drive.optJSONObject("timeElapsed")?.optString("displayValue").orEmpty(),
      startText = drive.optJSONObject("start")?.optString("text").orEmpty(),
      endText = drive.optJSONObject("end")?.optString("text").orEmpty(),
      awayScore = lastPlay?.awayScore ?: 0,
      homeScore = lastPlay?.homeScore ?: 0,
      plays = plays
    )
  }

  private fun normalizeBoxscore(
    boxscoreTeams: JSONArray?,
    awayId: String,
    homeId: String
  ): List<BoxscoreRow> {
    if (boxscoreTeams == null || boxscoreTeams.length() < 2) return emptyList()
    var awayTeam: JSONObject? = null
    var homeTeam: JSONObject? = null
    for (i in 0 until boxscoreTeams.length()) {
      val entry = boxscoreTeams.optJSONObject(i) ?: continue
      val tid = entry.optJSONObject("team")?.optString("id")
      if (tid == awayId && awayTeam == null) awayTeam = entry
      if (tid == homeId && homeTeam == null) homeTeam = entry
    }
    if (awayTeam == null) awayTeam = boxscoreTeams.optJSONObject(0) ?: return emptyList()
    if (homeTeam == null) homeTeam = boxscoreTeams.optJSONObject(1) ?: return emptyList()

    fun getStatMap(teamEntry: JSONObject): Map<String, Pair<String, String>> {
      val map = HashMap<String, Pair<String, String>>()
      val stats = teamEntry.optJSONArray("statistics") ?: return map
      for (i in 0 until stats.length()) {
        val s = stats.optJSONObject(i) ?: continue
        val name = s.optString("name")
        if (name.isEmpty()) continue
        map[name] = (s.optString("label").ifEmpty { name }) to s.optString("displayValue").ifEmpty { "0" }
      }
      return map
    }

    val awayMap = getStatMap(awayTeam)
    val homeMap = getStatMap(homeTeam)
    val specs = listOf(
      "totalYards" to "Total Yards",
      "netPassingYards" to "Passing Yards",
      "completionAttempts" to "Completions / Att",
      "rushingYards" to "Rushing Yards",
      "rushingAttempts" to "Rushing Attempts",
      "firstDowns" to "1st Downs",
      "thirdDownEff" to "3rd Down Efficiency",
      "fourthDownEff" to "4th Down Efficiency",
      "turnovers" to "Turnovers",
      "totalPenaltiesYards" to "Penalties - Yards",
      "possessionTime" to "Time of Possession"
    )
    return specs.mapNotNull { (key, fallbackLabel) ->
      val a = awayMap[key]
      val h = homeMap[key]
      if (a == null && h == null) null
      else BoxscoreRow(
        key = key,
        label = a?.first ?: h?.first ?: fallbackLabel,
        awayValue = a?.second ?: "0",
        homeValue = h?.second ?: "0"
      )
    }
  }

  fun parseGameSummary(raw: JSONObject, eventId: String): GameSummary {
    val header = raw.optJSONObject("header") ?: JSONObject()
    val comp = header.optJSONArray("competitions")?.optJSONObject(0) ?: JSONObject()
    val competitors = comp.optJSONArray("competitors") ?: JSONArray()

    var awayRaw: JSONObject? = null
    var homeRaw: JSONObject? = null
    for (i in 0 until competitors.length()) {
      val c = competitors.optJSONObject(i) ?: continue
      val ha = c.optString("homeAway")
      if (ha == "away" && awayRaw == null) awayRaw = c
      if (ha == "home" && homeRaw == null) homeRaw = c
    }
    if (awayRaw == null) awayRaw = competitors.optJSONObject(1) ?: competitors.optJSONObject(0) ?: JSONObject()
    if (homeRaw == null) homeRaw = competitors.optJSONObject(0) ?: JSONObject()

    val away = normalizeCompetitor(awayRaw)
    val home = normalizeCompetitor(homeRaw)

    val statusObj = comp.optJSONObject("status") ?: JSONObject()
    val statusType = statusObj.optJSONObject("type") ?: JSONObject()
    val state = statusType.optString("state").ifEmpty { "pre" }
    val shortDetail = statusType.optString("shortDetail")
    val detail = statusType.optString("detail")
    val rawStatusText = "$shortDetail $detail"
    val compHasFalseTimeValid = comp.has("timeValid") && !comp.optBoolean("timeValid", true)
    val timeValid = !compHasFalseTimeValid && !TBD_REGEX.containsMatchIn(rawStatusText)
    val parsedNotes = KickoffFormatter.parseGameNotes(
      notes = collectNoteHeadlines(comp.optJSONArray("notes")),
      fallbackGameNote = header.optString("gameNote")
    )

    val drivesObj = raw.optJSONObject("drives")
    val currentDriveObj = drivesObj?.optJSONObject("current")
    val currentDrive = if (currentDriveObj != null) normalizeDrive(currentDriveObj, true) else null
    val prevDrivesArr = drivesObj?.optJSONArray("previous") ?: JSONArray()
    val previousDrives = mutableListOf<DriveInfo>()
    for (i in 0 until prevDrivesArr.length()) {
      val d = prevDrivesArr.optJSONObject(i) ?: continue
      if (currentDrive != null) {
        val dId = d.optString("id")
        if (dId.isNotEmpty() && dId == currentDrive.id) continue
        if (i == prevDrivesArr.length() - 1 &&
          d.optString("result").isEmpty() &&
          d.optString("displayResult").isEmpty() &&
          d.optJSONObject("team")?.optString("id") == currentDrive.team.id &&
          d.optString("description") == currentDrive.description
        ) {
          continue
        }
      }
      previousDrives.add(normalizeDrive(d, false))
    }

    var runningAway = 0
    var runningHome = 0
    val chrono = previousDrives + listOfNotNull(currentDrive)
    val patchedDrives = chrono.map { d ->
      val startAway = runningAway
      val startHome = runningHome
      val updatedPlays = d.plays.map { p ->
        if (p.awayScore >= runningAway) runningAway = p.awayScore
        if (p.homeScore >= runningHome) runningHome = p.homeScore
        p.copy(awayScore = runningAway, homeScore = runningHome)
      }
      d.copy(
        startAwayScore = startAway,
        startHomeScore = startHome,
        awayScore = runningAway,
        homeScore = runningHome,
        plays = updatedPlays
      )
    }
    val finalPreviousDrives = if (currentDrive != null) patchedDrives.dropLast(1) else patchedDrives
    val finalCurrentDrive = if (currentDrive != null) patchedDrives.lastOrNull() else null

    val scoringPlaysArr = raw.optJSONArray("scoringPlays") ?: JSONArray()
    val scoringPlays = mutableListOf<ScoringPlay>()
    for (i in 0 until scoringPlaysArr.length()) {
      val sp = scoringPlaysArr.optJSONObject(i) ?: continue
      val team = sp.optJSONObject("team") ?: JSONObject()
      val stype = sp.optJSONObject("scoringType")
      val typeObj = sp.optJSONObject("type")
      scoringPlays.add(
        ScoringPlay(
          id = sp.optString("id").ifEmpty { "sp-$i" },
          period = sp.optJSONObject("period")?.optInt("number", 1) ?: 1,
          clock = sp.optJSONObject("clock")?.optString("displayValue").orEmpty(),
          text = sp.optString("text"),
          awayScore = sp.optInt("awayScore", 0),
          homeScore = sp.optInt("homeScore", 0),
          teamId = team.optString("id"),
          teamAbbr = team.optString("abbreviation"),
          teamName = team.optString("displayName"),
          teamLogo = extractLogoUrl(team),
          scoringType = stype?.optString("abbreviation").orEmpty()
            .ifEmpty { typeObj?.optString("abbreviation").orEmpty() }
            .ifEmpty { "SCORE" },
          scoringLabel = stype?.optString("displayName").orEmpty()
            .ifEmpty { typeObj?.optString("text").orEmpty() }
            .ifEmpty { "Score" }
        )
      )
    }

    val leadersArr = raw.optJSONArray("leaders") ?: JSONArray()
    val leaders = mutableListOf<TeamLeaderGroup>()
    for (i in 0 until leadersArr.length()) {
      val block = leadersArr.optJSONObject(i) ?: continue
      val t = block.optJSONObject("team") ?: JSONObject()
      val cats = normalizeCompetitorLeaders(block.optJSONArray("leaders"))
        .firstOrNull()?.categories ?: emptyList()
      leaders.add(
        TeamLeaderGroup(
          teamId = t.optString("id"),
          teamAbbr = t.optString("abbreviation"),
          teamName = t.optString("displayName"),
          categories = cats
        )
      )
    }

    val boxscoreTeams = raw.optJSONObject("boxscore")?.optJSONArray("teams")
    val boxscoreRows = normalizeBoxscore(boxscoreTeams, away.id, home.id)

    val oddsRaw = raw.optJSONArray("pickcenter")?.optJSONObject(0)
      ?: raw.optJSONArray("odds")?.optJSONObject(0)
    val odds = if (oddsRaw != null) {
      GameOdds(
        details = oddsRaw.optString("details"),
        overUnder = if (oddsRaw.has("overUnder") && !oddsRaw.isNull("overUnder")) {
          oddsRaw.optDouble("overUnder")
        } else null
      )
    } else null

    val venueInfo = raw.optJSONObject("gameInfo")?.optJSONObject("venue")
    val venueAddr = venueInfo?.optJSONObject("address")
    val attendanceVal = raw.optJSONObject("gameInfo")?.optInt("attendance", -1)?.takeIf { it > 0 }

    return GameSummary(
      id = eventId,
      date = comp.optString("date"),
      timeValid = timeValid,
      flexTimeSlot = parsedNotes.flexTimeSlot,
      headline = parsedNotes.headline,
      state = state,
      statusDetail = shortDetail.ifEmpty { detail },
      period = statusObj.optInt("period", 0),
      displayClock = statusObj.optString("displayClock"),
      broadcast = extractBroadcast(comp),
      venue = GameVenue(
        name = venueInfo?.optString("fullName").orEmpty(),
        city = venueAddr?.optString("city").orEmpty(),
        state = venueAddr?.optString("state").orEmpty(),
        attendance = attendanceVal
      ),
      away = away,
      home = home,
      currentDrive = finalCurrentDrive,
      previousDrives = finalPreviousDrives,
      scoringPlays = scoringPlays,
      boxscoreRows = boxscoreRows,
      leaders = leaders,
      odds = odds
    )
  }

  private fun findStatObj(stats: JSONArray?, typeName: String): JSONObject? {
    if (stats == null) return null
    for (i in 0 until stats.length()) {
      val s = stats.optJSONObject(i) ?: continue
      if (s.optString("type") == typeName) return s
    }
    return null
  }

  private fun normalizeStandingEntries(entries: JSONArray?, rankMap: Map<String, Int>): List<StandingTeamRow> {
    if (entries == null) return emptyList()
    val rows = ArrayList<StandingTeamRow>(entries.length())
    for (i in 0 until entries.length()) {
      val entry = entries.optJSONObject(i) ?: continue
      val team = entry.optJSONObject("team") ?: JSONObject()
      val stats = entry.optJSONArray("stats")
      val seedStat = findStatObj(stats, "playoffseed")
      val seedVal = seedStat?.optDouble("value", 0.0)?.toInt()?.takeIf { it > 0 } ?: 999
      val confRec = findStatObj(stats, "vsconf")
      val confPct = findStatObj(stats, "vsconf_leaguewinpercent")
      val ovrRec = findStatObj(stats, "total")
      val homeRec = findStatObj(stats, "homerecord")
      val awayRec = findStatObj(stats, "awayrecord")
      val pf = findStatObj(stats, "pointsfor")
      val pa = findStatObj(stats, "pointsagainst")
      val diff = findStatObj(stats, "pointdifferential")
      val streak = findStatObj(stats, "streak")
      val wins = findStatObj(stats, "wins")
      val ovrPct = findStatObj(stats, "leaguewinpercent")

      val tid = team.optString("id")
      val diffVal = diff?.optDouble("value", 0.0)?.toInt() ?: 0
      val confRecText = confRec?.optString("summary").orEmpty()
        .ifEmpty { confRec?.optString("displayValue").orEmpty() }
        .ifEmpty { "0-0" }
      val ovrRecText = ovrRec?.optString("summary").orEmpty()
        .ifEmpty { ovrRec?.optString("displayValue").orEmpty() }
        .ifEmpty { "0-0" }

      rows.add(
        StandingTeamRow(
          teamId = tid,
          name = team.optString("displayName").ifEmpty { team.optString("shortDisplayName") }.ifEmpty { "Team" },
          shortName = team.optString("shortDisplayName").ifEmpty { team.optString("location") }.ifEmpty { "Team" },
          abbreviation = team.optString("abbreviation"),
          logo = extractLogoUrl(team),
          rank = rankMap[tid],
          seed = seedVal,
          seedDisplay = if (seedVal < 999) seedVal.toString() else "-",
          confRecord = confRecText,
          confWinPct = confPct?.optDouble("value", 0.0) ?: 0.0,
          confWinPctDisplay = confPct?.optString("displayValue").orEmpty().ifEmpty { ".000" },
          overallRecord = ovrRecText,
          overallWins = wins?.optDouble("value", 0.0)?.toInt() ?: 0,
          overallWinPct = ovrPct?.optDouble("value", 0.0) ?: 0.0,
          homeRecord = homeRec?.optString("summary").orEmpty()
            .ifEmpty { homeRec?.optString("displayValue").orEmpty() }.ifEmpty { "0-0" },
          awayRecord = awayRec?.optString("summary").orEmpty()
            .ifEmpty { awayRec?.optString("displayValue").orEmpty() }.ifEmpty { "0-0" },
          pointsFor = pf?.optDouble("value", 0.0)?.toInt() ?: 0,
          pointsAgainst = pa?.optDouble("value", 0.0)?.toInt() ?: 0,
          pointDiff = diffVal,
          pointDiffDisplay = diff?.optString("displayValue").orEmpty()
            .ifEmpty { if (diffVal > 0) "+$diffVal" else diffVal.toString() },
          streak = streak?.optString("displayValue").orEmpty().ifEmpty { "-" },
          streakValue = streak?.optDouble("value", 0.0)?.toInt() ?: 0
        )
      )
    }

    rows.sortWith { a, b ->
      if (a.seed != b.seed) a.seed.compareTo(b.seed)
      else if (b.confWinPct != a.confWinPct) b.confWinPct.compareTo(a.confWinPct)
      else b.overallWins.compareTo(a.overallWins)
    }
    return rows
  }

  fun normalizeStandingsConferences(
    rawChildren: JSONArray?,
    rankMap: Map<String, Int> = emptyMap(),
    priorityOrder: List<String> = emptyList()
  ): Pair<List<ConferenceStandings>, Map<String, ConferenceInfo>> {
    val confMap = LinkedHashMap<String, ConferenceInfo>()
    val conferences = mutableListOf<ConferenceStandings>()
    val count = rawChildren?.length() ?: 0
    for (i in 0 until count) {
      val conf = rawChildren?.optJSONObject(i) ?: continue
      val id = conf.optString("id")
      val shortName = conf.optString("shortName").ifEmpty { conf.optString("name") }.ifEmpty { "Conference" }
      val name = conf.optString("name").ifEmpty { shortName }
      val abbr = conf.optString("abbreviation").ifEmpty { shortName }
      confMap[id] = ConferenceInfo(id = id, name = name, shortName = shortName, abbreviation = abbr)

      val groups = mutableListOf<StandingGroup>()
      val standingsObj = conf.optJSONObject("standings")
      if (standingsObj != null && standingsObj.has("entries")) {
        groups.add(
          StandingGroup(
            name = null,
            entries = normalizeStandingEntries(standingsObj.optJSONArray("entries"), rankMap)
          )
        )
      } else {
        val subs = conf.optJSONArray("children")
        if (subs != null) {
          for (j in 0 until subs.length()) {
            val sub = subs.optJSONObject(j) ?: continue
            val subStandings = sub.optJSONObject("standings") ?: continue
            if (subStandings.has("entries")) {
              groups.add(
                StandingGroup(
                  name = sub.optString("name").ifEmpty { sub.optString("shortName") }.ifEmpty { "Division" },
                  entries = normalizeStandingEntries(subStandings.optJSONArray("entries"), rankMap)
                )
              )
            }
          }
        }
      }
      conferences.add(ConferenceStandings(id = id, name = name, shortName = shortName, abbreviation = abbr, groups = groups))
    }

    if (priorityOrder.isNotEmpty()) {
      conferences.sortWith { a, b ->
        val ia = priorityOrder.indexOf(a.id).let { if (it == -1) 99 else it }
        val ib = priorityOrder.indexOf(b.id).let { if (it == -1) 99 else it }
        if (ia != ib) ia.compareTo(ib) else a.shortName.compareTo(b.shortName)
      }
    } else {
      conferences.sortBy { it.shortName }
    }
    return conferences to confMap
  }

  fun parseStandingsAndRankings(standingsRaw: JSONObject, rankingsRaw: JSONObject?): StandingsBundle {
    val polls = rankingsRaw?.optJSONArray("rankings")
    var preferredPoll: JSONObject? = null
    if (polls != null) {
      for (i in 0 until polls.length()) {
        val p = polls.optJSONObject(i) ?: continue
        val ranks = p.optJSONArray("ranks")
        if (ranks != null && ranks.length() > 0 && p.optString("name").contains("Playoff", ignoreCase = true)) {
          preferredPoll = p
          break
        }
      }
      if (preferredPoll == null) {
        for (i in 0 until polls.length()) {
          val p = polls.optJSONObject(i) ?: continue
          val ranks = p.optJSONArray("ranks")
          if (ranks != null && ranks.length() > 0 && p.optString("name").contains("AP Top 25", ignoreCase = true)) {
            preferredPoll = p
            break
          }
        }
      }
      if (preferredPoll == null) {
        for (i in 0 until polls.length()) {
          val p = polls.optJSONObject(i) ?: continue
          val ranks = p.optJSONArray("ranks")
          if (ranks != null && ranks.length() > 0) {
            preferredPoll = p
            break
          }
        }
      }
    }

    val rankMap = HashMap<String, Int>()
    val prefRanks = preferredPoll?.optJSONArray("ranks")
    if (prefRanks != null) {
      for (i in 0 until prefRanks.length()) {
        val entry = prefRanks.optJSONObject(i) ?: continue
        val tid = entry.optJSONObject("team")?.optString("id").orEmpty()
        val r = normalizeRank(entry.opt("current"))
        if (tid.isNotEmpty() && r != null) rankMap[tid] = r
      }
    }

    val (confs, confMap) = normalizeStandingsConferences(
      standingsRaw.optJSONArray("children"),
      rankMap,
      PRIORITY_CONFERENCE_ORDER
    )
    return StandingsBundle(
      conferences = confs,
      conferenceMap = confMap,
      rankMap = rankMap,
      pollName = preferredPoll?.optString("name")?.ifEmpty { "Top 25" } ?: "Top 25"
    )
  }

  private fun normalizePollTeamEntry(
    entry: JSONObject,
    isInitialRelease: Boolean = false,
    isDroppedOut: Boolean = false
  ): RankedTeamRow {
    val team = entry.optJSONObject("team") ?: JSONObject()
    val current = entry.optInt("current", 0)
    val previous = entry.optInt("previous", 0)
    val points = entry.optInt("points", 0)
    val firstPlaceVotes = entry.optInt("firstPlaceVotes", 0)
    val rawRec = entry.optString("recordSummary")
    val recSummary = if (rawRec == "0-0" && (isDroppedOut || current <= 0)) "" else rawRec

    val loc = team.optString("location")
    val tName = team.optString("name")
    val displayName = team.optString("displayName")
      .ifEmpty { listOf(loc, tName).filter { it.isNotEmpty() }.joinToString(" ") }
      .ifEmpty { team.optString("nickname") }
      .ifEmpty { team.optString("abbreviation") }
      .ifEmpty { "Team" }
    val shortName = team.optString("shortDisplayName")
      .ifEmpty { team.optString("nickname") }
      .ifEmpty { loc }
      .ifEmpty { displayName }

    val groupsObj = team.optJSONObject("groups")
    val confId = groupsObj?.optString("id")?.ifEmpty { null }
    val confShort = entry.optString("conference").ifEmpty { groupsObj?.optString("shortName").orEmpty() }

    var movement = "same"
    var delta = 0
    var trendDisplay = "—"
    var previousDisplay = if (previous > 0) "#$previous" else "—"

    when {
      isDroppedOut -> {
        movement = "dropped"
        trendDisplay = if (previous > 0) "was #$previous" else "Dropped"
      }
      current <= 0 -> {
        movement = "rv"
        trendDisplay = if (points > 0) "$points pts" else "RV"
        previousDisplay = if (previous > 0) "#$previous" else "NR"
      }
      isInitialRelease -> {
        movement = "initial"
        trendDisplay = "—"
        previousDisplay = "—"
      }
      previous <= 0 -> {
        movement = "new"
        trendDisplay = "NEW"
        previousDisplay = "NR"
      }
      previous > current -> {
        movement = "up"
        delta = previous - current
        trendDisplay = "+$delta"
      }
      previous < current -> {
        movement = "down"
        delta = current - previous
        trendDisplay = "-$delta"
      }
    }

    return RankedTeamRow(
      id = team.optString("id"),
      displayName = displayName,
      shortName = shortName,
      abbreviation = team.optString("abbreviation").ifEmpty { shortName.take(4).uppercase(Locale.US) },
      color = normalizeHexColor(team.optString("color")),
      logo = extractLogoUrl(team),
      conferenceId = confId,
      conferenceShortName = confShort,
      current = current,
      previous = previous,
      points = points,
      firstPlaceVotes = firstPlaceVotes,
      recordSummary = recSummary,
      firstRoundBye = entry.optBoolean("firstRoundBye", false),
      movement = movement,
      delta = delta,
      trendDisplay = trendDisplay,
      previousDisplay = previousDisplay
    )
  }

  private fun normalizeSinglePoll(rawPoll: JSONObject?, isPreseasonCarryover: Boolean = false): RankingPoll? {
    val ranksArr = rawPoll?.optJSONArray("ranks") ?: return null
    if (ranksArr.length() == 0) return null

    var anyPrev = false
    for (i in 0 until ranksArr.length()) {
      if ((ranksArr.optJSONObject(i)?.optInt("previous", 0) ?: 0) > 0) {
        anyPrev = true
        break
      }
    }
    val isInitial = !anyPrev

    val ranks = (0 until ranksArr.length()).mapNotNull { idx ->
      ranksArr.optJSONObject(idx)?.let { normalizePollTeamEntry(it, isInitialRelease = isInitial) }
    }
    val othersArr = rawPoll.optJSONArray("others")
    val others = if (othersArr != null) {
      (0 until othersArr.length()).mapNotNull { idx ->
        othersArr.optJSONObject(idx)?.let { normalizePollTeamEntry(it, isInitialRelease = isInitial) }
      }
    } else emptyList()
    val droppedArr = rawPoll.optJSONArray("droppedOut")
    val droppedOut = if (droppedArr != null) {
      (0 until droppedArr.length()).mapNotNull { idx ->
        droppedArr.optJSONObject(idx)?.let { normalizePollTeamEntry(it, isDroppedOut = true) }
      }
    } else emptyList()

    val occ = rawPoll.optJSONObject("occurrence")
    return RankingPoll(
      id = rawPoll.optString("id"),
      type = rawPoll.optString("type"),
      name = rawPoll.optString("name"),
      shortName = rawPoll.optString("shortName").ifEmpty { rawPoll.optString("name") },
      headline = rawPoll.optString("headline"),
      date = rawPoll.optString("date"),
      lastUpdated = rawPoll.optString("lastUpdated"),
      occurrenceLabel = occ?.optString("displayValue").orEmpty(),
      occurrenceWeek = occ?.opt("number")?.toString().orEmpty(),
      isInitialRelease = isInitial,
      isPreseasonCarryover = isPreseasonCarryover,
      ranks = ranks,
      others = others,
      droppedOut = droppedOut
    )
  }

  fun parseWeeklyRankings(
    raw: JSONObject,
    preRaw: JSONObject? = null,
    requestedSeason: Int? = null,
    requestedWeek: String? = null,
    requestedSeasonType: String? = null
  ): WeeklyRankingsData {
    val curYear = Calendar.getInstance().get(Calendar.YEAR)
    val seasonYear = raw.optJSONObject("requestedSeason")?.optInt("year", 0)?.takeIf { it > 0 }
      ?: raw.optJSONObject("latestSeason")?.optInt("year", 0)?.takeIf { it > 0 }
      ?: requestedSeason
      ?: curYear

    val weeksArr = raw.optJSONArray("weeks") ?: JSONArray()
    val seenWeeks = HashSet<String>()
    val weeks = mutableListOf<RankingsWeekOption>()
    for (i in 0 until weeksArr.length()) {
      val w = weeksArr.optJSONObject(i) ?: continue
      val wk = w.opt("week")?.toString().orEmpty()
      if (wk.isEmpty()) continue
      val st = w.opt("type")?.toString().orEmpty().ifEmpty { "2" }
      val key = "$st:$wk"
      if (!seenWeeks.add(key)) continue
      val label = w.optString("display").ifEmpty {
        when (st) {
          "1" -> "Preseason"
          "3" -> "Final Rankings"
          else -> "Week $wk"
        }
      }
      val shortLabel = when (st) {
        "1" -> "Preseason"
        "3" -> "Final"
        else -> "Week $wk"
      }
      weeks.add(RankingsWeekOption(key = key, week = wk, seasonType = st, label = label, shortLabel = shortLabel))
    }

    val polls = raw.optJSONArray("rankings") ?: JSONArray()
    var rawCfp: JSONObject? = null
    var rawAp: JSONObject? = null
    for (i in 0 until polls.length()) {
      val p = polls.optJSONObject(i) ?: continue
      val type = p.optString("type")
      val id = p.optString("id")
      val name = p.optString("name")
      if (rawCfp == null && (type == "cfp" || id == "21" || name.contains("Playoff Committee", true))) {
        rawCfp = p
      }
      if (rawAp == null && (type == "ap" || id == "1" || name.contains("AP Top 25", true))) {
        rawAp = p
      }
    }

    var isPreseasonCarryover = false
    if (rawAp == null && preRaw != null) {
      val prePolls = preRaw.optJSONArray("rankings") ?: JSONArray()
      for (i in 0 until prePolls.length()) {
        val p = prePolls.optJSONObject(i) ?: continue
        if (p.optString("type") == "ap" || p.optString("id") == "1" ||
          p.optString("name").contains("AP Top 25", true)
        ) {
          rawAp = p
          isPreseasonCarryover = true
          break
        }
      }
    }

    val cfpPoll = normalizeSinglePoll(rawCfp)
    val apPoll = normalizeSinglePoll(rawAp, isPreseasonCarryover = isPreseasonCarryover)

    var activeWeekKey: String
    if (!requestedWeek.isNullOrEmpty() && !requestedSeasonType.isNullOrEmpty()) {
      activeWeekKey = "$requestedSeasonType:$requestedWeek"
    } else {
      val occ = (rawCfp ?: rawAp)?.optJSONObject("occurrence")
      val occDisplay = occ?.optString("displayValue").orEmpty()
        .ifEmpty { raw.optJSONObject("latestWeek")?.optString("displayValue").orEmpty() }
      val isLast = occ?.optBoolean("last", false) ?: false
      activeWeekKey = when {
        occDisplay.contains("Preseason", ignoreCase = true) -> "1:1"
        occDisplay.contains("Final", ignoreCase = true) ||
          (isLast && weeks.any { it.seasonType == "3" }) -> {
          weeks.firstOrNull { it.seasonType == "3" }?.key
            ?: "3:${occ?.opt("number")?.toString() ?: raw.optJSONObject("latestWeek")?.opt("number")?.toString() ?: "1"}"
        }
        else -> {
          val wkNum = occ?.opt("number")?.toString()
            ?: raw.optJSONObject("latestWeek")?.opt("number")?.toString()
            ?: "1"
          "2:$wkNum"
        }
      }
      if (weeks.isNotEmpty() && weeks.none { it.key == activeWeekKey }) {
        activeWeekKey = weeks.last().key
      }
    }

    val matchedWeek = weeks.firstOrNull { it.key == activeWeekKey }
    val activeWeekLabel = matchedWeek?.label
      ?: rawCfp?.optJSONObject("occurrence")?.optString("displayValue")?.ifEmpty { null }
      ?: rawAp?.optJSONObject("occurrence")?.optString("displayValue")?.ifEmpty { null }
      ?: (if (!requestedWeek.isNullOrEmpty()) "Week $requestedWeek" else "Latest")

    return WeeklyRankingsData(
      seasonYear = seasonYear,
      activeWeekKey = activeWeekKey,
      activeWeekLabel = activeWeekLabel,
      weeks = weeks,
      cfpPoll = cfpPoll,
      apPoll = apPoll
    )
  }

  private data class TeamMeta(
    val division: String,
    val conferenceId: String,
    val conferenceName: String,
    val conferenceShortName: String,
    val overallRecord: String,
    val confRecord: String,
    val rank: Int?
  )

  fun buildTeamsCatalog(
    teamsRaw: JSONObject,
    fbsConferences: List<ConferenceStandings>,
    fcsConferences: List<ConferenceStandings>,
    rankMap: Map<String, Int>
  ): Pair<List<TeamDirectoryItem>, Map<String, TeamDirectoryItem>> {
    val metaMap = HashMap<String, TeamMeta>()

    fun indexConfs(confs: List<ConferenceStandings>, division: String) {
      for (conf in confs) {
        for (grp in conf.groups) {
          for (entry in grp.entries) {
            if (entry.teamId.isEmpty()) continue
            metaMap[entry.teamId] = TeamMeta(
              division = division,
              conferenceId = conf.id,
              conferenceName = conf.name,
              conferenceShortName = conf.shortName,
              overallRecord = entry.overallRecord,
              confRecord = entry.confRecord,
              rank = entry.rank ?: rankMap[entry.teamId]
            )
          }
        }
      }
    }

    indexConfs(fcsConferences, "FCS")
    indexConfs(fbsConferences, "FBS")

    val directory = mutableListOf<TeamDirectoryItem>()
    val seenIds = HashSet<String>()

    val rawEntries = teamsRaw.optJSONArray("sports")
      ?.optJSONObject(0)
      ?.optJSONArray("leagues")
      ?.optJSONObject(0)
      ?.optJSONArray("teams")
      ?: JSONArray()

    for (i in 0 until rawEntries.length()) {
      val item = rawEntries.optJSONObject(i) ?: continue
      val t = item.optJSONObject("team") ?: item
      val id = t.optString("id")
      if (id.isEmpty() || !seenIds.add(id)) continue

      val meta = metaMap[id]
      val rank = meta?.rank ?: rankMap[id]
      val division = meta?.division ?: if (rank != null) "FBS" else "D2/D3"
      val shortName = t.optString("shortDisplayName")
        .ifEmpty { t.optString("nickname") }
        .ifEmpty { t.optString("location") }
        .ifEmpty { t.optString("displayName") }
        .ifEmpty { "Team" }
      directory.add(
        TeamDirectoryItem(
          id = id,
          displayName = t.optString("displayName").ifEmpty { t.optString("location") }.ifEmpty { "Team" },
          shortName = shortName,
          location = t.optString("location"),
          nickname = t.optString("name").ifEmpty { t.optString("nickname") },
          abbreviation = t.optString("abbreviation"),
          color = normalizeHexColor(t.optString("color")),
          alternateColor = normalizeHexColor(t.optString("alternateColor")),
          logo = extractLogoUrl(t),
          slug = t.optString("slug"),
          division = division,
          conferenceId = meta?.conferenceId ?: if (division == "D2/D3") "d2-d3" else "",
          conferenceName = meta?.conferenceName ?: if (division == "D2/D3") "Division II / III" else "",
          conferenceShortName = meta?.conferenceShortName ?: if (division == "D2/D3") "Div II / III" else division,
          overallRecord = meta?.overallRecord.orEmpty(),
          confRecord = meta?.confRecord.orEmpty(),
          rank = rank
        )
      )
    }

    fun appendMissingFrom(confs: List<ConferenceStandings>, division: String) {
      for (conf in confs) {
        for (grp in conf.groups) {
          for (entry in grp.entries) {
            if (entry.teamId.isEmpty() || !seenIds.add(entry.teamId)) continue
            directory.add(
              TeamDirectoryItem(
                id = entry.teamId,
                displayName = entry.name,
                shortName = entry.shortName,
                location = entry.shortName,
                abbreviation = entry.abbreviation,
                logo = entry.logo,
                division = division,
                conferenceId = conf.id,
                conferenceName = conf.name,
                conferenceShortName = conf.shortName,
                overallRecord = entry.overallRecord,
                confRecord = entry.confRecord,
                rank = entry.rank ?: rankMap[entry.teamId]
              )
            )
          }
        }
      }
    }

    appendMissingFrom(fbsConferences, "FBS")
    appendMissingFrom(fcsConferences, "FCS")

    val divOrder = mapOf("FBS" to 0, "FCS" to 1, "D2/D3" to 2)
    directory.sortWith { a, b ->
      val da = divOrder[a.division] ?: 9
      val db = divOrder[b.division] ?: 9
      if (da != db) da.compareTo(db)
      else {
        val ra = a.rank ?: 999
        val rb = b.rank ?: 999
        if (ra != rb) ra.compareTo(rb) else a.displayName.compareTo(b.displayName)
      }
    }

    val byId = HashMap<String, TeamDirectoryItem>(directory.size * 2)
    for (t in directory) byId[t.id] = t
    return directory to byId
  }

  private fun mapTeamStatGroupKey(categoryName: String): String = when (categoryName) {
    "passing" -> "passing"
    "rushing" -> "rushing"
    "receiving" -> "receiving"
    "defensive", "defensiveInterceptions" -> "defensive"
    "returning", "kicking", "punting" -> "special"
    "scoring" -> "scoring"
    else -> "miscellaneous"
  }

  private fun normalizeTeamStatistics(statsRaw: JSONObject?): TeamStatisticsData? {
    val catsRaw = statsRaw?.optJSONObject("results")
      ?.optJSONObject("stats")
      ?.optJSONArray("categories")
    if (catsRaw == null || catsRaw.length() == 0) return null

    val oppMap = HashMap<String, HashMap<String, JSONObject>>()
    val oppArr = statsRaw.optJSONObject("results")?.optJSONArray("opponent")
    if (oppArr != null) {
      for (i in 0 until oppArr.length()) {
        val cat = oppArr.optJSONObject(i) ?: continue
        val sMap = HashMap<String, JSONObject>()
        val stats = cat.optJSONArray("stats") ?: continue
        for (j in 0 until stats.length()) {
          val s = stats.optJSONObject(j) ?: continue
          val name = s.optString("name")
          if (name.isNotEmpty() && !sMap.containsKey(name)) sMap[name] = s
        }
        oppMap[cat.optString("name")] = sMap
      }
    }

    val statLookup = HashMap<String, TeamStatItem>()
    val categories = mutableListOf<TeamStatCategory>()
    for (i in 0 until catsRaw.length()) {
      val cat = catsRaw.optJSONObject(i) ?: continue
      val catName = cat.optString("name").ifEmpty { "general" }
      val oppCat = oppMap[catName] ?: emptyMap()
      val seenStats = HashSet<String>()
      val items = mutableListOf<TeamStatItem>()
      val stats = cat.optJSONArray("stats") ?: JSONArray()

      for (j in 0 until stats.length()) {
        val s = stats.optJSONObject(j) ?: continue
        val key = s.optString("name")
        if (key.isEmpty() || !seenStats.add(key)) continue
        val opp = oppCat[key]
        val tv = s.opt("displayValue")?.takeIf { it !== JSONObject.NULL }?.toString()
          ?: s.opt("value")?.takeIf { it !== JSONObject.NULL }?.toString()
          ?: "0"
        val tNum = s.optDouble("value", tv.toDoubleOrNull() ?: 0.0)
        val ov = if (opp != null) {
          opp.opt("displayValue")?.takeIf { it !== JSONObject.NULL }?.toString()
            ?: opp.opt("value")?.takeIf { it !== JSONObject.NULL }?.toString()
            ?: "-"
        } else null
        val oNum = opp?.optDouble("value", ov?.toDoubleOrNull() ?: 0.0)

        val item = TeamStatItem(
          name = key,
          label = s.optString("displayName").ifEmpty { key },
          shortLabel = s.optString("shortDisplayName")
            .ifEmpty { s.optString("abbreviation") }
            .ifEmpty { s.optString("displayName") }
            .ifEmpty { key },
          description = s.optString("description"),
          teamValue = tv,
          teamNumeric = tNum,
          oppValue = ov,
          oppNumeric = oNum,
          oppRank = opp?.optString("rankDisplayValue").orEmpty()
        )
        items.add(item)
        statLookup.putIfAbsent("$catName:$key", item)
      }

      categories.add(
        TeamStatCategory(
          name = catName,
          displayName = cat.optString("displayName").ifEmpty { catName },
          groupKey = mapTeamStatGroupKey(catName),
          items = items
        )
      )
    }

    val compSpecs = listOf(
      "passing:netPassingYards" to "Passing Yards",
      "passing:completionPct" to "Completion %",
      "rushing:rushingYards" to "Rushing Yards",
      "rushing:yardsPerRushAttempt" to "Yards Per Rush",
      "miscellaneous:firstDowns" to "Total 1st Downs",
      "miscellaneous:thirdDownConvPct" to "3rd Down %",
      "scoring:totalTouchdowns" to "Total Touchdowns",
      "defensive:sacks" to "Sacks",
      "defensiveInterceptions:interceptions" to "Interceptions",
      "kicking:fieldGoalPct" to "Field Goal %"
    )
    val overview = compSpecs.mapNotNull { (key, label) ->
      val item = statLookup[key]
      if (item?.oppValue == null) null
      else TeamComparisonRow(
        label = label,
        teamValue = item.teamValue,
        teamNumeric = item.teamNumeric,
        oppValue = item.oppValue,
        oppNumeric = item.oppNumeric ?: 0.0,
        oppRank = item.oppRank
      )
    }

    val yearVal = statsRaw.optJSONObject("requestedSeason")?.optInt("year", 0)?.takeIf { it > 0 }
      ?: statsRaw.optJSONObject("season")?.optInt("year", 0)?.takeIf { it > 0 }
    return TeamStatisticsData(
      seasonYear = yearVal,
      categories = categories,
      overviewComparisons = overview
    )
  }

  private fun parseRecordGames(rec: String): Int {
    val parts = rec.split("-").map { it.toIntOrNull() }
    if (parts.size < 2 || parts.any { it == null }) return -1
    return parts.filterNotNull().sum()
  }

  private fun computeTeamSeasonSummary(games: List<TeamScheduleEvent>): TeamSeasonSummary {
    var wins = 0
    var losses = 0
    var ties = 0
    var confWins = 0
    var confLosses = 0
    var latestRegConf = ""
    var latestRegTotal = -1
    var latestAnyConf = ""
    var latestAnyTotal = -1
    var homeWins = 0
    var homeLosses = 0
    var awayWins = 0
    var awayLosses = 0
    var pointsFor = 0
    var pointsAgainst = 0
    var completed = 0
    val seq = mutableListOf<String>()

    for (g in games) {
      if (!g.isPast) continue
      completed += 1
      g.teamComp.score.toIntOrNull()?.let { pointsFor += it }
      g.opponent.score.toIntOrNull()?.let { pointsAgainst += it }

      val confRecStr = g.teamComp.confRecord.trim()
      if (RECORD_REGEX.matches(confRecStr)) {
        val total = parseRecordGames(confRecStr)
        if (total >= latestAnyTotal) {
          latestAnyTotal = total
          latestAnyConf = confRecStr
        }
        if (g.event.seasonTypeId != "3" && total >= latestRegTotal) {
          latestRegTotal = total
          latestRegConf = confRecStr
        }
      }

      when (g.result) {
        "W" -> {
          wins += 1
          seq.add("W")
          if (g.event.conferenceCompetition) confWins += 1
          if (!g.event.neutralSite) {
            if (g.isHome) homeWins += 1 else awayWins += 1
          }
        }
        "L" -> {
          losses += 1
          seq.add("L")
          if (g.event.conferenceCompetition) confLosses += 1
          if (!g.event.neutralSite) {
            if (g.isHome) homeLosses += 1 else awayLosses += 1
          }
        }
        else -> {
          ties += 1
          seq.add("T")
        }
      }
    }

    var streak = "-"
    if (seq.isNotEmpty()) {
      val last = seq.last()
      var count = 0
      for (i in seq.indices.reversed()) {
        if (seq[i] == last) count += 1 else break
      }
      streak = "$last$count"
    }

    val diff = pointsFor - pointsAgainst
    val ovr = if (ties > 0) "$wins-$losses-$ties" else "$wins-$losses"
    val confOut = latestRegConf.ifEmpty { latestAnyConf }.ifEmpty { "$confWins-$confLosses" }
    return TeamSeasonSummary(
      completedCount = completed,
      record = ovr,
      confRecord = confOut,
      homeRecord = "$homeWins-$homeLosses",
      awayRecord = "$awayWins-$awayLosses",
      pointsFor = pointsFor,
      pointsAgainst = pointsAgainst,
      ppg = if (completed > 0) String.format(Locale.US, "%.1f", pointsFor.toDouble() / completed) else "-",
      oppPpg = if (completed > 0) String.format(Locale.US, "%.1f", pointsAgainst.toDouble() / completed) else "-",
      pointDiff = diff,
      pointDiffDisplay = if (completed > 0) {
        if (diff > 0) "+$diff" else diff.toString()
      } else "-",
      streak = streak
    )
  }

  fun parseTeamPage(
    teamId: String,
    teamInfoRaw: JSONObject,
    schedRegRaw: JSONObject,
    schedPostRaw: JSONObject?,
    statsRaw: JSONObject?,
    catalogEntry: TeamDirectoryItem?,
    seasonYear: Int,
    currentSeasonYear: Int
  ): TeamPageData {
    val rawTeam = teamInfoRaw.optJSONObject("team") ?: JSONObject()
    val groups = rawTeam.optJSONObject("groups")
    val standingSummary = rawTeam.optString("standingSummary")
    val isCurrentSeason = seasonYear == currentSeasonYear
    val summaryYear = YEAR_REGEX.find(standingSummary)?.groupValues?.getOrNull(1)?.toIntOrNull()
    val division = catalogEntry?.division ?: rawTeam.optJSONObject("group")?.optString("shortName").orEmpty()

    val recordSummary = rawTeam.optJSONObject("record")
      ?.optJSONArray("items")
      ?.optJSONObject(0)
      ?.optString("summary")
      .orEmpty()

    val rankFromApi = normalizeRank(rawTeam.opt("rank"))
    val header = TeamDetailHeader(
      id = teamId,
      displayName = rawTeam.optString("displayName")
        .ifEmpty { catalogEntry?.displayName.orEmpty() }
        .ifEmpty { "Team" },
      shortName = rawTeam.optString("shortDisplayName")
        .ifEmpty { rawTeam.optString("nickname") }
        .ifEmpty { catalogEntry?.shortName.orEmpty() }
        .ifEmpty { "Team" },
      location = rawTeam.optString("location").ifEmpty { catalogEntry?.location.orEmpty() },
      nickname = rawTeam.optString("name").ifEmpty { catalogEntry?.nickname.orEmpty() },
      abbreviation = rawTeam.optString("abbreviation").ifEmpty { catalogEntry?.abbreviation.orEmpty() },
      color = normalizeHexColor(rawTeam.optString("color")) ?: catalogEntry?.color ?: "#006C47",
      alternateColor = normalizeHexColor(rawTeam.optString("alternateColor"))
        ?: catalogEntry?.alternateColor
        ?: "#3C6472",
      logo = extractLogoUrl(rawTeam).ifEmpty { catalogEntry?.logo.orEmpty() },
      division = division,
      standingSummary = if (isCurrentSeason && (summaryYear == null || summaryYear == seasonYear)) {
        standingSummary
      } else "",
      record = recordSummary.ifEmpty { if (isCurrentSeason) catalogEntry?.overallRecord.orEmpty() else "" },
      rank = if (isCurrentSeason) rankFromApi ?: catalogEntry?.rank else rankFromApi,
      conferenceId = groups?.optString("id").orEmpty().ifEmpty { catalogEntry?.conferenceId.orEmpty() },
      conferenceName = groups?.optString("name").orEmpty()
        .ifEmpty { catalogEntry?.conferenceName.orEmpty() }
        .ifEmpty { groups?.optString("shortName").orEmpty() },
      conferenceShortName = groups?.optString("shortName").orEmpty()
        .ifEmpty { catalogEntry?.conferenceShortName.orEmpty() }
        .ifEmpty { groups?.optString("name").orEmpty() }
    )

    val combinedRaw = mutableListOf<JSONObject>()
    val regEvents = schedRegRaw.optJSONArray("events")
    if (regEvents != null) {
      for (i in 0 until regEvents.length()) regEvents.optJSONObject(i)?.let { combinedRaw.add(it) }
    }
    val postEvents = schedPostRaw?.optJSONArray("events")
    if (postEvents != null) {
      for (i in 0 until postEvents.length()) postEvents.optJSONObject(i)?.let { combinedRaw.add(it) }
    }

    val seenIds = HashSet<String>()
    val mergedEvents = mutableListOf<TeamScheduleEvent>()
    for (rawEv in combinedRaw) {
      val eid = rawEv.optString("id")
      if (eid.isEmpty() || !seenIds.add(eid)) continue
      val ev = normalizeEvent(rawEv)
      val isHome = ev.home.id == teamId
      val teamComp = if (isHome) ev.home else ev.away
      val opponent = if (isHome) ev.away else ev.home
      val isPast = ev.state == "post" || ev.completed
      val isLive = ev.state == "in"
      val isFuture = !isPast && !isLive

      var result = ""
      if (isPast) {
        val ts = teamComp.score.toIntOrNull()
        val os = opponent.score.toIntOrNull()
        result = when {
          teamComp.winner -> "W"
          opponent.winner -> "L"
          ts != null && os != null && ts > os -> "W"
          ts != null && os != null && ts < os -> "L"
          ts != null && os != null -> "T"
          else -> ""
        }
      }

      mergedEvents.add(
        TeamScheduleEvent(
          event = ev,
          isHome = isHome,
          teamComp = teamComp,
          opponent = opponent,
          venuePrefix = if (ev.neutralSite || isHome) "vs" else "@",
          venueTag = if (ev.neutralSite) "Neutral" else if (isHome) "Home" else "Away",
          isPast = isPast,
          isLive = isLive,
          isFuture = isFuture,
          result = result
        )
      )
    }

    mergedEvents.sortBy { KickoffFormatter.parseIsoTimestampMs(it.event.date) ?: Long.MAX_VALUE }

    return TeamPageData(
      team = header,
      seasonYear = seasonYear,
      currentSeasonYear = currentSeasonYear,
      events = mergedEvents,
      seasonSummary = computeTeamSeasonSummary(mergedEvents),
      stats = normalizeTeamStatistics(statsRaw)
    )
  }

  fun parseSeasonResultsGraph(raw: JSONObject): SeasonResultsGraph {
    val curYear = Calendar.getInstance().get(Calendar.YEAR)
    val gamesArr = raw.optJSONArray("games") ?: JSONArray()
    val games = ArrayList<SeasonResultGame>(gamesArr.length())
    for (i in 0 until gamesArr.length()) {
      val g = gamesArr.optJSONObject(i) ?: continue
      val wId = g.optString("winnerId")
      val lId = g.optString("loserId")
      val eid = g.optString("id")
      if (eid.isEmpty() || wId.isEmpty() || lId.isEmpty()) continue
      games.add(
        SeasonResultGame(
          id = eid,
          date = g.optString("date"),
          seasonType = g.optString("seasonType").ifEmpty { "2" },
          weekNumber = if (g.has("weekNumber") && !g.isNull("weekNumber")) g.optInt("weekNumber") else null,
          weekLabel = g.optString("weekLabel"),
          shortName = g.optString("shortName"),
          neutralSite = g.optBoolean("neutralSite", false),
          winnerId = wId,
          loserId = lId,
          winnerScore = g.optInt("winnerScore", 0),
          loserScore = g.optInt("loserScore", 0),
          margin = g.optInt("margin", g.optInt("winnerScore", 0) - g.optInt("loserScore", 0)),
          homeId = g.optString("homeId"),
          awayId = g.optString("awayId"),
          homeScore = g.optInt("homeScore", 0),
          awayScore = g.optInt("awayScore", 0)
        )
      )
    }

    val teamsObj = raw.optJSONObject("teams") ?: JSONObject()
    val teams = HashMap<String, SeasonGraphTeam>()
    val keys = teamsObj.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val t = teamsObj.optJSONObject(key) ?: continue
      teams[key] = SeasonGraphTeam(
        id = t.optString("id").ifEmpty { key },
        displayName = t.optString("displayName").ifEmpty { "Team" },
        shortName = t.optString("shortName").ifEmpty { "Team" },
        location = t.optString("location"),
        abbreviation = t.optString("abbreviation"),
        color = normalizeHexColor(t.optString("color")),
        logo = t.optString("logo")
      )
    }

    return SeasonResultsGraph(
      seasonYear = raw.optInt("seasonYear", curYear),
      generatedAt = raw.optLong("generatedAt", System.currentTimeMillis()),
      completedCount = raw.optInt("completedCount", games.size),
      teamCount = raw.optInt("teamCount", teams.size),
      games = games,
      teams = teams
    )
  }

  fun parsePpvStreams(raw: JSONObject): WatchCatalog {
    val nowTs = raw.optLong("timestamp", System.currentTimeMillis() / 1000L)
    val rawCats = raw.optJSONArray("streams") ?: JSONArray()
    val categories = mutableListOf<WatchCategory>()
    val streams = mutableListOf<WatchStream>()
    val seenIds = HashSet<String>()

    for (i in 0 until rawCats.length()) {
      val cat = rawCats.optJSONObject(i) ?: continue
      val catName = cat.optString("category").ifEmpty { "Other" }
      val catStreams = cat.optJSONArray("streams") ?: JSONArray()
      categories.add(
        WatchCategory(
          id = cat.opt("id")?.toString() ?: catName,
          name = catName,
          alwaysLive = cat.optBoolean("always_live", false),
          count = catStreams.length()
        )
      )

      for (j in 0 until catStreams.length()) {
        val s = catStreams.optJSONObject(j) ?: continue
        val sid = s.opt("id")?.toString().orEmpty()
        if (sid.isEmpty() || !seenIds.add(sid)) continue

        val feeds = mutableListOf<WatchFeed>()
        val seenUrls = HashSet<String>()

        val primaryIframe = s.optString("iframe")
        if (primaryIframe.isNotEmpty() && seenUrls.add(primaryIframe)) {
          feeds.add(
            WatchFeed(
              id = sid,
              label = s.optString("source_tag").ifEmpty { s.optString("tag") }.ifEmpty { "HD | Main" },
              iframe = primaryIframe,
              uriName = s.optString("uri_name"),
              source = "ppv"
            )
          )
        }

        val subStreams = s.optJSONArray("substreams")
        if (subStreams != null) {
          for (k in 0 until subStreams.length()) {
            val sub = subStreams.optJSONObject(k) ?: continue
            val subIframe = sub.optString("iframe")
            if (subIframe.isNotEmpty() && seenUrls.add(subIframe)) {
              feeds.add(
                WatchFeed(
                  id = sub.opt("id")?.toString() ?: "$sid-sub-$k",
                  label = sub.optString("source_tag").ifEmpty { sub.optString("name") }.ifEmpty { "Alt Feed" },
                  iframe = subIframe,
                  uriName = sub.optString("uri_name").ifEmpty { sub.optString("uri") },
                  source = "ppv"
                )
              )
            }
          }
        }
        if (feeds.isEmpty()) continue

        val uriName = s.optString("uri_name")
        val tag = s.optString("tag")
        val isCfb = tag == "College Football" || uriName.startsWith("cfb/")
        val isFootball = catName == "American Football" || isCfb
        val startsAt = s.optLong("starts_at", 0L)
        val endsAt = s.optLong("ends_at", 0L)
        val alwaysLive = s.optBoolean("always_live", false)
        val isLiveNow = alwaysLive || (startsAt > 0 && startsAt <= nowTs && (endsAt == 0L || nowTs <= endsAt))
        val viewersRaw = s.optString("viewers").ifEmpty { "0" }
        val viewers = viewersRaw.replace(",", "").toIntOrNull() ?: 0
        val extUrl = if (uriName.isNotEmpty()) "https://ppv.st/live/$uriName" else "https://ppv.st"
        val colors = s.optJSONArray("colors")
        val c1 = colors?.optString(0)?.takeIf { it.startsWith("#") } ?: "#006C47"
        val c2 = colors?.optString(1)?.takeIf { it.startsWith("#") } ?: "#3C6472"

        streams.add(
          WatchStream(
            id = sid,
            source = "ppv",
            sourceLabel = "ppv.st",
            name = s.optString("name").ifEmpty { "Live Stream" },
            tag = tag,
            category = catName,
            sourceTag = s.optString("source_tag").ifEmpty { tag }.ifEmpty { feeds[0].label },
            poster = s.optString("poster"),
            primaryColor = c1,
            secondaryColor = c2,
            uriName = uriName,
            externalUrl = extUrl,
            startsAt = startsAt,
            endsAt = endsAt,
            alwaysLive = alwaysLive,
            isLiveNow = isLiveNow,
            isCfb = isCfb,
            isFootball = isFootball,
            viewers = viewers,
            viewersDisplay = viewersRaw,
            iframe = feeds[0].iframe,
            feeds = feeds
          )
        )
      }
    }

    streams.sortWith { a, b ->
      when {
        a.isCfb != b.isCfb -> if (a.isCfb) -1 else 1
        a.isLiveNow != b.isLiveNow -> if (a.isLiveNow) -1 else 1
        b.viewers != a.viewers -> b.viewers.compareTo(a.viewers)
        else -> a.startsAt.compareTo(b.startsAt)
      }
    }
    return WatchCatalog(timestamp = nowTs, categories = categories, streams = streams)
  }

  fun parseServerStreams(
    raw: JSONObject,
    sourceId: String,
    sourceLabel: String,
    defaultExternalUrl: String,
    backendBaseUrl: String
  ): WatchCatalog {
    val nowTs = raw.optLong("timestamp", System.currentTimeMillis() / 1000L)
    val rawCats = raw.optJSONArray("categories") ?: JSONArray()
    val categories = (0 until rawCats.length()).mapNotNull { i ->
      val c = rawCats.optJSONObject(i) ?: return@mapNotNull null
      WatchCategory(
        id = c.optString("id"),
        name = c.optString("name"),
        alwaysLive = c.optBoolean("alwaysLive", false),
        count = c.optInt("count", 0)
      )
    }

    val rawStreams = raw.optJSONArray("streams") ?: JSONArray()
    val streams = mutableListOf<WatchStream>()
    for (i in 0 until rawStreams.length()) {
      val s = rawStreams.optJSONObject(i) ?: continue
      val rawFeeds = s.optJSONArray("feeds") ?: JSONArray()
      val feeds = mutableListOf<WatchFeed>()
      for (j in 0 until rawFeeds.length()) {
        val f = rawFeeds.optJSONObject(j) ?: continue
        val resolved = resolveIframeUrl(f.optString("iframe"), backendBaseUrl)
        if (resolved.isEmpty()) continue
        feeds.add(
          WatchFeed(
            id = f.optString("id"),
            label = f.optString("label").ifEmpty { "Server ${j + 1}" },
            iframe = resolved,
            uriName = f.optString("uriName").ifEmpty { s.optString("uriName") },
            source = sourceId
          )
        )
      }
      if (feeds.isEmpty()) continue
      val viewers = s.optInt("viewers", 0)
      streams.add(
        WatchStream(
          id = s.optString("id"),
          source = sourceId,
          sourceLabel = sourceLabel,
          name = s.optString("name").ifEmpty { "Live Stream" },
          tag = s.optString("tag").ifEmpty { "College Football" },
          category = s.optString("category").ifEmpty { "College Football" },
          sourceTag = s.optString("sourceTag").ifEmpty { sourceLabel },
          broadcast = s.optString("broadcast"),
          poster = s.optString("poster"),
          primaryColor = if (sourceId == "strmfree") "#6B3FA0" else "#006C47",
          secondaryColor = if (sourceId == "strmfree") "#1D4ED8" else "#265B6E",
          uriName = s.optString("uriName"),
          externalUrl = s.optString("externalUrl").ifEmpty { defaultExternalUrl },
          startsAt = s.optLong("startsAt", 0L),
          endsAt = s.optLong("endsAt", 0L),
          timeLabel = s.optString("timeLabel"),
          alwaysLive = s.optBoolean("alwaysLive", false),
          isLiveNow = s.optBoolean("isLiveNow", false),
          isCfb = s.optBoolean("isCfb", false),
          isFootball = s.optBoolean("isFootball", false),
          viewers = viewers,
          viewersDisplay = if (viewers > 0) viewers.toString() else "",
          iframe = feeds[0].iframe,
          feeds = feeds
        )
      )
    }

    streams.sortWith { a, b ->
      when {
        a.isCfb != b.isCfb -> if (a.isCfb) -1 else 1
        a.isLiveNow != b.isLiveNow -> if (a.isLiveNow) -1 else 1
        else -> (if (a.startsAt > 0) a.startsAt else Long.MAX_VALUE)
          .compareTo(if (b.startsAt > 0) b.startsAt else Long.MAX_VALUE)
      }
    }
    return WatchCatalog(timestamp = nowTs, categories = categories, streams = streams)
  }

  private fun normText(raw: String): String =
    raw.lowercase(Locale.US)
      .replace(Regex("[^a-z0-9]+"), " ")
      .trim()

  private val ALIASES = mapOf(
    "ole miss" to listOf("mississippi", "ole miss rebels"),
    "mississippi" to listOf("ole miss", "ole miss rebels"),
    "miami fl" to listOf("miami", "miami hurricanes"),
    "miami" to listOf("miami fl", "miami hurricanes"),
    "nc state" to listOf("north carolina state", "nc state wolfpack"),
    "uconn" to listOf("connecticut", "uconn huskies"),
    "app state" to listOf("appalachian state"),
    "pitt" to listOf("pittsburgh", "pittsburgh panthers"),
    "usc" to listOf("southern california", "southern cal", "usc trojans"),
    "smu" to listOf("southern methodist", "smu mustangs"),
    "tcu" to listOf("texas christian", "tcu horned frogs"),
    "byu" to listOf("brigham young", "byu cougars"),
    "ucf" to listOf("central florida", "ucf knights"),
    "lsu" to listOf("louisiana state", "lsu tigers"),
    "utsa" to listOf("texas san antonio", "utsa roadrunners")
  )

  fun findStreamForEvent(
    event: GameEvent?,
    preferredSource: String,
    ppvStreams: List<WatchStream>,
    timStreams: List<WatchStream>,
    strmFreeStreams: List<WatchStream>
  ): WatchStream? {
    if (event == null) return null
    val ordered = listOf(preferredSource) + listOf("ppv", "timstreams", "strmfree").filter { it != preferredSource }
    fun getList(src: String): List<WatchStream> = when (src) {
      "timstreams" -> timStreams
      "strmfree" -> strmFreeStreams
      else -> ppvStreams
    }

    fun variantsFor(c: TeamCompetitor): Set<String> {
      val base = listOf(c.displayName, c.shortName, c.location, c.abbreviation)
        .map { normText(it) }
        .filter { it.length >= 2 }
        .toMutableSet()
      val extra = mutableListOf<String>()
      base.forEach { b -> ALIASES[b]?.let { extra.addAll(it) } }
      base.addAll(extra)
      return base
    }

    val awayVars = variantsFor(event.away)
    val homeVars = variantsFor(event.home)

    fun scoreMatch(stream: WatchStream): Int {
      val hay = normText("${stream.name} ${stream.tag} ${stream.category}")
      if (hay.isEmpty()) return 0
      val awayHit = awayVars.any { it.length >= 3 && hay.contains(it) }
      val homeHit = homeVars.any { it.length >= 3 && hay.contains(it) }
      if (!awayHit || !homeHit) return 0
      var score = 20
      if (stream.isCfb) score += 10
      if (stream.isLiveNow) score += 5
      return score
    }

    for (src in ordered) {
      val candidates = getList(src)
      var best: WatchStream? = null
      var bestScore = 0
      for (s in candidates) {
        val sc = scoreMatch(s)
        if (sc > bestScore) {
          bestScore = sc
          best = s
        }
      }
      if (best != null) return best
    }
    return null
  }
}
