package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Where things go, relative to the user's anchor (eye position and facing). The numbers follow the comfort rules in
 * docs (ROADMAP heuristic A): what you work with sits within arm's reach (0.55-0.65 m), slightly below eye level and
 * leaning back toward the eyes; what you only glance at is parked further out, where a pinch ray still reaches it.
 */
object Layout {
    /** Eyes of a seated or standing adult at the origin, facing -Z: the IWSDK default view. */
    val DEFAULT_ANCHOR = Pose(0.0, 1.6, 0.0)

    /** World size of a board panel (metres). Shared with the app, which sizes the UIKit document to it. */
    const val BOARD_WIDTH = 0.72
    const val BOARD_HEIGHT = 0.5
    const val TIMER_WIDTH = 0.24
    const val TIMER_HEIGHT = 0.16

    private class Slot(val yawDeg: Double, val distance: Double, val dy: Double)

    private val FOCUS = Slot(0.0, 0.62, -0.17)
    private val PARKED = listOf(Slot(52.0, 1.45, 0.08), Slot(-52.0, 1.45, 0.08), Slot(0.0, 1.7, 0.45))
    private val FAR = listOf(Slot(80.0, 2.4, 0.2), Slot(-80.0, 2.4, 0.2), Slot(0.0, 2.8, 1.0))
    private val TIMERS = listOf(Slot(-50.0, 0.55, -0.3), Slot(-50.0, 0.55, -0.13), Slot(-70.0, 0.55, -0.215))
    private val COMMAND = Slot(50.0, 0.55, -0.24)

    val parkedSlots: Int get() = PARKED.size
    val timerSlots: Int get() = TIMERS.size

    fun focus(anchor: Pose): Pose = place(anchor, FOCUS)

    fun parked(anchor: Pose, index: Int, far: Boolean = false): Pose {
        val slots = if (far) FAR else PARKED
        return place(anchor, slots[index.mod(slots.size)])
    }

    fun timer(anchor: Pose, index: Int): Pose = place(anchor, TIMERS[index.mod(TIMERS.size)])

    fun command(anchor: Pose): Pose = place(anchor, COMMAND)

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
