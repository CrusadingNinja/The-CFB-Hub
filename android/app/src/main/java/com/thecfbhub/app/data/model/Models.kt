package com.thecfbhub.app.data.model

data class TeamCompetitor(
  val id: String,
  val homeAway: String = "",
  val abbreviation: String = "TBD",
  val displayName: String = "TBD",
  val shortName: String = "TBD",
  val location: String = "",
  val color: String? = null,
  val alternateColor: String? = null,
  val logo: String = "",
  val logoDark: String = "",
  val conferenceId: String? = null,
  val score: String = "",
  val winner: Boolean = false,
  val rank: Int? = null,
  val overallRecord: String = "",
  val confRecord: String = "",
  val linescores: List<String> = emptyList(),
  val leaders: List<TeamLeaderGroup> = emptyList()
)

data class GameSituation(
  val possession: String? = null,
  val down: Int? = null,
  val distance: Int? = null,
  val downDistanceText: String = "",
  val shortDownDistanceText: String = "",
  val possessionText: String = "",
  val yardLine: Int? = null,
  val isRedZone: Boolean = false,
  val homeTimeouts: Int? = null,
  val awayTimeouts: Int? = null,
  val lastPlay: String = ""
)

data class GameVenue(
  val name: String = "",
  val city: String = "",
  val state: String = "",
  val attendance: Int? = null
)

data class GameOdds(
  val details: String = "",
  val overUnder: Double? = null
)

data class GameEvent(
  val id: String,
  val name: String,
  val shortName: String,
  val date: String = "",
  val timeValid: Boolean = true,
  val flexTimeSlot: String = "",
  val seasonTypeId: String = "2",
  val seasonTypeName: String = "Regular Season",
  val weekNumber: Int? = null,
  val weekText: String = "",
  val state: String = "pre",
  val statusDetail: String = "",
  val statusDescription: String = "",
  val completed: Boolean = false,
  val period: Int = 0,
  val displayClock: String = "",
  val neutralSite: Boolean = false,
  val conferenceCompetition: Boolean = false,
  val playByPlayAvailable: Boolean = false,
  val broadcast: String = "",
  val headline: String = "",
  val venue: GameVenue = GameVenue(),
  val odds: GameOdds? = null,
  val away: TeamCompetitor,
  val home: TeamCompetitor,
  val situation: GameSituation? = null
)

data class WeekEntry(
  val label: String,
  val detail: String = "",
  val value: String,
  val startDate: String = "",
  val endDate: String = ""
)

data class SeasonCalendar(
  val regular: List<WeekEntry> = emptyList(),
  val postseason: List<WeekEntry> = emptyList()
)

data class ScoreboardData(
  val seasonYear: Int,
  val seasonType: String,
  val weekNumber: String,
  val calendar: SeasonCalendar,
  val events: List<GameEvent>
)

data class PlayInfo(
  val id: String,
  val sequenceNumber: Long = 0,
  val period: Int = 1,
  val clock: String = "",
  val text: String = "",
  val awayScore: Int = 0,
  val homeScore: Int = 0,
  val scoringPlay: Boolean = false,
  val isTurnover: Boolean = false,
  val isPenalty: Boolean = false,
  val statYardage: Int? = null,
  val typeText: String = "",
  val downDistanceText: String = "",
  val shortDownDistance: String = "",
  val possessionText: String = "",
  val yardLine: Int? = null,
  val yardsToEndzone: Int? = null,
  val endDownDistanceText: String = "",
  val endShortDownDistanceText: String = "",
  val endPossessionText: String = "",
  val endYardsToEndzone: Int? = null,
  val endTeamId: String? = null
)

data class DriveTeamInfo(
  val id: String = "",
  val abbreviation: String = "",
  val displayName: String = "",
  val logo: String = "",
  val logoDark: String = ""
)

data class DriveInfo(
  val id: String,
  val isCurrent: Boolean = false,
  val description: String = "",
  val team: DriveTeamInfo = DriveTeamInfo(),
  val result: String = "",
  val displayResult: String = "",
  val isScore: Boolean = false,
  val yards: Int = 0,
  val offensivePlays: Int = 0,
  val timeElapsed: String = "",
  val startText: String = "",
  val endText: String = "",
  val startAwayScore: Int = 0,
  val startHomeScore: Int = 0,
  val awayScore: Int = 0,
  val homeScore: Int = 0,
  val plays: List<PlayInfo> = emptyList()
)

data class ScoringPlay(
  val id: String,
  val period: Int = 1,
  val clock: String = "",
  val text: String = "",
  val awayScore: Int = 0,
  val homeScore: Int = 0,
  val teamId: String = "",
  val teamAbbr: String = "",
  val teamName: String = "",
  val teamLogo: String = "",
  val scoringType: String = "SCORE",
  val scoringLabel: String = "Score"
)

data class BoxscoreRow(
  val key: String,
  val label: String,
  val awayValue: String,
  val homeValue: String
)

data class TeamLeaderEntry(
  val category: String,
  val displayName: String,
  val athleteName: String,
  val headshot: String = "",
  val jersey: String = "",
  val position: String = "",
  val displayValue: String = ""
)

data class TeamLeaderGroup(
  val teamId: String,
  val teamAbbr: String,
  val teamName: String,
  val categories: List<TeamLeaderEntry> = emptyList()
)

data class GameSummary(
  val id: String,
  val date: String = "",
  val timeValid: Boolean = true,
  val flexTimeSlot: String = "",
  val headline: String = "",
  val state: String = "pre",
  val statusDetail: String = "",
  val period: Int = 0,
  val displayClock: String = "",
  val broadcast: String = "",
  val venue: GameVenue = GameVenue(),
  val away: TeamCompetitor,
  val home: TeamCompetitor,
  val currentDrive: DriveInfo? = null,
  val previousDrives: List<DriveInfo> = emptyList(),
  val scoringPlays: List<ScoringPlay> = emptyList(),
  val boxscoreRows: List<BoxscoreRow> = emptyList(),
  val leaders: List<TeamLeaderGroup> = emptyList(),
  val odds: GameOdds? = null
)

data class StandingTeamRow(
  val teamId: String,
  val name: String,
  val shortName: String,
  val abbreviation: String,
  val logo: String = "",
  val rank: Int? = null,
  val seed: Int = 999,
  val seedDisplay: String = "-",
  val confRecord: String = "0-0",
  val confWinPct: Double = 0.0,
  val confWinPctDisplay: String = ".000",
  val overallRecord: String = "0-0",
  val overallWins: Int = 0,
  val overallWinPct: Double = 0.0,
  val homeRecord: String = "0-0",
  val awayRecord: String = "0-0",
  val pointsFor: Int = 0,
  val pointsAgainst: Int = 0,
  val pointDiff: Int = 0,
  val pointDiffDisplay: String = "0",
  val streak: String = "-",
  val streakValue: Int = 0
)

data class StandingGroup(
  val name: String? = null,
  val entries: List<StandingTeamRow> = emptyList()
)

data class ConferenceInfo(
  val id: String,
  val name: String,
  val shortName: String,
  val abbreviation: String
)

data class ConferenceStandings(
  val id: String,
  val name: String,
  val shortName: String,
  val abbreviation: String,
  val groups: List<StandingGroup> = emptyList()
)

data class StandingsBundle(
  val conferences: List<ConferenceStandings> = emptyList(),
  val conferenceMap: Map<String, ConferenceInfo> = emptyMap(),
  val rankMap: Map<String, Int> = emptyMap(),
  val pollName: String = "Top 25"
)

data class RankedTeamRow(
  val id: String,
  val displayName: String,
  val shortName: String,
  val abbreviation: String,
  val color: String? = null,
  val logo: String = "",
  val conferenceId: String? = null,
  val conferenceShortName: String = "",
  val current: Int = 0,
  val previous: Int = 0,
  val points: Int = 0,
  val firstPlaceVotes: Int = 0,
  val recordSummary: String = "",
  val firstRoundBye: Boolean = false,
  val movement: String = "same",
  val delta: Int = 0,
  val trendDisplay: String = "—",
  val previousDisplay: String = "—"
)

data class CommitteeG6Selection(
  val teamName: String,
  val sourceUrl: String = "",
  val releaseDate: String = "",
  val excerpt: String = ""
)

data class RankingPoll(
  val id: String,
  val type: String,
  val name: String,
  val shortName: String,
  val headline: String = "",
  val date: String = "",
  val lastUpdated: String = "",
  val occurrenceLabel: String = "",
  val occurrenceWeek: String = "",
  val isInitialRelease: Boolean = false,
  val isPreseasonCarryover: Boolean = false,
  val ranks: List<RankedTeamRow> = emptyList(),
  val others: List<RankedTeamRow> = emptyList(),
  val droppedOut: List<RankedTeamRow> = emptyList(),
  val committeeUnrankedG6: CommitteeG6Selection? = null
)

data class RankingsWeekOption(
  val key: String,
  val week: String,
  val seasonType: String,
  val label: String,
  val shortLabel: String
)

data class WeeklyRankingsData(
  val seasonYear: Int,
  val activeWeekKey: String,
  val activeWeekLabel: String,
  val weeks: List<RankingsWeekOption> = emptyList(),
  val cfpPoll: RankingPoll? = null,
  val apPoll: RankingPoll? = null
)

data class TeamDirectoryItem(
  val id: String,
  val displayName: String,
  val shortName: String,
  val location: String = "",
  val nickname: String = "",
  val abbreviation: String = "",
  val color: String? = null,
  val alternateColor: String? = null,
  val logo: String = "",
  val slug: String = "",
  val division: String = "D2/D3",
  val conferenceId: String = "",
  val conferenceName: String = "",
  val conferenceShortName: String = "",
  val overallRecord: String = "",
  val confRecord: String = "",
  val rank: Int? = null
)

data class TeamScheduleEvent(
  val event: GameEvent,
  val isHome: Boolean,
  val teamComp: TeamCompetitor,
  val opponent: TeamCompetitor,
  val venuePrefix: String,
  val venueTag: String,
  val isPast: Boolean,
  val isLive: Boolean,
  val isFuture: Boolean,
  val result: String
)

data class TeamSeasonSummary(
  val completedCount: Int = 0,
  val record: String = "0-0",
  val confRecord: String = "0-0",
  val homeRecord: String = "0-0",
  val awayRecord: String = "0-0",
  val pointsFor: Int = 0,
  val pointsAgainst: Int = 0,
  val ppg: String = "-",
  val oppPpg: String = "-",
  val pointDiff: Int = 0,
  val pointDiffDisplay: String = "-",
  val streak: String = "-"
)

data class TeamStatItem(
  val name: String,
  val label: String,
  val shortLabel: String,
  val description: String = "",
  val teamValue: String,
  val teamNumeric: Double = 0.0,
  val oppValue: String? = null,
  val oppNumeric: Double? = null,
  val oppRank: String = ""
)

data class TeamStatCategory(
  val name: String,
  val displayName: String,
  val groupKey: String,
  val items: List<TeamStatItem> = emptyList()
)

data class TeamComparisonRow(
  val label: String,
  val teamValue: String,
  val teamNumeric: Double,
  val oppValue: String,
  val oppNumeric: Double,
  val oppRank: String = ""
)

data class TeamStatisticsData(
  val seasonYear: Int? = null,
  val categories: List<TeamStatCategory> = emptyList(),
  val overviewComparisons: List<TeamComparisonRow> = emptyList()
)

data class TeamDetailHeader(
  val id: String,
  val displayName: String,
  val shortName: String,
  val location: String = "",
  val nickname: String = "",
  val abbreviation: String = "",
  val color: String = "#006C47",
  val alternateColor: String = "#3C6472",
  val logo: String = "",
  val division: String = "",
  val standingSummary: String = "",
  val record: String = "",
  val rank: Int? = null,
  val conferenceId: String = "",
  val conferenceName: String = "",
  val conferenceShortName: String = ""
)

data class TeamPageData(
  val team: TeamDetailHeader,
  val seasonYear: Int,
  val currentSeasonYear: Int,
  val events: List<TeamScheduleEvent> = emptyList(),
  val seasonSummary: TeamSeasonSummary = TeamSeasonSummary(),
  val stats: TeamStatisticsData? = null
)

data class SeasonResultGame(
  val id: String,
  val date: String = "",
  val seasonType: String = "2",
  val weekNumber: Int? = null,
  val weekLabel: String = "",
  val shortName: String = "",
  val neutralSite: Boolean = false,
  val winnerId: String,
  val loserId: String,
  val winnerScore: Int,
  val loserScore: Int,
  val margin: Int,
  val homeId: String = "",
  val awayId: String = "",
  val homeScore: Int = 0,
  val awayScore: Int = 0
)

data class SeasonGraphTeam(
  val id: String,
  val displayName: String,
  val shortName: String,
  val location: String = "",
  val abbreviation: String = "",
  val color: String? = null,
  val logo: String = ""
)

data class SeasonResultsGraph(
  val seasonYear: Int,
  val generatedAt: Long,
  val completedCount: Int,
  val teamCount: Int,
  val games: List<SeasonResultGame> = emptyList(),
  val teams: Map<String, SeasonGraphTeam> = emptyMap()
)

data class TransitiveChain(
  val degree: Int,
  val edgeCount: Int,
  val teamIds: List<String>,
  val intermediateIds: List<String>,
  val games: List<SeasonResultGame>,
  val totalMargin: Int,
  val minMargin: Int
)

data class TransitiveStats(
  val teamAWins: Int,
  val teamALosses: Int,
  val teamBWins: Int,
  val teamBLosses: Int,
  val completedCount: Int
)

data class TransitiveComparison(
  val winChains: List<TransitiveChain>,
  val lossChains: List<TransitiveChain>,
  val stats: TransitiveStats
)

data class FarthestChainResult(
  val degree: Int?,
  val edgeCount: Int,
  val targetId: String?,
  val tiedCount: Int,
  val reachableCount: Int,
  val teamIds: List<String>,
  val intermediateIds: List<String>,
  val games: List<SeasonResultGame>,
  val totalMargin: Int,
  val minMargin: Int
)

data class SchoolFarthestRow(
  val teamId: String,
  val wins: Int,
  val losses: Int,
  val farthestWin: FarthestChainResult,
  val farthestLoss: FarthestChainResult
)

data class WatchFeed(
  val id: String,
  val label: String,
  val iframe: String,
  val uriName: String = "",
  val source: String = "ppv"
)

data class WatchCategory(
  val id: String,
  val name: String,
  val alwaysLive: Boolean = false,
  val count: Int = 0
)

data class WatchStream(
  val id: String,
  val source: String,
  val sourceLabel: String,
  val name: String,
  val tag: String = "",
  val category: String = "",
  val sourceTag: String = "",
  val broadcast: String = "",
  val poster: String = "",
  val primaryColor: String = "#006C47",
  val secondaryColor: String = "#3C6472",
  val uriName: String = "",
  val externalUrl: String = "",
  val startsAt: Long = 0L,
  val endsAt: Long = 0L,
  val timeLabel: String = "",
  val alwaysLive: Boolean = false,
  val isLiveNow: Boolean = false,
  val isCfb: Boolean = false,
  val isFootball: Boolean = false,
  val viewers: Int = 0,
  val viewersDisplay: String = "0",
  val iframe: String,
  val feeds: List<WatchFeed> = emptyList()
)

data class WatchCatalog(
  val timestamp: Long = 0L,
  val categories: List<WatchCategory> = emptyList(),
  val streams: List<WatchStream> = emptyList()
)
