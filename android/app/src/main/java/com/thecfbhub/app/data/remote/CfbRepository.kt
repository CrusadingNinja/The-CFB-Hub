package com.thecfbhub.app.data.remote

import com.thecfbhub.app.BuildConfig
import com.thecfbhub.app.data.model.CommitteeG6Selection
import com.thecfbhub.app.data.model.GameSummary
import com.thecfbhub.app.data.model.ScoreboardData
import com.thecfbhub.app.data.model.SeasonResultsGraph
import com.thecfbhub.app.data.model.StandingsBundle
import com.thecfbhub.app.data.model.TeamDirectoryItem
import com.thecfbhub.app.data.model.TeamPageData
import com.thecfbhub.app.data.model.WatchCatalog
import com.thecfbhub.app.data.model.WeeklyRankingsData
import com.thecfbhub.app.util.CfpPlayoffHelper
import java.io.IOException
import java.net.URLEncoder
import java.util.Calendar
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

class CfbRepository(
  private val espnBaseUrl: String = BuildConfig.ESPN_BASE_URL,
  private val espnStandingsUrl: String = BuildConfig.ESPN_STANDINGS_URL,
  private val backendBaseUrl: String = BuildConfig.BACKEND_BASE_URL
) {
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(25, TimeUnit.SECONDS)
    .build()

  private data class CacheEntry(
    val json: JSONObject,
    val expiresAtMs: Long
  )

  private val cache = ConcurrentHashMap<String, CacheEntry>()

  private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

  private suspend fun fetchJsonObject(
    url: String,
    ttlMs: Long = 12_000L,
    force: Boolean = false
  ): JSONObject = withContext(Dispatchers.IO) {
    val now = System.currentTimeMillis()
    if (!force) {
      val cached = cache[url]
      if (cached != null && cached.expiresAtMs > now) {
        return@withContext cached.json
      }
    }

    val request = Request.Builder()
      .url(url)
      .header("Accept", "application/json")
      .header("User-Agent", "TheCFBHubAndroid/${BuildConfig.VERSION_NAME}")
      .build()

    val bodyStr = client.newCall(request).execute().use { response ->
      if (!response.isSuccessful) {
        throw IOException("HTTP ${response.code} for $url")
      }
      response.body?.string() ?: throw IOException("Empty response body")
    }

    val parsed = JSONObject(bodyStr)
    if (cache.size > 150) cache.clear()
    cache[url] = CacheEntry(parsed, System.currentTimeMillis() + ttlMs)
    parsed
  }

  private suspend fun fetchOptionalJsonObject(
    url: String,
    ttlMs: Long = 60_000L,
    force: Boolean = false
  ): JSONObject? = try {
    fetchJsonObject(url, ttlMs, force)
  } catch (_: Exception) {
    null
  }

  suspend fun getScoreboard(
    seasonType: String? = null,
    week: String? = null,
    group: String = "80",
    force: Boolean = false
  ): ScoreboardData {
    val params = mutableListOf("groups=${encode(group.ifEmpty { "80" })}", "limit=200")
    if (!seasonType.isNullOrEmpty()) params.add("seasontype=${encode(seasonType)}")
    if (!week.isNullOrEmpty()) params.add("week=${encode(week)}")
    val url = "$espnBaseUrl/scoreboard?${params.joinToString("&")}"
    val raw = fetchJsonObject(url, ttlMs = 12_000L, force = force)
    return EspnJsonParser.parseScoreboard(
      raw = raw,
      fallbackSeasonType = seasonType ?: "2",
      fallbackWeek = week ?: "1"
    )
  }

  suspend fun getGameSummary(eventId: String, force: Boolean = false): GameSummary {
    val url = "$espnBaseUrl/summary?event=${encode(eventId)}"
    val raw = fetchJsonObject(url, ttlMs = 10_000L, force = force)
    return EspnJsonParser.parseGameSummary(raw, eventId)
  }

  suspend fun getStandingsAndRankings(force: Boolean = false): StandingsBundle = coroutineScope {
    val standingsDeferred = async { fetchJsonObject(espnStandingsUrl, ttlMs = 60_000L, force = force) }
    val rankingsDeferred = async { fetchOptionalJsonObject("$espnBaseUrl/rankings", ttlMs = 60_000L, force = force) }
    val standingsRaw = standingsDeferred.await()
    val rankingsRaw = rankingsDeferred.await()
    EspnJsonParser.parseStandingsAndRankings(standingsRaw, rankingsRaw)
  }

  suspend fun getWeeklyRankings(
    season: Int? = null,
    week: String? = null,
    seasonType: String? = null,
    force: Boolean = false
  ): WeeklyRankingsData {
    val params = mutableListOf<String>()
    if (season != null) params.add("seasons=$season")
    if (!week.isNullOrEmpty()) params.add("weeks=${encode(week)}")
    if (!seasonType.isNullOrEmpty()) params.add("seasontypes=${encode(seasonType)}")
    val url = if (params.isNotEmpty()) {
      "$espnBaseUrl/rankings?${params.joinToString("&")}"
    } else {
      "$espnBaseUrl/rankings"
    }
    val raw = fetchJsonObject(url, ttlMs = 60_000L, force = force)

    val curYear = Calendar.getInstance().get(Calendar.YEAR)
    val seasonYear = raw.optJSONObject("requestedSeason")?.optInt("year", 0)?.takeIf { it > 0 }
      ?: raw.optJSONObject("latestSeason")?.optInt("year", 0)?.takeIf { it > 0 }
      ?: season
      ?: curYear

    var preRaw: JSONObject? = null
    if (week == "1" && seasonType == "2") {
      preRaw = fetchOptionalJsonObject(
        "$espnBaseUrl/rankings?seasons=$seasonYear&weeks=1&seasontypes=1",
        ttlMs = 60_000L,
        force = force
      )
    }

    val parsed = EspnJsonParser.parseWeeklyRankings(
      raw = raw,
      preRaw = preRaw,
      requestedSeason = season,
      requestedWeek = week,
      requestedSeasonType = seasonType
    )

    val cfp = parsed.cfpPoll
    if (cfp != null && CfpPlayoffHelper.computeCfpPlayoffInfo(cfp.ranks).g6Unranked) {
      val sel = getCfpCommitteeG6Selection(
        season = parsed.seasonYear,
        week = cfp.occurrenceWeek.ifBlank { week },
        pollDate = cfp.date,
        force = force
      )
      if (sel != null) {
        return parsed.copy(cfpPoll = cfp.copy(committeeUnrankedG6 = sel))
      }
    }
    return parsed
  }

  suspend fun getCfpCommitteeG6Selection(
    season: Int,
    week: String? = null,
    pollDate: String? = null,
    force: Boolean = false
  ): CommitteeG6Selection? {
    val base = backendBaseUrl.trimEnd('/')
    val params = mutableListOf("season=$season")
    if (!week.isNullOrBlank()) params.add("week=${encode(week)}")
    if (!pollDate.isNullOrBlank()) params.add("date=${encode(pollDate)}")
    if (force) params.add("force=1")
    val url = "$base/api/cfp-g6-selection?${params.joinToString("&")}"
    val raw = fetchOptionalJsonObject(url, ttlMs = 30 * 60 * 1000L, force = force) ?: return null
    val found = raw.optBoolean("found", false)
    val teamName = raw.optString("teamName", "").trim()
    if (!found || teamName.isEmpty() || teamName == "null") return null
    return CommitteeG6Selection(
      teamName = teamName,
      sourceUrl = raw.optString("sourceUrl", ""),
      releaseDate = raw.optString("releaseDate", ""),
      excerpt = raw.optString("excerpt", "")
    )
  }

  suspend fun getTeamsDirectory(
    fbsBundle: StandingsBundle,
    force: Boolean = false
  ): Pair<List<TeamDirectoryItem>, Map<String, TeamDirectoryItem>> = coroutineScope {
    val teamsDef = async { fetchJsonObject("$espnBaseUrl/teams?limit=1000", ttlMs = 300_000L, force = force) }
    val fcsDef = async { fetchOptionalJsonObject("$espnStandingsUrl?group=81", ttlMs = 300_000L, force = force) }
    val teamsRaw = teamsDef.await()
    val fcsRaw = fcsDef.await()
    val (fcsConfs, _) = if (fcsRaw != null) {
      EspnJsonParser.normalizeStandingsConferences(fcsRaw.optJSONArray("children"))
    } else {
      emptyList<com.thecfbhub.app.data.model.ConferenceStandings>() to emptyMap()
    }
    EspnJsonParser.buildTeamsCatalog(teamsRaw, fbsBundle.conferences, fcsConfs, fbsBundle.rankMap)
  }

  suspend fun getTeamPageData(
    teamId: String,
    season: Int? = null,
    currentSeasonYear: Int,
    catalogEntry: TeamDirectoryItem?,
    force: Boolean = false
  ): TeamPageData = coroutineScope {
    val encId = encode(teamId)
    val seasonYear = season ?: currentSeasonYear
    val infoDef = async { fetchJsonObject("$espnBaseUrl/teams/$encId", ttlMs = 60_000L, force = force) }
    val regDef = async {
      fetchOptionalJsonObject(
        "$espnBaseUrl/teams/$encId/schedule?season=$seasonYear",
        ttlMs = 30_000L,
        force = force
      ) ?: JSONObject()
    }
    val postDef = async {
      fetchOptionalJsonObject(
        "$espnBaseUrl/teams/$encId/schedule?season=$seasonYear&seasontype=3",
        ttlMs = 60_000L,
        force = force
      )
    }
    val statsDef = async {
      fetchOptionalJsonObject(
        "$espnBaseUrl/teams/$encId/statistics?season=$seasonYear",
        ttlMs = 60_000L,
        force = force
      )
    }

    EspnJsonParser.parseTeamPage(
      teamId = teamId,
      teamInfoRaw = infoDef.await(),
      schedRegRaw = regDef.await(),
      schedPostRaw = postDef.await(),
      statsRaw = statsDef.await(),
      catalogEntry = catalogEntry,
      seasonYear = seasonYear,
      currentSeasonYear = currentSeasonYear
    )
  }

  suspend fun getSeasonResultsGraph(season: Int? = null, force: Boolean = false): SeasonResultsGraph {
    val params = mutableListOf<String>()
    if (season != null) params.add("season=$season")
    if (force) params.add("force=1")
    val qs = if (params.isNotEmpty()) "?${params.joinToString("&")}" else ""
    val url = "${backendBaseUrl.trimEnd('/')}/api/season-results$qs"
    val raw = fetchJsonObject(url, ttlMs = 300_000L, force = force)
    return EspnJsonParser.parseSeasonResultsGraph(raw)
  }

  suspend fun getPpvStreams(force: Boolean = false): WatchCatalog {
    val base = backendBaseUrl.trimEnd('/')
    val proxyUrl = "$base/api/ppv/streams${if (force) "?force=1" else ""}"
    val raw = try {
      fetchJsonObject(proxyUrl, ttlMs = 15_000L, force = force)
    } catch (_: Exception) {
      fetchJsonObject("https://api.ppv.st/api/streams", ttlMs = 15_000L, force = force)
    }
    return EspnJsonParser.parsePpvStreams(raw)
  }

  suspend fun getTheTvAppStreams(force: Boolean = false): WatchCatalog {
    val base = backendBaseUrl.trimEnd('/')
    val raw = fetchJsonObject(
      "$base/api/thetvapp/streams${if (force) "?force=1" else ""}",
      ttlMs = 15_000L,
      force = force
    )
    return EspnJsonParser.parseServerStreams(
      raw = raw,
      sourceId = "thetvapp",
      sourceLabel = "thetvapp.plus",
      defaultExternalUrl = "https://thetvapp.plus",
      backendBaseUrl = base
    )
  }

  suspend fun getStrmFreeStreams(force: Boolean = false): WatchCatalog {
    val base = backendBaseUrl.trimEnd('/')
    val raw = fetchJsonObject(
      "$base/api/strmfree/streams${if (force) "?force=1" else ""}",
      ttlMs = 15_000L,
      force = force
    )
    return EspnJsonParser.parseServerStreams(
      raw = raw,
      sourceId = "strmfree",
      sourceLabel = "strmfree.pk",
      defaultExternalUrl = "https://strmfree.pk",
      backendBaseUrl = base
    )
  }
}
