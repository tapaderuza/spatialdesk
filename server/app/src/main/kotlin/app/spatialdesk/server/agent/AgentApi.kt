package app.spatialdesk.server.agent

import app.spatialdesk.server.SessionQuota
import app.spatialdesk.server.SessionRegistry
import app.spatialdesk.shared.WorkspaceJson
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
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient
import java.time.Clock
import java.time.Duration

@ConfigurationProperties("spatialdesk.agent")
data class AgentProperties(
    /** "bedrock" (Amazon Nova) or "built-in" (deterministic planner only: tests, offline development). */
    val mode: String = "bedrock",
    val model: String = "us.amazon.nova-2-lite-v1:0",
    val region: String = "us-east-1",
    val perSessionPerHour: Int = 20,
    /** A hard ceiling on Bedrock calls per day for the whole competition deployment: the bill stays bounded. */
    val perDay: Int = 300,
    val maxBodyBytes: Int = 65_536,
    val timeoutSeconds: Long = 8,
)

/** Plans per session per hour and per day (see SessionQuota), with the words the headset shows when one is spent. */
@Component
class AgentQuota(private val props: AgentProperties, clock: Clock) {
    private val quota = SessionQuota(props.perSessionPerHour, props.perDay, clock)

    /** Takes one plan from the quotas, or says which one is spent. */
    fun take(session: String): String? = when (quota.take(session)) {
        SessionQuota.Spent.Day -> "The AI has done all the planning it can today. Your workspace still works by hand."
        SessionQuota.Spent.Hour -> "That is ${props.perSessionPerHour} plans this hour. Try again a little later."
        null -> null
    }
}

@Configuration
class AgentConfig {
    @Bean
    fun planner(props: AgentProperties, clock: Clock): Planner = when (props.mode) {
        "built-in" -> Planner({ _, _, _ -> throw AiUnavailableException("The AI is switched off on this server") }, Planner.BUILT_IN, clock)
        else -> {
            val bedrock = BedrockRuntimeClient.builder()
                .region(Region.of(props.region))
                .overrideConfiguration(
                    ClientOverrideConfiguration.builder()
                        .apiCallTimeout(Duration.ofSeconds(props.timeoutSeconds))
                        // One quick retry at most: a plan that takes longer than the user's patience is no plan.
                        .retryStrategy { it.maxAttempts(2) }
                        .build(),
                )
                .build()
            val nova = NovaPlanModel(bedrock, props.model)
            Thread({ nova.warmUp() }, "nova-warm-up").apply { isDaemon = true }.start()
            Planner(nova, props.model, clock)
        }
    }
}

/**
 * POST /api/agent/plan: the workspace and an intent in, a validated plan out. Nothing is applied here: the headset
 * shows the plan, the user applies it (one undo step) or discards it.
 */
@RestController
class AgentController(
    private val planner: Planner,
    private val quota: AgentQuota,
    private val sessions: SessionRegistry,
    private val props: AgentProperties,
) {
    @PostMapping("/api/agent/plan", consumes = [MediaType.APPLICATION_JSON_VALUE], produces = [MediaType.APPLICATION_JSON_VALUE])
    fun plan(@RequestHeader("X-Session", required = false) session: String?, @RequestBody body: String): ResponseEntity<String> {
        if (session == null || !sessions.isValid(session)) return error(401, "Your session expired. Reconnecting, try again in a moment.")
        if (body.length > props.maxBodyBytes) return error(413, "This workspace is too large to plan.")
        val request = runCatching { WorkspaceJson.decodeFromString(PlanRequest.serializer(), body) }.getOrNull()
            ?: return error(400, "The request could not be read.")
        if (request.intent == Intent.Session && request.sessionChoice?.valid() != true) return error(400, "Choose 5 to 90 available minutes and low or steady energy.")
        quota.take(session)?.let { return error(429, it) }
        val response = planner.plan(request)
        return ResponseEntity.status(if (response.ok) 200 else 502).body(WorkspaceJson.encodeToString(PlanResponse.serializer(), response))
    }

    private fun error(status: Int, message: String): ResponseEntity<String> =
        ResponseEntity.status(status).body(WorkspaceJson.encodeToString(PlanResponse.serializer(), PlanResponse(ok = false, error = message)))
}
