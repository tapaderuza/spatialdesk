package app.spatialdesk.shared

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Bumped when the stored workspace format changes incompatibly; older saves are then discarded, not misread. */
const val WORKSPACE_SCHEMA = 1

/**
 * Where something sits in the room: metres, world space, and radians. Rotation is yaw about +Y, then pitch about
 * the panel's own X axis (three.js Euler order "YXZ"), so a panel below eye level can lean back toward the user.
 */
@Serializable
data class Pose(val x: Double, val y: Double, val z: Double, val yaw: Double = 0.0, val pitch: Double = 0.0)

@Serializable
enum class Priority {
    @SerialName("low") Low,
    @SerialName("normal") Normal,
    @SerialName("high") High,
}

@Serializable
data class Card(val id: String, val title: String, val minutes: Int? = null, val priority: Priority = Priority.Normal)

@Serializable
data class Column(val id: String, val title: String, val cards: List<Card> = emptyList())

@Serializable
data class Board(val id: String, val title: String, val columns: List<Column>, val pose: Pose)

@Serializable
enum class TimerState {
    @SerialName("running") Running,
    @SerialName("paused") Paused,
    @SerialName("done") Done,
}

/**
 * A countdown pinned in space. While running, [endsAtMs] (epoch ms) is the truth and the display derives the rest;
 * paused or done, [remainingMs] is. Absolute end times survive a reload: a timer keeps running while the app is shut.
 */
@Serializable
data class Timer(
    val id: String,
    val label: String,
    val durationMs: Double,
    val state: TimerState,
    val endsAtMs: Double? = null,
    val remainingMs: Double,
    val cardId: String? = null,
    val pose: Pose,
)

/**
 * The whole workspace: small, plain data, replaced (never mutated) by every operation. [anchor] is the user's home
 * pose (eye position and facing); every layout slot is relative to it, so "bring everything to me" just moves it.
 */
@Serializable
data class Workspace(
    val schema: Int = WORKSPACE_SCHEMA,
    val revision: Int = 0,
    val nextId: Int = 1,
    val anchor: Pose = Layout.DEFAULT_ANCHOR,
    val focusBoardId: String? = null,
    val boards: List<Board> = emptyList(),
    val timers: List<Timer> = emptyList(),
)

@Serializable
data class NewCard(val title: String, val column: String? = null, val minutes: Int? = null, val priority: Priority = Priority.Normal)

@Serializable
enum class Arrangement {
    /** Focus board within arm's reach, the others parked in an arc, timers by the right hand. */
    @SerialName("desk") Desk,

    /** Like [Desk], but the other boards move far out to the sides. */
    @SerialName("focus") Focus,
}

/**
 * Everything that can change a workspace, by the user's hands or by the AI agent: one vocabulary, one validator.
 * References ([AddCard.board], [MoveCard.card], ...) accept an id or a title, because the agent plans with the
 * titles it chose itself before any id exists.
 */
@Serializable
sealed class Op {
    @Serializable
    @SerialName("create_board")
    data class CreateBoard(
        val title: String,
        val columns: List<String> = DEFAULT_COLUMNS,
        val cards: List<NewCard> = emptyList(),
        /** Null: becomes the focus board only if there is none yet. */
        val focus: Boolean? = null,
    ) : Op()

    @Serializable
    @SerialName("add_card")
    data class AddCard(
        val board: String,
        val title: String,
        val column: String? = null,
        val minutes: Int? = null,
        val priority: Priority = Priority.Normal,
        val index: Int? = null,
    ) : Op()

    @Serializable
    @SerialName("move_card")
    data class MoveCard(val card: String, val column: String, val board: String? = null, val index: Int? = null) : Op()

    @Serializable
    @SerialName("remove_card")
    data class RemoveCard(val card: String, val board: String? = null) : Op()

    /** Removes the cards in the last column of one board, or of every board. */
    @Serializable
    @SerialName("clear_done")
    data class ClearDone(val board: String? = null) : Op()

    @Serializable
    @SerialName("delete_board")
    data class DeleteBoard(val board: String) : Op()

    @Serializable
    @SerialName("focus_board")
    data class FocusBoard(val board: String) : Op()

    @Serializable
    @SerialName("start_timer")
    data class StartTimer(val minutes: Double, val label: String? = null, val card: String? = null) : Op()

    @Serializable
    @SerialName("pause_timer")
    data class PauseTimer(val timer: String) : Op()

    @Serializable
    @SerialName("resume_timer")
    data class ResumeTimer(val timer: String) : Op()

    @Serializable
    @SerialName("add_time")
    data class AddTime(val timer: String, val minutes: Double) : Op()

    /** Sent by the app when a running timer reaches zero. */
    @Serializable
    @SerialName("finish_timer")
    data class FinishTimer(val timer: String) : Op()

    @Serializable
    @SerialName("dismiss_timer")
    data class DismissTimer(val timer: String) : Op()

    /** Re-anchors the layout on the viewer (when the app passes one) and puts everything back in its slot. */
    @Serializable
    @SerialName("arrange_space")
    data class ArrangeSpace(val layout: Arrangement = Arrangement.Desk) : Op()

    /** A board or timer was grabbed and released somewhere else. */
    @Serializable
    @SerialName("set_pose")
    data class SetPose(val id: String, val pose: Pose) : Op()
}

val DEFAULT_COLUMNS = listOf("To do", "Doing", "Done")

/** Hard limits: they keep the scene inside its draw-call budget and give the agent a clear "no". */
object Limits {
    const val BOARDS = 4
    const val COLUMNS = 4
    const val CARDS_PER_COLUMN = 12
    const val TIMERS = 3
    const val TITLE_CHARS = 48
    const val TIMER_MAX_MINUTES = 180.0
    const val CARD_MAX_MINUTES = 600
    const val OPS_PER_BATCH = 64
}

/** Ops use "op" as their discriminator, so a plan reads like a list of tool calls. */
val WorkspaceJson: Json = Json {
    classDiscriminator = "op"
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}
