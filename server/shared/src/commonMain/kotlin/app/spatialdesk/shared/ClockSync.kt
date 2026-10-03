@file:OptIn(ExperimentalJsExport::class)

package app.spatialdesk.shared

import kotlin.js.ExperimentalJsExport
import kotlin.js.JsExport

/**
 * Estimates serverTime − localTime from Ping/Pong round trips, NTP style: for a ping sent at local time t0,
 * answered at server time s and received at local time t1, offset ≈ s − (t0 + t1) / 2, with an error of at
 * most half the round trip. The sample with the shortest round trip in a sliding window is the most precise,
 * so that is the one used (the window also follows clock drift).
 *
 * Shared by the server's tests and the headset's browser, so every spatial timer agrees on the same second.
 */
@JsExport
class ClockSync(private val window: Int = 8) {
    private val offsets = DoubleArray(window)
    private val rtts = DoubleArray(window)
    private var count = 0

    /** Best offset so far, or 0 before the first Pong (callers then simply use the local clock). */
    var offsetMs: Double = 0.0
        private set

    /** Round trip of the sample behind [offsetMs]; -1 before the first Pong. */
    var rttMs: Double = -1.0
        private set

    val synced: Boolean get() = count > 0

    fun onPong(sentLocalMs: Double, serverTimeMs: Double, receivedLocalMs: Double) {
        val rtt = receivedLocalMs - sentLocalMs
        if (rtt < 0) return // clock went backwards locally: discard
        val i = count % window
        offsets[i] = serverTimeMs - (sentLocalMs + receivedLocalMs) / 2
        rtts[i] = rtt
        count++
        var best = 0
        for (k in 1 until minOf(count, window)) if (rtts[k] < rtts[best]) best = k
        offsetMs = offsets[best]
        rttMs = rtts[best]
    }

    fun serverNow(localMs: Double): Double = localMs + offsetMs
}
