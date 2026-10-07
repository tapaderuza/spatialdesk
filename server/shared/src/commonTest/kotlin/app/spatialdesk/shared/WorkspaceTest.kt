package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

class WorkspaceTest {
    private val now = 1_800_000_000_000.0

    private fun Workspace.run(vararg ops: Op, at: Double = now, viewer: Pose? = null): Workspace =
        when (val r = WorkspaceEngine.applyAll(this, ops.toList(), at, viewer)) {
            is EngineResult.Success -> r.state
            is EngineResult.Failure -> fail("op ${r.opIndex} failed: ${r.error}")
        }

    private fun Workspace.refuse(vararg ops: Op, at: Double = now): EngineResult.Failure =
        assertIs<EngineResult.Failure>(WorkspaceEngine.applyAll(this, ops.toList(), at))

    private fun Workspace.titles(board: String, column: String): List<String> =
        boards.first { it.title == board }.columns.first { it.title == column }.cards.map { it.title }

    private val today = Op.CreateBoard(
        "Today",
        cards = listOf(NewCard("Write report", minutes = 50), NewCard("Review PR", column = "Doing"), NewCard("Email Ana", column = "done")),
    )

    @Test
    fun `the first board is the focus board, within arm's reach and facing the user`() {
        val ws = Workspace().run(today)
        val board = ws.boards.single()
        assertEquals("b1", board.id)
        assertEquals(board.id, ws.focusBoardId)
        assertEquals(listOf("Write report"), ws.titles("Today", "To do"))
        assertEquals(listOf("Email Ana"), ws.titles("Today", "Done")) // column titles match case-insensitively

        val eye = ws.anchor
        val reach = hypot(board.pose.x - eye.x, board.pose.z - eye.z)
        assertTrue(reach in 0.55..0.65, "focus board at $reach m")
        assertTrue(board.pose.y < eye.y, "below eye level")
        // Panels face +Z: the yaw that points one at the eyes is atan2(dx, dz) from the panel to the eyes.
        assertEquals(atan2(eye.x - board.pose.x, eye.z - board.pose.z), board.pose.yaw, 1e-9)
        assertTrue(board.pose.pitch < 0, "leans back toward the eyes")
    }

    @Test
    fun `a new focus board swaps the old one out to a free parked slot`() {
        val ws = Workspace().run(today, Op.CreateBoard("Errands"), Op.CreateBoard("Launch", focus = true))
        assertEquals("Launch", ws.boards.first { it.id == ws.focusBoardId }.title)
        val poses = ws.boards.map { it.pose }
        assertEquals(3, poses.distinct().size, "no two boards in the same slot")
        assertTrue(ws.boards.filter { it.id != ws.focusBoardId }.all { hypot(it.pose.x, it.pose.z) > 1.2 }, "others parked further out")

        val swapped = ws.run(Op.FocusBoard("today"))
        val today = swapped.boards.first { it.title == "Today" }
        val launch = swapped.boards.first { it.title == "Launch" }
        assertEquals(ws.boards.first { it.title == "Launch" }.pose, today.pose)
        assertEquals(ws.boards.first { it.title == "Today" }.pose, launch.pose)
    }

    @Test
    fun `cards move by id or title, snap to an index, and respect column limits`() {
        var ws = Workspace().run(today)
        ws = ws.run(Op.MoveCard("write report", column = "Doing", index = 0))
        assertEquals(listOf("Write report", "Review PR"), ws.titles("Today", "Doing"))
        ws = ws.run(Op.MoveCard("c6", column = "Doing", index = 99)) // c6 = "Review PR"; the index is clamped
        assertEquals(listOf("Write report", "Review PR"), ws.titles("Today", "Doing"))

        val full = (1..Limits.CARDS_PER_COLUMN).fold(Workspace().run(Op.CreateBoard("Big"))) { acc, i -> acc.run(Op.AddCard("Big", "Task $i")) }
        val refused = full.refuse(Op.AddCard("Big", "One too many"))
        assertTrue("full" in refused.error, refused.error)
    }

    @Test
    fun `a batch is atomic and names the failing action`() {
        val ws = Workspace().run(today)
        val refused = ws.refuse(Op.AddCard("Today", "Fine"), Op.MoveCard("Nope", column = "Done"), Op.AddCard("Today", "Never"))
        assertEquals(1, refused.opIndex)
        assertTrue("No card called 'Nope'" in refused.error)
        assertEquals(3, ws.boards.single().columns.sumOf { it.cards.size }, "nothing applied")
    }

    @Test
    fun `limits give the agent a clear no`() {
        val four = Workspace().run(*(1..Limits.BOARDS).map { Op.CreateBoard("Board $it") }.toTypedArray())
        assertTrue("at most" in four.refuse(Op.CreateBoard("Fifth")).error)
        assertTrue("already" in Workspace().run(Op.CreateBoard("Board 1")).refuse(Op.CreateBoard("board 1")).error)
        assertTrue("columns" in Workspace().refuse(Op.CreateBoard("Wide", columns = List(5) { "C$it" })).error)
        assertTrue("empty" in Workspace().refuse(Op.CreateBoard("   ")).error)
        val long = Workspace().run(Op.CreateBoard("x".repeat(200))).boards.single().title
        assertEquals(Limits.TITLE_CHARS, long.length)
        assertTrue(long.endsWith("..."))
    }

    @Test
    fun `timers run, pause, resume, finish and snooze on absolute time`() {
        var ws = Workspace().run(today, Op.StartTimer(25.0, card = "Write report"))
        val started = ws.timers.single()
        assertEquals("Write report", started.label)
        assertEquals(now + 25 * 60_000, started.endsAtMs)

        ws = ws.run(Op.PauseTimer(started.id), at = now + 60_000)
        assertEquals(TimerState.Paused, ws.timers.single().state)
        assertEquals(24 * 60_000.0, ws.timers.single().remainingMs)
        assertNull(ws.timers.single().endsAtMs)

        ws = ws.run(Op.ResumeTimer(started.id), at = now + 120_000)
        assertEquals(now + 120_000 + 24 * 60_000, ws.timers.single().endsAtMs)
        assertTrue("time left" in ws.refuse(Op.FinishTimer(started.id), at = now + 130_000).error)

        val end = ws.timers.single().endsAtMs!!
        ws = ws.run(Op.FinishTimer(started.id), at = end)
        assertEquals(TimerState.Done, ws.timers.single().state)
        assertTrue("finished" in ws.refuse(Op.ResumeTimer(started.id), at = end).error)

        ws = ws.run(Op.AddTime(started.id, 5.0), at = end + 10_000)
        assertEquals(TimerState.Running, ws.timers.single().state)
        assertEquals(end + 10_000 + 5 * 60_000, ws.timers.single().endsAtMs)
    }

    @Test
    fun `timers take free slots and are capped`() {
        val ws = Workspace().run(Op.StartTimer(5.0), Op.StartTimer(10.0, label = "Break"), Op.StartTimer(15.0))
        assertEquals(3, ws.timers.map { it.pose }.distinct().size)
        assertTrue("Dismiss" in ws.refuse(Op.StartTimer(1.0)).error)
        val freed = ws.run(Op.DismissTimer("break"), Op.StartTimer(1.0))
        assertEquals(ws.timers[1].pose, freed.timers.last().pose, "the freed slot is reused")
    }

    @Test
    fun `arrange_space brings everything to the viewer`() {
        val ws = Workspace().run(today, Op.CreateBoard("Errands"), Op.StartTimer(25.0))
        val viewer = Pose(2.0, 1.3, -1.0, yaw = PI / 2) // seated, turned to face -X
        val arranged = ws.run(Op.ArrangeSpace(), viewer = viewer)
        assertEquals(viewer, arranged.anchor)
        val focus = arranged.boards.first { it.id == arranged.focusBoardId }.pose
        // Facing -X: the focus board is in front (smaller x), at the same z, and yawed to face back at the viewer.
        assertTrue(focus.x < viewer.x - 0.5 && abs(focus.z - viewer.z) < 1e-9, "$focus")
        assertEquals(PI / 2, focus.yaw, 1e-9)

        val focused = ws.run(Op.ArrangeSpace(Arrangement.Focus), viewer = viewer)
        val parked = focused.boards.first { it.id != focused.focusBoardId }.pose
        assertTrue(hypot(parked.x - viewer.x, parked.z - viewer.z) > 2.0, "focus mode pushes the rest away")
    }

    @Test
    fun `update_card changes priority, estimate and title in place`() {
        val ws = Workspace().run(today, Op.UpdateCard("review pr", priority = Priority.High, minutes = 30, title = "Review PR 42"))
        val card = ws.boards.single().columns.first { it.title == "Doing" }.cards.single()
        assertEquals(Card("c6", "Review PR 42", 30, Priority.High, since = now), card)
        assertTrue("estimate" in ws.refuse(Op.UpdateCard("Review PR 42", minutes = 0)).error)
    }

    @Test
    fun `a card's clock starts when it enters a column, and survives reordering`() {
        var ws = Workspace().run(today)
        val since = { title: String -> ws.boards.single().columns.flatMap { it.cards }.first { it.title == title }.since }
        assertEquals(now, since("Write report"))
        ws = ws.run(Op.MoveCard("Write report", column = "Doing"), at = now + 60_000)
        assertEquals(now + 60_000, since("Write report"), "a new column restarts it")
        ws = ws.run(Op.MoveCard("Write report", column = "Doing", index = 0), at = now + 120_000)
        assertEquals(now + 60_000, since("Write report"), "reordering keeps it")
    }

    @Test
    fun `clear_done empties only the last column`() {
        val ws = Workspace().run(today, Op.ClearDone())
        assertEquals(emptyList(), ws.titles("Today", "Done"))
        assertEquals(listOf("Write report"), ws.titles("Today", "To do"))
    }

    @Test
    fun `the JSON boundary takes an agent's plan written with titles`() {
        val plan = """
            [
              {"op":"create_board","title":"Launch day","cards":[{"title":"Ship build","priority":"high","minutes":45}]},
              {"op":"add_card","board":"launch day","title":"Tell the team","column":"Doing"},
              {"op":"start_timer","minutes":25,"card":"Ship build"},
              {"op":"arrange_space","layout":"focus"}
            ]
        """.trimIndent()
        val result = WorkspaceJson.decodeFromString(ApplyResult.serializer(), Workspaces.apply(Workspaces.empty(), plan, now, null))
        assertTrue(result.ok, result.error)
        val ws = result.state!!
        assertEquals(1, ws.revision)
        assertEquals(Priority.High, ws.boards.single().columns[0].cards.single().priority)
        assertEquals("Ship build", ws.timers.single().label)
        assertTrue(result.created.containsAll(listOf("b1", "t7")), result.created.toString())

        val bad = WorkspaceJson.decodeFromString(
            ApplyResult.serializer(),
            Workspaces.apply(Workspaces.empty(), """[{"op":"create_board","title":"A"},{"op":"teleport"}]""", now, null),
        )
        assertEquals(false, bad.ok)
        assertEquals(1, bad.opIndex)
        assertTrue(bad.error!!.startsWith("Action 2"), bad.error)
    }

    @Test
    fun `saves from another schema are discarded, not misread`() {
        val saved = Workspaces.apply(Workspaces.empty(), """{"op":"create_board","title":"Keep"}""", now, null)
        val state = WorkspaceJson.decodeFromString(ApplyResult.serializer(), saved).state!!
        val json = WorkspaceJson.encodeToString(Workspace.serializer(), state)
        assertNotEquals(null, Workspaces.load(json))
        assertNull(Workspaces.load(json.replace("\"schema\":1", "\"schema\":99")))
        assertNull(Workspaces.load("not json"))
    }
}
