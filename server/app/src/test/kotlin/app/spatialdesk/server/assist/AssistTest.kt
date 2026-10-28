package app.spatialdesk.server.assist

import app.spatialdesk.server.SessionLimits
import app.spatialdesk.server.SessionRegistry
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

private class AssistClock(var now: Long = 1_800_000_000_000L) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = this
    override fun instant(): Instant = Instant.ofEpochMilli(now)
    override fun millis(): Long = now
}

private class Fixture(limits: AssistLimits = AssistLimits(), maxSessions: Int = 50) {
    val clock = AssistClock()
    val sessions = SessionRegistry(SessionLimits(maxActive = maxSessions, perIpPerHour = 100), clock)
    private var nextIp = 0
    fun session(): String = sessions.create("192.0.2.${++nextIp}").also { clock.now++ }
    val owner = session()
    val helper = session()
    val other = session()
    val registry = AssistRegistry(sessions, clock, limits)
    val task = SharedTask("k1", "Only the selected task", "Doing")
    fun pair() = registry.create(owner)
    fun grant(configuration: Boolean = true): Pair<PairCreated, JoinResult> {
        val pair = pair(); val join = registry.join(helper, pair.code)
        registry.approve(owner, pair.pairId, join.requestId, configuration, listOf(task))
        return pair to join
    }
}

private fun failure(status: Int, code: String, action: () -> Any?) {
    val fault = assertThrows<AssistFault> { action() }
    assertEquals(status, fault.status)
    assertEquals(code, fault.code)
}

class AssistRegistryTest {
    @Test fun `joining gives no task data or configuration permission before owner approval`() {
        val f = Fixture(); val pair = f.pair(); val joined = f.registry.join(f.helper, pair.code)
        assertTrue(pair.code.matches(Regex("[A-HJ-NP-Z2-9]{8}")))
        assertTrue(pair.pairId.matches(Regex("[A-Za-z0-9_-]{22}")))
        assertEquals(120_000, pair.expiresAt - f.clock.now)
        assertEquals(900_000, pair.roomExpiresAt - f.clock.now)
        val pending = f.registry.helper(f.helper, pair.pairId)
        assertEquals("pending", pending.state)
        assertFalse(pending.approved)
        assertFalse(pending.allowConfiguration)
        assertNull(pending.tasks)
        assertNull(pending.proposals)
        assertEquals(joined.requestId, f.registry.owner(f.owner, pair.pairId).requests.single().requestId)
        failure(403, "configuration_not_allowed") { f.registry.propose(f.helper, pair.pairId, ComfortChange(scale = 1.2)) }
    }

    @Test fun `session validation is the existing registry and no participant can assume another role`() {
        val f = Fixture(); val pair = f.pair(); val joined = f.registry.join(f.helper, pair.code)
        failure(401, "session_expired") { f.registry.create("invented-session") }
        failure(401, "session_expired") { f.registry.owner(null, pair.pairId) }
        failure(403, "owner_required") { f.registry.owner(f.other, pair.pairId) }
        failure(403, "owner_required") { f.registry.approve(f.helper, pair.pairId, joined.requestId, true, listOf(f.task)) }
        failure(403, "owner_required") { f.registry.revoke(f.helper, pair.pairId) }
        failure(403, "helper_not_joined") { f.registry.helper(f.other, pair.pairId) }
        failure(409, "owner_cannot_join") { f.registry.join(f.owner, pair.code) }
    }

    @Test fun `each approved helper sees only its selected task view and own proposals`() {
        val f = Fixture(); val (pair, joined) = f.grant()
        val otherJoin = f.registry.join(f.other, pair.code)
        assertNull(f.registry.helper(f.other, pair.pairId).tasks)
        val ownProposal = f.registry.propose(f.helper, pair.pairId, ComfortChange(side = "right"))
        f.registry.approve(f.owner, pair.pairId, otherJoin.requestId, false, listOf(SharedTask("k2", "A different selected task", "To do")))
        val first = f.registry.helper(f.helper, pair.pairId); val second = f.registry.helper(f.other, pair.pairId)
        assertEquals(listOf(f.task), first.tasks)
        assertEquals(listOf(ownProposal.proposalId), first.proposals?.map { it.proposalId })
        assertEquals(listOf("k2"), second.tasks?.map { it.id })
        assertTrue(second.proposals!!.isEmpty())
        assertFalse(second.allowConfiguration)
        failure(403, "configuration_not_allowed") { f.registry.propose(f.other, pair.pairId, ComfortChange(reach = 1.1)) }
        // Re-approval replaces a grant's view; it does not append formerly shared tasks.
        f.registry.approve(f.owner, pair.pairId, joined.requestId, true, emptyList())
        assertEquals(emptyList<SharedTask>(), f.registry.helper(f.helper, pair.pairId).tasks)
    }

    @Test fun `a proposal remains pending until the owner acknowledges one outcome`() {
        val f = Fixture(); val (pair, _) = f.grant()
        val change = ComfortChange(reach = 0.8, scale = 1.2, side = "right", turnDeg = 30.0, tiltDeg = -10.0)
        val proposed = f.registry.propose(f.helper, pair.pairId, change)
        assertEquals("pending", proposed.state)
        assertEquals(change, f.registry.owner(f.owner, pair.pairId).proposals.single().comfort)
        failure(403, "owner_required") { f.registry.resolve(f.helper, pair.pairId, proposed.proposalId, "applied") }
        failure(400, "invalid_outcome") { f.registry.resolve(f.owner, pair.pairId, proposed.proposalId, "started") }
        assertEquals("applied", f.registry.resolve(f.owner, pair.pairId, proposed.proposalId, "applied").outcome)
        assertEquals("applied", f.registry.helper(f.helper, pair.pairId).proposals!!.single().state)
        failure(409, "proposal_resolved") { f.registry.resolve(f.owner, pair.pairId, proposed.proposalId, "applied") }
    }

    @Test fun `withdrawing configuration permission discards pending proposals`() {
        val f = Fixture(); val (pair, joined) = f.grant()
        val proposal = f.registry.propose(f.helper, pair.pairId, ComfortChange(turnDeg = 45.0))
        f.registry.approve(f.owner, pair.pairId, joined.requestId, false, listOf(f.task))
        assertEquals("discarded", f.registry.owner(f.owner, pair.pairId).proposals.single().state)
        failure(409, "proposal_resolved") { f.registry.resolve(f.owner, pair.pairId, proposal.proposalId, "applied") }
        failure(403, "configuration_not_allowed") { f.registry.propose(f.helper, pair.pairId, ComfortChange(reach = 1.1)) }
    }

    @Test fun `invitation and room have independent exact expiry deadlines`() {
        val f = Fixture(); val (pair, _) = f.grant()
        f.clock.now = pair.expiresAt
        failure(404, "invitation_unavailable") { f.registry.join(f.other, pair.code) }
        assertEquals(listOf(f.task), f.registry.helper(f.helper, pair.pairId).tasks)
        assertEquals(pair.roomExpiresAt, f.registry.owner(f.owner, pair.pairId).expiresAt)
        f.clock.now = pair.roomExpiresAt
        failure(404, "pair_unavailable") { f.registry.helper(f.helper, pair.pairId) }
        failure(404, "pair_unavailable") { f.registry.owner(f.owner, pair.pairId) }
    }

    @Test fun `revocation removes all access immediately`() {
        val f = Fixture(); val (pair, _) = f.grant()
        f.registry.propose(f.helper, pair.pairId, ComfortChange(reach = 1.0))
        assertEquals("revoked", f.registry.revoke(f.owner, pair.pairId).state)
        failure(404, "pair_unavailable") { f.registry.helper(f.helper, pair.pairId) }
        failure(404, "pair_unavailable") { f.registry.owner(f.owner, pair.pairId) }
        failure(404, "invitation_unavailable") { f.registry.join(f.other, pair.code) }
    }

    @Test fun `an evicted owner session cannot leave an uncontrollable shared room`() {
        val clock = AssistClock(); val sessions = SessionRegistry(SessionLimits(maxActive = 2, perIpPerHour = 50), clock)
        val owner = sessions.create("owner"); clock.now++
        val helper = sessions.create("helper"); clock.now++
        val registry = AssistRegistry(sessions, clock, AssistLimits())
        val pair = registry.create(owner); val request = registry.join(helper, pair.code)
        registry.approve(owner, pair.pairId, request.requestId, false, listOf(SharedTask("k1", "Selected", "Doing")))
        sessions.create("next") // SessionRegistry evicts its oldest capability, the owner.
        failure(401, "session_expired") { registry.owner(owner, pair.pairId) }
        failure(404, "pair_unavailable") { registry.helper(helper, pair.pairId) }
    }

    @Test fun `join attempts are limited per session and globally and reset in a new minute`() {
        val f = Fixture(AssistLimits(joinPerSessionPerMinute = 2, joinGlobalPerMinute = 3)); val pair = f.pair()
        repeat(2) { failure(404, "invitation_unavailable") { f.registry.join(f.helper, "bad-code") } }
        failure(429, "join_limit") { f.registry.join(f.helper, pair.code) }
        failure(404, "invitation_unavailable") { f.registry.join(f.other, "bad-code") }
        val fourth = f.session()
        failure(429, "join_limit") { f.registry.join(fourth, pair.code) }
        f.clock.now = (f.clock.now / 60_000 + 1) * 60_000
        assertEquals("pending", f.registry.join(f.helper, pair.code).state)
    }

    @Test fun `room request grant and proposal limits bound temporary memory`() {
        val f = Fixture(AssistLimits(maxRooms = 2, maxRoomsPerOwner = 1, maxRequestsPerRoom = 2, maxGrantsPerRoom = 1, maxProposalsPerRoom = 2, maxPendingPerHelper = 1))
        val pair = f.pair()
        failure(429, "pair_limit") { f.pair() }
        val joined = f.registry.join(f.helper, pair.code); val otherJoin = f.registry.join(f.other, pair.code)
        assertEquals(joined.requestId, f.registry.join(f.helper, pair.code).requestId)
        failure(429, "request_limit") { f.registry.join(f.session(), pair.code) }
        f.registry.approve(f.owner, pair.pairId, joined.requestId, true, emptyList())
        failure(429, "grant_limit") { f.registry.approve(f.owner, pair.pairId, otherJoin.requestId, true, emptyList()) }
        val one = f.registry.propose(f.helper, pair.pairId, ComfortChange(scale = 1.1))
        failure(429, "proposal_limit") { f.registry.propose(f.helper, pair.pairId, ComfortChange(scale = 1.2)) }
        f.registry.resolve(f.owner, pair.pairId, one.proposalId, "discarded")
        val two = f.registry.propose(f.helper, pair.pairId, ComfortChange(scale = 1.2))
        f.registry.resolve(f.owner, pair.pairId, two.proposalId, "discarded")
        failure(429, "proposal_limit") { f.registry.propose(f.helper, pair.pairId, ComfortChange(scale = 1.3)) }
        f.registry.create(f.helper)
        failure(429, "pair_limit") { f.registry.create(f.other) }
    }

    @Test fun `configuration ranges finite numbers and selected task limits are validated before mutation`() {
        val f = Fixture(); val (pair, joined) = f.grant()
        for (change in listOf(ComfortChange(), ComfortChange(reach = 0.49), ComfortChange(reach = Double.NaN), ComfortChange(scale = Double.POSITIVE_INFINITY), ComfortChange(scale = 1.81), ComfortChange(side = "front"), ComfortChange(turnDeg = 19.0), ComfortChange(tiltDeg = 31.0))) {
            failure(400, "invalid_comfort") { f.registry.propose(f.helper, pair.pairId, change) }
        }
        assertTrue(f.registry.owner(f.owner, pair.pairId).proposals.isEmpty())
        for (tasks in listOf(List(13) { SharedTask("k$it", "Selected", "Doing") }, listOf(f.task, f.task), listOf(f.task.copy(title = "x".repeat(161))), listOf(f.task.copy(column = "Doing\nPrivate")))) {
            failure(400, "invalid_tasks") { f.registry.approve(f.owner, pair.pairId, joined.requestId, true, tasks) }
            assertEquals(listOf(f.task), f.registry.helper(f.helper, pair.pairId).tasks)
        }
    }
}

class AssistHttpTest {
    private val f = Fixture()
    private val mvc = MockMvcBuilders.standaloneSetup(AssistController(f.registry)).build()
    private fun call(method: HttpMethod, path: String, session: String? = f.owner, body: String? = null): MockHttpServletResponse {
        val request = request(method, "/api/assist$path")
        if (session != null) request.header("X-Session", session)
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body)
        return mvc.perform(request).andReturn().response
    }

    @Test fun `HTTP flow returns only selected data and no session capabilities`() {
        val created = call(HttpMethod.POST, "/pairs")
        assertEquals(200, created.status)
        assertEquals("no-store", created.getHeader("Cache-Control"))
        val pair = Json.parseToJsonElement(created.contentAsString).jsonObject
        val id = pair["pairId"]!!.jsonPrimitive.content; val code = pair["code"]!!.jsonPrimitive.content
        val joined = call(HttpMethod.POST, "/join", f.helper, """{"code":"$code"}""")
        assertEquals(200, joined.status)
        val requestId = Json.parseToJsonElement(joined.contentAsString).jsonObject["requestId"]!!.jsonPrimitive.content
        val pending = call(HttpMethod.GET, "/pairs/$id/helper", f.helper)
        assertFalse(Json.parseToJsonElement(pending.contentAsString).jsonObject.containsKey("tasks"))
        val approved = call(HttpMethod.POST, "/pairs/$id/approve", body = """{"requestId":"$requestId","allowConfiguration":true,"tasks":[{"id":"k1","title":"Selected task","column":"Doing"}]}""")
        assertEquals(200, approved.status)
        val shared = call(HttpMethod.GET, "/pairs/$id/helper", f.helper)
        val view = Json.parseToJsonElement(shared.contentAsString).jsonObject
        assertEquals(1, view["tasks"]!!.jsonArray.size)
        assertEquals("Selected task", view["tasks"]!!.jsonArray[0].jsonObject["title"]!!.jsonPrimitive.content)
        for (token in listOf(f.owner, f.helper, f.other)) assertFalse(shared.contentAsString.contains(token))
        val proposal = call(HttpMethod.POST, "/pairs/$id/proposals", f.helper, """{"comfort":{"reach":0.8,"side":"right"}}""")
        assertEquals(200, proposal.status)
        val proposalId = Json.parseToJsonElement(proposal.contentAsString).jsonObject["proposalId"]!!.jsonPrimitive.content
        assertEquals(200, call(HttpMethod.POST, "/pairs/$id/resolve", body = """{"proposalId":"$proposalId","outcome":"discarded"}""").status)
        assertEquals(200, call(HttpMethod.DELETE, "/pairs/$id").status)
        assertEquals(404, call(HttpMethod.GET, "/pairs/$id/helper", f.helper).status)
    }

    @Test fun `HTTP rejects unknown fields clinical payloads NaN numeric strings and excess size`() {
        val (pair, joined) = f.grant()
        val path = "/pairs/${pair.pairId}"
        assertEquals(401, call(HttpMethod.POST, "/join", null, "not json").status)
        assertEquals(401, call(HttpMethod.POST, "/pairs", "fake-session").status)
        assertEquals(403, call(HttpMethod.GET, "$path/owner", f.other).status)
        assertEquals(403, call(HttpMethod.GET, "$path/helper", f.other).status)
        assertEquals(400, call(HttpMethod.POST, "/pairs", body = """{"patient":"do not store"}""").status)
        assertEquals(400, call(HttpMethod.POST, "$path/approve", body = """{"requestId":"${joined.requestId}","allowConfiguration":true,"tasks":[{"id":"k1","title":"Task","column":"Doing","notes":"do not store"}]}""").status)
        for (body in listOf("""{"comfort":{"reach":"NaN"}}""", """{"comfort":{"reach":"1.0"}}""", """{"comfort":{"reach":null}}""", """{"comfort":{"reach":NaN}}""", """{"comfort":{"reach":1e309}}""", """{"comfort":{"pose":0.8}}""", """{"comfort":{"reach":0.8},"workspace":{}}""")) {
            val response = call(HttpMethod.POST, "$path/proposals", f.helper, body)
            assertEquals(400, response.status, body)
            assertFalse(response.contentAsString.contains("NaN"))
        }
        assertEquals(413, call(HttpMethod.POST, "/join", f.helper, """{"code":"${"x".repeat(AssistLimits.MAX_BODY_BYTES)}"}""").status)
        assertTrue(f.registry.owner(f.owner, pair.pairId).proposals.isEmpty())
    }
}

class AssistHelpTest {
    @Test fun `an approved helper calls for help and the owner follows the call to its end`() {
        val f = Fixture(); val (pair, joined) = f.grant(configuration = false)
        val call = f.registry.requestHelp(f.helper, pair.pairId)
        assertEquals("pending", call.state)
        // Asking again while a call is open is the same call: it cannot be used to pile up requests.
        assertEquals(call.helpId, f.registry.requestHelp(f.helper, pair.pairId).helpId)
        val owner = f.registry.owner(f.owner, pair.pairId)
        assertEquals(listOf(call.helpId), owner.help.map { it.helpId })
        assertEquals(joined.requestId, owner.help.single().requestId)
        assertEquals("pending", f.registry.helper(f.helper, pair.pairId).help?.state)
        failure(403, "owner_required") { f.registry.resolveHelp(f.helper, pair.pairId, call.helpId, "shown") }
        failure(400, "invalid_state") { f.registry.resolveHelp(f.owner, pair.pairId, call.helpId, "pending") }
        assertEquals("shown", f.registry.resolveHelp(f.owner, pair.pairId, call.helpId, "shown").state)
        assertEquals("shown", f.registry.helper(f.helper, pair.pairId).help?.state)
        assertEquals("done", f.registry.resolveHelp(f.owner, pair.pairId, call.helpId, "done").state)
        assertEquals("done", f.registry.helper(f.helper, pair.pairId).help?.state)
        failure(409, "help_resolved") { f.registry.resolveHelp(f.owner, pair.pairId, call.helpId, "dismissed") }
        failure(404, "help_unavailable") { f.registry.resolveHelp(f.owner, pair.pairId, "no-such-call", "done") }
    }

    @Test fun `a helper who is not approved, or who never joined, cannot call for help`() {
        val f = Fixture(); val pair = f.pair(); f.registry.join(f.helper, pair.code)
        failure(403, "not_approved") { f.registry.requestHelp(f.helper, pair.pairId) }
        failure(403, "helper_not_joined") { f.registry.requestHelp(f.other, pair.pairId) }
        failure(401, "session_expired") { f.registry.requestHelp(null, pair.pairId) }
        assertTrue(f.registry.owner(f.owner, pair.pairId).help.isEmpty())
        assertNull(f.registry.helper(f.helper, pair.pairId).help)
    }

    @Test fun `calls for help have a cooldown between them and a ceiling per room`() {
        val f = Fixture(AssistLimits(maxHelpPerRoom = 2, helpCooldownSeconds = 5)); val (pair, _) = f.grant()
        val first = f.registry.requestHelp(f.helper, pair.pairId)
        f.registry.resolveHelp(f.owner, pair.pairId, first.helpId, "dismissed")
        failure(429, "help_cooldown") { f.registry.requestHelp(f.helper, pair.pairId) }
        f.clock.now += 5_000
        val second = f.registry.requestHelp(f.helper, pair.pairId)
        assertNotEquals(first.helpId, second.helpId)
        f.registry.resolveHelp(f.owner, pair.pairId, second.helpId, "done")
        f.clock.now += 5_000
        failure(429, "help_limit") { f.registry.requestHelp(f.helper, pair.pairId) }
    }

    @Test fun `revoking the room ends the calls and a stranger sees none`() {
        val f = Fixture(); val (pair, _) = f.grant()
        f.registry.requestHelp(f.helper, pair.pairId)
        failure(403, "owner_required") { f.registry.owner(f.other, pair.pairId) }
        f.registry.revoke(f.owner, pair.pairId)
        failure(404, "pair_unavailable") { f.registry.requestHelp(f.helper, pair.pairId) }
    }
}

class AssistHelpHttpTest {
    private val f = Fixture()
    private val mvc = MockMvcBuilders.standaloneSetup(AssistController(f.registry)).build()
    private fun call(method: HttpMethod, path: String, session: String? = f.owner, body: String? = null): MockHttpServletResponse {
        val request = request(method, "/api/assist$path")
        if (session != null) request.header("X-Session", session)
        if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(body)
        return mvc.perform(request).andReturn().response
    }

    @Test fun `HTTP help flow reaches the owner and carries no data`() {
        val (pair, _) = f.grant()
        val path = "/pairs/${pair.pairId}"
        assertEquals(401, call(HttpMethod.POST, "$path/help", null).status)
        assertEquals(400, call(HttpMethod.POST, "$path/help", f.helper, """{"workspace":{"cards":[]}}""").status)
        val asked = call(HttpMethod.POST, "$path/help", f.helper)
        assertEquals(200, asked.status)
        assertEquals("no-store", asked.getHeader("Cache-Control"))
        val helpId = Json.parseToJsonElement(asked.contentAsString).jsonObject["helpId"]!!.jsonPrimitive.content
        val owner = Json.parseToJsonElement(call(HttpMethod.GET, "$path/owner").contentAsString).jsonObject
        assertEquals(helpId, owner["help"]!!.jsonArray.single().jsonObject["helpId"]!!.jsonPrimitive.content)
        assertEquals(403, call(HttpMethod.POST, "$path/help/resolve", f.helper, """{"helpId":"$helpId","state":"shown"}""").status)
        assertEquals(400, call(HttpMethod.POST, "$path/help/resolve", body = """{"helpId":"$helpId","state":"shown","extra":1}""").status)
        assertEquals(200, call(HttpMethod.POST, "$path/help/resolve", body = """{"helpId":"$helpId","state":"shown"}""").status)
        val helper = Json.parseToJsonElement(call(HttpMethod.GET, "$path/helper", f.helper).contentAsString).jsonObject
        assertEquals("shown", helper["help"]!!.jsonObject["state"]!!.jsonPrimitive.content)
        for (token in listOf(f.owner, f.helper, f.other)) assertFalse(call(HttpMethod.GET, "$path/helper", f.helper).contentAsString.contains(token))
    }
}
