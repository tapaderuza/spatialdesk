package app.spatialdesk.server.agent

import app.spatialdesk.shared.Board
import app.spatialdesk.shared.Card
import app.spatialdesk.shared.Comfort
import app.spatialdesk.shared.Workspace
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
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

    /**
     * What the prompt states and the plan is checked against: [unfinished] cards may not move to the last column,
     * [start] is the task a first step is for, [momentum] the task the user has just started with a first step.
     */
    class Facts(val lines: List<String>, val unfinished: List<Card>, val start: Card? = null, val momentum: Card? = null)

    fun facts(request: PlanRequest, nowMs: Double): Facts {
        val ws = request.workspace
        if (request.intent == Intent.AdaptSpace) {
            val designed = if (ws.comfort == Comfort()) " (the layout as designed)" else ""
            val asked = ComfortNeeds.of(request.text).filter { it.required }
            return Facts(
                buildList {
                    add("Current comfort: ${Prompt.comfortLine(ws.comfort)}$designed.")
                    if (asked.isNotEmpty()) {
                        add("The user asked for: ${asked.joinToString { "${it.asked} (${it.field})" }}. Cover each with its own set_comfort step.")
                    }
                    add("Adapt the space with set_comfort steps only, one field per step; no other ops.")
                },
                emptyList(),
            )
        }
        if (request.intent == Intent.FirstStep) {
            val task = StartTask.of(ws, request.text)
                ?: return Facts(listOf("There is no open task to start: no steps; the summary asks what is on the user's plate today."), emptyList())
            val board = ws.boards.first { b -> b.columns.any { c -> c.cards.any { it.id == task.id } } }
            val column = board.columns.indexOfFirst { c -> c.cards.any { it.id == task.id } }
            val move = if (column == 0 && board.columns.size > 2) "move_card \"${task.title}\" to \"${board.columns[1].title}\" with index 0, then " else ""
            return Facts(
                listOf(
                    "The task to start: \"${task.title}\"${if (column == 0) " (not started)" else " (in progress)"}.",
                    "A first step: ${move}one start_timer of 5 minutes with card \"${task.title}\" and a label \"First step: \" plus one concrete action that takes under 5 minutes. Nothing else.",
                ),
                emptyList(),
                start = task,
            )
        }
        if (request.intent == Intent.NextBlock && request.context?.contains("first step", ignoreCase = true) == true) {
            // The point of a first step: once the user has started, a break would throw the start away.
            val inProgress = ws.boards.flatMap { b -> b.columns.drop(1).dropLast(1).flatMap { it.cards } }
            val card = inProgress.firstOrNull { request.context.contains(it.title, ignoreCase = true) } ?: inProgress.firstOrNull()
            if (card != null) {
                return Facts(
                    listOf("\"${card.title}\" had a first step: the user has started. Keep the momentum: start_timer 25 with card \"${card.title}\"; no break, and it is not finished (it stays where it is)."),
                    listOf(card),
                    momentum = card,
                )
            }
        }
        if (request.intent == Intent.WrapUp) {
            // Measured on 2026-10-23: asked to wrap up, Nova 2 Lite named the card still in progress as finished.
            val day = WrapUpDay.of(request.workspace)
            val quoted = { cards: List<Card> -> cards.joinToString { "\"${it.title}\"" } }
            return Facts(
                buildList {
                    add(if (day.finished.isEmpty()) "Nothing reached a last column today." else "Finished today (in a last column): ${quoted(day.finished)}.")
                    if (day.open.isNotEmpty()) add("Still open, NOT finished (never say these are finished or done): ${quoted(day.open)}.")
                    day.next?.let { add("Tomorrow starts with \"${it.title}\".") }
                    add("This is the end of the user's day: no timers, no new boards, and the space is not rearranged.")
                },
                emptyList(),
            )
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
            if (request.intent == Intent.AdaptSpace && op != "set_comfort") {
                return "Step ${i + 1} ($op) breaks a rule: adapting the space to the user's body only uses set_comfort."
            }
            if (op == "set_comfort" && request.intent != Intent.AdaptSpace && request.intent != Intent.Custom) {
                return "Step ${i + 1} (set_comfort) breaks a rule: comfort changes only when the user asks about their body."
            }
            if (request.intent == Intent.FirstStep) {
                if (op != "start_timer" && op != "move_card") {
                    return "Step ${i + 1} ($op) breaks a rule: a first step only starts a short timer (and may move the task to its in-progress column)."
                }
                val minutes = step.double("minutes") ?: 25.0
                if (op == "start_timer" && minutes > 10) {
                    return "Step ${i + 1} starts ${minutes.toInt()} minutes: a first step is 5 minutes (10 at most), small enough to say yes to."
                }
                if (op == "move_card" && movesToLastColumn(request, step)) return "Step ${i + 1} breaks a rule: a first step never moves the task to the last column."
            }
            if (facts.momentum != null && op == "start_timer" && step.string("label")?.trim()?.equals("break", ignoreCase = true) == true) {
                return "Step ${i + 1} starts a break, but the user has just started \"${facts.momentum.title}\": keep the momentum with start_timer 25 on it."
            }
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
        val start = facts.start
        if (request.intent == Intent.FirstStep && start != null && steps.count { it.string("op") == "start_timer" } != 1) {
            return "Start exactly one 5-minute timer on \"${start.title}\"."
        }
        if (request.intent == Intent.AdaptSpace && !ComfortNeeds.isReset(request.text)) {
            // Measured on 2026-10-23: asked for neck, right side, closer and bigger text, Nova covered two of the four.
            val covered = steps.flatMap { it.keys }.toSet()
            val missing = ComfortNeeds.of(request.text).filter { it.required && it.field !in covered }
            if (missing.isNotEmpty()) {
                return "The plan leaves out what the user asked for: ${missing.joinToString { "${it.asked} (${it.field})" }}. Add one set_comfort step for each."
            }
        }
        return null
    }

    /** A first step's timer says so on its label ("First step: ..."): that is how the headset knows when it ends. */
    fun firstStepLabel(op: JsonObject): JsonObject {
        if (op.string("op") != "start_timer") return op
        val label = op.string("label")?.trim().orEmpty()
        if (FIRST_STEP.containsMatchIn(label)) return op
        return JsonObject(op + ("label" to JsonPrimitive(if (label.isEmpty()) "First step" else "First step: $label")))
    }

    private val FIRST_STEP = Regex("^(first step|primer paso)", RegexOption.IGNORE_CASE)

    private fun JsonObject.double(key: String): Double? = this[key]?.jsonPrimitive?.doubleOrNull

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

/**
 * What someone says about their body, read by plain words (English and Spanish): one comfort change per need, with the
 * value the built-in planner uses and its reason. [Need.required] needs are what the user asked for in so many words,
 * which every plan must cover; the others are inferences (tired eyes may also want the panels further away).
 */
object ComfortNeeds {
    class Need(val field: String, val value: JsonPrimitive, val why: String, val asked: String, val required: Boolean = true)

    fun isReset(text: String?): Boolean = says(fold(text.orEmpty()), "normal|reset|default|as (?:it was|before|designed)|como antes|por defecto|restablece")

    fun of(text: String?): List<Need> {
        val said = fold(text.orEmpty())
        val has = { pattern: String -> says(said, pattern) }
        // Tiredness alone is not the eyes: "estoy cansada" (I'm tired) leaves the distance to what else is said.
        val eyes = has("eye|ojo|vista|vision|visual|sight|see |read|leer|bigger|larger|grande|letra|text|squint")
        val near = has("closer|nearer|near me|reach|alcanz|cerca|acerc|trae|bring (?:it|everything|them)|arm|brazo|tremor|temblor|my hand|mi mano")
        return buildList {
            if (has("neck|cuello|turn my head|girar la cabeza|no puedo girar|can ?t turn")) {
                add(Need("turnDeg", JsonPrimitive(25.0), "Within 25 degrees: no neck turn needed", "their neck"))
            }
            when {
                has("right (?:hand|side|arm)|on my right|to my right|derech") -> add(Need("side", JsonPrimitive("right"), "Everything on your right, where you work", "the right side"))
                has("left (?:hand|side|arm)|on my left|to my left|izquierd") -> add(Need("side", JsonPrimitive("left"), "Everything on your left, where you work", "the left side"))
            }
            if (eyes) add(Need("scale", JsonPrimitive(1.4), "Larger panels: text that is easier to read", "larger text"))
            when {
                near -> add(Need("reach", JsonPrimitive(0.75), "Within easy reach of your hand", "everything closer"))
                eyes -> add(Need("reach", JsonPrimitive(1.4), "Further away: easier on tired eyes", "easier on the eyes", required = false))
            }
            if (has("lying|in bed|en la cama|tumbad|recost|reclin")) add(Need("tiltDeg", JsonPrimitive(20.0), "Higher, where your eyes rest lying back", "lying back"))
            if (has("wheelchair|silla de ruedas|lower|mas abajo")) add(Need("tiltDeg", JsonPrimitive(-10.0), "A little lower, an easier reach from a chair", "a lower space"))
        }
    }

    private fun says(said: String, pattern: String): Boolean = Regex("\\b(?:$pattern)").containsMatchIn(said)

    /** Lower case, accents folded: "Acércalo" -> "acercalo". */
    private fun fold(text: String): String =
        java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase()
}

/** The task a first step is for: the open card the user named (most words in common), else the one the day goes on with. */
object StartTask {
    fun of(ws: Workspace, text: String?): Card? {
        val open = ws.boards.flatMap { b -> (if (b.columns.size > 1) b.columns.dropLast(1) else b.columns).flatMap { it.cards } }
        val said = words(text.orEmpty())
        if (said.isNotEmpty()) {
            open.map { it to words(it.title).count { w -> w in said } }.filter { it.second > 0 }.maxByOrNull { it.second }?.let { return it.first }
        }
        return WrapUpDay.of(ws).next
    }

    private fun words(s: String): Set<String> = s.lowercase().split(Regex("""[^\p{L}\p{N}]+""")).filter { it.length >= 4 }.toSet()
}

/** The day as a wrap-up sees it: what reached a last column, what is still open, and the card tomorrow starts with. */
class WrapUpDay(val finished: List<Card>, val open: List<Card>, val next: Card?) {
    companion object {
        fun of(ws: Workspace): WrapUpDay {
            val finished = ws.boards.filter { it.columns.size > 1 }.flatMap { it.columns.last().cards }
            val open = ws.boards.flatMap { b -> (if (b.columns.size > 1) b.columns.dropLast(1) else b.columns).flatMap { it.cards } }
            val inProgress = ws.boards.flatMap { b -> b.columns.drop(1).dropLast(1).flatMap { it.cards } }
            val focus = ws.boards.firstOrNull { it.id == ws.focusBoardId }
            // In progress on the focus board first, then anywhere, then the top of the focus board's first column.
            val next = focus?.columns?.drop(1)?.dropLast(1)?.flatMap { it.cards }?.firstOrNull()
                ?: inProgress.firstOrNull()
                ?: focus?.columns?.firstOrNull()?.cards?.firstOrNull()
                ?: open.firstOrNull()
            return WrapUpDay(finished, open, next)
        }
    }
}

/** A wrap-up's summary must not call a card that is still open finished (the model's words are shown to the user). */
object SummaryCheck {
    private val FINISHED = Regex("""\b(finish(ed|es)?|done|complet(e|ed)|wrapped up|closed|ticked off|checked off|terminad[ao]s?|hech[ao]s?)\b""", RegexOption.IGNORE_CASE)
    /** A sentence about what is left or comes next may name an open card next to "finish": that is not a claim. */
    private val STILL_OPEN = Regex("""\b(tomorrow|next|still|keep|continue|left|open|remain\w*|ma[nñ]ana|sigue|pendiente)\b""", RegexOption.IGNORE_CASE)
    private val COMMON = setOf("finish", "prepare", "review", "write", "call", "make", "with", "from", "about", "today", "draft", "send", "plan", "that", "this")

    /** Feedback the model can act on when the summary names an open card as finished; null when it does not. */
    fun violation(request: PlanRequest, summary: String): String? {
        if (request.intent != Intent.WrapUp) return null
        val day = WrapUpDay.of(request.workspace)
        val sentences = summary.split(Regex("""(?<=[.!?;])\s+"""))
        for (card in day.open) {
            val words = card.title.lowercase().split(Regex("""[^\p{L}\p{N}]+""")).filter { it.length >= 4 && it !in COMMON }
            if (words.isEmpty()) continue
            val needed = minOf(2, words.size)
            val claimed = sentences.any { s ->
                val lower = s.lowercase()
                words.count { it in lower } >= needed && FINISHED.containsMatchIn(s) && !STILL_OPEN.containsMatchIn(s)
            }
            if (claimed) {
                val finished = day.finished.joinToString { "\"${it.title}\"" }.ifEmpty { "nothing" }
                return "The summary says \"${card.title}\" is finished, but it is still open. Finished today: $finished. Rewrite the summary."
            }
        }
        return null
    }
}
