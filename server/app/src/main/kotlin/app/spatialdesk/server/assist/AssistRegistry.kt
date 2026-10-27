package app.spatialdesk.server.assist

import app.spatialdesk.server.SessionRegistry
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.stereotype.Component
import java.security.SecureRandom
import java.time.Clock
import java.util.Base64
import java.util.Locale

@ConfigurationProperties("spatialdesk.assist")
data class AssistLimits(
    val maxRooms: Int = 128,
    val maxRoomsPerOwner: Int = 2,
    val maxRequestsPerRoom: Int = 8,
    val maxGrantsPerRoom: Int = 3,
    val maxProposalsPerRoom: Int = 16,
    val maxPendingPerHelper: Int = 3,
    val joinPerSessionPerMinute: Int = 6,
    val joinGlobalPerMinute: Int = 120,
    val invitationSeconds: Long = 120,
    val roomSeconds: Long = 900,
) {
    init {
        require(maxRooms in 1..512 && maxRoomsPerOwner in 1..8)
        require(maxRequestsPerRoom in 1..16 && maxGrantsPerRoom in 1..maxRequestsPerRoom)
        require(maxProposalsPerRoom in 1..64 && maxPendingPerHelper in 1..maxProposalsPerRoom)
        require(joinPerSessionPerMinute in 1..30 && joinGlobalPerMinute in 1..600)
        require(invitationSeconds in 1..300 && roomSeconds in invitationSeconds..900)
    }

    companion object {
        const val MAX_BODY_BYTES = 16_384
        const val MAX_TASKS = 12
        const val MAX_TITLE = 160
    }
}

class AssistFault(val status: Int, val code: String, message: String) : RuntimeException(message)

/**
 * Single-node, temporary state only. X-Session is validated with the application's existing SessionRegistry.
 * An invitation merely requests access; no task information is disclosed until its owner explicitly approves it.
 * This service stores proposals but never reads or executes WorkspaceEngine operations.
 */
@Component
class AssistRegistry(private val sessions: SessionRegistry, private val clock: Clock, private val limits: AssistLimits) {
    private val random = SecureRandom()
    private val rooms = linkedMapOf<String, Room>()
    private val codes = mutableMapOf<String, String>()
    private val joinWindows = mutableMapOf<String, Window>()
    private var globalJoinWindow = Window(Long.MIN_VALUE, 0)

    private data class Window(val minute: Long, var count: Int)
    private data class Request(
        val id: String, val helper: String, val requestedAt: Long,
        var approved: Boolean = false, var allowConfiguration: Boolean = false, var tasks: List<SharedTask> = emptyList(),
    )
    private data class Proposal(val id: String, val requestId: String, val comfort: ComfortChange, val createdAt: Long, var state: String = "pending")
    private data class Room(
        val id: String, val owner: String, val code: String, val inviteExpiresAt: Long, val expiresAt: Long,
        val requests: LinkedHashMap<String, Request> = linkedMapOf(), val proposals: LinkedHashMap<String, Proposal> = linkedMapOf(),
    )

    fun requireSession(session: String?): String = session?.takeIf { sessions.isValid(it) }
        ?: throw AssistFault(401, "session_expired", "Tu sesión ha caducado. Vuelve a conectar antes de compartir.")

    @Synchronized fun create(session: String?): PairCreated {
        val owner = requireSession(session)
        val now = clock.millis(); prune(now)
        if (rooms.size >= limits.maxRooms || rooms.values.count { it.owner == owner } >= limits.maxRoomsPerOwner) {
            throw AssistFault(429, "pair_limit", "Cierra una invitación anterior antes de abrir otra.")
        }
        var code: String
        do { code = buildString { repeat(8) { append(CODE_ALPHABET[random.nextInt(CODE_ALPHABET.length)]) } } } while (codes.containsKey(code))
        val id = identifier()
        val room = Room(id, owner, code, now + limits.invitationSeconds * 1000, now + limits.roomSeconds * 1000)
        rooms[id] = room; codes[code] = id
        return PairCreated(pairId = id, code = code, expiresAt = room.inviteExpiresAt, roomExpiresAt = room.expiresAt)
    }

    @Synchronized fun join(session: String?, code: String): JoinResult {
        val helper = requireSession(session)
        val now = clock.millis(); prune(now); takeJoin(helper, now)
        val normal = code.takeIf { it.length <= 24 }?.trim()?.uppercase(Locale.ROOT)?.filterNot { it == ' ' || it == '-' }
        val room = normal?.takeIf { it.length == 8 && it.all(CODE_ALPHABET::contains) }?.let(codes::get)?.let(rooms::get)
            ?.takeIf { now < it.inviteExpiresAt } ?: unavailableCode()
        if (room.owner == helper) throw AssistFault(409, "owner_cannot_join", "Ya eres la persona propietaria de esta invitación.")
        val existing = room.requests.values.firstOrNull { it.helper == helper }
        if (existing != null) return JoinResult(requestId = existing.id, pairId = room.id, state = if (existing.approved) "approved" else "pending", expiresAt = room.expiresAt)
        if (room.requests.size >= limits.maxRequestsPerRoom) throw AssistFault(429, "request_limit", "Esta invitación ya tiene todas sus solicitudes. Pide una nueva.")
        val request = Request(identifier(), helper, now)
        room.requests[request.id] = request
        return JoinResult(requestId = request.id, pairId = room.id, expiresAt = room.expiresAt)
    }

    @Synchronized fun owner(session: String?, pairId: String): OwnerView {
        val owner = requireSession(session)
        val room = ownedRoom(pairId, owner)
        return OwnerView(pairId = room.id, expiresAt = room.expiresAt, inviteExpiresAt = room.inviteExpiresAt,
            requests = room.requests.values.map { AccessRequestView(it.id, if (it.approved) "approved" else "pending", it.requestedAt, it.approved && it.allowConfiguration, if (it.approved) it.tasks.map(SharedTask::id) else emptyList()) },
            proposals = room.proposals.values.map(::proposalView))
    }

    @Synchronized fun approve(session: String?, pairId: String, requestId: String, allowConfiguration: Boolean, tasks: List<SharedTask>): ApprovalResult {
        val owner = requireSession(session)
        val room = ownedRoom(pairId, owner)
        val request = room.requests[requestId] ?: throw AssistFault(404, "request_unavailable", "La solicitud ya no está disponible.")
        if (!request.approved && room.requests.values.count { it.approved } >= limits.maxGrantsPerRoom) throw AssistFault(429, "grant_limit", "Esta sesión ya tiene todas sus ayudas autorizadas.")
        val selected = validateTasks(tasks)
        request.tasks = selected; request.approved = true; request.allowConfiguration = allowConfiguration
        if (!allowConfiguration) room.proposals.values.filter { it.requestId == request.id && it.state == "pending" }.forEach { it.state = "discarded" }
        return ApprovalResult(pairId = room.id, requestId = request.id)
    }

    @Synchronized fun helper(session: String?, pairId: String): HelperView {
        val helper = requireSession(session)
        val room = room(pairId)
        val request = helperRequest(room, helper)
        return HelperView(pairId = room.id, requestId = request.id, approved = request.approved, state = if (request.approved) "approved" else "pending", expiresAt = room.expiresAt,
            allowConfiguration = request.approved && request.allowConfiguration,
            tasks = if (request.approved) request.tasks.map { it.copy() } else null,
            proposals = if (request.approved) room.proposals.values.filter { it.requestId == request.id }.map(::proposalView) else null)
    }

    @Synchronized fun propose(session: String?, pairId: String, comfort: ComfortChange): ProposalResult {
        val helper = requireSession(session)
        val room = room(pairId)
        val request = helperRequest(room, helper)
        if (!request.approved || !request.allowConfiguration) throw AssistFault(403, "configuration_not_allowed", "La persona propietaria no ha autorizado propuestas de configuración.")
        validateComfort(comfort)
        if (room.proposals.size >= limits.maxProposalsPerRoom || room.proposals.values.count { it.requestId == request.id && it.state == "pending" } >= limits.maxPendingPerHelper) {
            throw AssistFault(429, "proposal_limit", "Espera a que se revisen las propuestas pendientes.")
        }
        val proposal = Proposal(identifier(), request.id, comfort.copy(), clock.millis())
        room.proposals[proposal.id] = proposal
        return ProposalResult(proposalId = proposal.id)
    }

    @Synchronized fun resolve(session: String?, pairId: String, proposalId: String, outcome: String): ResolveResult {
        val owner = requireSession(session)
        val room = ownedRoom(pairId, owner)
        if (outcome !in setOf("applied", "discarded")) throw AssistFault(400, "invalid_outcome", "Elige aplicar o descartar la propuesta.")
        val proposal = room.proposals[proposalId] ?: throw AssistFault(404, "proposal_unavailable", "La propuesta ya no está disponible.")
        if (proposal.state != "pending") throw AssistFault(409, "proposal_resolved", "Esta propuesta ya fue revisada.")
        val request = room.requests[proposal.requestId]
        if (request?.approved != true || !request.allowConfiguration) throw AssistFault(403, "configuration_not_allowed", "El permiso de configuración ya no está activo.")
        // This is an acknowledgement from the owner; the service never applies settings to a workspace.
        proposal.state = outcome
        return ResolveResult(proposalId = proposal.id, outcome = outcome)
    }

    @Synchronized fun revoke(session: String?, pairId: String): RevokeResult {
        val owner = requireSession(session)
        val room = ownedRoom(pairId, owner)
        rooms.remove(room.id); codes.remove(room.code)
        return RevokeResult(pairId = room.id)
    }

    private fun ownedRoom(id: String, owner: String): Room = room(id).also {
        if (it.owner != owner) throw AssistFault(403, "owner_required", "Sólo la persona propietaria puede revisar esta sesión.")
    }

    private fun room(id: String): Room {
        prune(clock.millis())
        return rooms[id] ?: throw AssistFault(404, "pair_unavailable", "El enlace ya no está disponible. Puede haber caducado o haberse cerrado.")
    }

    private fun helperRequest(room: Room, helper: String): Request = room.requests.values.firstOrNull { it.helper == helper }
        ?: throw AssistFault(403, "helper_not_joined", "Únete con la invitación antes de consultar esta sesión.")

    private fun validateTasks(tasks: List<SharedTask>): List<SharedTask> {
        if (tasks.size > AssistLimits.MAX_TASKS || tasks.map { it.id }.toSet().size != tasks.size) throw AssistFault(400, "invalid_tasks", "Selecciona hasta doce tareas distintas para compartir.")
        if (tasks.any { !validText(it.id, 100) || !validText(it.title, AssistLimits.MAX_TITLE) || !validText(it.column, 80) }) throw AssistFault(400, "invalid_tasks", "Revisa el título y la columna de las tareas seleccionadas.")
        return tasks.map { it.copy() }
    }

    private fun validateComfort(change: ComfortChange) {
        fun valid(value: Double?, low: Double, high: Double) = value == null || value.isFinite() && value in low..high
        if (change.reach == null && change.scale == null && change.side == null && change.turnDeg == null && change.tiltDeg == null ||
            !valid(change.reach, 0.5, 1.8) || !valid(change.scale, 0.8, 1.8) || !valid(change.turnDeg, 20.0, 120.0) || !valid(change.tiltDeg, -25.0, 30.0) ||
            change.side != null && change.side !in setOf("both", "left", "right")) throw AssistFault(400, "invalid_comfort", "Los ajustes deben estar dentro de los límites de distancia, tamaño, lado, giro y altura.")
    }

    private fun validText(value: String, max: Int) = value.isNotBlank() && value.length <= max && value == value.trim() && value.none { it.code < 32 || it.code == 127 }
    private fun proposalView(proposal: Proposal) = ProposalView(proposal.id, proposal.requestId, proposal.comfort.copy(), proposal.state, proposal.createdAt)
    private fun identifier(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(16).also(random::nextBytes))
    private fun unavailableCode(): Nothing = throw AssistFault(404, "invitation_unavailable", "El código no está disponible. Compruébalo o pide una nueva invitación.")

    private fun prune(now: Long) {
        val expired = rooms.values.filter { now >= it.expiresAt || !sessions.isValid(it.owner) }.map { it.id }
        for (id in expired) rooms.remove(id)?.let { codes.remove(it.code) }
        codes.entries.removeIf { (_, id) -> rooms[id]?.let { now >= it.inviteExpiresAt } != false }
        val minute = now / 60_000
        joinWindows.entries.removeIf { it.value.minute != minute }
    }

    private fun takeJoin(session: String, now: Long) {
        val minute = now / 60_000
        if (globalJoinWindow.minute != minute) globalJoinWindow = Window(minute, 0)
        val window = joinWindows.getOrPut(session) { Window(minute, 0) }
        if (window.count >= limits.joinPerSessionPerMinute || globalJoinWindow.count >= limits.joinGlobalPerMinute) throw AssistFault(429, "join_limit", "Demasiados intentos. Espera un minuto antes de volver a probar.")
        window.count++; globalJoinWindow.count++
    }

    companion object { private const val CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" }
}
