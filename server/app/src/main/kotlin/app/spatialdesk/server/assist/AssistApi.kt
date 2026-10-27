package app.spatialdesk.server.assist

import kotlinx.serialization.Serializable
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/** Only the owner's selected task view is accepted. No patient records, notes, audio or workspace are accepted. */
@Serializable data class SharedTask(val id: String, val title: String, val column: String)
@Serializable data class ComfortChange(val reach: Double? = null, val scale: Double? = null, val side: String? = null, val turnDeg: Double? = null, val tiltDeg: Double? = null)
@Serializable data class PairCreated(val ok: Boolean = true, val pairId: String, val code: String, val expiresAt: Long, val roomExpiresAt: Long)
@Serializable data class JoinResult(val ok: Boolean = true, val requestId: String, val pairId: String, val state: String = "pending", val expiresAt: Long)
@Serializable data class AccessRequestView(val requestId: String, val state: String, val requestedAt: Long, val allowConfiguration: Boolean, val taskIds: List<String>)
@Serializable data class ProposalView(val proposalId: String, val requestId: String, val comfort: ComfortChange, val state: String, val createdAt: Long)
@Serializable data class OwnerView(val ok: Boolean = true, val pairId: String, val expiresAt: Long, val inviteExpiresAt: Long, val requests: List<AccessRequestView>, val proposals: List<ProposalView>)
@Serializable data class HelperView(val ok: Boolean = true, val pairId: String, val requestId: String, val approved: Boolean, val state: String, val expiresAt: Long, val allowConfiguration: Boolean = false, val tasks: List<SharedTask>? = null, val proposals: List<ProposalView>? = null)
@Serializable data class ApprovalResult(val ok: Boolean = true, val pairId: String, val requestId: String, val state: String = "approved")
@Serializable data class ProposalResult(val ok: Boolean = true, val proposalId: String, val state: String = "pending")
@Serializable data class ResolveResult(val ok: Boolean = true, val proposalId: String, val outcome: String)
@Serializable data class RevokeResult(val ok: Boolean = true, val pairId: String, val state: String = "revoked")
@Serializable data class AssistError(val ok: Boolean = false, val code: String, val error: String)

@Serializable private data class JoinRequest(val code: String)
@Serializable private data class ApproveRequest(val requestId: String, val allowConfiguration: Boolean, val tasks: List<SharedTask>)
@Serializable private data class ProposalRequest(val comfort: ComfortChange)
@Serializable private data class ResolveRequest(val proposalId: String, val outcome: String)

/** Strict JSON at this boundary prevents a whole workspace or arbitrary metadata from being shared accidentally. */
@OptIn(ExperimentalSerializationApi::class)
private val assistJson = Json { ignoreUnknownKeys = false; isLenient = false; encodeDefaults = true; explicitNulls = false }

@RestController
@RequestMapping("/api/assist", produces = [MediaType.APPLICATION_JSON_VALUE])
class AssistController(private val registry: AssistRegistry) {
    @PostMapping("/pairs")
    fun create(@RequestHeader("X-Session", required = false) session: String?, @RequestBody(required = false) body: String?): ResponseEntity<String> = respond(session) {
        if (!body.isNullOrBlank() && objectBody(body).isNotEmpty()) throw AssistFault(400, "unexpected_fields", "Crea la invitación sin enviar datos personales.")
        assistJson.encodeToString(registry.create(session))
    }

    @PostMapping("/join", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun join(@RequestHeader("X-Session", required = false) session: String?, @RequestBody body: String): ResponseEntity<String> = respond(session) {
        val request = decode<JoinRequest>(body)
        assistJson.encodeToString(registry.join(session, request.code))
    }

    @GetMapping("/pairs/{id}/owner")
    fun owner(@RequestHeader("X-Session", required = false) session: String?, @PathVariable id: String): ResponseEntity<String> = respond(session) {
        assistJson.encodeToString(registry.owner(session, id))
    }

    @PostMapping("/pairs/{id}/approve", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun approve(@RequestHeader("X-Session", required = false) session: String?, @PathVariable id: String, @RequestBody body: String): ResponseEntity<String> = respond(session) {
        val request = decode<ApproveRequest>(body)
        assistJson.encodeToString(registry.approve(session, id, request.requestId, request.allowConfiguration, request.tasks))
    }

    @GetMapping("/pairs/{id}/helper")
    fun helper(@RequestHeader("X-Session", required = false) session: String?, @PathVariable id: String): ResponseEntity<String> = respond(session) {
        assistJson.encodeToString(registry.helper(session, id))
    }

    @PostMapping("/pairs/{id}/proposals", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun proposal(@RequestHeader("X-Session", required = false) session: String?, @PathVariable id: String, @RequestBody body: String): ResponseEntity<String> = respond(session) {
        val raw = objectBody(body)
        val comfort = raw["comfort"] as? JsonObject ?: throw AssistFault(400, "invalid_comfort", "Revisa los ajustes propuestos.")
        // Numeric strings, null, NaN and non-finite numbers are not configuration values.
        for ((key, value) in comfort) {
            val primitive = value as? JsonPrimitive ?: throw AssistFault(400, "invalid_comfort", "Revisa los ajustes propuestos.")
            val valid = if (key == "side") primitive.isString else !primitive.isString && primitive.doubleOrNull?.isFinite() == true
            if (!valid) throw AssistFault(400, "invalid_comfort", "Revisa los ajustes propuestos.")
        }
        val request = decode<ProposalRequest>(body)
        assistJson.encodeToString(registry.propose(session, id, request.comfort))
    }

    @PostMapping("/pairs/{id}/resolve", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun resolve(@RequestHeader("X-Session", required = false) session: String?, @PathVariable id: String, @RequestBody body: String): ResponseEntity<String> = respond(session) {
        val request = decode<ResolveRequest>(body)
        assistJson.encodeToString(registry.resolve(session, id, request.proposalId, request.outcome))
    }

    @DeleteMapping("/pairs/{id}")
    fun revoke(@RequestHeader("X-Session", required = false) session: String?, @PathVariable id: String): ResponseEntity<String> = respond(session) {
        assistJson.encodeToString(registry.revoke(session, id))
    }

    private fun objectBody(body: String): JsonObject {
        if (body.toByteArray(Charsets.UTF_8).size > AssistLimits.MAX_BODY_BYTES) throw AssistFault(413, "body_too_large", "El contenido compartido es demasiado grande.")
        return runCatching { assistJson.parseToJsonElement(body) as? JsonObject }.getOrNull()
            ?: throw AssistFault(400, "invalid_request", "No se pudo leer la solicitud.")
    }

    private inline fun <reified T> decode(body: String): T {
        val value = objectBody(body)
        return runCatching { assistJson.decodeFromJsonElement<T>(value) }.getOrElse {
            throw AssistFault(400, "invalid_request", "Revisa los campos de la solicitud. Sólo se aceptan los datos de esta función.")
        }
    }

    private inline fun respond(session: String?, action: () -> String): ResponseEntity<String> {
        val (status, response) = try {
            registry.requireSession(session) // reject unauthenticated requests before reading their JSON
            200 to action()
        } catch (fault: AssistFault) {
            fault.status to assistJson.encodeToString(AssistError(code = fault.code, error = fault.message.orEmpty()))
        }
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).header("Cache-Control", "no-store").header("Pragma", "no-cache").body(response)
    }
}
