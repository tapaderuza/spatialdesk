package app.spatialdesk.server

import java.time.Clock
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.ArrayDeque
import java.util.concurrent.ConcurrentHashMap

/**
 * A per-session hourly window plus one global daily cap, in memory (one small task). Every paid AWS call a headset
 * can cause (Bedrock plans, Transcribe listens) goes through one of these, so the bill stays bounded.
 */
class SessionQuota(private val perSessionPerHour: Int, private val perDay: Int, private val clock: Clock) {
    enum class Spent { Day, Hour }

    private val perSession = ConcurrentHashMap<String, ArrayDeque<Long>>()
    private var day: LocalDate? = null
    private var today = 0

    /** Takes one use from the quotas, or says which one is spent. */
    @Synchronized
    fun take(session: String): Spent? {
        val now = clock.millis()
        val date = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC)
        if (date != day) {
            day = date
            today = 0
        }
        if (today >= perDay) return Spent.Day
        val window = perSession.computeIfAbsent(session) { ArrayDeque() }
        while (window.isNotEmpty() && now - window.first() > 3_600_000) window.removeFirst()
        if (window.size >= perSessionPerHour) return Spent.Hour
        window.addLast(now)
        today++
        return null
    }
}
