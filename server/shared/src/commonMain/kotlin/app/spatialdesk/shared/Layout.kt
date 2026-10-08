package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Where things go, relative to the user's anchor (eye position and facing). The numbers follow the comfort rules
 * (ROADMAP heuristic A): what you work with sits within arm's reach (0.55-0.66 m), the focus board slightly below eye
 * level and leaning back toward the eyes; what you only glance at is parked further out, where a pinch ray still
 * reaches it.
 *
 * The sides have one job each, so no pinch ray has to cross a near panel to reach a far one (the synthetic-noise
 * test in tests/interaction.spec.ts measures exactly this): the left is the console (command panel), the right is
 * the shelf (parked boards), and timers sit in a row just above the focus board, always in view.
 */
object Layout {
    /** Eyes of a seated or standing adult at the origin, facing -Z: the IWSDK default view. */
    val DEFAULT_ANCHOR = Pose(0.0, 1.6, 0.0)

    /** World size of a board panel (metres). Shared with the app, which sizes the UIKit document to it. */
    const val BOARD_WIDTH = 0.72
    const val BOARD_HEIGHT = 0.5
    const val TIMER_WIDTH = 0.24
    const val TIMER_HEIGHT = 0.16
    /** The command panel keeps its natural UIKit size (public/ui/command.uikitml); these bound it for layout checks. */
    const val COMMAND_WIDTH = 0.36
    const val COMMAND_HEIGHT = 0.74

    private class Slot(val yawDeg: Double, val distance: Double, val dy: Double)

    private val FOCUS = Slot(0.0, 0.62, -0.17)
    private val PARKED = listOf(Slot(-58.0, 1.45, 0.05), Slot(-58.0, 1.6, 0.62), Slot(92.0, 1.45, 0.05))
    private val FAR = listOf(Slot(-85.0, 2.4, 0.2), Slot(-85.0, 2.6, 1.1), Slot(115.0, 2.4, 0.2))
    private val TIMERS = listOf(Slot(0.0, 0.66, 0.24), Slot(-23.0, 0.66, 0.24), Slot(23.0, 0.66, 0.24))
    private val COMMAND = Slot(50.0, 0.55, -0.24)
    /** The agent's plan preview: a modal card in front of the focus board, gone once applied or discarded. */
    private val PREVIEW = Slot(0.0, 0.5, -0.05)

    val parkedSlots: Int get() = PARKED.size
    val timerSlots: Int get() = TIMERS.size

    fun focus(anchor: Pose): Pose = place(anchor, FOCUS)

    fun parked(anchor: Pose, index: Int, far: Boolean = false): Pose {
        val slots = if (far) FAR else PARKED
        return place(anchor, slots[index.mod(slots.size)])
    }

    fun timer(anchor: Pose, index: Int): Pose = place(anchor, TIMERS[index.mod(TIMERS.size)])

    fun command(anchor: Pose): Pose = place(anchor, COMMAND)

    fun preview(anchor: Pose): Pose = place(anchor, PREVIEW)

    /** Slot [distance] metres from the eyes along [Slot.yawDeg], turned and tilted to face them. */
    private fun place(anchor: Pose, slot: Slot): Pose {
        val yaw = anchor.yaw + slot.yawDeg * PI / 180.0
        return Pose(
            x = anchor.x - sin(yaw) * slot.distance,
            y = anchor.y + slot.dy,
            z = anchor.z - cos(yaw) * slot.distance,
            yaw = yaw,
            pitch = atan2(slot.dy, slot.distance),
        )
    }

    internal fun distance(a: Pose, b: Pose): Double = hypot(hypot(a.x - b.x, a.y - b.y), a.z - b.z)
}
