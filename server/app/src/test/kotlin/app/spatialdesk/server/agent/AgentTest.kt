package app.spatialdesk.server.agent

import app.spatialdesk.shared.EngineResult
import app.spatialdesk.shared.NewCard
import app.spatialdesk.shared.Op
import app.spatialdesk.shared.Workspace
import app.spatialdesk.shared.WorkspaceEngine
import app.spatialdesk.shared.WorkspaceJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

private val clock = Clock.fixed(Instant.parse("2026-10-07T07:10:00Z"), ZoneOffset.UTC)

private fun steps(json: String): List<JsonObject> = Json.parseToJsonElement(json).jsonArray.map { it.jsonObject }

private val starter: Workspace = (
    WorkspaceEngine.applyAll(
        Workspace(),
        listOf(Op.CreateBoard("Getting started", cards = listOf(NewCard("Tap a card"), NewCard("Press Focus 25", column = "Doing")))),
        clock.millis().toDouble(),
    ) as EngineResult.Success
    ).state

/** A model that answers from a script, recording the feedback it gets. */
private class Scripted(vararg answers: ModelPlan) : PlanModel {
    private val queue = ArrayDeque(answers.toList())
    val feedback = mutableListOf<String?>()
    override fun propose(system: String, user: String, feedback: String?): ModelPlan {
        this.feedback += feedback
        return queue.removeFirst()
    }
}

class PlannerTest {
    private fun planner(model: PlanModel) = Planner(model, "test-model", clock)
    private fun request(intent: Intent = Intent.PlanMyDay, text: String? = "report and call Ana") = PlanRequest(intent, text, starter)

    @Test
    fun `a valid plan passes, and the obvious slips are normalised instead of retried`() {
        val model = Scripted(
            ModelPlan(
                "Your day.",
                steps(
                    """
                    [{"op":"create_board","title":"Today","cards":[{"title":"Write report","column":"Doing","minutes":90},{"title":"Gym at 18:00","minutes":0}],"why":"One board"},
                     {"op":"add_card","title":"Call Ana","why":"No board given: the board just created"},
                     {"op":"start_timer","minutes":1440,"card":"Write report","why":"A day-long timer becomes a pomodoro"},
                     {"op":"arrange_space","layout":"focus","why":"Focus"}]
                    """,
                ),
            ),
        )
        val response = planner(model).plan(request())
        assertTrue(response.ok, response.error)
        assertEquals("test-model", response.source)
        assertEquals(1, response.attempts)
        assertEquals("Today", response.steps[1].op["board"]?.jsonPrimitive?.content)
        assertEquals("25", response.steps[2].op["minutes"]?.jsonPrimitive?.content)
        val gym = response.steps[0].op["cards"]!!.jsonArray[1].jsonObject
        assertFalse("minutes" in gym, "an estimate of 0 is dropped")
        assertTrue(response.steps.none { "why" in it.op }, "why travels beside the op, never inside it")
    }

    @Test
    fun `a rejected plan goes back once with the exact error, then passes`() {
        val model = Scripted(
            ModelPlan("Move it.", steps("""[{"op":"move_card","card":"Nope","column":"Done","why":"x"}]""")),
            ModelPlan("Move it.", steps("""[{"op":"move_card","card":"Tap a card","column":"Done","why":"Finished"}]""")),
        )
        val response = planner(model).plan(request(Intent.Custom, "done with tapping"))
        assertTrue(response.ok)
        assertEquals(2, response.attempts)
        assertTrue(model.feedback[1]!!.startsWith("Step 1 (move_card) was rejected: No card called 'Nope'"), model.feedback[1])
    }

    @Test
    fun `two bad plans, or no AI at all, fall back to the built-in planner and say so`() {
        val bad = ModelPlan("x", steps("""[{"op":"delete_board","board":"Getting started","why":"tidy"}]"""))
        val twice = planner(Scripted(bad, bad)).plan(request())
        assertTrue(twice.ok)
        assertEquals(Planner.BUILT_IN, twice.source)
        assertTrue(twice.note!!.contains("did not pass validation"))

        val offline = planner { _, _, _ -> throw AiUnavailableException("The AI service is busy") }.plan(request())
        assertTrue(offline.ok)
        assertEquals("The AI service is busy, so the built-in planner made this plan.", offline.note)
    }

    @Test
    fun `the agent may not delete boards or move panels`() {
        val model = Scripted(
            ModelPlan("x", steps("""[{"op":"delete_board","board":"Getting started","why":"x"}]""")),
            ModelPlan("Fine.", steps("""[{"op":"clear_done","why":"Tidy"}]""")),
        )
        planner(model).plan(request(Intent.ClearDone, null))
        assertTrue(model.feedback[1]!!.contains("'delete_board', which is not allowed"))
    }

    @Test
    fun `field mix-ups seen from Nova are read the one sensible way`() {
        val normalised = Normaliser(starter).normalise(
            steps(
                """
                [{"op":"move_card","title":"Tap a card","column":"Doing","index":-2,"why":"card named in title"},
                 {"op":"focus_board","why":"no board: nothing to do"},
                 {"op":"move_card","card":"Press Focus 25","board":"Getting started","column":"Someday","why":"board lacks the column"}]
                """,
            ),
        ).map { it.first }
        assertEquals(2, normalised.size, "focus_board without a board is dropped")
        assertEquals("Tap a card", normalised[0]["card"]?.jsonPrimitive?.content)
        assertFalse("title" in normalised[0])
        assertEquals("0", normalised[0]["index"]?.jsonPrimitive?.content)
        assertFalse("board" in normalised[1], "a board without that column was the source, not the target")
    }

    @Test
    fun `summarise needs no steps`() {
        val response = planner(Scripted(ModelPlan("Two open cards.", emptyList()))).plan(request(Intent.Summarise, null))
        assertTrue(response.ok)
        assertTrue(response.steps.isEmpty())
        assertEquals("Two open cards.", response.summary)
    }

    @Test
    fun `the built-in planner turns a sentence into a day, in English or Spanish`() {
        val plan = BuiltInPlanner().plan(request(text = "informe trimestral, llamar a Ana y gimnasio a las 18:00"))
        val board = plan.steps.first()
        assertEquals("create_board", board["op"]?.jsonPrimitive?.content)
        assertEquals(3, (board["cards"] as JsonArray).size)
        assertEquals(listOf("create_board", "start_timer", "arrange_space"), plan.steps.map { it["op"]?.jsonPrimitive?.content })
    }

    @Test
    fun `the prompt describes the workspace compactly, focus board first`() {
        val text = Prompt.user(PlanRequest(Intent.PlanMyDay, "x", starter, "Tuesday 2026-10-07 09:10"))
        assertTrue(text.startsWith("Local time: Tuesday 2026-10-07 09:10."))
        assertTrue("1. \"Getting started\" [focus board] columns: \"To do\" (1 cards: \"Tap a card\")" in text, text)
        assertTrue("Room for 3 more boards and 3 more timers." in text)
    }
}

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["spatialdesk.agent.mode=built-in", "spatialdesk.agent.per-session-per-hour=2"],
)
class AgentApiTest {
    @LocalServerPort
    private var port: Int = 0
    private val http = HttpClient.newHttpClient()

    private fun send(path: String, body: String?, session: String? = null): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI.create("http://localhost:$port$path"))
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.0.2.${(1..250).random()}, 10.0.0.1")
        session?.let { builder.header("X-Session", it) }
        builder.POST(body?.let { HttpRequest.BodyPublishers.ofString(it) } ?: HttpRequest.BodyPublishers.noBody())
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun session(): String = Regex("\"sessionId\":\"([^\"]+)\"").find(send("/api/sessions", null).body())!!.groupValues[1]

    private val body = WorkspaceJson.encodeToString(PlanRequest.serializer(), PlanRequest(Intent.PlanMyDay, "report and call Ana", starter))

    @Test
    fun `a plan needs a live session, and is validated end to end`() {
        assertEquals(401, send("/api/agent/plan", body).statusCode())
        val res = send("/api/agent/plan", body, session())
        assertEquals(200, res.statusCode(), res.body())
        val plan = WorkspaceJson.decodeFromString(PlanResponse.serializer(), res.body())
        assertTrue(plan.ok)
        assertEquals(Planner.BUILT_IN, plan.source)
        assertEquals("create_board", plan.steps.first().op["op"]?.jsonPrimitive?.content)
    }

    @Test
    fun `quotas and malformed input get clear answers`() {
        val id = session()
        assertEquals(400, send("/api/agent/plan", "{not json", id).statusCode())
        assertEquals(200, send("/api/agent/plan", body, id).statusCode())
        assertEquals(200, send("/api/agent/plan", body, id).statusCode())
        val third = send("/api/agent/plan", body, id)
        assertEquals(429, third.statusCode())
        assertTrue("plans this hour" in third.body())
    }
}
