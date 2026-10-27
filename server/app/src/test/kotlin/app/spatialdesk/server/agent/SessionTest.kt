package app.spatialdesk.server.agent

import app.spatialdesk.shared.*
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.Clock

class SessionTest {
    private val workspace = (WorkspaceEngine.applyAll(Workspace(), listOf(
        Op.CreateBoard("Today", cards = listOf(NewCard("Check the bill", minutes = 10), NewCard("Review the letter", column = "Doing", minutes = 30), NewCard("Finished task", column = "Done"))),
    ), 0.0) as EngineResult.Success).state
    private fun request(minutes: Int = 10, energy: String = "low") = PlanRequest(Intent.Session, workspace = workspace, sessionChoice = SessionChoice(minutes, energy))
    private fun op(text: String) = Json.parseToJsonElement(text).jsonObject
    private fun planner(model: PlanModel) = Planner(model, "test-model", Clock.systemUTC())

    @Test fun `time and energy are mandatory validated inputs before any model call`() {
        val p = planner { _, _, _ -> error("must not call") }
        assertFalse(p.plan(request().copy(sessionChoice = null)).ok)
        assertFalse(p.plan(request(2)).ok)
        assertFalse(p.plan(request(120)).ok)
        assertFalse(p.plan(request(15, "inferred-stress")).ok)
    }

    @Test fun `one short block on a real task passes and receives a stable end-of-session label`() {
        var prompt = ""
        val p = planner { _, user, _ ->
            prompt = user
            ModelPlan("I can start with checking the amount on the bill, for five minutes.", listOf(
                op("""{"op":"move_card","card":"Check the bill","column":"Doing","why":"One task"}"""),
                op("""{"op":"start_timer","card":"Check the bill","minutes":5,"label":"Not a break","why":"Five minutes"}"""),
            ))
        }
        val response = p.plan(request())
        assertTrue(response.ok, response.error)
        assertEquals("test-model", response.source)
        assertTrue(prompt.contains("10 available minutes and low energy"))
        assertEquals("Session: Check the bill", response.steps.last().op["label"]?.jsonPrimitive?.content)
        assertEquals(0, workspace.timers.size, "a proposal cannot start anything")
    }

    @Test fun `an overlong low-energy proposal is rejected and the honest fallback stays within five minutes`() {
        val p = planner { _, _, _ -> ModelPlan("Work for half an hour", listOf(op("""{"op":"start_timer","card":"Check the bill","minutes":30}"""))) }
        val response = p.plan(request(15, "low"))
        assertTrue(response.ok, response.error)
        assertEquals("built-in", response.source)
        assertEquals(2, response.attempts)
        assertEquals("5", response.steps.single { it.op["op"]?.jsonPrimitive?.content == "start_timer" }.op["minutes"]?.jsonPrimitive?.content)
    }

    @Test fun `a steady session still cannot exceed the user's ten available minutes`() {
        val response = planner { _, _, _ -> ModelPlan("A pomodoro", listOf(op("""{"op":"start_timer","card":"Check the bill","minutes":25}"""))) }.plan(request(10, "steady"))
        assertTrue(response.ok, response.error)
        assertEquals("built-in", response.source)
        assertEquals("10", response.steps.single { it.op["op"]?.jsonPrimitive?.content == "start_timer" }.op["minutes"]?.jsonPrimitive?.content)
    }

    @Test fun `sessions never complete cards or create tasks`() {
        val req = request()
        for (bad in listOf(
            """{"op":"move_card","card":"Check the bill","column":"Done"}""",
            """{"op":"create_board","title":"Invented work"}""",
            """{"op":"set_comfort","reach":0.8}""",
        )) {
            val response = planner { _, _, _ -> ModelPlan("Bad proposal", listOf(op(bad), op("""{"op":"start_timer","card":"Check the bill","minutes":5}"""))) }.plan(req)
            assertTrue(response.ok, response.error)
            assertEquals("built-in", response.source)
            assertFalse(response.steps.any { it.op["column"]?.jsonPrimitive?.content == "Done" || it.op["op"]?.jsonPrimitive?.content in setOf("create_board", "set_comfort") })
        }
    }

    @Test fun `a finished or invented task cannot receive the session timer`() {
        for (name in listOf("Finished task", "Imaginary task")) {
            val response = planner { _, _, _ -> ModelPlan("Use this", listOf(op("""{"op":"start_timer","card":"$name","minutes":5}"""))) }.plan(request())
            assertTrue(response.ok, response.error)
            assertEquals("built-in", response.source)
            assertFalse(response.steps.any { it.op["card"]?.jsonPrimitive?.content == name })
        }
    }

    @Test fun `an empty workspace asks for real tasks instead of inventing them`() {
        val response = planner { _, _, _ -> ModelPlan("Add your tasks with Plan my day first.", emptyList()) }.plan(request().copy(workspace = Workspace()))
        assertTrue(response.ok)
        assertTrue(response.steps.isEmpty())
    }

    @Test fun `a session never interrupts a running timer or starts a parallel block`() {
        val busy = (WorkspaceEngine.applyAll(workspace, listOf(Op.StartTimer(25.0, label = "Current block")), 0.0) as EngineResult.Success).state
        val response = planner { _, _, _ -> ModelPlan("Add another", listOf(op("""{"op":"start_timer","card":"Check the bill","minutes":5}"""))) }.plan(request().copy(workspace = busy))
        assertTrue(response.ok, response.error)
        assertEquals("built-in", response.source)
        assertTrue(response.steps.isEmpty())
        assertEquals(1, busy.timers.size)
    }

    @Test fun `a repeated task title cannot attach a timer to the wrong card`() {
        val duplicate = workspace.copy(boards = workspace.boards.map { b -> b.copy(columns = b.columns.mapIndexed { i, c ->
            if (i == 2) c.copy(cards = c.cards.map { it.copy(title = "Check the bill") }) else c
        }) })
        val response = planner { _, _, _ -> ModelPlan("Use this", listOf(op("""{"op":"start_timer","card":"Check the bill","minutes":5}"""))) }.plan(request().copy(workspace = duplicate))
        assertTrue(response.ok, response.error)
        assertEquals("built-in", response.source)
        assertEquals(duplicate.boards[0].columns[0].cards[0].id, response.steps.last().op["card"]?.jsonPrimitive?.content)
    }
}
