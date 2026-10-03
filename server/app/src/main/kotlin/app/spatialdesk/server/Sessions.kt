package app.spatialdesk.server

import app.spatialdesk.shared.PROTOCOL_VERSION
import jakarta.servlet.http.HttpServletRequest
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.server.ResponseStatusException
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

@ConfigurationProperties("spatialdesk.sessions")
data class SessionLimits(val maxActive: Int = 500, val perIpPerHour: Int = 30)

data class SessionResponse(val sessionId: String, val protocol: Int)

/**
 * Anonymous workspace sessions: a judge opens the URL and gets one, no account. The id is a 128-bit random
 * capability (unguessable) required to open the WebSocket. In memory for week 1; persistence arrives with
 * the workspace model.
 */
@Component
class SessionRegistry(private val limits: SessionLimits, private val clock: Clock) {
    private val random = SecureRandom()
    private val sessions = ConcurrentHashMap<String, Long>() // id -> created (epoch ms)
    private val perIp = ConcurrentHashMap<String, Pair<Long, Int>>() // ip -> (hour, count)

    fun create(ip: String): String {
        val hour = clock.millis() / 3_600_000
        val (_, count) = perIp.compute(ip) { _, c -> if (c == null || c.first != hour) hour to 1 else hour to c.second + 1 }!!
        if (count > limits.perIpPerHour) throw ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many new sessions from this network")
        if (sessions.size >= limits.maxActive) evictOldest()
        val bytes = ByteArray(16).also(random::nextBytes)
        val id = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        sessions[id] = clock.millis()
        return id
    }

    fun isValid(id: String?): Boolean = id != null && sessions.containsKey(id)

    private fun evictOldest() {
        sessions.entries.minByOrNull { it.value }?.let { sessions.remove(it.key) }
    }
}

@RestController
class SessionController(private val registry: SessionRegistry) {
    @PostMapping("/api/sessions")
    fun create(request: HttpServletRequest): SessionResponse = SessionResponse(registry.create(clientIp(request)), PROTOCOL_VERSION)
}

/** Behind CloudFront + ALB the real client is the second-to-last X-Forwarded-For hop (ScreenDesk lesson). */
fun clientIp(request: HttpServletRequest): String {
    val hops = request.getHeader("X-Forwarded-For")?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
    return when {
        hops.size >= 2 -> hops[hops.size - 2]
        hops.size == 1 -> hops[0]
        else -> request.remoteAddr
    }
}
