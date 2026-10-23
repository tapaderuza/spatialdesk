package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The layout's comfort and reachability rules (ROADMAP heuristic A), checked for a seated and a standing user
 * facing several directions. Every slot is relative to the eyes, so these hold wherever the user sits.
 */
class LayoutTest {
    private class Panel(val name: String, val pose: Pose, val width: Double, val height: Double)

    private val users = listOf(
        "seated" to Pose(0.3, 1.2, -0.4, yaw = 0.0),
        "standing" to Pose(-1.0, 1.7, 2.0, yaw = 0.9),
        "seated, turned" to Pose(0.0, 1.15, 0.0, yaw = -2.4),
    )

    private fun near(anchor: Pose, c: Comfort = Comfort()): List<Panel> {
        val s = Layout.scale(ViewFit(), c)
        return listOf(
            Panel("focus board", Layout.focus(anchor, comfort = c), Layout.BOARD_WIDTH * s, Layout.BOARD_HEIGHT * s),
            Panel("command panel", Layout.command(anchor, comfort = c), Layout.COMMAND_WIDTH * s, Layout.COMMAND_HEIGHT * s),
        ) + (0 until Layout.timerSlots).map { Panel("timer $it", Layout.timer(anchor, it, comfort = c), Layout.TIMER_WIDTH * s, Layout.TIMER_HEIGHT * s) }
    }

    private fun parked(anchor: Pose, c: Comfort = Comfort()): List<Panel> {
        val s = Layout.scale(ViewFit(), c)
        return (0 until Layout.parkedSlots).map { Panel("parked $it", Layout.parked(anchor, it, comfort = c), Layout.BOARD_WIDTH * s, Layout.BOARD_HEIGHT * s) }
    }

    /** Bodies the agent adapts the space to (src/agent: set_comfort), from what people say about themselves. */
    private val bodies = listOf(
        "can't turn the neck" to Comfort(turnDeg = 25.0),
        "right side only" to Comfort(side = Side.Right),
        "left side only" to Comfort(side = Side.Left),
        "right side, can't turn" to Comfort(side = Side.Right, turnDeg = 25.0),
        "close by" to Comfort(reach = 0.7),
        "tired eyes" to Comfort(scale = 1.4, reach = 1.4),
        "bigger" to Comfort(scale = 1.4),
        "lying back" to Comfort(tiltDeg = 20.0),
        // "My neck hurts a lot today, and I'm tired: bring everything closer, on the right, and the text bigger."
        "a bad day" to Comfort(side = Side.Right, turnDeg = 25.0, reach = 0.75, scale = 1.3),
    )

    /**
     * Horizontal distance from the eyes, yaw relative to the user's facing, and elevation, in degrees; for a body that
     * leans back ([tiltDeg]), as its own eyes see them (the tilt undone round the eyes' left-right axis).
     */
    private fun polar(anchor: Pose, p: Pose, tiltDeg: Double = 0.0): Triple<Double, Double, Double> {
        val dx = p.x - anchor.x
        val dz = p.z - anchor.z
        val x = dx * cos(anchor.yaw) - dz * sin(anchor.yaw)
        val ahead = -dx * sin(anchor.yaw) - dz * cos(anchor.yaw)
        val t = tiltDeg * PI / 180
        val up = (p.y - anchor.y) * cos(t) - ahead * sin(t)
        val f = ahead * cos(t) + (p.y - anchor.y) * sin(t)
        val distance = hypot(x, f)
        return Triple(distance, atan2(-x, f) * 180 / PI, atan2(up, distance) * 180 / PI)
    }

    /** A point in the user's own frame (x right, y up, f ahead, leaning back [tiltDeg]) in the world. */
    private fun world(anchor: Pose, x: Double, y: Double, f: Double, tiltDeg: Double): Vec {
        val t = tiltDeg * PI / 180
        val up = y * cos(t) + f * sin(t)
        val ahead = f * cos(t) - y * sin(t)
        return Vec(anchor.x + x * cos(anchor.yaw) - ahead * sin(anchor.yaw), anchor.y + up, anchor.z - x * sin(anchor.yaw) - ahead * cos(anchor.yaw))
    }

    @Test
    fun `the focus board sits in the seated work zone`() {
        for ((who, anchor) in users) {
            val (distance, yaw, elevation) = polar(anchor, Layout.focus(anchor))
            assertTrue(distance in 0.55..0.65, "$who: focus board at $distance m")
            assertTrue(abs(yaw) < 1e-6, "$who: straight ahead")
            assertTrue(elevation in -16.0..10.0, "$who: focus board at $elevation deg")
        }
    }

    @Test
    fun `near panels are within reach and never overlap`() {
        for ((who, anchor) in users) {
            val panels = near(anchor)
            for (p in panels) {
                val (distance, _, _) = polar(anchor, p.pose)
                assertTrue(distance <= 0.7, "$who: ${p.name} at $distance m")
            }
            for (i in panels.indices) for (j in i + 1 until panels.size) {
                assertTrue(!overlap(anchor, panels[i], panels[j]), "$who: ${panels[i].name} overlaps ${panels[j].name}")
            }
        }
    }

    @Test
    fun `parked boards are apart, further out, and visible past every near panel`() {
        for ((who, anchor) in users) {
            val far = parked(anchor)
            for (p in far) assertTrue(polar(anchor, p.pose).first >= 1.3, "$who: ${p.name} too close")
            for (i in far.indices) for (j in i + 1 until far.size) assertTrue(!overlap(anchor, far[i], far[j]), "$who: ${far[i].name} overlaps ${far[j].name}")
            // A pinch ray runs from a shoulder through the hand to the target: no near panel may sit in between.
            val right = Vec(cos(anchor.yaw), 0.0, -sin(anchor.yaw))
            val eye = Vec(anchor.x, anchor.y, anchor.z)
            for (side in listOf(-1.0, 1.0)) {
                val shoulder = eye + right * (0.18 * side) + Vec(0.0, -0.25, 0.0)
                for (target in far) for (blocker in near(anchor)) {
                    assertTrue(
                        !segmentHits(shoulder, Vec(target.pose.x, target.pose.y, target.pose.z), blocker),
                        "$who: the ray from the ${if (side < 0) "left" else "right"} shoulder to ${target.name} crosses the ${blocker.name}",
                    )
                }
            }
        }
    }

    /**
     * Meta VR Glasses: the render extent IWER samples from the device (37 deg either side, 25 up, 43 down) times Meta's
     * p90 perceived share of it (58 of 74 across, 54 of 68 up and down): what src/ui/view-fit.ts measures there.
     */
    private val glasses = ViewFit(halfWidthDeg = 37.0 * 58 / 74, upDeg = 25.0 * 54 / 68, downDeg = 43.0 * 54 / 68)

    @Test
    fun `on a Quest the layout is exactly as designed`() {
        val anchor = Layout.DEFAULT_ANCHOR
        assertEquals(1.0, Layout.scale(ViewFit()))
        assertEquals(-0.17, Layout.focus(anchor).y - anchor.y, 1e-12)
        assertEquals(0.24, Layout.timer(anchor, 0).y - anchor.y, 1e-12)
        assertEquals(-0.05, Layout.preview(anchor).y - anchor.y, 1e-12)
    }

    @Test
    fun `in the glasses' narrower view the essential panels fit, still within reach`() {
        val s = Layout.scale(glasses)
        assertTrue(s in 0.8..0.9, "scale $s")
        for ((who, anchor) in users) {
            val essential = listOf(
                Panel("focus board", Layout.focus(anchor, glasses), Layout.BOARD_WIDTH * s, Layout.BOARD_HEIGHT * s),
                Panel("first timer", Layout.timer(anchor, 0, glasses), Layout.TIMER_WIDTH * s, Layout.TIMER_HEIGHT * s),
                Panel("agent's card", Layout.preview(anchor, glasses), Layout.PREVIEW_WIDTH * s, Layout.PREVIEW_HEIGHT * s),
            )
            for (p in essential) {
                val (x1, x2, y1, y2) = box(anchor, p).toList()
                assertTrue(x1 >= -glasses.halfWidthDeg && x2 <= glasses.halfWidthDeg, "$who: ${p.name} spans $x1..$x2 deg across")
                assertTrue(y1 >= -glasses.downDeg && y2 <= glasses.upDeg, "$who: ${p.name} spans $y1..$y2 deg up")
            }
            assertTrue(!overlap(anchor, essential[0], essential[1]), "$who: the timer overlaps the board")
            assertTrue(polar(anchor, essential[0].pose).first in 0.55..0.65, "$who: the focus board left arm's reach")
        }
    }

    @Test
    fun `a view too narrow for anything still gets a readable layout`() {
        val tiny = ViewFit(10.0, 8.0, 8.0)
        assertEquals(Layout.MIN_SCALE, Layout.scale(tiny), 1e-9)
        assertTrue(polar(Layout.DEFAULT_ANCHOR, Layout.focus(Layout.DEFAULT_ANCHOR, tiny)).first in 0.55..0.65)
    }

    @Test
    fun `for every body the rules still hold - nothing overlaps, and every parked board is in sight and reach of a pinch`() {
        for ((body, c) in bodies) for ((who, anchor) in users) {
            val near = near(anchor, c)
            val far = parked(anchor, c)
            val t = c.tiltDeg
            for (i in near.indices) for (j in i + 1 until near.size) {
                assertTrue(!overlap(anchor, near[i], near[j], t), "$body, $who: ${near[i].name} overlaps ${near[j].name}")
            }
            for (i in far.indices) for (j in i + 1 until far.size) {
                assertTrue(!overlap(anchor, far[i], far[j], t), "$body, $who: ${far[i].name} overlaps ${far[j].name}")
            }
            for (p in far) for (n in near) assertTrue(!overlap(anchor, p, n, t), "$body, $who: ${p.name} is hidden by the ${n.name}")
            for (side in listOf(-1.0, 1.0)) {
                val shoulder = world(anchor, 0.18 * side, -0.25, 0.0, t)
                for (target in far) for (blocker in near) {
                    assertTrue(
                        !segmentHits(shoulder, Vec(target.pose.x, target.pose.y, target.pose.z), blocker),
                        "$body, $who: the ray from the ${if (side < 0) "left" else "right"} shoulder to ${target.name} crosses the ${blocker.name}",
                    )
                }
            }
        }
    }

    @Test
    fun `each comfort does what it says`() {
        val a = Layout.DEFAULT_ANCHOR
        // The defaults are the layout as designed.
        assertEquals(Layout.focus(a), Layout.focus(a, ViewFit(), Comfort()))
        assertEquals(Layout.command(a), Layout.command(a, ViewFit(), Comfort()))
        assertEquals(Layout.parked(a, 2), Layout.parked(a, 2, false, ViewFit(), Comfort()))
        assertEquals(50.0, polar(a, Layout.command(a)).second, 1e-9)

        // A neck that turns 25 degrees: every panel within that and the eyes' own reach, also nearer and larger, with
        // what the hands use on the right; nearer, the text still looks larger than designed.
        val badDay = Comfort(side = Side.Right, turnDeg = 25.0, reach = 0.75, scale = 1.3)
        for (neck in listOf(Comfort(turnDeg = 25.0), badDay)) {
            for (p in near(a, neck) + parked(a, neck)) {
                val yaw = polar(a, p.pose).second
                assertTrue(abs(yaw) <= 25.0 + Layout.EYE_DEG + 1e-9, "$neck: ${p.name} at $yaw deg")
            }
        }
        assertTrue(polar(a, Layout.command(a, comfort = badDay)).second < -30.0, "a bad day: the console by the right hand")
        assertTrue(Layout.scale(ViewFit(), badDay) / 0.75 > 1.05, "a bad day: text looks larger than designed")

        // One side: everything gathers there (+ is left), the console too.
        for ((c, sign) in listOf(Comfort(side = Side.Right) to -1.0, Comfort(side = Side.Left) to 1.0)) {
            for (p in near(a, c) + parked(a, c)) {
                val yaw = polar(a, p.pose).second
                assertTrue(yaw * sign >= -10.0, "${c.side}: ${p.name} at $yaw deg")
            }
            assertTrue(polar(a, Layout.command(a, comfort = c)).second * sign > 45.0, "${c.side}: the console")
            assertTrue(polar(a, Layout.focus(a, comfort = c)).second * sign > 0.0, "${c.side}: the board leans that way")
        }

        // Reach: further along the same line of sight; nearer, the board looks larger and rises just enough to stay in view.
        val (d0, _, e0) = polar(a, Layout.focus(a))
        val (d1, _, e1) = polar(a, Layout.focus(a, comfort = Comfort(reach = 1.3)))
        assertEquals(d0 * 1.3, d1, 1e-9)
        assertEquals(e0, e1, 1e-9)
        assertTrue(polar(a, Layout.focus(a, comfort = Comfort(reach = 0.7))).first < 0.47)

        // Tired eyes: larger panels further away, at the same angle.
        assertEquals(1.4, Layout.scale(ViewFit(), Comfort(scale = 1.4, reach = 1.4)), 1e-9)
        val (d2, y2, e2) = polar(a, Layout.focus(a, comfort = Comfort(scale = 1.4, reach = 1.4)))
        assertEquals(d0 * 1.4, d2, 1e-9)
        assertEquals(0.0, y2, 1e-9)
        assertEquals(e0, e2, 1e-9)
        // Larger than the view allows: as large as it allows.
        assertTrue(Layout.scale(glasses, Comfort(scale = 1.8)) < 1.0)

        // Lying back: everything 20 degrees higher round the eyes, just as far from them.
        val (d3, _, e3) = polar(a, Layout.focus(a, comfort = Comfort(tiltDeg = 20.0)))
        assertEquals(e0 + 20.0, e3, 1e-9)
        assertEquals(d0 / cos(e0 * PI / 180), d3 / cos(e3 * PI / 180), 1e-9)
    }

    /** A panel's angular rectangle seen from the eyes: [left, right, bottom, top] in degrees. */
    private fun box(anchor: Pose, p: Panel, tiltDeg: Double = 0.0): DoubleArray {
        val (d, yaw, el) = polar(anchor, p.pose, tiltDeg)
        val hw = atan(p.width / 2 / d) * 180 / PI
        val hh = atan(p.height / 2 / d) * 180 / PI
        return doubleArrayOf(yaw - hw, yaw + hw, el - hh, el + hh)
    }

    /** Angular rectangles seen from the eyes. */
    private fun overlap(anchor: Pose, a: Panel, b: Panel, tiltDeg: Double = 0.0): Boolean {
        val (x1, x2, y1, y2) = box(anchor, a, tiltDeg).toList()
        val (u1, u2, v1, v2) = box(anchor, b, tiltDeg).toList()
        return x1 < u2 && u1 < x2 && y1 < v2 && v1 < y2
    }

    private data class Vec(val x: Double, val y: Double, val z: Double) {
        operator fun plus(o: Vec) = Vec(x + o.x, y + o.y, z + o.z)
        operator fun minus(o: Vec) = Vec(x - o.x, y - o.y, z - o.z)
        operator fun times(s: Double) = Vec(x * s, y * s, z * s)
        fun dot(o: Vec) = x * o.x + y * o.y + z * o.z
    }

    /** Does the segment from [a] to [b] pass through the panel's rectangle (yaw, then pitch, like the app)? */
    private fun segmentHits(a: Vec, b: Vec, panel: Panel): Boolean {
        val p = panel.pose
        val right = Vec(cos(p.yaw), 0.0, -sin(p.yaw))
        val up = Vec(sin(p.yaw) * sin(p.pitch), cos(p.pitch), cos(p.yaw) * sin(p.pitch))
        val normal = Vec(sin(p.yaw) * cos(p.pitch), -sin(p.pitch), cos(p.yaw) * cos(p.pitch))
        val center = Vec(p.x, p.y, p.z)
        val dir = b - a
        val denom = dir.dot(normal)
        if (abs(denom) < 1e-9) return false
        val t = (center - a).dot(normal) / denom
        if (t <= 0 || t >= 1) return false
        val hit = a + dir * t - center
        return abs(hit.dot(right)) <= panel.width / 2 && abs(hit.dot(up)) <= panel.height / 2
    }
}
