package app.spatialdesk.server.agent

import app.spatialdesk.shared.Card
import app.spatialdesk.shared.Workspace
import kotlinx.serialization.json.*

/** One bounded block on a task the user already has. A session never invents or completes tasks. */
object SessionRules {
    fun openCards(ws: Workspace): List<Card> = ws.boards.flatMap { b -> b.columns.dropLast(1).flatMap { it.cards } }
    fun running(ws: Workspace) = ws.timers.any { it.state == app.spatialdesk.shared.TimerState.Running }

    private fun resolveCard(ws: Workspace, ref: String?): Card? {
        openCards(ws).firstOrNull { it.id == ref }?.let { return it }
        // A repeated title must never resolve to a different (possibly completed) card in the engine.
        val named = ws.boards.flatMap { b -> b.columns.flatMap { it.cards } }.filter { it.title.equals(ref, true) }
        return named.singleOrNull()?.takeIf { card -> openCards(ws).any { it.id == card.id } }
    }

    fun facts(request: PlanRequest): List<String> {
        val c = request.sessionChoice!!
        if (running(request.workspace)) return listOf("A timer is already running. Steps must be empty. Ask the user to pause or finish it before preparing another block; never interrupt it yourself.")
        if (openCards(request.workspace).isEmpty()) return listOf("No existing open tasks: steps must be empty. Ask the user to add their tasks with Plan my day first.")
        return listOf(
            "User chose ${c.minutes} available minutes and ${c.energy} energy. This is self-reported, not a health assessment.",
            "Propose ONE block of 5 to ${c.blockLimit()} minutes on ONE existing open task. Never exceed the available time.",
            "At most four steps: optional focus_board, optional move_card to its in-progress column, exactly one start_timer with card, optional arrange_space focus. No other operations.",
            "Never finish a card. Never create tasks. At the end the app offers a choice, not an automatic continuation.",
        )
    }

    fun violation(request: PlanRequest, steps: List<JsonObject>): String? {
        val choice = request.sessionChoice ?: return "A session needs the user's time and energy choice."
        if (running(request.workspace)) return "A timer is already running: do not change it or start a parallel session."
        if (steps.size > 4) return "A session has at most four steps."
        val allowed = setOf("focus_board", "move_card", "start_timer", "arrange_space")
        if (steps.any { it.text("op") !in allowed }) return "A session may only focus a board, move its one task to Doing, start its one timer and arrange focus."
        if (allowed.any { name -> steps.count { it.text("op") == name } > 1 }) return "Use each session operation at most once."
        val timer = steps.singleOrNull { it.text("op") == "start_timer" } ?: return "Start exactly one timer on an existing open task."
        val minutes = (timer["minutes"] as? JsonPrimitive)?.doubleOrNull ?: return "The session timer needs minutes."
        if (minutes < 5 || minutes > choice.blockLimit()) return "The chosen block must be 5 to ${choice.blockLimit()} minutes, within the user's budget."
        val ref = timer.text("card")
        val card = resolveCard(request.workspace, ref) ?: return "The session must use an unambiguous existing open task ID, never a completed or invented one."
        val board = request.workspace.boards.first { b -> b.columns.any { c -> c.cards.any { it.id == card.id } } }
        for (step in steps) when (step.text("op")) {
            "focus_board" -> if (step.text("board") !in setOf(board.id, board.title)) return "Focus only the chosen task's board."
            "move_card" -> {
                if (step.text("card") !in setOf(card.id, card.title)) return "Move only the chosen task."
                val doing = board.columns.getOrNull(1)
                if (board.columns.size < 3 || doing == null || step.text("column") !in setOf(doing.id, doing.title)) return "The chosen task can only move to its existing in-progress column."
                if (step.text("board") != null && step.text("board") !in setOf(board.id, board.title)) return "Keep the task on its own board."
            }
            "arrange_space" -> if (step.text("layout") != "focus") return "Use the focus layout for this session."
        }
        return null
    }

    fun normalise(op: JsonObject, ws: Workspace): JsonObject {
        if (op.text("op") !in setOf("start_timer", "move_card")) return op
        val card = resolveCard(ws, op.text("card")) ?: return op
        val fields = op + ("card" to JsonPrimitive(card.id))
        return if (op.text("op") == "start_timer") JsonObject(fields + ("label" to JsonPrimitive("Session: ${card.title}".take(100)))) else JsonObject(fields)
    }

    fun builtIn(request: PlanRequest): ModelPlan {
        val choice = request.sessionChoice!!
        if (running(request.workspace)) return ModelPlan("A timer is already running. Pause or finish it on the timer before preparing another session.", emptyList())
        val candidates = openCards(request.workspace)
        val card = if (choice.energy == "low") candidates.minByOrNull { it.minutes ?: 60 } else candidates.firstOrNull()
        if (card == null) return ModelPlan("Add your tasks with Plan my day first, then choose a session that fits your time.", emptyList())
        val board = request.workspace.boards.first { b -> b.columns.any { c -> c.cards.any { it.id == card.id } } }
        val steps = buildList {
            if (board.id != request.workspace.focusBoardId) add(buildJsonObject { put("op", "focus_board"); put("board", board.id); put("why", "Your chosen task within reach") })
            if (board.columns.size > 2 && board.columns.first().cards.any { it.id == card.id }) add(buildJsonObject { put("op", "move_card"); put("board", board.id); put("card", card.id); put("column", board.columns[1].id); put("why", "One task to start") })
            add(buildJsonObject { put("op", "start_timer"); put("minutes", choice.blockLimit()); put("card", card.id); put("why", "Within the time you chose") })
        }
        return ModelPlan("A ${choice.blockLimit()}-minute block on \"${card.title}\". Review before applying; you can stop when it ends.", steps)
    }

    private fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull
}
