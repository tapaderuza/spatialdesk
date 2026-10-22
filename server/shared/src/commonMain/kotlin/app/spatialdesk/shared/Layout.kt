package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.tan

/**
 * Where things go, relative to the user's anchor (eye position and facing). The numbers follow the comfort rules
 * (ROADMAP heuristic A): what you work with sits within arm's reach (0.55-0.66 m), the focus board slightly below eye
 * level and leaning back toward the eyes; what you only glance at is parked further out, where a pinch ray still
 * reaches it.
 *
 * The sides have one job each, so no pinch ray has to cross a near panel to reach a far one (the synthetic-noise
 * test in tests/interaction.spec.ts measures exactly this): the left is the console (command panel), the right is
 * the shelf (parked boards), and timers sit in a row just above the focus board, always in view.
 *
 * Field of view: the essential panels (the focus board, the first timer and the agent's card) stay inside the
 * comfortable part of the headset's view ([ViewFit]). On a Quest the layout is used as designed; in a narrower view
 * (Meta VR Glasses) it shrinks the panels just enough and brings the board and its timer row together ([fit]).
 * Distances never change, so whatever a hand could poke stays within reach.
 */
object Layout {
    /** Eyes of a seated or standing adult at the origin, facing -Z: the IWSDK default view. */
    val DEFAULT_ANCHOR = Pose(0.0, 1.6, 0.0)

    /** World size of a board panel (metres) at scale 1. Shared with the app, which sizes the UIKit document to it. */
    const val BOARD_WIDTH = 0.72
    const val BOARD_HEIGHT = 0.5
    const val TIMER_WIDTH = 0.24
    const val TIMER_HEIGHT = 0.16
    /** The command panel keeps its natural UIKit size (public/ui/command.uikitml); these bound it for layout checks. */
    const val COMMAND_WIDTH = 0.36
    const val COMMAND_HEIGHT = 0.74
    /** The agent's card (public/ui/plan.uikitml). */
    const val PREVIEW_WIDTH = 0.46
    const val PREVIEW_HEIGHT = 0.55

    private class Slot(val yawDeg: Double, val distance: Double, val dy: Double)

    private val FOCUS = Slot(0.0, 0.62, -0.17)
    private val PARKED = listOf(Slot(-58.0, 1.45, 0.05), Slot(-58.0, 1.6, 0.62), Slot(92.0, 1.45, 0.05))
    private val FAR = listOf(Slot(-85.0, 2.4, 0.2), Slot(-85.0, 2.6, 1.1), Slot(115.0, 2.4, 0.2))
    private val TIMERS = listOf(Slot(0.0, 0.66, 0.24), Slot(-23.0, 0.66, 0.24), Slot(23.0, 0.66, 0.24))
    private val COMMAND = Slot(50.0, 0.55, -0.24)
    /** The agent's plan preview: a modal card in front of the focus board, gone once applied or discarded. */
    private val PREVIEW = Slot(0.0, 0.5, -0.05)

    /** Kept clear between essential content and the edge of the comfortable view, and between the board and timers. */
    private const val MARGIN_DEG = 2.0
    private const val GAP_DEG = 1.5
    /** Below this the text would be too small to read; a view that needs less keeps this scale and lets edges go. */
    const val MIN_SCALE = 0.6

    val parkedSlots: Int get() = PARKED.size
    val timerSlots: Int get() = TIMERS.size

    /**
     * How the layout sits in a view: the panels' scale (1 = designed size), the height of the focus board and of the
     * timer row above it, how far the side timers turn, and the height of the agent's card.
     */
    class Fit(val scale: Double, val focusDy: Double, val timerDy: Double, val sideTimerYawDeg: Double, val previewDy: Double)

    /** The last view asked and its fit, as one reference so concurrent callers (the server) never mix two views. */
    private var cache: Pair<ViewFit, Fit>? = null

    /** The largest scale (at most 1) at which the essential panels fit in [view]; cached for the last view asked. */
    fun fit(view: ViewFit): Fit {
        cache?.let { (cachedView, cachedFit) -> if (cachedView == view) return cachedFit }
        val fit = fitAt(view, 1.0) ?: run {
            // Every constraint loosens as the panels shrink, so the largest scale that fits is found by bisection.
            var lo = MIN_SCALE
            var hi = 1.0
            repeat(24) {
                val mid = (lo + hi) / 2
                if (fitAt(view, mid) != null) lo = mid else hi = mid
            }
            fitAt(view, lo) ?: Fit(MIN_SCALE, FOCUS.dy, TIMERS[0].dy, TIMERS[2].yawDeg, PREVIEW.dy)
        }
        cache = view to fit
        return fit
    }

    fun scale(view: ViewFit = ViewFit()): Double = fit(view).scale

    fun focus(anchor: Pose, view: ViewFit = ViewFit()): Pose = place(anchor, FOCUS.yawDeg, FOCUS.distance, fit(view).focusDy)

    /** Parked boards are glanced at, outside any view's essential part: their slots do not depend on the view. */
    fun parked(anchor: Pose, index: Int, far: Boolean = false): Pose {
        val slots = if (far) FAR else PARKED
        return place(anchor, slots[index.mod(slots.size)])
    }

    fun timer(anchor: Pose, index: Int, view: ViewFit = ViewFit()): Pose {
        val fit = fit(view)
        val slot = TIMERS[index.mod(TIMERS.size)]
        val yaw = if (slot.yawDeg == 0.0) 0.0 else if (slot.yawDeg < 0) -fit.sideTimerYawDeg else fit.sideTimerYawDeg
        return place(anchor, yaw, slot.distance, fit.timerDy)
    }

    /** The console is a panel you turn to, like a second monitor: its slot does not depend on the view either. */
    fun command(anchor: Pose): Pose = place(anchor, COMMAND)

    fun preview(anchor: Pose, view: ViewFit = ViewFit()): Pose = place(anchor, PREVIEW.yawDeg, PREVIEW.distance, fit(view).previewDy)

    /**
     * The layout at scale [s], or null when the essential panels do not fit: the focus board keeps its height unless its
     * bottom edge would leave the view, the timer row comes down only as far as its top edge needs, and the board, the
     * first timer and the agent's card must each fit across.
     */
    private fun fitAt(view: ViewFit, s: Double): Fit? {
        val top = view.upDeg - MARGIN_DEG
        val bottom = MARGIN_DEG - view.downDeg
        val side = view.halfWidthDeg - MARGIN_DEG

        var boardEl = elevation(FOCUS)
        repeat(2) { boardEl = max(elevation(FOCUS), bottom + halfAngle(BOARD_HEIGHT * s / 2, FOCUS.distance, boardEl)) }
        val boardHalf = halfAngle(BOARD_HEIGHT * s / 2, FOCUS.distance, boardEl)
        if (halfAngle(BOARD_WIDTH * s / 2, FOCUS.distance, boardEl) > side) return null

        val row = TIMERS[0]
        var timerEl = elevation(row)
        repeat(2) { timerEl = min(elevation(row), top - halfAngle(TIMER_HEIGHT * s / 2, row.distance, timerEl)) }
        val timerHalf = halfAngle(TIMER_HEIGHT * s / 2, row.distance, timerEl)
        if (timerEl - timerHalf < boardEl + boardHalf + GAP_DEG) return null
        val timerHalfWidth = halfAngle(TIMER_WIDTH * s / 2, row.distance, timerEl)
        if (timerHalfWidth > side) return null

        var previewEl = elevation(PREVIEW)
        repeat(2) {
            val half = halfAngle(PREVIEW_HEIGHT * s / 2, PREVIEW.distance, previewEl)
            if (bottom + half > top - half) return null
            previewEl = elevation(PREVIEW).coerceIn(bottom + half, top - half)
        }
        if (halfAngle(PREVIEW_WIDTH * s / 2, PREVIEW.distance, previewEl) > side) return null

        // The side timers stand next to the first one, no further out than designed and inside the view if they can.
        val sideYaw = min(TIMERS[2].yawDeg, max(2 * timerHalfWidth + GAP_DEG, side - timerHalfWidth))
        return Fit(
            scale = s,
            focusDy = heightAt(FOCUS, boardEl),
            timerDy = heightAt(row, timerEl),
            sideTimerYawDeg = sideYaw,
            previewDy = heightAt(PREVIEW, previewEl),
        )
    }

    /** Degrees above (+) or below (-) the eyes. */
    private fun elevation(slot: Slot): Double = atan2(slot.dy, slot.distance) * 180 / PI

    /** The slot's own height when [el] is its designed elevation (exactly as designed), else the height at [el]. */
    private fun heightAt(slot: Slot, el: Double): Double = if (el == elevation(slot)) slot.dy else slot.distance * tan(el * PI / 180)

    /** Half the angle a panel half-size [half] fills, facing the eyes at horizontal [distance] and elevation [el]. */
    private fun halfAngle(half: Double, distance: Double, el: Double): Double = atan(half * cos(el * PI / 180) / distance) * 180 / PI

    private fun place(anchor: Pose, slot: Slot): Pose = place(anchor, slot.yawDeg, slot.distance, slot.dy)

    /** [distance] metres from the eyes along [yawDeg], [dy] above them, turned and tilted to face them. */
    private fun place(anchor: Pose, yawDeg: Double, distance: Double, dy: Double): Pose {
        val yaw = anchor.yaw + yawDeg * PI / 180.0
        return Pose(
            x = anchor.x - sin(yaw) * distance,
            y = anchor.y + dy,
            z = anchor.z - cos(yaw) * distance,
            yaw = yaw,
            pitch = atan2(dy, distance),
        )
    }

    internal fun distance(a: Pose, b: Pose): Double = hypot(hypot(a.x - b.x, a.y - b.y), a.z - b.z)
}
