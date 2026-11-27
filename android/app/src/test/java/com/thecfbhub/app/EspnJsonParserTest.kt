package com.thecfbhub.app

import com.thecfbhub.app.data.remote.EspnJsonParser
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EspnJsonParserTest {

  @Test
  fun normalizeEvent_handlesPolymorphicScoresAndFlexTbdMetadata() {
    val rawEvent = JSONObject(
      """
      {
        "id": "401856760",
        "name": "Georgia Tech at Georgia",
        "shortName": "GT @ UGA",
        "date": "2026-11-28T05:00Z",
        "competitions": [
          {
            "timeValid": false,
            "notes": [
              { "type": "event", "headline": "FLEX: 3:30 - 4:30pm OR 6 - 8pm ET start" }
            ],
            "status": {
              "type": { "state": "pre", "shortDetail": "TBD", "detail": "11/28 - TBD", "completed": false }
            },
            "competitors": [
              {
                "id": "61",
                "homeAway": "home",
                "score": { "value": 0, "displayValue": "0" },
                "curatedRank": { "current": 1 },
                "team": { "id": "61", "abbreviation": "UGA", "displayName": "Georgia Bulldogs", "shortDisplayName": "Georgia" }
              },
              {
                "id": "59",
                "homeAway": "away",
                "score": "0",
                "curatedRank": { "current": 99 },
                "team": { "id": "59", "abbreviation": "GT", "displayName": "Georgia Tech Yellow Jackets", "shortDisplayName": "Georgia Tech" }
              }
            ]
          }
        ]
      }
      """.trimIndent()
    )

    val ev = EspnJsonParser.normalizeEvent(rawEvent)
    assertFalse(ev.timeValid)
    assertEquals("FLEX: 3:30 - 4:30pm OR 6 - 8pm ET", ev.flexTimeSlot)
    assertEquals("", ev.headline)
    assertEquals(1, ev.home.rank)
    assertNull(ev.away.rank)
    assertEquals("0", ev.home.score)
  }

  @Test
  fun parseScoreboard_ordersConfirmedBeforeFlexBeforeTbdOnSameDay() {
    val sbJson = JSONObject(
      """
      {
        "season": { "year": 2026, "type": 2 },
        "week": { "number": 13 },
        "events": [
          {
            "id": "pure-tbd",
            "shortName": "A @ B",
            "date": "2026-11-28T05:00Z",
            "competitions": [{
              "timeValid": false,
              "notes": [],
              "status": { "type": { "state": "pre", "shortDetail": "TBD" } },
              "competitors": []
            }]
          },
          {
            "id": "flex-game",
            "shortName": "C @ D",
            "date": "2026-11-28T05:00Z",
            "competitions": [{
              "timeValid": false,
              "notes": [{ "headline": "FLEX: 3:30 - 4:30pm ET start" }],
              "status": { "type": { "state": "pre", "shortDetail": "TBD" } },
              "competitors": []
            }]
          },
          {
            "id": "confirmed-noon",
            "shortName": "E @ F",
            "date": "2026-11-28T17:00Z",
            "competitions": [{
              "timeValid": true,
              "notes": [],
              "status": { "type": { "state": "pre", "shortDetail": "11/28 - 12:00 PM EST" } },
              "competitors": []
            }]
          }
        ]
      }
      """.trimIndent()
    )

    val parsed = EspnJsonParser.parseScoreboard(sbJson)
    assertEquals(listOf("confirmed-noon", "flex-game", "pure-tbd"), parsed.events.map { it.id })
  }

  @Test
  fun parseServerStreams_resolvesRelativeEmbedUrlsAgainstBackendHost() {
    val raw = JSONObject(
      """
      {
        "timestamp": 1763800000,
        "categories": [],
        "streams": [
          {
            "id": "espn",
            "name": "Alabama at Auburn",
            "isCfb": true,
            "isLiveNow": true,
            "feeds": [
              { "id": "f1", "label": "Server 1", "iframe": "/api/thetvapp/embed?eventPath=%2Ftv%2Fespn" }
            ]
          }
        ]
      }
      """.trimIndent()
    )

    val catalog = EspnJsonParser.parseServerStreams(
      raw = raw,
      sourceId = "thetvapp",
      sourceLabel = "thetvapp.plus",
      defaultExternalUrl = "https://thetvapp.plus",
      backendBaseUrl = "https://thecfbhub.netlify.app/"
    )

    assertEquals(1, catalog.streams.size)
    assertTrue(catalog.streams[0].isCfb)
    assertEquals(
      "https://thecfbhub.netlify.app/api/thetvapp/embed?eventPath=%2Ftv%2Fespn",
      catalog.streams[0].iframe
    )
  }
}
