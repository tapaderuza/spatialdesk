package app.spatialdesk.server

import app.spatialdesk.shared.PROTOCOL_VERSION
import app.spatialdesk.shared.Protocol
import app.spatialdesk.shared.ServerMessage
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketSession
import org.springframework.web.socket.client.standard.StandardWebSocketClient
import org.springframework.web.socket.handler.TextWebSocketHandler
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["spatialdesk.sessions.per-ip-per-hour=5"],
)
class WorkspaceApiTest {
    @LocalServerPort
    private var port: Int = 0

    private val http = HttpClient.newHttpClient()

    private fun post(path: String, forwardedFor: String = "203.0.113.7, 10.0.0.1"): HttpResponse<String> =
        http.send(
            HttpRequest.newBuilder(URI.create("http://localhost:$port$path"))
                .header("X-Forwarded-For", forwardedFor)
                .POST(HttpRequest.BodyPublishers.noBody()).build(),
            HttpResponse.BodyHandlers.ofString(),
        )

    private fun newSession(ip: String = "198.51.100.${(1..250).random()}, 10.0.0.1"): String {
        val res = post("/api/sessions", ip)
        assertEquals(200, res.statusCode(), res.body())
        return Regex("\"sessionId\":\"([^\"]+)\"").find(res.body())!!.groupValues[1]
    }

    private fun connect(session: String, inbox: LinkedBlockingQueue<String>): WebSocketSession =
        StandardWebSocketClient().execute(
            object : TextWebSocketHandler() {
                override fun handleTextMessage(s: WebSocketSession, m: TextMessage) {
                    inbox.add(m.payload)
                }
            },
            "ws://localhost:$port/ws?session=$session",
        ).get(5, TimeUnit.SECONDS)

    @Test
    fun `a new session opens a socket that says hello and answers pings`() {
        val session = newSession()
        val inbox = LinkedBlockingQueue<String>()
        val ws = connect(session, inbox)

        val hello = Protocol.decodeServer(inbox.poll(5, TimeUnit.SECONDS)!!)
        assertInstanceOf(ServerMessage.Hello::class.java, hello)
        hello as ServerMessage.Hello
        assertEquals(session, hello.sessionId)
        assertEquals(PROTOCOL_VERSION, hello.protocol)
        assertTrue(hello.serverTimeMs > 1.7e12)

        ws.sendMessage(TextMessage(Protocol.ping(1234.5)))
        val pong = Protocol.decodeServer(inbox.poll(5, TimeUnit.SECONDS)!!)
        assertEquals(1234.5, (pong as ServerMessage.Pong).clientTimeMs)
        ws.close()
    }

    @Test
    fun `an unknown session cannot open a socket`() {
        assertThrows<Exception> { connect("not-a-real-session", LinkedBlockingQueue()) }
    }

    @Test
    fun `session creation is rate limited per client network`() {
        val statuses = (1..6).map { post("/api/sessions", "192.0.2.44, 10.0.0.1").statusCode() }
        assertEquals(List(5) { 200 } + 429, statuses)
    }

    @Test
    fun `health endpoint is up for the load balancer`() {
        val res = http.send(HttpRequest.newBuilder(URI.create("http://localhost:$port/actuator/health/liveness")).build(), HttpResponse.BodyHandlers.ofString())
        assertEquals(200, res.statusCode())
    }
}
