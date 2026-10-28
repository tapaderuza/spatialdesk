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
    val systems = mutableListOf<String>()
    override fun propose(system: String, user: String, feedback: String?): ModelPlan {
        this.feedback += feedback
        systems += system
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
        assertEquals("true", response.steps[0].op["focus"]?.jsonPrimitive?.content, "the board the agent creates comes within reach")
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
    fun `what just happened reaches the prompt, and the next block skips the card that just ended`() {
        val request = PlanRequest(Intent.NextBlock, null, starter, context = "The 25-minute timer on \"Press Focus 25\" just finished.")
        assertTrue("What just happened: The 25-minute timer on \"Press Focus 25\" just finished." in Prompt.user(request))
        val plan = BuiltInPlanner().plan(request)
        val timer = plan.steps.first { it["op"]?.jsonPrimitive?.content == "start_timer" }
        assertEquals("c5", timer["card"]?.jsonPrimitive?.content, "not c6, the card whose block just ended")
        assertTrue(planner(Scripted(ModelPlan("Tidy already.", emptyList()))).plan(PlanRequest(Intent.Regroup, null, starter)).ok, "regroup may change nothing")
    }

    @Test
    fun `guardrails - an unfinished card never goes to Done, and a replan starts no timers`() {
        val now = clock.millis().toDouble()
        val ws = (
            WorkspaceEngine.applyAll(
                Workspace(),
                listOf(Op.CreateBoard("Today", cards = listOf(NewCard("Write report", column = "Doing", minutes = 120), NewCard("Call Ana", minutes = 15)))),
                now - 25 * 60_000,
            ) as EngineResult.Success
            ).state
        val next = PlanRequest(Intent.NextBlock, null, ws, context = "The 25-minute timer on \"Write report\" just finished.")
        assertTrue("\"Write report\" has used 25 of its 120 estimated minutes" in Prompt.user(next, now, Guardrails.facts(next, now).lines))

        val model = Scripted(
            ModelPlan("Done.", steps("""[{"op":"move_card","card":"Write report","column":"Done","why":"Timer ended"}]""")),
            ModelPlan("Break.", steps("""[{"op":"start_timer","minutes":5,"label":"Break","why":"Rest"}]""")),
        )
        val response = planner(model).plan(next)
        assertTrue(response.ok)
        assertEquals(2, response.attempts)
        assertTrue(model.feedback[1]!!.contains("is not finished"), model.feedback[1])

        val replanModel = Scripted(
            ModelPlan("x", steps("""[{"op":"start_timer","minutes":25,"card":"Call Ana","why":"x"}]""")),
            ModelPlan("y", steps("""[{"op":"update_card","card":"Call Ana","priority":"high","why":"Quick win first"}]""")),
        )
        planner(replanModel).plan(PlanRequest(Intent.Replan, null, ws, context = "\"Write report\" is running over."))
        assertTrue(replanModel.feedback[1]!!.contains("never starts timers"), replanModel.feedback[1])

        val offline = planner { _, _, _ -> throw AiUnavailableException("The AI service is busy") }.plan(next)
        assertEquals("Break", offline.steps.single().op["label"]?.jsonPrimitive?.content, "the built-in planner also suggests the break")
    }

    @Test
    fun `wrap up clears the day's done work, names it, and never starts anything`() {
        val day = (
            WorkspaceEngine.applyAll(starter, listOf(Op.AddCard("Getting started", "Write the report", column = "Done")), clock.millis().toDouble())
                as EngineResult.Success
            ).state
        val wrap = PlanRequest(Intent.WrapUp, null, day, context = "Today: 3 focus blocks, 75 min, 1 cards done.")
        // A model that starts a timer at the end of the day is sent back; the second plan passes.
        val model = Scripted(
            ModelPlan("Good day.", steps("""[{"op":"clear_done","board":"Getting started","why":"Done"},{"op":"start_timer","minutes":25,"why":"One more"}]""")),
            ModelPlan("You finished the report. Tomorrow starts with Press Focus 25.", steps("""[{"op":"clear_done","board":"Getting started","why":"Today's work, cleared away"}]""")),
        )
        val response = planner(model).plan(wrap)
        assertTrue(response.ok, response.error)
        assertEquals(2, response.attempts)
        assertTrue(model.feedback[1]!!.contains("never starts timers"), model.feedback[1])
        // Without the AI, the built-in planner wraps up the same way and says what got done and what comes next.
        val builtIn = BuiltInPlanner().plan(wrap)
        assertEquals(listOf("clear_done"), builtIn.steps.map { it["op"]!!.jsonPrimitive.content })
        assertTrue("\"Write the report\"" in builtIn.summary && "Tomorrow starts with \"Press Focus 25\"" in builtIn.summary, builtIn.summary)
        // A day with nothing done needs no steps, only kind words.
        assertTrue(planner(Scripted(ModelPlan("A quiet day. Tomorrow starts with Press Focus 25.", emptyList()))).plan(PlanRequest(Intent.WrapUp, null, starter)).ok)
    }

    @Test
    fun `a wrap-up may not call open work finished, as Nova once did`() {
        val day = (
            WorkspaceEngine.applyAll(
                starter,
                listOf(Op.AddCard("Getting started", "Finish the quarterly report", column = "Doing"), Op.AddCard("Getting started", "Call the dentist", column = "Done")),
                clock.millis().toDouble(),
            ) as EngineResult.Success
            ).state
        val wrap = PlanRequest(Intent.WrapUp, null, day)
        val facts = Guardrails.facts(wrap, clock.millis().toDouble()).lines
        assertTrue(facts.any { "NOT finished" in it && "\"Finish the quarterly report\"" in it }, facts.toString())
        // Nova 2 Lite's words on 2026-10-23, with the report still in progress: sent back; the honest summary passes.
        val clear = steps("""[{"op":"clear_done","board":"Getting started","why":"Today's work, cleared away"}]""")
        val model = Scripted(
            ModelPlan("Today you finished the quarterly report and two other tasks. Tomorrow starts with the slides.", clear),
            ModelPlan("Today you finished the dentist call, and the quarterly report is still in progress. Tomorrow starts there.", clear),
        )
        val response = planner(model).plan(wrap)
        assertTrue(response.ok, response.error)
        assertEquals(2, response.attempts)
        assertTrue(model.feedback[1]!!.startsWith("The summary says \"Finish the quarterly report\" is finished"), model.feedback[1])
        assertEquals(null, SummaryCheck.violation(wrap, "Tomorrow, finish the quarterly report first."))
    }

    @Test
    fun `adapting the space to the body uses set_comfort only, one need per step, and reads plain words without the AI`() {
        val now = clock.millis().toDouble()
        val adapt = PlanRequest(Intent.AdaptSpace, "I can't turn my neck and I only use my right hand", starter)
        assertTrue("Current comfort" in Prompt.user(adapt, now, Guardrails.facts(adapt, now).lines))
        // A model that also rearranges the boards is sent back; its slips (a nested comfort, "Right", a reach of 0.3)
        // are read the safe way.
        val model = Scripted(
            ModelPlan("Done.", steps("""[{"op":"set_comfort","turnDeg":25,"why":"No neck turn"},{"op":"arrange_space","layout":"focus","why":"Tidy"}]""")),
            ModelPlan(
                "Adapted.",
                steps(
                    """[{"op":"set_comfort","comfort":{"side":"Right"},"why":"Your right side"},{"op":"set_comfort","reach":"0.3","why":"Close"},
                    {"op":"set_comfort","turnDeg":25,"why":"No neck turn"}]""",
                ),
            ),
        )
        val response = planner(model).plan(adapt)
        assertTrue(response.ok, response.error)
        assertEquals(2, response.attempts)
        assertTrue(model.feedback[1]!!.contains("only uses set_comfort"), model.feedback[1])
        assertEquals("right", response.steps[0].op["side"]?.jsonPrimitive?.content)
        assertEquals(0.5, response.steps[1].op["reach"]?.jsonPrimitive?.content?.toDouble())
        // Comfort never changes in a plan that was not about the body.
        val sneaky = Scripted(
            ModelPlan("x", steps("""[{"op":"set_comfort","scale":1.5,"why":"x"}]""")),
            ModelPlan("y", steps("""[{"op":"start_timer","minutes":25,"why":"y"}]""")),
        )
        planner(sneaky).plan(request(Intent.Focus, null))
        assertTrue(sneaky.feedback[1]!!.contains("only when the user asks about their body"), sneaky.feedback[1])
        // Without the AI: plain words, English or Spanish, one step per need; words it cannot read get a question.
        val fields = { plan: ModelPlan -> plan.steps.map { s -> s.filterKeys { it != "op" && it != "why" }.mapValues { it.value.jsonPrimitive.content } } }
        assertEquals(listOf(mapOf("turnDeg" to "25.0"), mapOf("side" to "right")), fields(BuiltInPlanner().plan(adapt)))
        assertEquals(listOf(mapOf("scale" to "1.4"), mapOf("reach" to "1.4")), fields(BuiltInPlanner().plan(PlanRequest(Intent.AdaptSpace, "Tengo la vista cansada", starter))))
        val unclear = planner { _, _, _ -> throw AiUnavailableException("busy") }.plan(PlanRequest(Intent.AdaptSpace, "hmm", starter))
        assertTrue(unclear.ok && unclear.steps.isEmpty() && "Tell me what is hard" in unclear.summary!!, unclear.summary)
    }

    @Test
    fun `help me start - five minutes on the task's first bit, then the momentum is kept instead of a break`() {
        val now = clock.millis().toDouble()
        val ws = (
            WorkspaceEngine.applyAll(
                Workspace(),
                listOf(Op.CreateBoard("Today", cards = listOf(NewCard("Write the quarterly report", minutes = 120), NewCard("Call the dentist", column = "Doing", minutes = 10)))),
                now,
            ) as EngineResult.Success
            ).state
        val start = PlanRequest(Intent.FirstStep, "the report", ws)
        assertEquals("Write the quarterly report", Guardrails.facts(start, now).start?.title, "the card the user named, not the one in progress")
        // A model that starts a full pomodoro is sent back; the label always says it is a first step.
        val model = Scripted(
            ModelPlan("Go.", steps("""[{"op":"start_timer","minutes":25,"card":"Write the quarterly report","why":"Focus"}]""")),
            ModelPlan(
                "Open it and write three headings.",
                steps(
                    """[{"op":"move_card","card":"Write the quarterly report","column":"Doing","index":0,"why":"Now in progress"},
                    {"op":"start_timer","minutes":5,"card":"Write the quarterly report","label":"open the doc, write 3 headings","why":"Just five minutes"}]""",
                ),
            ),
        )
        val response = planner(model).plan(start)
        assertTrue(response.ok, response.error)
        assertTrue(model.feedback[1]!!.contains("a first step is 5 minutes"), model.feedback[1])
        assertEquals("First step: open the doc, write 3 headings", response.steps[1].op["label"]?.jsonPrimitive?.content)
        // Without the AI: the same shape.
        val builtIn = planner { _, _, _ -> throw AiUnavailableException("busy") }.plan(start)
        assertEquals(listOf("move_card", "start_timer"), builtIn.steps.map { it.op["op"]!!.jsonPrimitive.content })
        assertTrue(builtIn.steps[1].op["label"]!!.jsonPrimitive.content.startsWith("First step"))

        // When the first step ends the user has started: 25 more minutes, never a break.
        val started = (WorkspaceEngine.applyAll(ws, listOf(Op.MoveCard("Write the quarterly report", "Doing", index = 0)), now - 5 * 60_000) as EngineResult.Success).state
        val next = PlanRequest(
            Intent.NextBlock,
            null,
            started,
            context = "The 5-minute first step \"First step: open the doc\" on \"Write the quarterly report\" just finished: the user has started.",
        )
        val momentum = Scripted(
            ModelPlan("Break.", steps("""[{"op":"start_timer","minutes":5,"label":"Break","why":"Rest"}]""")),
            ModelPlan("Keep going.", steps("""[{"op":"start_timer","minutes":25,"card":"Write the quarterly report","why":"While you are warm"}]""")),
        )
        assertTrue(planner(momentum).plan(next).ok)
        assertTrue(momentum.feedback[1]!!.contains("keep the momentum"), momentum.feedback[1])
        val offline = planner { _, _, _ -> throw AiUnavailableException("busy") }.plan(next)
        assertEquals("25", offline.steps.single().op["minutes"]?.jsonPrimitive?.content)
    }

    @Test
    fun `the tool Nova is given offers exactly the ops the server accepts`() {
        // Measured on 2026-10-23: set_comfort was accepted here but missing from the tool, so Nova could not write it.
        val items = NovaPlanModel.SCHEMA["properties"]!!.jsonObject["steps"]!!.jsonObject["items"]!!.jsonObject["properties"]!!.jsonObject
        assertEquals(Planner.AGENT_OPS, items["op"]!!.jsonObject["enum"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet())
        for (field in listOf("reach", "scale", "side", "turnDeg", "tiltDeg")) assertTrue(field in items, "set_comfort's $field")
        // Her words, read without the AI: nearer (not further), on the right, larger, within a small turn.
        val her = BuiltInPlanner().plan(PlanRequest(Intent.AdaptSpace, "Hoy me duele mucho el cuello y estoy cansada. Acércalo todo por la derecha y la letra más grande, por favor.", starter))
        val fields = her.steps.map { s -> s.filterKeys { it != "op" && it != "why" }.mapValues { it.value.jsonPrimitive.content } }
        assertEquals(listOf(mapOf("turnDeg" to "25.0"), mapOf("side" to "right"), mapOf("scale" to "1.4"), mapOf("reach" to "0.75")), fields)

        // Nova's answer to her on 2026-10-23 covered two of her four needs: sent back once, naming what is missing.
        val request = PlanRequest(Intent.AdaptSpace, "Hoy me duele mucho el cuello y estoy cansada. Acércalo todo por la derecha y la letra más grande, por favor.", starter)
        val now = clock.millis().toDouble()
        assertTrue(Guardrails.facts(request, now).lines.any { "The user asked for: their neck (turnDeg), the right side (side), larger text (scale), everything closer (reach)" in it })
        val model = Scripted(
            ModelPlan("Right side, larger text.", steps("""[{"op":"set_comfort","side":"right","why":"Right"},{"op":"set_comfort","scale":1.3,"why":"Larger"}]""")),
            ModelPlan(
                "All four.",
                steps(
                    """[{"op":"set_comfort","turnDeg":25,"why":"Neck"},{"op":"set_comfort","side":"right","why":"Right"},
                    {"op":"set_comfort","reach":0.75,"why":"Closer"},{"op":"set_comfort","scale":1.3,"why":"Larger"}]""",
                ),
            ),
        )
        val response = planner(model).plan(request)
        assertTrue(response.ok && response.source == "test-model", response.note ?: response.error)
        assertTrue(model.feedback[1]!!.startsWith("The plan leaves out what the user asked for: their neck (turnDeg), everything closer (reach)"), model.feedback[1])
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

    @Test
    fun `the companion answers in the language the user spoke, not the language of its examples`() {
        // Nova once answered every English sentence in Spanish, copying the examples, which were all Spanish.
        assertTrue("English words get an English answer, Spanish words a Spanish one" in Prompt.SYSTEM)
        assertTrue("User: \"I'm not comfortable\" -> {\"summary\":\"What is harder right now" in Prompt.SYSTEM)
        assertTrue("User: \"No estoy cómoda\"" in Prompt.SYSTEM)
    }

    @Test
    fun `what the eyes rest on is marked in the workspace, and only then do the rules say how to read "this"`() {
        val board = starter.boards.single()
        val card = board.columns.flatMap { it.cards }.first { it.title == "Tap a card" }
        val looking = PlanRequest(Intent.Companion, "move this to done", starter, attention = Attention(board = board.id, card = card.id))
        assertTrue("\"Tap a card\" [looked at]" in Prompt.user(looking), Prompt.user(looking))
        assertEquals(1, Regex(Regex.escape(Prompt.LOOKED_AT)).findAll(Prompt.user(looking)).count(), "the card only, not its board too")
        assertTrue(Prompt.system(looking).startsWith(Prompt.SYSTEM) && Prompt.GAZE_RULE in Prompt.system(looking))
        // The model is given both.
        val model = Scripted(ModelPlan("I can move it to Done.", emptyList()), ModelPlan("I can move it to Done.", emptyList()))
        planner(model).plan(looking)
        assertTrue(model.systems.isNotEmpty() && model.systems.all { Prompt.GAZE_RULE in it })
        // A board, a column, a timer.
        assertTrue("\"Getting started\" [looked at]" in Prompt.user(looking.copy(attention = Attention(board = board.id))))
        assertTrue("\"Doing\" [looked at] (" in Prompt.user(looking.copy(attention = Attention(column = board.columns[1].id))))
        // Nothing looked at, or an id that is not in the workspace (stale, or invented): the plain rules, no mark.
        for (none in listOf(null, Attention(card = "c999"), Attention(timer = "t9"), Attention())) {
            val request = looking.copy(attention = none)
            assertEquals(Prompt.SYSTEM, Prompt.system(request))
            assertFalse(Prompt.LOOKED_AT in Prompt.user(request))
        }
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
