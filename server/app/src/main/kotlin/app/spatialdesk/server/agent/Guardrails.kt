package app.spatialdesk.server.agent

import app.spatialdesk.shared.Board
import app.spatialdesk.shared.Card
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Rules that depend on the request, enforced in code because the model does not reliably follow them in prose:
 * measured on 2026-10-07, Nova 2 Lite moved a card with 25 of its 120 minutes used to Done on every "next block"
 * and "replan" request, and started timers in replans. The server computes the facts (how much of each estimate is
 * used), states them in the prompt, and checks every plan against them; a violation goes back to the model as
 * feedback, exactly like an engine error.
 */
object Guardrails {
    /** A card counts as unfinished while less than this share of its estimate has been spent in progress. */
    private const val FINISHED_SHARE = 0.8

    class Facts(val lines: List<String>, val unfinished: List<Card>)

    fun facts(request: PlanRequest, nowMs: Double): Facts {
        if (request.intent == Intent.WrapUp) {
            return Facts(listOf("This is the end of the user's day: no timers, no new boards, and the space is not rearranged."), emptyList())
        }
        if (request.intent != Intent.NextBlock && request.intent != Intent.Replan) return Facts(emptyList(), emptyList())
        val inProgress = request.workspace.boards.flatMap { board ->
            board.columns.drop(1).dropLast(1).flatMap { it.cards }
        }
        val named = inProgress.filter { request.context?.contains(it.title, ignoreCase = true) == true }
        val unfinished = (named.ifEmpty { inProgress }).filter { card ->
            val minutes = card.minutes ?: return@filter false
            val since = card.since ?: return@filter false
            (nowMs - since) / 60_000 < FINISHED_SHARE * minutes
        }.take(3)
        val lines = buildList {
            for (card in unfinished) {
                val used = ((nowMs - card.since!!) / 60_000).toInt().coerceAtLeast(0)
                add("\"${card.title}\" has used $used of its ${card.minutes} estimated minutes: it is not finished, so it does not move to the last column.")
            }
            if (request.intent == Intent.NextBlock && unfinished.isNotEmpty()) {
                add("After a block on unfinished work, the next block is a short break: start_timer 5 with label \"Break\", nothing else.")
            }
            if (request.intent == Intent.Replan) add("This is a replan: no timers, no new boards, and no card moves to the last column.")
        }
        return Facts(lines, unfinished)
    }

    /** The first rule a plan breaks, as feedback the model can act on; null when it keeps them all. */
    fun violation(request: PlanRequest, facts: Facts, steps: List<JsonObject>): String? {
        steps.forEachIndexed { i, step ->
            val op = step.string("op")
            if (request.intent == Intent.WrapUp && op in WRAP_UP_FORBIDDEN) {
                return "Step ${i + 1} ($op) breaks a rule: wrapping up the day never starts timers, creates boards or rearranges the space."
            }
            if (request.intent == Intent.Replan) {
                if (op == "start_timer" || op == "create_board") return "Step ${i + 1} ($op) breaks a rule: a replan never starts timers or creates boards."
                if (op == "move_card" && movesToLastColumn(request, step)) return "Step ${i + 1} breaks a rule: a replan never moves cards to the last column."
            }
            if (request.intent == Intent.NextBlock && op == "move_card" && movesToLastColumn(request, step)) {
                val ref = step.string("card")
                facts.unfinished.firstOrNull { it.id == ref || it.title.equals(ref, ignoreCase = true) }?.let { card ->
                    return "Step ${i + 1} moves \"${card.title}\" to the last column, but it is not finished (see the facts). Suggest a short break instead."
                }
            }
        }
        return null
    }

    /** The target column is the last one of the target board (the board given, or the card's own board). */
    private fun movesToLastColumn(request: PlanRequest, step: JsonObject): Boolean {
        val boards = request.workspace.boards
        val target = step.string("board")?.let { ref -> boards.firstOrNull { it.id == ref || it.title.equals(ref, ignoreCase = true) } }
            ?: step.string("card")?.let { ref -> boards.firstOrNull { b -> b.hasCard(ref) } }
            ?: return false
        val column = step.string("column") ?: return false
        val last = target.columns.lastOrNull() ?: return false
        return target.columns.size > 1 && (last.id == column || last.title.equals(column, ignoreCase = true))
    }

    private fun Board.hasCard(ref: String) = columns.any { c -> c.cards.any { it.id == ref || it.title.equals(ref, ignoreCase = true) } }

    private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

    private val WRAP_UP_FORBIDDEN = setOf("start_timer", "create_board", "arrange_space", "focus_board")
}
