package app.spatialdesk.server.voice

import app.spatialdesk.server.SessionQuota
import app.spatialdesk.server.SessionRegistry
import app.spatialdesk.shared.WorkspaceJson
import kotlinx.serialization.Serializable
import org.slf4j.LoggerFactory
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RestController
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider
import java.time.Clock

@ConfigurationProperties("spatialdesk.voice")
data class VoiceProperties(
    /** Off: the endpoint answers 503 and the headset says voice is unavailable (offline development). */
    val enabled: Boolean = true,
    val region: String = "us-east-1",
    val perSessionPerHour: Int = 60,
    /** Each listen streams at most ~10 s to Amazon Transcribe (billed per second, 15 s minimum): $0.006 at most. */
    val perDay: Int = 600,
    /** How long the URL may wait before the headset opens it; an open stream is not cut by it. */
    val expiresSeconds: Int = 30,
)

@Serializable
data class VoiceRequest(val language: String? = null)

@Serializable
data class VoiceResponse(
    val ok: Boolean,
    /** A wss:// URL to Amazon Transcribe streaming, presigned by this server. */
    val url: String? = null,
    val language: String? = null,
    val sampleRate: Int? = null,
    val error: String? = null,
)

/**
 * Presigned Amazon Transcribe streaming URLs. The headset streams its microphone straight to Transcribe over a
 * WebSocket: no audio passes through or is stored on this server, and the browser never holds AWS credentials.
 */
class TranscribePresigner(private val region: String, private val credentials: AwsCredentialsProvider, private val clock: Clock, private val expiresSeconds: Int) {
    fun url(language: String): String {
        val resolved = credentials.resolveCredentials()
        val host = "transcribestreaming.$region.amazonaws.com:8443"
        val query = SigV4.presign(
            method = "GET",
            host = host,
            path = PATH,
            query = mapOf("language-code" to language, "media-encoding" to "pcm", "sample-rate" to SAMPLE_RATE.toString()),
            service = "transcribe",
            region = region,
            credentials = SigV4.Credentials(resolved.accessKeyId(), resolved.secretAccessKey(), (resolved as? AwsSessionCredentials)?.sessionToken()),
            time = clock.instant(),
            expiresSeconds = expiresSeconds,
        )
        return "wss://$host$PATH?$query"
    }

    companion object {
        const val PATH = "/stream-transcription-websocket"
        const val SAMPLE_RATE = 16_000

        /** What a headset may ask for (its browser language, when Transcribe streams it); anything else is US English. */
        val LANGUAGES = setOf("en-US", "en-GB", "en-AU", "es-ES", "es-US", "fr-FR", "de-DE", "it-IT", "pt-BR")
        const val DEFAULT_LANGUAGE = "en-US"
    }
}

@Configuration
class VoiceConfig {
    /** The task role's credentials on Fargate, the developer's profile locally. A bean so tests can replace it. */
    @Bean
    fun voiceCredentials(): AwsCredentialsProvider = DefaultCredentialsProvider.builder().build()

    @Bean
    fun transcribePresigner(props: VoiceProperties, credentials: AwsCredentialsProvider, clock: Clock) =
        TranscribePresigner(props.region, credentials, clock, props.expiresSeconds)
}

/** Listens per session per hour and per day (see SessionQuota). */
@Component
class VoiceQuota(private val props: VoiceProperties, clock: Clock) {
    private val quota = SessionQuota(props.perSessionPerHour, props.perDay, clock)

    fun take(session: String): String? = when (quota.take(session)) {
        SessionQuota.Spent.Day -> "Voice has reached today's limit. Tap the buttons instead."
        SessionQuota.Spent.Hour -> "That is ${props.perSessionPerHour} voice commands this hour. Tap the buttons for a while."
        null -> null
    }
}

/** POST /api/voice/session: one presigned URL per listen, counted against the quotas. */
@RestController
class VoiceController(
    private val props: VoiceProperties,
    private val quota: VoiceQuota,
    private val sessions: SessionRegistry,
    private val presigner: TranscribePresigner,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @PostMapping("/api/voice/session", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun session(@RequestHeader("X-Session", required = false) session: String?, @RequestBody(required = false) body: String?): ResponseEntity<String> {
        if (!props.enabled) return error(503, "Voice is switched off on this server.")
        if (session == null || !sessions.isValid(session)) return error(401, "Your session expired. Reconnecting, try again in a moment.")
        val asked = runCatching { WorkspaceJson.decodeFromString(VoiceRequest.serializer(), body ?: "{}").language }.getOrNull()
        val language = asked?.takeIf { it in TranscribePresigner.LANGUAGES } ?: TranscribePresigner.DEFAULT_LANGUAGE
        quota.take(session)?.let { return error(429, it) }
        val url = runCatching { presigner.url(language) }.getOrElse { e ->
            log.warn("voice presign failed: {}", e.message)
            return error(503, "Voice is unavailable right now. Tap the buttons instead.")
        }
        val response = VoiceResponse(ok = true, url = url, language = language, sampleRate = TranscribePresigner.SAMPLE_RATE)
        return ResponseEntity.ok(WorkspaceJson.encodeToString(VoiceResponse.serializer(), response))
    }

    private fun error(status: Int, message: String): ResponseEntity<String> =
        ResponseEntity.status(status).body(WorkspaceJson.encodeToString(VoiceResponse.serializer(), VoiceResponse(ok = false, error = message)))
}
