package app.spatialdesk.server.agent

import app.spatialdesk.shared.Board
import app.spatialdesk.shared.EngineResult
import app.spatialdesk.shared.Op
import app.spatialdesk.shared.Pose
import app.spatialdesk.shared.Priority
import app.spatialdesk.shared.TimerState
import app.spatialdesk.shared.Workspace
import app.spatialdesk.shared.WorkspaceEngine
import app.spatialdesk.shared.WorkspaceJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.time.Clock

@Serializable
enum class Intent(val label: String) {
    @SerialName("plan_my_day") PlanMyDay("plan my day"),
    @SerialName("prioritise") Prioritise("prioritise"),
    @SerialName("focus") Focus("focus"),
    @SerialName("clear_done") ClearDone("clear done"),
    @SerialName("summarise") Summarise("summarise"),
    @SerialName("custom") Custom("custom request"),

    // Week 4: the agent reacting to what just happened (see PlanRequest.context).
    @SerialName("next_block") NextBlock("next block"),
    @SerialName("replan") Replan("replan"),
    @SerialName("regroup") Regroup("regroup"),

    // The end of the day: what got done is cleared away and tomorrow's first task is on top.
    @SerialName("wrap_up") WrapUp("wrap up my day"),
}

@Serializable
data class PlanRequest(
    val intent: Intent,
    val text: String? = null,
    val workspace: Workspace,
    /** The user's clock, already formatted ("Tuesday 2026-10-07 09:10 (UTC+02:00)"): plans fit the hours left. */
    val localTime: String? = null,
    val viewer: Pose? = null,
    /** What just happened, from the headset's own observation ("timer X finished", "Y is running over"). */
    val context: String? = null,
)

/** One step of a plan: an engine op (exactly what the headset will apply) and the reason shown to the user. */
@Serializable
data class PlanStep(val op: JsonObject, val why: String)

@Serializable
data class PlanResponse(
    val ok: Boolean,
    val summary: String? = null,
    val steps: List<PlanStep> = emptyList(),
    /** The model id, or "built-in" when the deterministic planner answered. */
    val source: String? = null,
    val latencyMs: Long? = null,
    val attempts: Int? = null,
    /** Why the built-in planner answered instead of the model, when it did. */
    val note: String? = null,
    val error: String? = null,
)

/** What a model proposes, before any checking: free-form steps exactly as it wrote them. */
data class ModelPlan(val summary: String, val steps: List<JsonObject>)

/** Bedrock itself failed (permissions, throttling, outage, timeout): retrying the same input will not help. */
class AiUnavailableException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

fun interface PlanModel {
    /** [feedback] is why the previous answer was rejected, for the one retry. */
    fun propose(system: String, user: String, feedback: String?): ModelPlan
}

/**
 * The agent loop, server side: describe the workspace, ask the model for a plan through one forced tool call,
 * normalise the obvious slips, then validate every step with the same Kotlin engine the headset runs. A rejected
 * plan goes back to the model once with the exact error; if it still fails, or Bedrock is unavailable, the
 * deterministic built-in planner answers instead (and says so), so the user always gets a usable plan.
 */
class Planner(
    private val model: PlanModel,
    private val modelId: String,
    private val clock: Clock,
    private val builtIn: BuiltInPlanner = BuiltInPlanner(),
) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun plan(request: PlanRequest): PlanResponse {
        val started = System.nanoTime()
        val elapsed = { (System.nanoTime() - started) / 1_000_000 }
        val now = clock.millis().toDouble()
        val facts = Guardrails.facts(request, now)
        val user = Prompt.user(request, now, facts.lines)
        var feedback: String? = null
        for (attempt in 1..2) {
            val proposed = try {
                model.propose(Prompt.SYSTEM, user, feedback)
            } catch (e: AiUnavailableException) {
                log.warn("agent model unavailable: {}", e.message)
                return fallback(request, now, facts, elapsed(), attempt, e.message ?: "The AI service is unavailable right now")
            }
            when (val checked = check(request, proposed, now, facts)) {
                is Checked.Valid -> {
                    log.info("agent plan intent={} steps={} attempt={} ms={}", request.intent, checked.steps.size, attempt, elapsed())
                    return PlanResponse(true, proposed.summary.trim(), checked.steps, modelId, elapsed(), attempt)
                }
                is Checked.Invalid -> {
                    log.info("agent plan rejected intent={} attempt={} reason={}", request.intent, attempt, checked.reason)
                    feedback = checked.reason
                }
            }
        }
        return fallback(request, now, facts, elapsed(), 2, "The AI's plan did not pass validation")
    }

    private fun fallback(request: PlanRequest, now: Double, facts: Guardrails.Facts, ms: Long, attempts: Int, why: String): PlanResponse {
        val plan = builtIn.plan(request, facts)
        return when (val checked = check(request, plan, now, facts)) {
            is Checked.Valid -> PlanResponse(true, plan.summary, checked.steps, BUILT_IN, ms, attempts, note = "$why, so the built-in planner made this plan.")
            is Checked.Invalid -> PlanResponse(false, attempts = attempts, latencyMs = ms, error = "$why. ${checked.reason}")
        }
    }

    private sealed class Checked {
        class Valid(val steps: List<PlanStep>) : Checked()
        class Invalid(val reason: String) : Checked()
    }

    private fun check(request: PlanRequest, plan: ModelPlan, now: Double, facts: Guardrails.Facts): Checked {
        SummaryCheck.violation(request, plan.summary)?.let { return Checked.Invalid(it) }
        if (plan.steps.size > MAX_STEPS) return Checked.Invalid("The plan has ${plan.steps.size} steps; use at most $MAX_STEPS.")
        val normalised = Normaliser(request.workspace).normalise(plan.steps)
        if (normalised.isEmpty()) {
            val maySkip = request.intent in setOf(Intent.Summarise, Intent.Regroup, Intent.Custom, Intent.WrapUp)
            return if (maySkip && plan.summary.isNotBlank()) Checked.Valid(emptyList())
            else Checked.Invalid("The plan has no steps. Call submit_plan with at least one step.")
        }
        Guardrails.violation(request, facts, normalised.map { it.first })?.let { return Checked.Invalid(it) }
        val ops = normalised.mapIndexed { i, (json, _) ->
            val name = json["op"]?.jsonPrimitive?.contentOrNull
            if (name !in AGENT_OPS) return Checked.Invalid("Step ${i + 1} uses '$name', which is not allowed. Allowed: ${AGENT_OPS.joinToString()}.")
            runCatching { WorkspaceJson.decodeFromJsonElement(Op.serializer(), json) }.getOrElse { e ->
                return Checked.Invalid("Step ${i + 1} ($name) is malformed: ${e.message?.lineSequence()?.firstOrNull()?.take(160)}")
            }
        }
        return when (val result = WorkspaceEngine.applyAll(request.workspace, ops, now, request.viewer)) {
            is EngineResult.Success -> Checked.Valid(normalised.map { (op, why) -> PlanStep(op, why) })
            is EngineResult.Failure -> {
                val name = normalised.getOrNull(result.opIndex)?.first?.get("op")?.jsonPrimitive?.contentOrNull
                Checked.Invalid(if (result.opIndex < 0) result.error else "Step ${result.opIndex + 1} ($name) was rejected: ${result.error}")
            }
        }
    }

    companion object {
        const val BUILT_IN = "built-in"
        const val MAX_STEPS = 24

        /** What the agent may do. Deleting boards, moving panels or dismissing timers stays with the user's hands. */
        val AGENT_OPS = setOf(
            "create_board", "add_card", "update_card", "move_card", "remove_card", "clear_done", "focus_board", "start_timer", "arrange_space",
        )
    }
}

/**
 * Fixes the slips models make that have exactly one sensible reading, so a near-miss costs no retry: a card op
 * with no board means the board just created (or the focus board); an estimate of 0 means no estimate; a timer
 * with no usable length is a 25-minute pomodoro. Blank strings and nulls are dropped. Anything ambiguous is left for
 * the engine to reject with a precise error.
 */
class Normaliser(private val workspace: Workspace) {
    fun normalise(steps: List<JsonObject>): List<Pair<JsonObject, String>> {
        var lastBoard: String? = workspace.boards.firstOrNull { it.id == workspace.focusBoardId }?.title
        var createdOne = false
        return steps.mapNotNull { raw ->
            val why = raw["why"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { "Part of the plan" }
            val op = raw["op"]?.jsonPrimitive?.contentOrNull
            val fields = raw.filterKeys { it != "why" }.filterValues { it.isMeaningful() }.toMutableMap()
            when (op) {
                "create_board" -> {
                    fields["title"]?.jsonPrimitive?.contentOrNull?.let { lastBoard = it }
                    // The board an agent creates is the one the user works on next: in front, unless it said otherwise.
                    if (!createdOne && "focus" !in fields) fields["focus"] = JsonPrimitive(true)
                    createdOne = true
                    (fields["cards"] as? JsonArray)?.let { cards ->
                        fields["cards"] = buildJsonArray {
                            for (card in cards) {
                                val obj = card as? JsonObject ?: continue
                                add(JsonObject(obj.filterValues { it.isMeaningful() }.toMutableMap().also { fixEstimate(it) }))
                            }
                        }
                    }
                }
                "add_card" -> {
                    if ("board" !in fields) lastBoard?.let { fields["board"] = JsonPrimitive(it) }
                    fixEstimate(fields)
                }
                "update_card" -> {
                    cardFromTitle(fields)
                    fixEstimate(fields)
                }
                "remove_card" -> cardFromTitle(fields)
                "move_card" -> {
                    cardFromTitle(fields)
                    fields["index"]?.jsonPrimitive?.doubleOrNull?.let { if (it < 0) fields["index"] = JsonPrimitive(0) }
                    // "board" is the target board; a board that lacks the named column was meant as the source.
                    val board = fields["board"]?.jsonPrimitive?.contentOrNull?.let { name -> workspace.boards.firstOrNull { it.title.equals(name, true) || it.id == name } }
                    val column = fields["column"]?.jsonPrimitive?.contentOrNull
                    if (board != null && column != null && board.columns.none { it.title.equals(column, true) || it.id == column }) fields.remove("board")
                }
                // Focusing "nothing in particular" is a no-op: drop it rather than spend a retry.
                "focus_board" -> if ("board" !in fields) return@mapNotNull null
                "start_timer" -> {
                    val minutes = fields["minutes"]?.jsonPrimitive?.doubleOrNull
                    if (minutes == null || minutes < 1 || minutes > 180) fields["minutes"] = JsonPrimitive(25)
                }
            }
            JsonObject(fields) to why
        }
    }

    /** Models often name the card they mean in "title": without a "card", that is the reference, not a rename. */
    private fun cardFromTitle(fields: MutableMap<String, JsonElement>) {
        if ("card" !in fields) fields.remove("title")?.let { fields["card"] = it }
    }

    private fun fixEstimate(fields: MutableMap<String, JsonElement>) {
        val minutes = fields["minutes"]?.jsonPrimitive?.doubleOrNull ?: return
        if (minutes < 1) fields.remove("minutes") else fields["minutes"] = JsonPrimitive(minutes.coerceAtMost(600.0).toInt())
    }

    private fun JsonElement.isMeaningful(): Boolean = when (this) {
        is JsonNull -> false
        is JsonPrimitive -> !isString || content.isNotBlank()
        else -> true
    }
}

/** The prompt, in two parts: fixed rules (system) and the workspace as compact text (user). */
object Prompt {
    val SYSTEM: String = Prompt::class.java.getResource("/agent/system-prompt.txt")!!.readText()
    const val MAX_TEXT = 600
    const val MAX_CONTEXT = 300

    fun user(request: PlanRequest, nowMs: Double? = null, facts: List<String> = emptyList()): String = buildString {
        request.localTime?.let { append("Local time: ").append(it.take(80)).append(".\n") }
        append(describe(request.workspace, nowMs))
        request.context?.trim()?.take(MAX_CONTEXT)?.takeIf { it.isNotEmpty() }?.let { append("What just happened: ").append(it).append('\n') }
        if (facts.isNotEmpty()) {
            append("Facts for this request (checked by the app, plans that ignore them are rejected):\n")
            facts.forEach { append("- ").append(it).append('\n') }
        }
        append("\nIntent: ").append(request.intent.label).append(".\n")
        val text = request.text?.trim()?.take(MAX_TEXT)
        if (!text.isNullOrEmpty()) append("User says: \"").append(text.replace('"', '\'')).append("\"\n")
        else append("The user did not add any text: work from the workspace as it is.\n")
    }

    fun describe(ws: Workspace, nowMs: Double? = null): String = buildString {
        val boards = ws.boards.sortedByDescending { it.id == ws.focusBoardId }
        append(if (boards.isEmpty()) "Workspace: no boards yet.\n" else "Workspace:\n")
        boards.forEachIndexed { i, board -> append(i + 1).append(". ").append(boardLine(board, board.id == ws.focusBoardId, nowMs)).append('\n') }
        val timers = ws.timers.joinToString { t ->
            val state = when (t.state) {
                TimerState.Running -> "running"
                TimerState.Paused -> "paused, ${(t.remainingMs / 60_000).toInt()} min left"
                TimerState.Done -> "finished"
            }
            "\"${t.label}\" $state"
        }
        append("Timers: ").append(timers.ifEmpty { "none" }).append(". ")
        append("Room for ${4 - ws.boards.size} more boards and ${3 - ws.timers.size} more timers.\n")
    }

    private fun boardLine(board: Board, focus: Boolean, nowMs: Double?): String {
        val columns = board.columns.mapIndexed { c, column ->
            // Cards between the first and last column are in progress: say for how long, so the model can tell a
            // card that just had one block from one that is running over its estimate.
            val inProgress = c in 1 until board.columns.size - 1
            val cards = column.cards.take(12).joinToString { card ->
                buildString {
                    append('"').append(card.title).append('"')
                    card.minutes?.let { append(' ').append(it).append(" min") }
                    if (card.priority != Priority.Normal) append(' ').append(card.priority.name.lowercase())
                    if (inProgress && nowMs != null && card.since != null) {
                        append(", in progress ").append(((nowMs - card.since!!) / 60_000).toInt().coerceAtLeast(0)).append(" min")
                    }
                }
            }
            "\"${column.title}\" (${column.cards.size} cards${if (cards.isEmpty()) "" else ": $cards"})"
        }
        return "\"${board.title}\"${if (focus) " [focus board]" else ""} columns: ${columns.joinToString()}"
    }
}

/**
 * A deterministic planner for when the model cannot help (offline, throttled, or two invalid plans) and for tests.
 * Plain rules, honest summaries: it never pretends to be the AI.
 */
class BuiltInPlanner {
    fun plan(request: PlanRequest, facts: Guardrails.Facts = Guardrails.Facts(emptyList(), emptyList())): ModelPlan {
        val ws = request.workspace
        val focus = ws.boards.firstOrNull { it.id == ws.focusBoardId }
        if (request.intent == Intent.NextBlock && facts.unfinished.isNotEmpty()) {
            val card = facts.unfinished.first()
            return ModelPlan(
                "A five-minute break, then back to \"${card.title}\".",
                listOf(step("start_timer", "A short break after a focus block") { put("minutes", 5); put("label", "Break") }),
            )
        }
        return when (request.intent) {
            Intent.PlanMyDay, Intent.Custom -> planDay(ws, tasks(request.text))
            Intent.Prioritise -> prioritise(focus)
            Intent.Focus -> focusOn(focus)
            Intent.ClearDone -> ModelPlan("Cleared the last column of every board.", listOf(step("clear_done", "Finished cards out of the way")))
            Intent.Summarise -> ModelPlan(summary(ws), emptyList())
            Intent.NextBlock -> focusOn(focus, skipping = request.context)
            Intent.Replan -> prioritise(focus)
            Intent.Regroup -> ModelPlan("Your boards already have a clear place each; nothing to regroup.", emptyList())
            Intent.WrapUp -> wrapUp(ws)
        }
    }

    /** The end of the day: what got done is named, then cleared away; tomorrow starts with the first task in progress. */
    private fun wrapUp(ws: Workspace): ModelPlan {
        val day = WrapUpDay.of(ws)
        val done = day.finished.map { it.title }
        val next = day.next
        val steps = ws.boards.filter { b -> b.columns.size > 1 && b.columns.last().cards.isNotEmpty() }.map { b ->
            step("clear_done", "Today's finished work, cleared away") { put("board", b.title) }
        }
        val finished = when {
            done.isEmpty() -> "Nothing reached Done today, and that is fine: tomorrow is a fresh start."
            else -> "Today you finished " + done.take(3).joinToString { "\"$it\"" } + (if (done.size > 3) " and ${done.size - 3} more" else "") + "."
        }
        return ModelPlan(finished + (next?.let { " Tomorrow starts with \"${it.title}\"." } ?: ""), steps)
    }

    private fun planDay(ws: Workspace, tasks: List<String>): ModelPlan {
        if (tasks.isEmpty()) return focusOn(ws.boards.firstOrNull { it.id == ws.focusBoardId })
        val today = ws.boards.firstOrNull { it.title.equals("Today", ignoreCase = true) }
        val first = tasks.first()
        val steps = buildList {
            if (today == null) {
                add(
                    step("create_board", "One board for today, first task in progress") {
                        put("title", "Today")
                        put("cards", buildJsonArray {
                            tasks.forEachIndexed { i, task ->
                                add(buildJsonObject {
                                    put("title", task)
                                    put("column", if (i == 0) "Doing" else "To do")
                                    put("priority", if (i == 0) "high" else "normal")
                                })
                            }
                        })
                    },
                )
            } else {
                tasks.forEach { task -> add(step("add_card", "Added to today") { put("board", today.title); put("title", task) }) }
                val doing = today.columns.getOrNull(1) ?: today.columns.first()
                add(step("move_card", "Start with the first task") { put("card", first); put("board", today.title); put("column", doing.title) })
            }
            add(step("start_timer", "A first pomodoro") { put("minutes", 25); put("card", first) })
            add(step("arrange_space", "Other boards step back") { put("layout", "focus") })
        }
        return ModelPlan("${tasks.size} tasks on today's board, starting with \"$first\" and a 25-minute timer.", steps)
    }

    private fun prioritise(board: Board?): ModelPlan {
        val column = board?.columns?.firstOrNull() ?: return ModelPlan("There is no board to prioritise yet.", emptyList())
        val order = column.cards.sortedWith(compareBy({ -it.priority.ordinal }, { it.minutes ?: Int.MAX_VALUE }))
        val steps = order.mapIndexed { i, card ->
            step("move_card", if (i == 0) "Highest priority first" else "Then by priority and size") {
                put("card", card.id); put("board", board.id); put("column", column.id); put("index", i)
            }
        }
        return ModelPlan("Sorted \"${column.title}\" by priority, quick tasks first among equals.", steps)
    }

    /** [skipping] is the context line: a card it names (the block that just ended) is not picked again. */
    private fun focusOn(board: Board?, skipping: String? = null): ModelPlan {
        val doing = board?.columns?.getOrNull(1)
        val open = (doing?.cards.orEmpty() + board?.columns?.firstOrNull()?.cards.orEmpty()).filter { skipping == null || !skipping.contains(it.title) }
        val card = open.firstOrNull()
            ?: return ModelPlan("Nothing to focus on yet: add a task first.", emptyList())
        val steps = buildList {
            if (doing != null && doing.cards.none { it.id == card.id }) {
                add(step("move_card", "Next task, now in progress") { put("card", card.id); put("column", doing.id); put("index", 0) })
            }
            add(step("start_timer", "25 minutes on it") { put("minutes", 25); put("card", card.id) })
            add(step("arrange_space", "Other boards step back") { put("layout", "focus") })
        }
        return ModelPlan("Focus on \"${card.title}\" for 25 minutes.", steps)
    }

    private fun summary(ws: Workspace): String {
        val open = ws.boards.sumOf { b -> b.columns.dropLast(1).sumOf { it.cards.size } }
        val next = ws.boards.firstOrNull { it.id == ws.focusBoardId }?.columns?.getOrNull(1)?.cards?.firstOrNull()?.title
        return "You have $open open cards on ${ws.boards.size} boards." + (next?.let { " Next up: \"$it\"." } ?: "")
    }

    /** "report, call Ana and gym at 18:00" -> three tasks; English and Spanish joiners. */
    private fun tasks(text: String?): List<String> = text.orEmpty()
        .split(Regex("[,;\\n]|\\s+(and|y|then|luego)\\s+", RegexOption.IGNORE_CASE))
        .map { it.trim().trimEnd('.').replaceFirstChar(Char::uppercaseChar) }
        .filter { it.length >= 3 }
        .take(8)

    private fun step(op: String, why: String, fields: JsonObjectBuilder.() -> Unit = {}): JsonObject =
        buildJsonObject { put("op", op); fields(); put("why", why) }
}

/** The model's tool input, read leniently: an object with summary and steps. */
fun modelPlanFrom(input: JsonElement): ModelPlan {
    val obj = input as? JsonObject ?: throw IllegalArgumentException("submit_plan input must be an object")
    val steps = (obj["steps"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    return ModelPlan(obj["summary"]?.jsonPrimitive?.contentOrNull.orEmpty(), steps)
}
