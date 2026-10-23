package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.abs
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
 * Distances never change for a view, so whatever a hand could poke stays within reach.
 *
 * The body ([Comfort]): what you work with comes nearer or goes further ([Comfort.reach], the same angles), the
 * panels grow or shrink ([Comfort.scale], as far as the view allows), everything turns round the eyes higher or lower
 * ([Comfort.tiltDeg]). With one side ([Comfort.side]) the layout leans toward it and the console moves there; when
 * the shelf is out of reach (that side only, or a head that turns less than [Comfort.turnDeg] needs) the parked
 * boards stack in tiers at the edge of what can be reached, still clear of every near panel's pinch ray.
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
    /**
     * The parked boards when the shelf is out of reach: three tiers at one yaw ([Fit.stackYawDeg]), 12 degrees below
     * the eyes, 8 and 26 above, so none hides another; further back in the focus arrangement.
     */
    private val STACK = listOf(Slot(0.0, 1.45, -0.308), Slot(0.0, 1.6, 0.225), Slot(0.0, 1.75, 0.854))
    private const val STACK_FAR = 1.6

    /** Kept clear between essential content and the edge of the comfortable view, and between the board and timers. */
    private const val MARGIN_DEG = 2.0
    private const val GAP_DEG = 1.5
    /** Below this the text would be too small to read; a view that needs less keeps this scale and lets edges go. */
    const val MIN_SCALE = 0.6
    /** How far the eyes comfortably look aside without turning the head: a panel within turnDeg + this needs no more. */
    const val EYE_DEG = 30.0
    /** How far the layout leans toward the one side a person uses. */
    private const val SIDE_SHIFT_DEG = 15.0

    val parkedSlots: Int get() = PARKED.size
    val timerSlots: Int get() = TIMERS.size

    /**
     * How the layout sits in a view, for a body: the panels' scale (1 = designed size), the height of the focus board
     * and of the timer row above it, how far the side timers turn, the height of the agent's card; where "ahead" is
     * ([homeYawDeg], toward the side a person uses), the console's yaw, and the parked boards' stack (null: the shelf
     * as designed). Yaws in degrees, + to the left.
     */
    class Fit(
        val scale: Double,
        val focusDy: Double,
        val timerDy: Double,
        val sideTimerYawDeg: Double,
        val previewDy: Double,
        val homeYawDeg: Double,
        val consoleYawDeg: Double,
        val stackYawDeg: Double?,
    )

    /** The last view and body asked and their fit, as one reference so concurrent callers (the server) never mix two. */
    private var cache: Pair<Pair<ViewFit, Comfort>, Fit>? = null

    /** The largest scale (at most the body's) at which the essential panels fit in [view]; cached for the last asked. */
    fun fit(view: ViewFit, comfort: Comfort = Comfort()): Fit {
        val key = view to comfort
        cache?.let { (cachedKey, cachedFit) -> if (cachedKey == key) return cachedFit }
        val base = fitAt(view, comfort.scale, comfort) ?: run {
            // Every constraint loosens as the panels shrink, so the largest scale that fits is found by bisection.
            var lo = MIN_SCALE
            var hi = comfort.scale
            repeat(24) {
                val mid = (lo + hi) / 2
                if (fitAt(view, mid, comfort) != null) lo = mid else hi = mid
            }
            fitAt(view, lo, comfort) ?: Fit(MIN_SCALE, FOCUS.dy, TIMERS[0].dy, TIMERS[2].yawDeg, PREVIEW.dy, 0.0, COMMAND.yawDeg, null)
        }
        val fit = withSides(base, comfort)
        cache = key to fit
        return fit
    }

    fun scale(view: ViewFit = ViewFit(), comfort: Comfort = Comfort()): Double = fit(view, comfort).scale

    fun focus(anchor: Pose, view: ViewFit = ViewFit(), comfort: Comfort = Comfort()): Pose {
        val fit = fit(view, comfort)
        return place(anchor, fit.homeYawDeg + FOCUS.yawDeg, FOCUS.distance, fit.focusDy, comfort.reach, comfort.tiltDeg)
    }

    /**
     * Parked boards are glanced at, outside any view's essential part: on the shelf as designed (further out with
     * larger panels, so they look the same), or stacked where [Fit.stackYawDeg] says.
     */
    fun parked(anchor: Pose, index: Int, far: Boolean = false, view: ViewFit = ViewFit(), comfort: Comfort = Comfort()): Pose {
        val fit = fit(view, comfort)
        val grow = max(1.0, fit.scale)
        val stack = fit.stackYawDeg
        if (stack == null) {
            val slot = (if (far) FAR else PARKED).let { it[index.mod(it.size)] }
            return place(anchor, fit.homeYawDeg + slot.yawDeg, slot.distance * grow, slot.dy * grow, 1.0, comfort.tiltDeg)
        }
        val tier = STACK[index.mod(STACK.size)]
        val back = if (far) STACK_FAR else 1.0
        return place(anchor, stack, tier.distance * grow * back, tier.dy * grow * back, 1.0, comfort.tiltDeg)
    }

    fun timer(anchor: Pose, index: Int, view: ViewFit = ViewFit(), comfort: Comfort = Comfort()): Pose {
        val fit = fit(view, comfort)
        val slot = TIMERS[index.mod(TIMERS.size)]
        val yaw = if (slot.yawDeg == 0.0) 0.0 else if (slot.yawDeg < 0) -fit.sideTimerYawDeg else fit.sideTimerYawDeg
        return place(anchor, fit.homeYawDeg + yaw, slot.distance, fit.timerDy, comfort.reach, comfort.tiltDeg)
    }

    /** The console is a panel you turn to, like a second monitor: beside the board, on the side the body uses. */
    fun command(anchor: Pose, view: ViewFit = ViewFit(), comfort: Comfort = Comfort()): Pose =
        place(anchor, fit(view, comfort).consoleYawDeg, COMMAND.distance, COMMAND.dy, comfort.reach, comfort.tiltDeg)

    fun preview(anchor: Pose, view: ViewFit = ViewFit(), comfort: Comfort = Comfort()): Pose {
        val fit = fit(view, comfort)
        return place(anchor, fit.homeYawDeg + PREVIEW.yawDeg, PREVIEW.distance, fit.previewDy, comfort.reach, comfort.tiltDeg)
    }

    /**
     * The layout at scale [s] for the body [c] (near panels at its reach), or null when the essential panels do not
     * fit: the focus board keeps its height unless its bottom edge would leave the view, the timer row comes down only
     * as far as its top edge needs, and the board, the first timer and the agent's card must each fit across. A head
     * that turns less also needs the console within its reach (the panels shrink for it; nearer, they still look larger
     * than designed).
     */
    private fun fitAt(view: ViewFit, s: Double, c: Comfort): Fit? {
        val reach = c.reach
        val top = view.upDeg - MARGIN_DEG
        val bottom = MARGIN_DEG - view.downDeg
        val side = view.halfWidthDeg - MARGIN_DEG
        val focusDistance = FOCUS.distance * reach

        var boardEl = elevation(FOCUS)
        repeat(2) { boardEl = max(elevation(FOCUS), bottom + halfAngle(BOARD_HEIGHT * s / 2, focusDistance, boardEl)) }
        val boardHalf = halfAngle(BOARD_HEIGHT * s / 2, focusDistance, boardEl)
        if (halfAngle(BOARD_WIDTH * s / 2, focusDistance, boardEl) > side) return null

        val row = TIMERS[0]
        val rowDistance = row.distance * reach
        var timerEl = elevation(row)
        repeat(2) { timerEl = min(elevation(row), top - halfAngle(TIMER_HEIGHT * s / 2, rowDistance, timerEl)) }
        val timerHalf = halfAngle(TIMER_HEIGHT * s / 2, rowDistance, timerEl)
        if (timerEl - timerHalf < boardEl + boardHalf + GAP_DEG) return null
        val timerHalfWidth = halfAngle(TIMER_WIDTH * s / 2, rowDistance, timerEl)
        if (timerHalfWidth > side) return null

        val previewDistance = PREVIEW.distance * reach
        var previewEl = elevation(PREVIEW)
        repeat(2) {
            val half = halfAngle(PREVIEW_HEIGHT * s / 2, previewDistance, previewEl)
            if (bottom + half > top - half) return null
            previewEl = elevation(PREVIEW).coerceIn(bottom + half, top - half)
        }
        if (halfAngle(PREVIEW_WIDTH * s / 2, previewDistance, previewEl) > side) return null

        // The side timers stand next to the first one, never over it; no further out than designed, inside the view if
        // they can.
        val sideYaw = max(2 * timerHalfWidth + GAP_DEG, min(TIMERS[2].yawDeg, side - timerHalfWidth))
        if (c.turnDeg < Comfort().turnDeg && consoleOffset(s, c, heightAt(row, timerEl), sideYaw) > c.turnDeg + EYE_DEG) return null
        return Fit(
            scale = s,
            focusDy = heightAt(FOCUS, boardEl),
            timerDy = heightAt(row, timerEl),
            sideTimerYawDeg = sideYaw,
            previewDy = heightAt(PREVIEW, previewEl),
            homeYawDeg = 0.0,
            consoleYawDeg = COMMAND.yawDeg,
            stackYawDeg = null,
        )
    }

    /**
     * The sides for a body: the console clears the board (larger or nearer panels take more of the view), the layout
     * leans toward the side a person uses as far as the turn allows, and the parked boards stay on the designed shelf
     * only while all of it is within reach and clear of the board and the console; otherwise they stack on the
     * shelf's side (both sides) or past the console (one side), clear of every near panel.
     */
    /**
     * How far from ahead the console stands (degrees) so it clears the board, and the side timer once it looks tall
     * enough (near) to reach the timer row. Half widths as wide as a panel can look, so nothing overlaps at any lean.
     */
    private fun consoleOffset(s: Double, c: Comfort, timerDy: Double, sideTimerYawDeg: Double): Double {
        val boardHalf = wide(BOARD_WIDTH * s / 2, FOCUS.distance * c.reach)
        val consoleHalf = wide(COMMAND_WIDTH * s / 2, COMMAND.distance * c.reach)
        val row = TIMERS[0].distance * c.reach
        var console = max(COMMAND.yawDeg, boardHalf + consoleHalf + GAP_DEG)
        val consoleTop = elevation(COMMAND) + wide(COMMAND_HEIGHT * s / 2, COMMAND.distance * c.reach)
        val rowBottom = atan2(timerDy, TIMERS[0].distance) * 180 / PI - wide(TIMER_HEIGHT * s / 2, row)
        if (consoleTop + GAP_DEG > rowBottom) console = max(console, sideTimerYawDeg + wide(TIMER_WIDTH * s / 2, row) + consoleHalf + GAP_DEG)
        return console
    }

    private fun withSides(f: Fit, c: Comfort): Fit {
        val s = f.scale
        val boardHalf = wide(BOARD_WIDTH * s / 2, FOCUS.distance * c.reach)
        val consoleHalf = wide(COMMAND_WIDTH * s / 2, COMMAND.distance * c.reach)
        val console = consoleOffset(s, c, f.timerDy, f.sideTimerYawDeg)
        val limit = c.turnDeg + EYE_DEG
        val home = when (c.side) {
            Side.Both -> 0.0
            Side.Left -> (limit - console).coerceIn(0.0, SIDE_SHIFT_DEG)
            Side.Right -> -(limit - console).coerceIn(0.0, SIDE_SHIFT_DEG)
        }
        val consoleYaw = if (c.side == Side.Right) home - console else home + console
        // Parked boards look the same size at any scale (further out when larger): their half width at the shelf.
        val parkedHalf = halfAngle(BOARD_WIDTH / 2, STACK[0].distance, 0.0)
        val clearOfBoard = boardHalf + parkedHalf + 2 * MARGIN_DEG
        val shelf = c.side == Side.Both &&
            (PARKED + FAR).all { abs(it.yawDeg) <= limit } &&
            abs(PARKED[0].yawDeg) >= clearOfBoard &&
            PARKED[2].yawDeg - parkedHalf >= console + consoleHalf + MARGIN_DEG
        val stack = when {
            shelf -> null
            c.side == Side.Both -> -max(clearOfBoard, min(abs(PARKED[0].yawDeg), limit))
            else -> {
                // Past the console on that side; when that is beyond the turn, across the board where the eyes reach
                // (boards only glanced at; what the hands work with stays on the side asked).
                val toSide = if (c.side == Side.Right) -1.0 else 1.0
                val beyond = consoleYaw + toSide * (consoleHalf + parkedHalf + 2 * MARGIN_DEG)
                val across = home - toSide * clearOfBoard
                if (abs(beyond) <= limit || abs(across) > limit) beyond else across
            }
        }
        return Fit(s, f.focusDy, f.timerDy, f.sideTimerYawDeg, f.previewDy, home, consoleYaw, stack)
    }

    /** Degrees above (+) or below (-) the eyes. */
    private fun elevation(slot: Slot): Double = atan2(slot.dy, slot.distance) * 180 / PI

    /** The slot's own height when [el] is its designed elevation (exactly as designed), else the height at [el]. */
    private fun heightAt(slot: Slot, el: Double): Double = if (el == elevation(slot)) slot.dy else slot.distance * tan(el * PI / 180)

    /** Half the angle a panel half-size [half] fills, facing the eyes at horizontal [distance] and elevation [el]. */
    private fun halfAngle(half: Double, distance: Double, el: Double): Double = atan(half * cos(el * PI / 180) / distance) * 180 / PI

    /** The most a panel half-size [half] at horizontal [distance] can fill, whatever its lean (degrees). */
    private fun wide(half: Double, distance: Double): Double = atan(half / distance) * 180 / PI

    /**
     * [distance] metres from the eyes along [yawDeg] (horizontally), [dy] above them, turned and tilted to face them.
     * For a body: [reach] times as far along the same line of sight, then the whole layout turned [tiltDeg] up (+) or
     * down round the eyes' left-right axis, as if the head leaned back, so panels keep their spacing (raising each one
     * on its own would crowd those at the sides together).
     */
    private fun place(anchor: Pose, yawDeg: Double, distance: Double, dy: Double, reach: Double, tiltDeg: Double): Pose {
        if (reach == 1.0 && tiltDeg == 0.0) {
            val yaw = anchor.yaw + yawDeg * PI / 180.0
            return Pose(
                x = anchor.x - sin(yaw) * distance,
                y = anchor.y + dy,
                z = anchor.z - cos(yaw) * distance,
                yaw = yaw,
                pitch = atan2(dy, distance),
            )
        }
        // In the anchor's frame: x to the right, y up, f ahead.
        val turn = yawDeg * PI / 180
        val t = tiltDeg * PI / 180
        val x = -sin(turn) * distance * reach
        val ahead = cos(turn) * distance * reach
        val rise = dy * reach
        val y = rise * cos(t) + ahead * sin(t)
        val f = ahead * cos(t) - rise * sin(t)
        val wx = x * cos(anchor.yaw) - f * sin(anchor.yaw)
        val wz = -x * sin(anchor.yaw) - f * cos(anchor.yaw)
        return Pose(x = anchor.x + wx, y = anchor.y + y, z = anchor.z + wz, yaw = atan2(-wx, -wz), pitch = atan2(y, hypot(wx, wz)))
    }

    internal fun distance(a: Pose, b: Pose): Double = hypot(hypot(a.x - b.x, a.y - b.y), a.z - b.z)
}
