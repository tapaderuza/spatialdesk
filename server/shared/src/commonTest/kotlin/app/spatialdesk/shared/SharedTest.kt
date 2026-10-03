package app.spatialdesk.shared

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProtocolTest {
    @Test
    fun `messages round-trip with a type discriminator`() {
        val hello = ServerMessage.Hello("abc", 1_700_000_000_123.0, PROTOCOL_VERSION)
        val json = Protocol.encodeServer(hello)
        assertTrue("\"type\":\"hello\"" in json, json)
        assertEquals(hello, Protocol.decodeServer(json))
        assertEquals(ClientMessage.Ping(42.0), Protocol.decodeClient(Protocol.ping(42.0)))
    }

    @Test
    fun `unknown or broken input is ignored, never thrown`() {
        assertNull(Protocol.decodeServer("""{"type":"from-the-future","x":1}"""))
        assertNull(Protocol.decodeServer("not json"))
        assertEquals(ServerMessage.Pong(1.0, 2.0), Protocol.decodeServer("""{"type":"pong","clientTimeMs":1,"serverTimeMs":2,"newField":true}"""))
    }
}

class ClockSyncTest {
    @Test
    fun `offset comes from the shortest round trip`() {
        val sync = ClockSync()
        // True offset +1000 ms. Slow sample: 200 ms round trip, asymmetric (150 out, 50 back).
        sync.onPong(sentLocalMs = 0.0, serverTimeMs = 1150.0, receivedLocalMs = 200.0)
        // Fast sample: 20 ms round trip, symmetric.
        sync.onPong(sentLocalMs = 500.0, serverTimeMs = 1510.0, receivedLocalMs = 520.0)
        assertEquals(1000.0, sync.offsetMs)
        assertEquals(20.0, sync.rttMs)
        assertEquals(2000.0, sync.serverNow(1000.0))
    }

    @Test
    fun `negative round trips are discarded and the window slides`() {
        val sync = ClockSync(window = 2)
        sync.onPong(100.0, 0.0, 50.0)
        assertEquals(false, sync.synced)
        sync.onPong(0.0, 1005.0, 10.0)  // rtt 10, offset 1000
        sync.onPong(20.0, 1530.0, 60.0) // rtt 40, offset 1490
        sync.onPong(70.0, 1600.0, 110.0) // rtt 40, offset 1510: the rtt-10 sample has left the window
        assertEquals(40.0, sync.rttMs)
    }
}
