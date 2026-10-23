package app.spatialdesk.shared

/** A rejected operation. The message is shown to the user and fed back to the agent, so it says what to do. */
class WorkspaceError(message: String) : Exception(message)

sealed class EngineResult {
    data class Success(val state: Workspace, val created: List<String>) : EngineResult()

    /** Nothing was applied. [opIndex] is the failing operation, or -1 when the batch itself was refused. */
    data class Failure(val error: String, val opIndex: Int) : EngineResult()
}

/**
 * The only code that changes a workspace. Pure: same state, ops, clock and viewer in, same state out, on the JVM
 * (validating the agent's plans) and in the headset (applying them and the user's own actions). A batch is atomic:
 * one bad operation and nothing changes.
 */
object WorkspaceEngine {
    fun applyAll(state: Workspace, ops: List<Op>, nowMs: Double, viewer: Pose? = null): EngineResult {
        if (ops.isEmpty()) return EngineResult.Failure("Nothing to do.", -1)
        if (ops.size > Limits.OPS_PER_BATCH) return EngineResult.Failure("Too many actions at once (max ${Limits.OPS_PER_BATCH}).", -1)
        val step = Step(nowMs, viewer)
        var ws = state
        ops.forEachIndexed { index, op ->
            ws = try {
                step.apply(ws, op)
            } catch (e: WorkspaceError) {
                return EngineResult.Failure(e.message ?: "Invalid action.", index)
            }
        }
        return EngineResult.Success(ws.copy(revision = state.revision + 1), step.created)
    }

    private class Step(val nowMs: Double, val viewer: Pose?) {
        val created = mutableListOf<String>()

        fun apply(ws: Workspace, op: Op): Workspace = when (op) {
            is Op.CreateBoard -> createBoard(ws, op)
            is Op.AddCard -> addCard(ws, op)
            is Op.UpdateCard -> updateCard(ws, op)
            is Op.MoveCard -> moveCard(ws, op)
            is Op.RemoveCard -> ws.withoutCard(ws.locateCard(op.card, op.board))
            is Op.ClearDone -> clearDone(ws, op)
            is Op.DeleteBoard -> deleteBoard(ws, op)
            is Op.FocusBoard -> focusBoard(ws, ws.board(op.board).id)
            is Op.StartTimer -> startTimer(ws, op)
            is Op.PauseTimer -> ws.updateTimer(op.timer) { t ->
                if (t.state != TimerState.Running) t
                else t.copy(state = TimerState.Paused, remainingMs = remainingAt(t), endsAtMs = null)
            }
            is Op.ResumeTimer -> ws.updateTimer(op.timer) { t ->
                when (t.state) {
                    TimerState.Paused -> t.copy(state = TimerState.Running, endsAtMs = nowMs + t.remainingMs)
                    TimerState.Running -> t
                    TimerState.Done -> throw WorkspaceError("That timer has finished. Add time or start a new one.")
                }
            }
            is Op.AddTime -> addTime(ws, op)
            is Op.FinishTimer -> ws.updateTimer(op.timer) { t ->
                if (t.state != TimerState.Running) t
                else if (remainingAt(t) > FINISH_TOLERANCE_MS) throw WorkspaceError("That timer still has time left.")
                else t.copy(state = TimerState.Done, remainingMs = 0.0, endsAtMs = null)
            }
            is Op.DismissTimer -> ws.timer(op.timer).let { t -> ws.copy(timers = ws.timers - t) }
            is Op.ArrangeSpace -> arrange(ws, op.layout)
            is Op.SetPose -> setPose(ws, op)
            is Op.SetView -> setView(ws, op.view)
            is Op.SetComfort -> setComfort(ws, op)
        }

        private fun newId(ws: Workspace, prefix: String): Pair<Workspace, String> {
            val id = "$prefix${ws.nextId}"
            created += id
            return ws.copy(nextId = ws.nextId + 1) to id
        }

        private fun createBoard(start: Workspace, op: Op.CreateBoard): Workspace {
            if (start.boards.size >= Limits.BOARDS) {
                throw WorkspaceError("A workspace holds at most ${Limits.BOARDS} boards. Delete or reuse one first.")
            }
            val title = cleanText(op.title, "A board title")
            if (start.boards.any { it.title.equals(title, ignoreCase = true) }) throw WorkspaceError("There is already a board called '$title'.")
            if (op.columns.isEmpty() || op.columns.size > Limits.COLUMNS) {
                throw WorkspaceError("A board needs 1 to ${Limits.COLUMNS} columns.")
            }
            var ws = start
            val boardId = newId(ws, "b").also { ws = it.first }.second
            val columns = op.columns.map { raw ->
                val columnTitle = cleanText(raw, "A column title")
                Column(newId(ws, "k").also { ws = it.first }.second, columnTitle)
            }
            if (columns.distinctBy { it.title.lowercase() }.size != columns.size) throw WorkspaceError("Column titles must differ.")

            val makeFocus = op.focus ?: (ws.focusBoardId == null)
            var board = Board(boardId, title, columns, if (makeFocus) Layout.focus(ws.anchor, ws.view, ws.comfort) else freeParkedPose(ws, null))
            for (card in op.cards) {
                val column = card.column?.let { board.column(it) } ?: board.columns.first()
                val (next, cardId) = newId(ws, "c")
                ws = next
                board = board.withCard(column.id, Card(cardId, cleanText(card.title, "A card title"), checkMinutes(card.minutes), card.priority, nowMs), null)
            }

            if (!makeFocus) return ws.copy(boards = ws.boards + board)
            // The new board takes the focus slot; the previous focus board moves out to a free parked slot.
            val previous = ws.focusBoardId
            val boards = ws.boards.map { if (it.id == previous) it.copy(pose = freeParkedPose(ws, it.id)) else it }
            return ws.copy(boards = boards + board, focusBoardId = boardId)
        }

        private fun addCard(start: Workspace, op: Op.AddCard): Workspace {
            val board = start.board(op.board)
            val column = op.column?.let { board.column(it) } ?: board.columns.first()
            val title = cleanText(op.title, "A card title")
            val minutes = checkMinutes(op.minutes)
            val (ws, cardId) = newId(start, "c")
            return ws.replaceBoard(board.withCard(column.id, Card(cardId, title, minutes, op.priority, nowMs), op.index))
        }

        private fun updateCard(ws: Workspace, op: Op.UpdateCard): Workspace {
            val at = ws.locateCard(op.card, op.board)
            val board = ws.boards[at.board]
            val card = board.columns[at.column].cards[at.card]
            val updated = card.copy(
                title = op.title?.let { cleanText(it, "A card title") } ?: card.title,
                minutes = op.minutes?.let { checkMinutes(it) } ?: card.minutes,
                priority = op.priority ?: card.priority,
            )
            val columns = board.columns.mapIndexed { c, column ->
                if (c != at.column) column else column.copy(cards = column.cards.mapIndexed { i, k -> if (i == at.card) updated else k })
            }
            return ws.replaceBoard(board.copy(columns = columns))
        }

        private fun moveCard(ws: Workspace, op: Op.MoveCard): Workspace {
            val from = ws.locateCard(op.card, null)
            val card = ws.boards[from.board].columns[from.column].cards[from.card]
            val target = op.board?.let { ws.board(it) } ?: ws.boards[from.board]
            val column = target.column(op.column)
            val without = ws.withoutCard(from)
            // Reordering within a column keeps the clock; a new column starts it again.
            val moved = if (ws.boards[from.board].columns[from.column].id == column.id) card else card.copy(since = nowMs)
            return without.replaceBoard(without.board(target.id).withCard(column.id, moved, op.index))
        }

        private fun clearDone(ws: Workspace, op: Op.ClearDone): Workspace {
            val targets = op.board?.let { setOf(ws.board(it).id) } ?: ws.boards.map { it.id }.toSet()
            return ws.copy(
                boards = ws.boards.map { b ->
                    if (b.id !in targets || b.columns.size < 2) b
                    else b.copy(columns = b.columns.dropLast(1) + b.columns.last().copy(cards = emptyList()))
                },
            )
        }

        private fun deleteBoard(ws: Workspace, op: Op.DeleteBoard): Workspace {
            val board = ws.board(op.board)
            val rest = ws.boards - board
            if (ws.focusBoardId != board.id) return ws.copy(boards = rest)
            // The next board steps into the focus slot, so there is always something within reach.
            val next = rest.firstOrNull() ?: return ws.copy(boards = rest, focusBoardId = null)
            return ws.copy(
                boards = rest.map { if (it.id == next.id) it.copy(pose = Layout.focus(ws.anchor, ws.view, ws.comfort)) else it },
                focusBoardId = next.id,
            )
        }

        /** The chosen board and the current focus board swap places, so boards the user moved stay where they put them. */
        private fun focusBoard(ws: Workspace, boardId: String): Workspace {
            val previous = ws.focusBoardId
            if (previous == boardId) return ws
            val incoming = ws.board(boardId)
            val outgoing = previous?.let { id -> ws.boards.firstOrNull { it.id == id } }
            val focusPose = outgoing?.pose ?: Layout.focus(ws.anchor, ws.view, ws.comfort)
            return ws.copy(
                boards = ws.boards.map {
                    when (it.id) {
                        boardId -> it.copy(pose = focusPose)
                        previous -> it.copy(pose = incoming.pose)
                        else -> it
                    }
                },
                focusBoardId = boardId,
            )
        }

        private fun startTimer(start: Workspace, op: Op.StartTimer): Workspace {
            if (start.timers.size >= Limits.TIMERS) throw WorkspaceError("At most ${Limits.TIMERS} timers. Dismiss one first.")
            val ms = minutesToMs(op.minutes)
            val card = op.card?.let { ref -> start.locateCard(ref, null).let { start.boards[it.board].columns[it.column].cards[it.card] } }
            val label = cleanText(op.label ?: card?.title ?: "Focus", "A timer label")
            val (ws, timerId) = newId(start, "t")
            val pose = freeTimerPose(ws)
            return ws.copy(
                timers = ws.timers + Timer(timerId, label, ms, TimerState.Running, nowMs + ms, ms, card?.id, pose),
            )
        }

        private fun addTime(ws: Workspace, op: Op.AddTime): Workspace {
            val extra = minutesToMs(op.minutes)
            return ws.updateTimer(op.timer) { t ->
                val total = when (t.state) {
                    TimerState.Running -> remainingAt(t) + extra
                    TimerState.Paused -> t.remainingMs + extra
                    TimerState.Done -> extra
                }
                if (total > Limits.TIMER_MAX_MINUTES * MINUTE_MS) throw WorkspaceError("A timer runs ${Limits.TIMER_MAX_MINUTES.toInt()} minutes at most.")
                when (t.state) {
                    TimerState.Running -> t.copy(endsAtMs = t.endsAtMs!! + extra, durationMs = t.durationMs + extra)
                    TimerState.Paused -> t.copy(remainingMs = total, durationMs = t.durationMs + extra)
                    // A finished timer snoozes: it runs again for the added time.
                    TimerState.Done -> t.copy(state = TimerState.Running, endsAtMs = nowMs + extra, remainingMs = extra, durationMs = extra)
                }
            }
        }

        private fun arrange(ws: Workspace, layout: Arrangement): Workspace {
            val anchor = viewer?.let { Pose(it.x, it.y, it.z, it.yaw) } ?: ws.anchor
            var parked = 0
            return ws.copy(
                anchor = anchor,
                boards = ws.boards.map { b ->
                    if (b.id == ws.focusBoardId) b.copy(pose = Layout.focus(anchor, ws.view, ws.comfort))
                    else b.copy(pose = Layout.parked(anchor, parked++, layout == Arrangement.Focus, ws.view, ws.comfort))
                },
                timers = ws.timers.mapIndexed { i, t -> t.copy(pose = Layout.timer(anchor, i, ws.view, ws.comfort)) },
            )
        }

        /** The headset's view changed: the layout refits to it ([refit]). */
        private fun setView(ws: Workspace, view: ViewFit): Workspace {
            val angles = listOf(view.halfWidthDeg, view.upDeg, view.downDeg)
            if (!angles.all { it.isFinite() && it in 5.0..90.0 }) throw WorkspaceError("That field of view is not a headset's.")
            return refit(ws, view, ws.comfort)
        }

        /** What the user's body asks for, merged into their [Comfort]; the layout refits to it ([refit]). */
        private fun setComfort(ws: Workspace, op: Op.SetComfort): Workspace {
            if (listOf(op.reach, op.scale, op.side, op.turnDeg, op.tiltDeg).all { it == null }) {
                throw WorkspaceError("Say what to change: reach, scale, side, turnDeg or tiltDeg.")
            }
            val c = ws.comfort
            val comfort = Comfort(
                reach = op.reach ?: c.reach,
                scale = op.scale ?: c.scale,
                side = op.side ?: c.side,
                turnDeg = op.turnDeg ?: c.turnDeg,
                tiltDeg = op.tiltDeg ?: c.tiltDeg,
            )
            Comfort.problem(comfort)?.let { throw WorkspaceError("Comfort: $it") }
            return refit(ws, ws.view, comfort)
        }

        /**
         * Refits the layout to [view] and [comfort]: the focus board, the parked boards and the timers still in their
         * slots move to the new slots; whatever the user placed elsewhere stays there.
         */
        private fun refit(ws: Workspace, view: ViewFit, comfort: Comfort): Workspace {
            val a = ws.anchor
            fun slotted(pose: Pose, slot: Pose) = Layout.distance(pose, slot) < SLOT_TAKEN_M / 3
            fun parkedSlot(pose: Pose): Pair<Int, Boolean>? {
                for (far in listOf(false, true)) for (i in 0 until Layout.parkedSlots) {
                    if (slotted(pose, Layout.parked(a, i, far, ws.view, ws.comfort))) return i to far
                }
                return null
            }
            val focusSlot = Layout.focus(a, ws.view, ws.comfort)
            return ws.copy(
                view = view,
                comfort = comfort,
                boards = ws.boards.map { b ->
                    when {
                        b.id == ws.focusBoardId -> if (slotted(b.pose, focusSlot)) b.copy(pose = Layout.focus(a, view, comfort)) else b
                        else -> parkedSlot(b.pose)?.let { (i, far) -> b.copy(pose = Layout.parked(a, i, far, view, comfort)) } ?: b
                    }
                },
                timers = ws.timers.map { t ->
                    val slot = (0 until Layout.timerSlots).firstOrNull { slotted(t.pose, Layout.timer(a, it, ws.view, ws.comfort)) }
                    if (slot != null) t.copy(pose = Layout.timer(a, slot, view, comfort)) else t
                },
            )
        }

        private fun setPose(ws: Workspace, op: Op.SetPose): Workspace {
            val p = op.pose
            if (!listOf(p.x, p.y, p.z, p.yaw, p.pitch).all { it.isFinite() } || Layout.distance(p, ws.anchor) > MAX_REACH_M) {
                throw WorkspaceError("That spot is out of reach.")
            }
            return when {
                ws.boards.any { it.id == op.id } -> ws.copy(boards = ws.boards.map { if (it.id == op.id) it.copy(pose = p) else it })
                ws.timers.any { it.id == op.id } -> ws.copy(timers = ws.timers.map { if (it.id == op.id) it.copy(pose = p) else it })
                else -> throw WorkspaceError("Nothing called '${op.id}' to move.")
            }
        }

        private fun remainingAt(t: Timer): Double = if (t.state == TimerState.Running) maxOf(0.0, t.endsAtMs!! - nowMs) else t.remainingMs
    }

    private const val MINUTE_MS = 60_000.0
    private const val FINISH_TOLERANCE_MS = 1_000.0
    private const val MAX_REACH_M = 6.0

    private fun minutesToMs(minutes: Double): Double {
        if (!minutes.isFinite() || minutes < 0.1 || minutes > Limits.TIMER_MAX_MINUTES) {
            throw WorkspaceError("Timers run from 0.1 to ${Limits.TIMER_MAX_MINUTES.toInt()} minutes.")
        }
        return minutes * MINUTE_MS
    }

    private fun checkMinutes(minutes: Int?): Int? {
        if (minutes != null && (minutes < 1 || minutes > Limits.CARD_MAX_MINUTES)) {
            throw WorkspaceError("A card estimate is 1 to ${Limits.CARD_MAX_MINUTES} minutes.")
        }
        return minutes
    }

    /** Printable, single-line, bounded. Long titles are shortened rather than refused: the agent can be wordy. */
    internal fun cleanText(raw: String, what: String): String {
        val text = raw.filterNot { it.isISOControl() }.trim().replace(WHITESPACE, " ")
        if (text.isEmpty()) throw WorkspaceError("$what can't be empty.")
        return if (text.length <= Limits.TITLE_CHARS) text else text.take(Limits.TITLE_CHARS - 3).trimEnd() + "..."
    }

    private val WHITESPACE = Regex("\\s+")

    private fun freeParkedPose(ws: Workspace, excluding: String?): Pose {
        val others = ws.boards.filter { it.id != excluding }
        val free = (0 until Layout.parkedSlots).firstOrNull { i ->
            val slot = Layout.parked(ws.anchor, i, view = ws.view, comfort = ws.comfort)
            others.none { Layout.distance(it.pose, slot) < SLOT_TAKEN_M }
        }
        return Layout.parked(ws.anchor, free ?: others.size, view = ws.view, comfort = ws.comfort)
    }

    private fun freeTimerPose(ws: Workspace): Pose {
        val free = (0 until Layout.timerSlots).firstOrNull { i ->
            val slot = Layout.timer(ws.anchor, i, ws.view, ws.comfort)
            ws.timers.none { Layout.distance(it.pose, slot) < SLOT_TAKEN_M / 3 }
        }
        return Layout.timer(ws.anchor, free ?: ws.timers.size, ws.view, ws.comfort)
    }

    private const val SLOT_TAKEN_M = 0.3
}

private class CardLocation(val board: Int, val column: Int, val card: Int)

private fun Workspace.board(ref: String): Board {
    val key = ref.trim()
    return boards.firstOrNull { it.id == key }
        ?: boards.firstOrNull { it.title.equals(key, ignoreCase = true) }
        ?: throw WorkspaceError("No board called '$key'.")
}

private fun Board.column(ref: String): Column {
    val key = ref.trim()
    return columns.firstOrNull { it.id == key }
        ?: columns.firstOrNull { it.title.equals(key, ignoreCase = true) }
        ?: throw WorkspaceError("Board '$title' has no column '$key'. Its columns: ${columns.joinToString { it.title }}.")
}

/** By id anywhere, else by title (within [boardRef] when given); a title shared by several cards is refused. */
private fun Workspace.locateCard(ref: String, boardRef: String?): CardLocation {
    val key = ref.trim()
    val scope = boardRef?.let { setOf(board(it).id) }
    val matches = mutableListOf<CardLocation>()
    boards.forEachIndexed { b, board ->
        board.columns.forEachIndexed { c, column ->
            column.cards.forEachIndexed { i, card -> if (card.id == key) return CardLocation(b, c, i) }
        }
    }
    boards.forEachIndexed { b, board ->
        if (scope != null && board.id !in scope) return@forEachIndexed
        board.columns.forEachIndexed { c, column ->
            column.cards.forEachIndexed { i, card -> if (card.title.equals(key, ignoreCase = true)) matches += CardLocation(b, c, i) }
        }
    }
    return when (matches.size) {
        1 -> matches[0]
        0 -> throw WorkspaceError("No card called '$key'.")
        else -> throw WorkspaceError("Several cards are called '$key'. Name the board too.")
    }
}

private fun Workspace.withoutCard(at: CardLocation): Workspace {
    val board = boards[at.board]
    val columns = board.columns.mapIndexed { c, column ->
        if (c == at.column) column.copy(cards = column.cards.filterIndexed { i, _ -> i != at.card }) else column
    }
    return replaceBoard(board.copy(columns = columns))
}

/** Inserts at [index] (clamped; null appends), enforcing the per-column limit. */
private fun Board.withCard(columnId: String, card: Card, index: Int?): Board = copy(
    columns = columns.map { column ->
        if (column.id != columnId) return@map column
        if (column.cards.size >= Limits.CARDS_PER_COLUMN) {
            throw WorkspaceError("'${column.title}' on '$title' is full (${Limits.CARDS_PER_COLUMN} cards).")
        }
        val at = (index ?: column.cards.size).coerceIn(0, column.cards.size)
        column.copy(cards = column.cards.take(at) + card + column.cards.drop(at))
    },
)

private fun Workspace.replaceBoard(board: Board): Workspace = copy(boards = boards.map { if (it.id == board.id) board else it })

private fun Workspace.timer(ref: String): Timer {
    val key = ref.trim()
    return timers.firstOrNull { it.id == key }
        ?: timers.firstOrNull { it.label.equals(key, ignoreCase = true) }
        ?: throw WorkspaceError("No timer called '$key'.")
}

private fun Workspace.updateTimer(ref: String, change: (Timer) -> Timer): Workspace {
    val target = timer(ref)
    return copy(timers = timers.map { if (it.id == target.id) change(it) else it })
}
