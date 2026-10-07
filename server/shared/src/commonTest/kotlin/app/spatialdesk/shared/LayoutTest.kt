package app.spatialdesk.shared

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.test.Test
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

    private fun near(anchor: Pose) = listOf(
        Panel("focus board", Layout.focus(anchor), Layout.BOARD_WIDTH, Layout.BOARD_HEIGHT),
        Panel("command panel", Layout.command(anchor), Layout.COMMAND_WIDTH, Layout.COMMAND_HEIGHT),
    ) + (0 until Layout.timerSlots).map { Panel("timer $it", Layout.timer(anchor, it), Layout.TIMER_WIDTH, Layout.TIMER_HEIGHT) }

    private fun parked(anchor: Pose) = (0 until Layout.parkedSlots).map { Panel("parked $it", Layout.parked(anchor, it), Layout.BOARD_WIDTH, Layout.BOARD_HEIGHT) }

    /** Horizontal distance from the eyes, yaw relative to the user's facing, and elevation, in degrees. */
    private fun polar(anchor: Pose, p: Pose): Triple<Double, Double, Double> {
        val dx = p.x - anchor.x
        val dz = p.z - anchor.z
        val distance = hypot(dx, dz)
        var yaw = atan2(-dx, -dz) - anchor.yaw
        while (yaw > PI) yaw -= 2 * PI
        while (yaw < -PI) yaw += 2 * PI
        return Triple(distance, yaw * 180 / PI, atan2(p.y - anchor.y, distance) * 180 / PI)
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

    /** Angular rectangles seen from the eyes. */
    private fun overlap(anchor: Pose, a: Panel, b: Panel): Boolean {
        fun box(p: Panel): DoubleArray {
            val (d, yaw, el) = polar(anchor, p.pose)
            val hw = atan(p.width / 2 / d) * 180 / PI
            val hh = atan(p.height / 2 / d) * 180 / PI
            return doubleArrayOf(yaw - hw, yaw + hw, el - hh, el + hh)
        }
        val (x1, x2, y1, y2) = box(a).toList()
        val (u1, u2, v1, v2) = box(b).toList()
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
